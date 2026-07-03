'use node'

import { v } from 'convex/values'
import { marked } from 'marked'
import { emojify } from 'node-emoji'
import { internal } from '../_generated/api'
import { action } from '../_generated/server'
import { renderAdminBroadcast } from './templates'

/**
 * Send selected outbox drafts. Public action called from the Emails tab.
 *
 * Per-draft outcomes are tallied rather than all-or-nothing: drafts without a
 * resolvable email are never sent (the UI can't select them; this guards the
 * API path too), and hard idempotency in finalizeDraftSend guarantees one sent
 * email per (application, kind) even under double-clicks or races.
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
      kind: string
      subject: string
      markdownBody: string
      recipientName: string
      recipientEmail: string | null
    }> = await ctx.runQuery(internal.emails.outbox.getDraftsForSend, {
      opportunityId,
      draftIds,
    })

    let sent = 0
    let alreadySent = 0
    let noEmail = 0
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
        const bodyMarkdown = draft.markdownBody.replaceAll(
          '{{applicant_name}}',
          draft.recipientName,
        )
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

    return { sent, alreadySent, noEmail, gone, failed }
  },
})
