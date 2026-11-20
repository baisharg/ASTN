import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import { mutation, query } from './_generated/server'
import { isPlatformAdmin, requireAuth, requirePlatformAdmin } from './lib/auth'
import { logPermissionChange } from './lib/permissionLog'
import { rateLimiter } from './lib/rateLimiter'
import { generateSlug } from './lib/slug'

// ---------- Mutations ----------

/**
 * Submit an org application. Authenticated user submits application.
 * Duplicate check: prevents submission if org name already exists or has pending/approved application.
 */
export const submit = mutation({
  args: {
    orgName: v.string(),
    description: v.string(),
    city: v.string(),
    country: v.string(),
    website: v.optional(v.string()),
    applicantName: v.string(),
    applicantEmail: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx)

    await rateLimiter.limit(ctx, 'orgApplicationSubmit', {
      key: userId,
      throws: true,
    })

    const normalizedName = args.orgName.toLowerCase().trim()

    // Check for existing organization with same name
    const existingOrgs = await ctx.db.query('organizations').collect()
    const matchingOrg = existingOrgs.find(
      (org) => org.name.toLowerCase().trim() === normalizedName,
    )
    if (matchingOrg) {
      throw new Error(
        `An organization named "${args.orgName}" already exists on the platform.`,
      )
    }

    // Check for pending or approved application with same org name (case-insensitive)
    const existingApplication = await ctx.db
      .query('orgApplications')
      .withIndex('by_orgNameNormalized', (q) =>
        q.eq('orgNameNormalized', normalizedName),
      )
      .filter((q) =>
        q.or(
          q.eq(q.field('status'), 'pending'),
          q.eq(q.field('status'), 'approved'),
        ),
      )
      .first()

    if (existingApplication) {
      throw new ConvexError({
        code: 'DUPLICATE_APPLICATION',
        message:
          existingApplication.status === 'pending'
            ? `An application for "${args.orgName}" is already pending review.`
            : `An organization named "${args.orgName}" has already been approved.`,
      })
    }

    const applicationId = await ctx.db.insert('orgApplications', {
      applicantUserId: userId,
      applicantName: args.applicantName,
      applicantEmail: args.applicantEmail,
      orgName: args.orgName,
      orgNameNormalized: normalizedName,
      description: args.description,
      city: args.city,
      country: args.country,
      website: args.website,
      status: 'pending',
      createdAt: Date.now(),
    })

    return applicationId
  },
})

/**
 * Get all applications for the current user, sorted by createdAt descending.
 */
export const getMyApplications = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx)

    const applications = await ctx.db
      .query('orgApplications')
      .withIndex('by_applicant', (q) => q.eq('applicantUserId', userId))
      .collect()

    // For approved applications, find the associated org slug
    const enriched = await Promise.all(
      applications.map(async (app) => {
        if (app.status === 'approved') {
          const orgs = await ctx.db.query('organizations').collect()
          const org = orgs.find(
            (o) =>
              o.name.toLowerCase().trim() === app.orgName.toLowerCase().trim(),
          )
          return { ...app, orgSlug: org?.slug ?? null }
        }
        return { ...app, orgSlug: null }
      }),
    )

    return enriched.sort((a, b) => b.createdAt - a.createdAt)
  },
})

/**
 * Platform admin lists all applications, optionally filtered by status.
 */
export const listAll = query({
  args: {
    status: v.optional(
      v.union(
        v.literal('pending'),
        v.literal('approved'),
        v.literal('rejected'),
        v.literal('withdrawn'),
      ),
    ),
  },
  handler: async (ctx, args) => {
    await requirePlatformAdmin(ctx)

    let applications
    if (args.status) {
      applications = await ctx.db
        .query('orgApplications')
        .withIndex('by_status', (q) => q.eq('status', args.status!))
        .collect()
    } else {
      applications = await ctx.db.query('orgApplications').collect()
    }

    return applications.sort((a, b) => b.createdAt - a.createdAt)
  },
})

/**
 * Get a single application by ID.
 * Accessible by the applicant or platform admins.
 */
export const getApplication = query({
  args: {
    applicationId: v.id('orgApplications'),
  },
  handler: async (ctx, { applicationId }) => {
    const userId = await requireAuth(ctx)

    const application = await ctx.db.get('orgApplications', applicationId)
    if (!application) {
      throw new Error('Application not found')
    }

    // Check: user is applicant OR user is platform admin
    const isApplicant = application.applicantUserId === userId
    const isAdmin = await isPlatformAdmin(ctx)

    if (!isApplicant && !isAdmin) {
      throw new Error('Access denied')
    }

    return application
  },
})

/**
 * Platform admin approves an application.
 * Atomically creates org + membership + notification.
 */
export const approve = mutation({
  args: {
    applicationId: v.id('orgApplications'),
  },
  handler: async (ctx, { applicationId }) => {
    const adminUserId = await requirePlatformAdmin(ctx)

    const application = await ctx.db.get('orgApplications', applicationId)
    if (!application) {
      throw new Error('Application not found')
    }
    if (application.status !== 'pending') {
      throw new Error(
        `Cannot approve application with status "${application.status}"`,
      )
    }

    // Update application status
    await ctx.db.patch('orgApplications', applicationId, {
      status: 'approved',
      reviewedBy: adminUserId,
      reviewedAt: Date.now(),
    })

    // Generate slug from org name
    const slug = await generateSlug(ctx, application.orgName)

    // Create organization record
    const orgId = await ctx.db.insert('organizations', {
      name: application.orgName,
      slug,
      description: application.description,
      city: application.city,
      country: application.country,
      contactEmail: application.applicantEmail,
      ...(application.website && { website: application.website }),
    })

    // Geocode org location for map display
    await ctx.scheduler.runAfter(0, internal.orgs.geocode.geocodeOrg, {
      orgId,
    })

    // Create org membership for applicant as admin
    await ctx.db.insert('orgMemberships', {
      userId: application.applicantUserId,
      orgId,
      role: 'admin',
      directoryVisibility: 'visible',
      joinedAt: Date.now(),
    })
    await logPermissionChange(ctx, {
      orgId,
      userId: application.applicantUserId,
      by: adminUserId,
      change: 'role',
      from: null,
      to: 'admin',
      via: 'orgApplications:approve',
    })

    // Schedule notification to applicant
    await ctx.scheduler.runAfter(
      0,
      internal.notifications.mutations.createNotification,
      {
        userId: application.applicantUserId,
        type: 'org_application_approved',
        orgId,
        applicationId,
        title: 'Your org application was approved',
        body: `"${application.orgName}" has been approved and is now on the platform.`,
        actionUrl: `/org/${slug}/admin`,
      },
    )

    return orgId
  },
})

/**
 * Platform admin rejects an application.
 * Requires a rejection reason.
 */
export const reject = mutation({
  args: {
    applicationId: v.id('orgApplications'),
    rejectionReason: v.string(),
  },
  handler: async (ctx, { applicationId, rejectionReason }) => {
    const adminUserId = await requirePlatformAdmin(ctx)

    const application = await ctx.db.get('orgApplications', applicationId)
    if (!application) {
      throw new Error('Application not found')
    }
    if (application.status !== 'pending') {
      throw new Error(
        `Cannot reject application with status "${application.status}"`,
      )
    }

    // Update application status
    await ctx.db.patch('orgApplications', applicationId, {
      status: 'rejected',
      rejectionReason,
      reviewedBy: adminUserId,
      reviewedAt: Date.now(),
    })

    // Schedule notification to applicant
    await ctx.scheduler.runAfter(
      0,
      internal.notifications.mutations.createNotification,
      {
        userId: application.applicantUserId,
        type: 'org_application_rejected',
        applicationId,
        title: 'Your org application was not approved',
        body: `Your application for "${application.orgName}" was not approved. Reason: ${rejectionReason}`,
        actionUrl: '/apply/status',
      },
    )
  },
})

/**
 * Applicant withdraws their own pending application.
 */
export const withdraw = mutation({
  args: {
    applicationId: v.id('orgApplications'),
  },
  handler: async (ctx, { applicationId }) => {
    const userId = await requireAuth(ctx)

    const application = await ctx.db.get('orgApplications', applicationId)
    if (!application) {
      throw new Error('Application not found')
    }
    if (application.applicantUserId !== userId) {
      throw new Error('You can only withdraw your own applications')
    }
    if (application.status !== 'pending') {
      throw new Error(
        `Cannot withdraw application with status "${application.status}"`,
      )
    }

    await ctx.db.patch('orgApplications', applicationId, {
      status: 'withdrawn',
    })
  },
})

// ---------- Queries ----------

/**
 * Check if the current user is a platform admin.
 * Returns false if not authenticated. Used for frontend UI gating.
 */
export const checkPlatformAdmin = query({
  args: {},
  handler: async (ctx) => {
    return await isPlatformAdmin(ctx)
  },
})

/**
 * Get the current user's email from auth identity.
 * Used for pre-filling the application form.
 */
export const getMyEmail = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null
    return identity.email ?? null
  },
})
