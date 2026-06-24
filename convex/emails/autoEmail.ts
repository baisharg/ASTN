'use node'

import { v } from 'convex/values'
import { marked } from 'marked'
import { emojify } from 'node-emoji'
import { internal } from '../_generated/api'
import { internalAction } from '../_generated/server'
import { renderAdminBroadcast } from './templates'
import type { Id } from '../_generated/dataModel'

/**
 * Send an auto-email triggered by a new application or status change.
 * Resolves recipient info, substitutes template variables, and sends via Resend.
 */
export const sendAutoEmail = internalAction({
  args: {
    applicationId: v.id('opportunityApplications'),
    trigger: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { applicationId, trigger }) => {
    // Single query: application + config
    const data: {
      application: {
        _id: string
        opportunityId: string
        orgId: string
      }
      config: {
        enabled: boolean
        templates: Array<{
          trigger: string
          subject: string
          markdownBody: string
          requiresPoll: boolean
        }>
      } | null
    } | null = await ctx.runQuery(
      internal.emails.autoEmailHelpers.getApplicationAndConfig,
      { applicationId },
    )

    if (!data?.config?.enabled) return null
    const template = data.config.templates.find((t) => t.trigger === trigger)
    if (!template) return null

    // Single query: recipient + poll token
    const recipientData: {
      email: string
      name: string
      pollToken: {
        accessToken: string
        respondentToken: string
        orgSlug: string
      } | null
    } | null = await ctx.runQuery(
      internal.emails.autoEmailHelpers.getRecipientAndPollToken,
      { applicationId },
    )
    if (!recipientData) return null

    // Build poll link from token data (URL constructed here in node runtime)
    let pollLink: string | null = null
    if (recipientData.pollToken) {
      const baseUrl = process.env.SITE_URL ?? 'https://safetytalent.org'
      const { orgSlug, accessToken, respondentToken } = recipientData.pollToken
      pollLink = `${baseUrl}/org/${orgSlug}/poll/${accessToken}/${respondentToken}`
    }

    // If requiresPoll and no poll link, skip
    if (template.requiresPoll && !pollLink) return null

    // Substitute template variables
    let body = template.markdownBody
    let subject = template.subject
    body = body.replaceAll('{{applicant_name}}', recipientData.name)
    subject = subject.replaceAll('{{applicant_name}}', recipientData.name)
    if (pollLink) {
      body = body.replaceAll('{{poll_link}}', pollLink)
      subject = subject.replaceAll('{{poll_link}}', pollLink)
    }

    // Render HTML
    const bodyHtml: string = await marked(emojify(body), {
      breaks: true,
      gfm: true,
    })
    const html: string = await renderAdminBroadcast({
      userName: recipientData.name,
      bodyHtml,
    })

    const opportunityId = data.application
      .opportunityId as Id<'orgOpportunities'>

    // Send email + log
    try {
      await ctx.runMutation(internal.emails.adminBroadcast.sendSingleEmail, {
        to: recipientData.email,
        subject,
        html,
      })

      await ctx.runMutation(internal.emails.autoEmailHelpers.logAutoEmail, {
        opportunityId,
        applicationId,
        recipientEmail: recipientData.email,
        recipientName: recipientData.name,
        trigger,
        subject,
        status: 'sent',
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      await ctx.runMutation(internal.emails.autoEmailHelpers.logAutoEmail, {
        opportunityId,
        applicationId,
        recipientEmail: recipientData.email,
        recipientName: recipientData.name,
        trigger,
        subject,
        status: 'failed',
        error: errorMessage,
      })
    }

    return null
  },
})

/**
 * Send the built-in availability poll email to an applicant. Used by the
 * per-opportunity "auto-send availability email" toggle — no admin-authored
 * template required. Skips silently if there's no poll link for the applicant.
 */
export const sendAvailabilityEmail = internalAction({
  args: { applicationId: v.id('opportunityApplications') },
  returns: v.null(),
  handler: async (ctx, { applicationId }) => {
    const data: {
      application: { _id: string; opportunityId: string; orgId: string }
    } | null = await ctx.runQuery(
      internal.emails.autoEmailHelpers.getApplicationAndConfig,
      { applicationId },
    )
    if (!data) return null

    const recipientData: {
      email: string
      name: string
      pollToken: {
        accessToken: string
        respondentToken: string
        orgSlug: string
      } | null
    } | null = await ctx.runQuery(
      internal.emails.autoEmailHelpers.getRecipientAndPollToken,
      { applicationId },
    )
    if (!recipientData) return null

    // The availability email is meaningless without a poll link — skip.
    if (!recipientData.pollToken) return null
    const baseUrl = process.env.SITE_URL ?? 'https://safetytalent.org'
    const { orgSlug, accessToken, respondentToken } = recipientData.pollToken
    const pollLink = `${baseUrl}/org/${orgSlug}/poll/${accessToken}/${respondentToken}`

    const subject = 'Share your availability'
    const markdownBody =
      `Hi ${recipientData.name},\n\n` +
      `Thanks for applying! To help us schedule sessions that work for you, ` +
      `please fill out your availability here:\n\n` +
      `[Set your availability](${pollLink})\n\n` +
      `It only takes a minute — thank you!`

    const bodyHtml: string = await marked(emojify(markdownBody), {
      breaks: true,
      gfm: true,
    })
    const html: string = await renderAdminBroadcast({
      userName: recipientData.name,
      bodyHtml,
    })
    const opportunityId = data.application
      .opportunityId as Id<'orgOpportunities'>

    try {
      await ctx.runMutation(internal.emails.adminBroadcast.sendSingleEmail, {
        to: recipientData.email,
        subject,
        html,
      })
      await ctx.runMutation(internal.emails.autoEmailHelpers.logAutoEmail, {
        opportunityId,
        applicationId,
        recipientEmail: recipientData.email,
        recipientName: recipientData.name,
        trigger: 'availability',
        subject,
        status: 'sent',
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      await ctx.runMutation(internal.emails.autoEmailHelpers.logAutoEmail, {
        opportunityId,
        applicationId,
        recipientEmail: recipientData.email,
        recipientName: recipientData.name,
        trigger: 'availability',
        subject,
        status: 'failed',
        error: errorMessage,
      })
    }

    return null
  },
})
