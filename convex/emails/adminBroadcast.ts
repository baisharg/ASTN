import { v } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import { resolveApplicantContact } from '../lib/applicantContact'
import type { FormField } from '../lib/formFields'
import { rateLimiter } from '../lib/rateLimiter'
import { resend } from './send'

const FROM_ADDRESS = 'ASTN <notifications@safetytalent.org>'

export const applicationStatusValidator = v.union(
  v.literal('submitted'),
  v.literal('under_review'),
  v.literal('accepted'),
  v.literal('rejected'),
  v.literal('waitlisted'),
  v.literal('participated'),
)

/**
 * Get deduplicated recipients for a broadcast email, for an explicit set of
 * selected applications. Resolves email + name via the shared resolver so the
 * send matches exactly what the recipient table shows. Applications that don't
 * belong to the opportunity, or that have no resolvable email, are dropped.
 */
export const getRecipientsForEmail = internalQuery({
  args: {
    opportunityId: v.id('orgOpportunities'),
    applicationIds: v.array(v.id('opportunityApplications')),
  },
  returns: v.array(
    v.object({
      email: v.string(),
      name: v.string(),
      applicationId: v.id('opportunityApplications'),
    }),
  ),
  handler: async (ctx, { opportunityId, applicationIds }) => {
    const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
    const formFields = opportunity?.formFields as Array<FormField> | undefined

    const seen = new Set<string>()
    const recipients: Array<{
      email: string
      name: string
      applicationId: (typeof applicationIds)[number]
    }> = []

    for (const applicationId of applicationIds) {
      const app = await ctx.db.get('opportunityApplications', applicationId)
      // Safety: ignore ids that aren't applications of this opportunity.
      if (!app || app.opportunityId !== opportunityId) continue

      const { name, email } = await resolveApplicantContact(
        ctx,
        app,
        formFields,
        'there',
      )

      if (email && !seen.has(email.toLowerCase())) {
        seen.add(email.toLowerCase())
        recipients.push({ email, name, applicationId: app._id })
      }
    }

    return recipients
  },
})

/**
 * Verify that a user is an admin of the org that owns the opportunity.
 */
export const verifyOrgAdmin = internalQuery({
  args: {
    userId: v.string(),
    opportunityId: v.id('orgOpportunities'),
  },
  returns: v.boolean(),
  handler: async (ctx, { userId, opportunityId }) => {
    const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
    if (!opportunity) return false

    const membership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('orgId'), opportunity.orgId))
      .first()

    return membership?.role === 'admin'
  },
})

/**
 * Check rate limit for broadcast emails.
 * Called from action via ctx.runMutation since actions can't use rateLimiter directly.
 */
export const checkBroadcastRateLimit = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    await rateLimiter.limit(ctx, 'adminBroadcast', {
      key: userId,
      throws: true,
    })
    return null
  },
})

/**
 * Check rate limit for test emails (sent only to the admin themselves).
 */
export const checkTestEmailRateLimit = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    await rateLimiter.limit(ctx, 'adminTestEmail', {
      key: userId,
      throws: true,
    })
    return null
  },
})

/**
 * Send a single broadcast email via Resend.
 */
export const sendSingleEmail = internalMutation({
  args: {
    to: v.string(),
    subject: v.string(),
    html: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { to, subject, html }) => {
    await resend.sendEmail(ctx, {
      from: FROM_ADDRESS,
      to,
      subject,
      html,
    })
    return null
  },
})
