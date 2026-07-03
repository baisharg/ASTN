'use node'

import { v } from 'convex/values'
import { marked } from 'marked'
import { emojify } from 'node-emoji'
import { internal } from '../_generated/api'
import { action, internalAction } from '../_generated/server'
import { renderAdminBroadcast } from './templates'

async function renderBody(
  markdownBody: string,
  recipientName: string,
  links: { pollLink: string | null; surveyLink: string | null },
): Promise<string> {
  let bodyMarkdown = markdownBody.replaceAll(
    '{{applicant_name}}',
    recipientName,
  )
  const blocks: Array<string> = []
  if (links.pollLink) {
    blocks.push(`[:hourglass: Set your availability](${links.pollLink})`)
  }
  if (links.surveyLink) {
    blocks.push(`[:speech_balloon: Share your feedback](${links.surveyLink})`)
  }
  if (blocks.length > 0) bodyMarkdown += `\n\n${blocks.join('\n\n')}`
  const bodyHtml: string = await marked(emojify(bodyMarkdown), {
    breaks: true,
    gfm: true,
  })
  return await renderAdminBroadcast({ userName: recipientName, bodyHtml })
}

/**
 * The on-apply confirmation email (kind application_received) — the single
 * truly-automatic email of the outbox system. Scheduled from submit handlers;
 * every precondition (kill switch, template enabled, idempotency, resolvable
 * email) is re-checked in getApplicationReceivedPayload, and finalizeAutoSend
 * re-checks idempotency atomically. If the template promises a poll/survey
 * link that can't be resolved, a *failed* log row records it — visible in
 * History, never a silent skip and never a mail without its link.
 */
export const sendApplicationReceivedEmail = internalAction({
  args: { applicationId: v.id('opportunityApplications') },
  returns: v.null(),
  handler: async (ctx, { applicationId }) => {
    const payload: {
      opportunityId: string
      to: string
      recipientName: string
      subject: string
      markdownBody: string
      includePollLink: boolean
      includeSurveyLink: boolean
    } | null = await ctx.runQuery(
      internal.emails.outbox.getApplicationReceivedPayload,
      { applicationId },
    )
    if (!payload) return null

    const subject = payload.subject.replaceAll(
      '{{applicant_name}}',
      payload.recipientName,
    )
    let links: { pollLink: string | null; surveyLink: string | null } = {
      pollLink: null,
      surveyLink: null,
    }
    if (payload.includePollLink || payload.includeSurveyLink) {
      links = await ctx.runMutation(internal.emails.outbox.ensureLinkTargets, {
        applicationId,
        includePollLink: payload.includePollLink,
        includeSurveyLink: payload.includeSurveyLink,
      })
      if (
        (payload.includePollLink && !links.pollLink) ||
        (payload.includeSurveyLink && !links.surveyLink)
      ) {
        await ctx.runMutation(internal.emails.outbox.logAutoFailure, {
          applicationId,
          kind: 'application_received',
          to: payload.to,
          recipientName: payload.recipientName,
          subject,
          error: `Not sent: template includes a ${
            payload.includePollLink && !links.pollLink
              ? 'poll link but there is no open availability poll'
              : 'feedback link but there is no open survey'
          } for this opportunity`,
        })
        return null
      }
    }

    try {
      const html = await renderBody(
        payload.markdownBody,
        payload.recipientName,
        links,
      )
      await ctx.runMutation(internal.emails.outbox.finalizeAutoSend, {
        applicationId,
        kind: 'application_received',
        to: payload.to,
        recipientName: payload.recipientName,
        subject,
        html,
      })
    } catch (err) {
      console.error('Failed to send application_received email:', err)
      await ctx.runMutation(internal.emails.outbox.logAutoFailure, {
        applicationId,
        kind: 'application_received',
        to: payload.to,
        recipientName: payload.recipientName,
        subject,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    return null
  },
})

/**
 * Send selected outbox drafts. Public action called from the Emails tab.
 *
 * Per-draft outcomes are tallied rather than all-or-nothing: drafts without a
 * resolvable email are never sent (the UI can't select them; this guards the
 * API path too), a draft whose poll/survey link can't be resolved is *blocked*
 * (stays pending, explicit outcome) rather than sent without the promised
 * link, and hard idempotency in finalizeDraftSend guarantees one sent email
 * per (application, kind) even under double-clicks or races.
 */
export const sendDrafts = action({
  args: {
    opportunityId: v.id('orgOpportunities'),
    draftIds: v.array(v.id('emailOutbox')),
  },
  returns: v.object({
    sent: v.number(),
    alreadySent: v.number(),
    noEmail: v.number(),
    blocked: v.number(),
    gone: v.number(),
    failed: v.number(),
  }),
  handler: async (ctx, { opportunityId, draftIds }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Not authenticated')

    const isAdmin: boolean = await ctx.runQuery(
      internal.emails.adminBroadcast.verifyOrgAdmin,
      { userId: identity.subject, opportunityId },
    )
    if (!isAdmin) throw new Error('Admin access required')

    await ctx.runMutation(
      internal.emails.adminBroadcast.checkBroadcastRateLimit,
      { userId: identity.subject },
    )

    const drafts: Array<{
      draftId: string
      applicationId: string
      kind: string
      subject: string
      markdownBody: string
      includePollLink: boolean
      includeSurveyLink: boolean
      recipientName: string
      recipientEmail: string | null
    }> = await ctx.runQuery(internal.emails.outbox.getDraftsForSend, {
      opportunityId,
      draftIds,
    })

    let sent = 0
    let alreadySent = 0
    let noEmail = 0
    let blocked = 0
    let gone = 0
    let failed = 0

    for (const draft of drafts) {
      if (!draft.recipientEmail) {
        noEmail++
        continue
      }
      const subject = draft.subject.replaceAll(
        '{{applicant_name}}',
        draft.recipientName,
      )
      try {
        let bodyMarkdown = draft.markdownBody.replaceAll(
          '{{applicant_name}}',
          draft.recipientName,
        )

        // System-managed link blocks: resolved per recipient at send time
        // (respondent tokens are created on demand). If the draft promises a
        // link that can't exist right now (no open poll/survey), the draft is
        // blocked and stays pending — never sent without its link.
        if (draft.includePollLink || draft.includeSurveyLink) {
          const links: { pollLink: string | null; surveyLink: string | null } =
            await ctx.runMutation(internal.emails.outbox.ensureLinkTargets, {
              applicationId: draft.applicationId as any,
              includePollLink: draft.includePollLink,
              includeSurveyLink: draft.includeSurveyLink,
            })
          if (
            (draft.includePollLink && !links.pollLink) ||
            (draft.includeSurveyLink && !links.surveyLink)
          ) {
            blocked++
            console.error(
              `Draft ${draft.draftId} blocked: missing ${
                draft.includePollLink && !links.pollLink
                  ? 'open availability poll'
                  : 'open feedback survey'
              }`,
            )
            continue
          }
          const blocks: Array<string> = []
          if (draft.includePollLink && links.pollLink) {
            blocks.push(
              `[:hourglass: Set your availability](${links.pollLink})`,
            )
          }
          if (draft.includeSurveyLink && links.surveyLink) {
            blocks.push(
              `[:speech_balloon: Share your feedback](${links.surveyLink})`,
            )
          }
          bodyMarkdown += `\n\n${blocks.join('\n\n')}`
        }
        const bodyHtml: string = await marked(emojify(bodyMarkdown), {
          breaks: true,
          gfm: true,
        })
        const html: string = await renderAdminBroadcast({
          userName: draft.recipientName,
          bodyHtml,
        })

        const outcome: 'sent' | 'already_sent' | 'gone' = await ctx.runMutation(
          internal.emails.outbox.finalizeDraftSend,
          {
            draftId: draft.draftId as any,
            to: draft.recipientEmail,
            recipientName: draft.recipientName,
            subject,
            html,
            sentBy: identity.subject,
          },
        )
        if (outcome === 'sent') sent++
        else if (outcome === 'already_sent') alreadySent++
        else gone++
      } catch (err) {
        failed++
        console.error(`Failed to send draft to ${draft.recipientEmail}:`, err)
        await ctx.runMutation(internal.emails.outbox.logFailedSend, {
          draftId: draft.draftId as any,
          to: draft.recipientEmail,
          recipientName: draft.recipientName,
          subject,
          sentBy: identity.subject,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return { sent, alreadySent, noEmail, blocked, gone, failed }
  },
})
