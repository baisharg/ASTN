import { ConvexError, v } from 'convex/values'
import { action, internalQuery, mutation, query } from './_generated/server'
import { getUserId } from './lib/auth'
import { resolveApplicantDisplayName } from './lib/applicantName'
import { rateLimiter } from './lib/rateLimiter'
import { internal } from './_generated/api'
import type { MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import {
  PROFILE_PREFILL_KEYS,
  sanitizeResponsesForForm,
  type FormField,
} from './lib/formFields'

// Applicants can re-open and edit their submission until this long after the
// opportunity's posted deadline. Keep in sync with the client in
// src/routes/org/$slug/apply/$opportunityId.tsx.
const APPLICATION_EDIT_GRACE_MS = 24 * 60 * 60 * 1000

function isWithinEditWindow(deadline: number | undefined): boolean {
  if (deadline === undefined) return true
  return Date.now() <= deadline + APPLICATION_EDIT_GRACE_MS
}

/**
 * Auto-add a poll respondent for a new application if an open poll exists.
 * Fails silently so it never blocks the main operation.
 */
async function maybeAddPollRespondent(
  ctx: MutationCtx,
  opts: {
    opportunityId: Id<'orgOpportunities'>
    applicationId: Id<'opportunityApplications'>
    profileName?: string
    responses: unknown
  },
) {
  try {
    const openPoll = await ctx.db
      .query('availabilityPolls')
      .withIndex('by_opportunity', (q) =>
        q.eq('opportunityId', opts.opportunityId),
      )
      .filter((q) => q.eq(q.field('status'), 'open'))
      .first()
    if (!openPoll) return

    const existing = await ctx.db
      .query('pollRespondents')
      .withIndex('by_poll_and_application', (q) =>
        q.eq('pollId', openPoll._id).eq('applicationId', opts.applicationId),
      )
      .first()
    if (existing) return

    const name = resolveApplicantDisplayName({
      profileName: opts.profileName,
      responses: opts.responses,
      fallback: 'Applicant',
    })
    await ctx.db.insert('pollRespondents', {
      pollId: openPoll._id,
      applicationId: opts.applicationId,
      respondentToken: crypto.randomUUID(),
      respondentName: name,
    })
  } catch (err) {
    console.error('Failed to auto-add poll respondent:', err)
  }
}

/**
 * Schedule an auto-email if the opportunity has a matching auto-email config.
 * Fails silently so it never blocks the main operation.
 */
async function maybeScheduleAutoEmail(
  ctx: MutationCtx,
  opts: {
    opportunityId: Id<'orgOpportunities'>
    applicationId: Id<'opportunityApplications'>
    trigger: string
  },
) {
  try {
    const config = await ctx.db
      .query('opportunityAutoEmails')
      .withIndex('by_opportunity', (q) =>
        q.eq('opportunityId', opts.opportunityId),
      )
      .first()
    const hasMatchingTrigger =
      config?.templates?.some((t) => t.trigger === opts.trigger) ??
      config?.triggers?.includes(opts.trigger) ??
      false
    if (config?.enabled && hasMatchingTrigger) {
      await ctx.scheduler.runAfter(0, internal.emails.autoEmail.sendAutoEmail, {
        applicationId: opts.applicationId,
        trigger: opts.trigger,
      })
    }
  } catch (err) {
    console.error('Failed to schedule auto-email:', err)
  }
}

// Submit an application (idempotent — returns existing if already applied)
// Auto-joins the org if the user is not already a member.
export const submit = mutation({
  args: {
    opportunityId: v.id('orgOpportunities'),
    responses: v.any(),
  },
  returns: v.id('opportunityApplications'),
  handler: async (ctx, { opportunityId, responses }) => {
    const userId = await getUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')

    await rateLimiter.limit(ctx, 'opportunityApplication', {
      key: userId,
      throws: true,
    })

    // Get the opportunity
    const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
    if (!opportunity) throw new ConvexError('Opportunity not found')
    if (opportunity.status !== 'active') {
      throw new ConvexError(
        'This opportunity is no longer accepting applications',
      )
    }

    // Auto-join org if not already a member
    const membership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('orgId'), opportunity.orgId))
      .first()

    if (!membership) {
      await ctx.db.insert('orgMemberships', {
        userId,
        orgId: opportunity.orgId,
        role: 'member',
        directoryVisibility: 'visible',
        joinedAt: Date.now(),
      })
    }

    // Side-effects below (poll respondent, auto-email) are intentionally
    // first-submission only — don't fire them on edits.
    const existing = await ctx.db
      .query('opportunityApplications')
      .withIndex('by_user_and_opportunity', (q) =>
        q.eq('userId', userId).eq('opportunityId', opportunityId),
      )
      .first()

    if (existing) {
      if (!isWithinEditWindow(opportunity.deadline)) {
        throw new ConvexError('The edit window for this application has closed')
      }
      await ctx.db.patch(existing._id, {
        responses,
        updatedAt: Date.now(),
      })
      return existing._id
    }

    // Get profile if exists
    const profile = await ctx.db
      .query('profiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()

    const applicationId = await ctx.db.insert('opportunityApplications', {
      opportunityId,
      orgId: opportunity.orgId,
      userId,
      profileId: profile?._id,
      status: 'submitted',
      responses,
      submittedAt: Date.now(),
    })

    await maybeAddPollRespondent(ctx, {
      opportunityId,
      applicationId,
      profileName: profile?.name,
      responses,
    })
    await maybeScheduleAutoEmail(ctx, {
      opportunityId,
      applicationId,
      trigger: 'new_application',
    })

    return applicationId
  },
})

// Submit an application as a guest (no auth required, idempotent by email+opportunity).
// Guest submissions are not editable — returning users must sign up so the row
// can be claimed and re-opened through the authenticated `submit` path.
export const submitGuest = mutation({
  args: {
    opportunityId: v.id('orgOpportunities'),
    guestEmail: v.string(),
    responses: v.any(),
  },
  returns: v.id('opportunityApplications'),
  handler: async (ctx, { opportunityId, guestEmail, responses }) => {
    await rateLimiter.limit(ctx, 'guestApplication', {
      key: guestEmail.trim().toLowerCase(),
      throws: true,
    })

    const email = guestEmail.trim().toLowerCase()

    // Get the opportunity
    const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
    if (!opportunity) throw new ConvexError('Opportunity not found')
    if (opportunity.status !== 'active') {
      throw new ConvexError(
        'This opportunity is no longer accepting applications',
      )
    }

    // Idempotent: check if guest already applied with this email
    const existing = await ctx.db
      .query('opportunityApplications')
      .withIndex('by_guest_email_and_opportunity', (q) =>
        q.eq('guestEmail', email).eq('opportunityId', opportunityId),
      )
      .first()

    if (existing) return existing._id

    const applicationId = await ctx.db.insert('opportunityApplications', {
      opportunityId,
      orgId: opportunity.orgId,
      guestEmail: email,
      status: 'submitted',
      responses,
      submittedAt: Date.now(),
    })

    await maybeAddPollRespondent(ctx, {
      opportunityId,
      applicationId,
      responses,
    })
    await maybeScheduleAutoEmail(ctx, {
      opportunityId,
      applicationId,
      trigger: 'new_application',
    })

    return applicationId
  },
})

// Claim guest applications on login/signup (idempotent)
// Finds guest apps matching the user's email, patches them with userId,
// and auto-joins the user to each org.
export const claimGuestApplications = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return 0

    const userId = identity.subject
    const email = identity.email?.trim().toLowerCase()
    if (!email) return 0

    // Find all guest applications matching this email
    const guestApps = await ctx.db
      .query('opportunityApplications')
      .withIndex('by_guest_email_and_opportunity', (q) =>
        q.eq('guestEmail', email),
      )
      .collect()

    // Filter to unclaimed apps only (no userId yet)
    const unclaimed = guestApps.filter((app) => !app.userId)
    if (unclaimed.length === 0) return 0

    // Get profile if exists
    const profile = await ctx.db
      .query('profiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()

    let claimed = 0
    for (const app of unclaimed) {
      // Patch the application with userId and profile
      await ctx.db.patch('opportunityApplications', app._id, {
        userId,
        profileId: profile?._id,
      })

      // Auto-join the org if not already a member
      const membership = await ctx.db
        .query('orgMemberships')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .filter((q) => q.eq(q.field('orgId'), app.orgId))
        .first()

      if (!membership) {
        await ctx.db.insert('orgMemberships', {
          userId,
          orgId: app.orgId,
          role: 'member',
          directoryVisibility: 'visible',
          joinedAt: Date.now(),
        })
      }

      claimed++
    }

    return claimed
  },
})

// Check if current user already applied
export const getMyApplication = query({
  args: { opportunityId: v.id('orgOpportunities') },
  returns: v.union(
    v.object({
      _id: v.id('opportunityApplications'),
      _creationTime: v.number(),
      opportunityId: v.id('orgOpportunities'),
      orgId: v.id('organizations'),
      userId: v.optional(v.string()),
      guestEmail: v.optional(v.string()),
      profileId: v.optional(v.id('profiles')),
      status: v.union(
        v.literal('submitted'),
        v.literal('under_review'),
        v.literal('accepted'),
        v.literal('rejected'),
        v.literal('waitlisted'),
      ),
      responses: v.any(),
      submittedAt: v.number(),
      updatedAt: v.optional(v.number()),
      reviewedAt: v.optional(v.number()),
      reviewedBy: v.optional(v.string()),
      reviewNotes: v.optional(v.string()),
      qualityScore: v.optional(v.number()),
      qualityScoreReason: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, { opportunityId }) => {
    const userId = await getUserId(ctx)
    if (!userId) return null

    return await ctx.db
      .query('opportunityApplications')
      .withIndex('by_user_and_opportunity', (q) =>
        q.eq('userId', userId).eq('opportunityId', opportunityId),
      )
      .first()
  },
})

// Pre-fill the apply form from the user's previous application to this
// opportunity's configured source opportunity. Returns null when there is
// no source configured, no prior application, or nothing to carry over.
export const getPreviousResponsesForOpportunity = query({
  args: { opportunityId: v.id('orgOpportunities') },
  returns: v.union(
    v.null(),
    v.object({
      sourceOpportunityTitle: v.string(),
      responses: v.any(),
    }),
  ),
  handler: async (ctx, { opportunityId }) => {
    const userId = await getUserId(ctx)
    if (!userId) return null

    const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
    if (!opportunity) return null

    // Mirror the visibility rules from `orgOpportunities.get`: active opps
    // are public to authed users, draft/closed require org-admin membership.
    if (opportunity.status !== 'active') {
      const membership = await ctx.db
        .query('orgMemberships')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .filter((q) => q.eq(q.field('orgId'), opportunity.orgId))
        .first()
      if (!membership || membership.role !== 'admin') return null
    }

    const sourceId = opportunity.sourceOpportunityId
    if (!sourceId) return null

    // Use the most-recent prior application: `by_user_and_opportunity` is
    // non-unique because `claimGuestApplications` can attach a userId to an
    // older guest row alongside a later authenticated submission.
    const [source, prior] = await Promise.all([
      ctx.db.get('orgOpportunities', sourceId),
      ctx.db
        .query('opportunityApplications')
        .withIndex('by_user_and_opportunity', (q) =>
          q.eq('userId', userId).eq('opportunityId', sourceId),
        )
        .order('desc')
        .first(),
    ])
    if (!source || source.orgId !== opportunity.orgId) return null
    if (!prior) return null

    const formFields =
      (opportunity.formFields as Array<FormField> | undefined) ?? []
    const cleaned = sanitizeResponsesForForm(
      formFields,
      (prior.responses as Record<string, unknown>) ?? {},
      PROFILE_PREFILL_KEYS,
    )
    if (Object.keys(cleaned).length === 0) return null

    return {
      sourceOpportunityTitle: source.title,
      responses: cleaned,
    }
  },
})

// Admin: list all applications for an opportunity
export const listByOpportunity = query({
  args: {
    opportunityId: v.id('orgOpportunities'),
    statusFilter: v.optional(
      v.union(
        v.literal('submitted'),
        v.literal('under_review'),
        v.literal('accepted'),
        v.literal('rejected'),
        v.literal('waitlisted'),
      ),
    ),
  },
  returns: v.array(
    v.object({
      _id: v.id('opportunityApplications'),
      _creationTime: v.number(),
      opportunityId: v.id('orgOpportunities'),
      orgId: v.id('organizations'),
      userId: v.optional(v.string()),
      guestEmail: v.optional(v.string()),
      profileId: v.optional(v.id('profiles')),
      status: v.union(
        v.literal('submitted'),
        v.literal('under_review'),
        v.literal('accepted'),
        v.literal('rejected'),
        v.literal('waitlisted'),
      ),
      responses: v.any(),
      submittedAt: v.number(),
      updatedAt: v.optional(v.number()),
      reviewedAt: v.optional(v.number()),
      reviewedBy: v.optional(v.string()),
      reviewNotes: v.optional(v.string()),
      qualityScore: v.optional(v.number()),
      qualityScoreReason: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { opportunityId, statusFilter }) => {
    const userId = await getUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')

    // Get opportunity to check org
    const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
    if (!opportunity) throw new ConvexError('Opportunity not found')

    // Verify admin role
    const membership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('orgId'), opportunity.orgId))
      .first()

    if (!membership || membership.role !== 'admin') {
      throw new ConvexError('Admin access required')
    }

    if (statusFilter) {
      return await ctx.db
        .query('opportunityApplications')
        .withIndex('by_opportunity_and_status', (q) =>
          q.eq('opportunityId', opportunityId).eq('status', statusFilter),
        )
        .collect()
    }

    return await ctx.db
      .query('opportunityApplications')
      .withIndex('by_opportunity_and_status', (q) =>
        q.eq('opportunityId', opportunityId),
      )
      .collect()
  },
})

// Admin: get a single application by ID (includes full responses)
export const getById = query({
  args: { applicationId: v.id('opportunityApplications') },
  returns: v.any(),
  handler: async (ctx, { applicationId }) => {
    const userId = await getUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')

    const application = await ctx.db.get(
      'opportunityApplications',
      applicationId,
    )
    if (!application) return null

    const membership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('orgId'), application.orgId))
      .first()

    if (!membership || membership.role !== 'admin') {
      throw new ConvexError('Admin access required')
    }

    return application
  },
})

// Admin: get application count for an opportunity
export const getApplicationCount = query({
  args: { opportunityId: v.id('orgOpportunities') },
  returns: v.number(),
  handler: async (ctx, { opportunityId }) => {
    const userId = await getUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')

    const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
    if (!opportunity) return 0

    // Verify admin role
    const membership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('orgId'), opportunity.orgId))
      .first()

    if (!membership || membership.role !== 'admin') return 0

    const apps = await ctx.db
      .query('opportunityApplications')
      .withIndex('by_opportunity_and_status', (q) =>
        q.eq('opportunityId', opportunityId),
      )
      .collect()

    return apps.length
  },
})

// Admin: count all applications for an org
export const getOrgApplicationCount = query({
  args: { orgId: v.id('organizations') },
  returns: v.number(),
  handler: async (ctx, { orgId }) => {
    const userId = await getUserId(ctx)
    if (!userId) return 0

    const membership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('orgId'), orgId))
      .first()

    if (!membership || membership.role !== 'admin') return 0

    const apps = await ctx.db
      .query('opportunityApplications')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()

    return apps.length
  },
})

// Admin: update application status (idempotent)
export const updateStatus = mutation({
  args: {
    applicationId: v.id('opportunityApplications'),
    status: v.union(
      v.literal('submitted'),
      v.literal('under_review'),
      v.literal('accepted'),
      v.literal('rejected'),
      v.literal('waitlisted'),
    ),
    reviewNotes: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { applicationId, status, reviewNotes }) => {
    const userId = await getUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')

    const application = await ctx.db.get(
      'opportunityApplications',
      applicationId,
    )
    if (!application) throw new ConvexError('Application not found')

    // Verify admin role
    const membership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('orgId'), application.orgId))
      .first()

    if (!membership || membership.role !== 'admin') {
      throw new ConvexError('Admin access required')
    }

    // Idempotent: skip if already at target status
    if (
      application.status === status &&
      application.reviewNotes === reviewNotes
    ) {
      return null
    }

    await ctx.db.patch('opportunityApplications', applicationId, {
      status,
      reviewedAt: Date.now(),
      reviewedBy: userId,
      ...(reviewNotes !== undefined ? { reviewNotes } : {}),
    })

    await maybeScheduleAutoEmail(ctx, {
      opportunityId: application.opportunityId,
      applicationId,
      trigger: `status:${status}`,
    })

    return null
  },
})

// Admin: set quality score for an application (0–100)
export const setQualityScore = mutation({
  args: {
    applicationId: v.id('opportunityApplications'),
    qualityScore: v.number(),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { applicationId, qualityScore, reason }) => {
    const userId = await getUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')

    const application = await ctx.db.get(
      'opportunityApplications',
      applicationId,
    )
    if (!application) throw new ConvexError('Application not found')

    const membership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('orgId'), application.orgId))
      .first()

    if (!membership || membership.role !== 'admin') {
      throw new ConvexError('Admin access required')
    }

    await ctx.db.patch('opportunityApplications', applicationId, {
      qualityScore,
      ...(reason !== undefined ? { qualityScoreReason: reason } : {}),
    })

    return null
  },
})

// Internal query for export action
export const listForExport = internalQuery({
  args: { opportunityId: v.id('orgOpportunities') },
  returns: v.array(
    v.object({
      _id: v.id('opportunityApplications'),
      _creationTime: v.number(),
      opportunityId: v.id('orgOpportunities'),
      orgId: v.id('organizations'),
      userId: v.optional(v.string()),
      guestEmail: v.optional(v.string()),
      profileId: v.optional(v.id('profiles')),
      status: v.union(
        v.literal('submitted'),
        v.literal('under_review'),
        v.literal('accepted'),
        v.literal('rejected'),
        v.literal('waitlisted'),
      ),
      responses: v.any(),
      submittedAt: v.number(),
      updatedAt: v.optional(v.number()),
      reviewedAt: v.optional(v.number()),
      reviewedBy: v.optional(v.string()),
      reviewNotes: v.optional(v.string()),
      qualityScore: v.optional(v.number()),
      qualityScoreReason: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { opportunityId }) => {
    return await ctx.db
      .query('opportunityApplications')
      .withIndex('by_opportunity_and_status', (q) =>
        q.eq('opportunityId', opportunityId),
      )
      .collect()
  },
})

// Admin: export applications as CSV (returns string for client-side download)
// Dynamically generates columns from the opportunity's formFields.
export const exportApplications = action({
  args: { opportunityId: v.id('orgOpportunities') },
  returns: v.string(),
  handler: async (ctx, { opportunityId }): Promise<string> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new ConvexError('Not authenticated')

    // Verify admin + fetch data in parallel
    const [isAdmin, applications, opportunity] = await Promise.all([
      ctx.runQuery(internal.emails.adminBroadcast.verifyOrgAdmin, {
        userId: identity.subject,
        opportunityId,
      }),
      ctx.runQuery(internal.opportunityApplications.listForExport, {
        opportunityId,
      }) as Promise<
        Array<{
          _id: string
          responses: Record<string, unknown>
          submittedAt: number
          status: string
          guestEmail?: string
          qualityScore?: number
          qualityScoreReason?: string
        }>
      >,
      ctx.runQuery(internal.orgOpportunities.getInternal, {
        id: opportunityId,
      }) as Promise<{
        formFields?: Array<{ key: string; kind: string; label: string }>
      } | null>,
    ])
    if (!isAdmin) throw new ConvexError('Admin access required')

    const escapeCSV = (val: string): string => {
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`
      }
      return val
    }

    const formatCell = (val: unknown): string => {
      if (val === undefined || val === null) return ''
      if (Array.isArray(val)) return val.join('; ')
      if (typeof val === 'boolean') return val ? 'Yes' : 'No'
      if (typeof val === 'object') return JSON.stringify(val)
      return String(val as string | number)
    }

    const formFields = (opportunity?.formFields ?? []) as Array<{
      key: string
      kind: string
      label: string
    }>
    const inputFields = formFields.filter((f) => f.kind !== 'section_header')

    // Build headers: form field labels + metadata columns
    const headers = [
      ...inputFields.map((f) => f.label),
      'Submitted at',
      'Status',
      'Quality Score',
      'Score Reasoning',
    ]

    const rows = applications.map((app) => {
      const r = app.responses
      return [
        ...inputFields.map((f) => formatCell(r[f.key])),
        new Date(app.submittedAt).toISOString(),
        app.status,
        app.qualityScore !== undefined ? String(app.qualityScore) : '',
        app.qualityScoreReason ?? '',
      ].map((cell) => escapeCSV(cell))
    })

    return [
      headers.map((h) => escapeCSV(h)).join(','),
      ...rows.map((r: Array<string>) => r.join(',')),
    ].join('\n')
  },
})
