'use node'

import { v } from 'convex/values'
import { marked } from 'marked'
import { api, internal } from '../_generated/api'
import { action } from '../_generated/server'
import { applicationStatusValidator } from './adminBroadcast'
import { renderAdminBroadcast } from './templates'

/**
 * Send a broadcast email to applicants of an opportunity.
 * Public action called from the admin email compose page.
 *
 * If `pollId` and `pollLinkBase` are provided, `{{poll_link}}` in the markdown body
 * will be replaced with each recipient's unique poll link.
 */
export const sendBroadcastToApplicants = action({
  args: {
    opportunityId: v.id('orgOpportunities'),
    statuses: v.array(applicationStatusValidator),
    subject: v.string(),
    markdownBody: v.string(),
    pollId: v.optional(v.id('availabilityPolls')),
    pollLinkBase: v.optional(v.string()),
    surveyId: v.optional(v.id('feedbackSurveys')),
    surveyLinkBase: v.optional(v.string()),
  },
  returns: v.object({
    sent: v.number(),
    failed: v.number(),
  }),
  handler: async (
    ctx,
    {
      opportunityId,
      statuses,
      subject,
      markdownBody,
      pollId,
      pollLinkBase,
      surveyId,
      surveyLinkBase,
    },
  ) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error('Not authenticated')

    const isAdmin: boolean = await ctx.runQuery(
      internal.emails.adminBroadcast.verifyOrgAdmin,
      { userId: identity.subject, opportunityId },
    )
    if (!isAdmin) throw new Error('Admin access required')

    // Rate limit broadcast emails per admin
    await ctx.runMutation(
      internal.emails.adminBroadcast.checkBroadcastRateLimit,
      { userId: identity.subject },
    )

    const recipients: Array<{
      email: string
      name: string
      applicationId: string
    }> = await ctx.runQuery(
      internal.emails.adminBroadcast.getRecipientsForEmail,
      { opportunityId, statuses },
    )

    if (recipients.length === 0) {
      return { sent: 0, failed: 0 }
    }

    // Build applicationId → token maps for link substitution
    type LinkSub = {
      tokenMap: Map<string, string>
      linkBase: string
      placeholder: string
    }
    const linkSubs: Array<LinkSub> = []

    if (pollId && pollLinkBase && markdownBody.includes('{{poll_link}}')) {
      const respondents: Array<{
        respondentToken: string
        applicationId: string
      }> = await ctx.runQuery(api.availabilityPolls.getRespondentLinks, {
        pollId,
      })
      linkSubs.push({
        tokenMap: new Map(
          respondents.map((r) => [r.applicationId, r.respondentToken]),
        ),
        linkBase: pollLinkBase,
        placeholder: '{{poll_link}}',
      })
    }

    if (
      surveyId &&
      surveyLinkBase &&
      markdownBody.includes('{{survey_link}}')
    ) {
      const respondents: Array<{
        respondentToken: string
        applicationId: string
      }> = await ctx.runQuery(api.feedbackSurveys.getRespondentLinks, {
        surveyId,
      })
      linkSubs.push({
        tokenMap: new Map(
          respondents.map((r) => [r.applicationId, r.respondentToken]),
        ),
        linkBase: surveyLinkBase,
        placeholder: '{{survey_link}}',
      })
    }

    let sent = 0
    let failed = 0

    for (const recipient of recipients) {
      try {
        // Substitute personalized links per recipient
        let recipientMarkdown = markdownBody
        for (const sub of linkSubs) {
          const token = sub.tokenMap.get(recipient.applicationId)
          const link = token ? `${sub.linkBase}/${token}` : sub.linkBase
          recipientMarkdown = recipientMarkdown.replaceAll(
            sub.placeholder,
            link,
          )
        }

        const recipientHtml: string = await marked(recipientMarkdown, {
          breaks: true,
          gfm: true,
        })

        const html: string = await renderAdminBroadcast({
          userName: recipient.name,
          bodyHtml: recipientHtml,
        })

        await ctx.runMutation(internal.emails.adminBroadcast.sendSingleEmail, {
          to: recipient.email,
          subject,
          html,
        })
        sent++
      } catch (err) {
        console.error(`Failed to send to ${recipient.email}:`, err)
        failed++
      }
    }

    return { sent, failed }
  },
})
