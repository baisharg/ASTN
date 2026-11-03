import { v } from 'convex/values'
import { internalMutation, internalQuery, query } from './_generated/server'
import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { resolveApplicantContact } from './lib/applicantContact'
import { requireOpportunityAccess } from './lib/courseAccess'
import { courseOf } from './lib/courses'
import { sanitizeResponsesForForm } from './lib/formFields'
import type { FormField } from './lib/formFields'

/**
 * {{apply_link}}: a personal link to a course's open application, pre-filled
 * with what the recipient already answered in the opportunity the email is
 * sent from (usually their expression of interest), so they apply without an
 * account and without typing everything again. Questions match by key.
 *
 * A link works while its application is active. Once it closes the same URL
 * is the plain application link (which may show the EOI again), so nothing
 * stale is ever pre-filled. It also stops pre-filling once that person
 * applied there: whoever opens a forwarded email afterwards sees an empty
 * form, not their answers.
 */

/**
 * The application {{apply_link}} points to from `opportunity`: an EOI's
 * redirect target while it is active, otherwise the newest active edition
 * (not an EOI) of the same course, which is the opportunity itself when it is
 * one. Null when nothing is open.
 */
export async function applyTargetFor(
  ctx: QueryCtx,
  opportunity: Doc<'orgOpportunities'>,
): Promise<Doc<'orgOpportunities'> | null> {
  if (opportunity.redirectOpportunityId) {
    const target = await ctx.db.get(
      'orgOpportunities',
      opportunity.redirectOpportunityId,
    )
    if (
      target &&
      target.orgId === opportunity.orgId &&
      target.status === 'active' &&
      !target.isEOI
    ) {
      return target
    }
  }
  const course = courseOf(opportunity.tags)
  if (!course) return null
  const active = await ctx.db
    .query('orgOpportunities')
    .withIndex('by_org_and_status', (q) =>
      q.eq('orgId', opportunity.orgId).eq('status', 'active'),
    )
    .collect()
  const editions = active
    .filter((o) => !o.isEOI && courseOf(o.tags) === course)
    .sort((a, b) => b.createdAt - a.createdAt)
  return editions[0] ?? null
}

/** The email composer: where {{apply_link}} goes from this opportunity. */
export const getApplyTarget = query({
  args: { opportunityId: v.id('orgOpportunities') },
  returns: v.union(v.null(), v.object({ title: v.string(), key: v.string() })),
  handler: async (ctx, { opportunityId }) => {
    const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
    if (!opportunity) return null
    await requireOpportunityAccess(ctx, opportunity, 'read')
    const target = await applyTargetFor(ctx, opportunity)
    return target
      ? { title: target.title, key: target.slug ?? target._id }
      : null
  },
})

/** For the broadcast action: the target and the base of its links. */
export const applyTargetForSend = internalQuery({
  args: { opportunityId: v.id('orgOpportunities') },
  returns: v.union(
    v.null(),
    v.object({
      targetOpportunityId: v.id('orgOpportunities'),
      linkBase: v.string(),
    }),
  ),
  handler: async (ctx, { opportunityId }) => {
    const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
    if (!opportunity) return null
    const target = await applyTargetFor(ctx, opportunity)
    const org = await ctx.db.get('organizations', opportunity.orgId)
    if (!target || !org?.slug) return null
    const baseUrl = process.env.SITE_URL ?? 'https://safetytalent.org'
    return {
      targetOpportunityId: target._id,
      linkBase: `${baseUrl}/org/${org.slug}/apply/${target.slug ?? target._id}`,
    }
  },
})

/** One invite token per (source application, target), created on first use. */
export const ensureInvites = internalMutation({
  args: {
    targetOpportunityId: v.id('orgOpportunities'),
    applicationIds: v.array(v.id('opportunityApplications')),
  },
  returns: v.record(v.string(), v.string()),
  handler: async (ctx, { targetOpportunityId, applicationIds }) => {
    const target = await ctx.db.get('orgOpportunities', targetOpportunityId)
    if (!target) return {}
    const tokens: Record<string, string> = {}
    for (const applicationId of applicationIds) {
      const application = await ctx.db.get(
        'opportunityApplications',
        applicationId,
      )
      if (!application || application.orgId !== target.orgId) continue
      const existing = await ctx.db
        .query('applicationInvites')
        .withIndex('by_source_and_target', (q) =>
          q
            .eq('sourceApplicationId', applicationId)
            .eq('targetOpportunityId', targetOpportunityId),
        )
        .first()
      if (existing) {
        tokens[applicationId] = existing.token
        continue
      }
      const token = crypto.randomUUID()
      await ctx.db.insert('applicationInvites', {
        orgId: target.orgId,
        token,
        sourceApplicationId: applicationId,
        targetOpportunityId,
        createdAt: Date.now(),
      })
      tokens[applicationId] = token
    }
    return tokens
  },
})

async function hasApplied(
  ctx: QueryCtx,
  source: Doc<'opportunityApplications'>,
  email: string,
  targetId: Id<'orgOpportunities'>,
): Promise<boolean> {
  if (email) {
    const asGuest = await ctx.db
      .query('opportunityApplications')
      .withIndex('by_guest_email_and_opportunity', (q) =>
        q.eq('guestEmail', email.toLowerCase()).eq('opportunityId', targetId),
      )
      .first()
    if (asGuest && !asGuest.availabilityOnly) return true
  }
  if (source.userId) {
    const asUser = await ctx.db
      .query('opportunityApplications')
      .withIndex('by_user_and_opportunity', (q) =>
        q.eq('userId', source.userId).eq('opportunityId', targetId),
      )
      .first()
    if (asUser && !asUser.availabilityOnly) return true
  }
  return false
}

/**
 * The apply page with ?invite=: the answers to pre-fill, or why not. Public on
 * purpose (the link is the credential, like a poll's personal link), and it
 * returns only what that person answered, never consents.
 */
export const getInvite = query({
  args: { token: v.string(), opportunityId: v.id('orgOpportunities') },
  returns: v.union(
    v.object({ state: v.literal('invalid') }),
    v.object({ state: v.literal('applied') }),
    v.object({
      state: v.literal('ok'),
      sourceTitle: v.string(),
      responses: v.any(),
    }),
  ),
  handler: async (ctx, { token, opportunityId }) => {
    const invite = await ctx.db
      .query('applicationInvites')
      .withIndex('by_token', (q) => q.eq('token', token))
      .unique()
    if (!invite || invite.targetOpportunityId !== opportunityId) {
      return { state: 'invalid' as const }
    }
    const target = await ctx.db.get('orgOpportunities', opportunityId)
    const source = await ctx.db.get(
      'opportunityApplications',
      invite.sourceApplicationId,
    )
    if (!target || target.status !== 'active' || !source) {
      return { state: 'invalid' as const }
    }
    const sourceOpportunity = await ctx.db.get(
      'orgOpportunities',
      source.opportunityId,
    )
    const { email } = await resolveApplicantContact(
      ctx,
      source,
      sourceOpportunity?.formFields as Array<FormField> | undefined,
      '',
    )
    if (await hasApplied(ctx, source, email, opportunityId)) {
      return { state: 'applied' as const }
    }

    const fields = (target.formFields ?? []) as Array<FormField>
    const consentKeys = new Set(
      fields.filter((f) => f.consent).map((f) => f.key),
    )
    const responses = Object.fromEntries(
      Object.entries(
        sanitizeResponsesForForm(
          fields,
          (source.responses as Record<string, unknown> | undefined) ?? {},
        ),
      ).filter(([key]) => !consentKeys.has(key)),
    )
    // The address it was sent to, even if the old form had no email question.
    const emailField = fields.find((f) => f.key === 'email')
    if (emailField && email && !responses.email) responses.email = email
    return {
      state: 'ok' as const,
      sourceTitle: sourceOpportunity?.title ?? '',
      responses,
    }
  },
})
