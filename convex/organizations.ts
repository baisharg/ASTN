import { v } from 'convex/values'
import { internalMutation, query } from './_generated/server'
import { logPermissionChange } from './lib/permissionLog'

// List all organizations (for browse mode)
export const listOrganizations = query({
  args: {},
  handler: async (ctx) => {
    const organizations = await ctx.db.query('organizations').collect()
    // Sort alphabetically by name
    return organizations.sort((a, b) => a.name.localeCompare(b.name))
  },
})

// Search organizations by name (for search mode)
export const searchOrganizations = query({
  args: { query: v.string() },
  handler: async (ctx, { query: searchQuery }) => {
    if (!searchQuery.trim()) {
      return []
    }

    const results = await ctx.db
      .query('organizations')
      .withSearchIndex('search_name', (q) => q.search('name', searchQuery))
      .take(10)

    return results
  },
})

// Create invite link for an org (bootstrap, run from dashboard)
export const createInviteLinkInternal = internalMutation({
  args: {
    orgSlug: v.string(),
    expiresInDays: v.optional(v.number()),
  },
  handler: async (ctx, { orgSlug, expiresInDays }) => {
    const org = await ctx.db
      .query('organizations')
      .filter((q) => q.eq(q.field('slug'), orgSlug))
      .first()

    if (!org) {
      throw new Error(`Organization not found with slug: ${orgSlug}`)
    }

    // Get an admin membership to use as createdBy
    const adminMembership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_org_role', (q) =>
        q.eq('orgId', org._id).eq('role', 'admin'),
      )
      .first()

    if (!adminMembership) {
      throw new Error('No admin found for this organization')
    }

    const token = crypto.randomUUID()
    const DEFAULT_INVITE_EXPIRY_DAYS = 30
    const expiresAt =
      Date.now() +
      (expiresInDays ?? DEFAULT_INVITE_EXPIRY_DAYS) * 24 * 60 * 60 * 1000

    await ctx.db.insert('orgInviteLinks', {
      orgId: org._id,
      token,
      createdBy: adminMembership._id,
      createdAt: Date.now(),
      expiresAt,
    })

    return {
      token,
      url: `/org/${orgSlug}/join?token=${token}`,
      expiresAt,
    }
  },
})

// Bootstrap: Make a user admin of an org (one-time setup, run from dashboard)
export const bootstrapOrgAdmin = internalMutation({
  args: {
    userEmail: v.string(),
    orgSlug: v.string(),
  },
  handler: async (ctx, { userEmail, orgSlug }) => {
    // Find user by email
    const user = await ctx.db
      .query('users')
      .filter((q) => q.eq(q.field('email'), userEmail))
      .first()

    if (!user) {
      throw new Error(`User not found with email: ${userEmail}`)
    }

    // Find org by slug
    const org = await ctx.db
      .query('organizations')
      .filter((q) => q.eq(q.field('slug'), orgSlug))
      .first()

    if (!org) {
      throw new Error(`Organization not found with slug: ${orgSlug}`)
    }

    // Check if already a member
    const existing = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .filter((q) => q.eq(q.field('orgId'), org._id))
      .first()

    if (existing) {
      // Update to admin if not already
      if (existing.role !== 'admin') {
        await ctx.db.patch('orgMemberships', existing._id, { role: 'admin' })
        await logPermissionChange(ctx, {
          orgId: org._id,
          userId: user._id,
          by: null,
          change: 'role',
          from: existing.role,
          to: 'admin',
          via: 'organizations:bootstrapOrgAdmin',
        })
        return { action: 'promoted', userId: user._id, orgId: org._id }
      }
      return { action: 'already_admin', userId: user._id, orgId: org._id }
    }

    // Create admin membership
    await ctx.db.insert('orgMemberships', {
      userId: user._id,
      orgId: org._id,
      role: 'admin',
      directoryVisibility: 'visible',
      joinedAt: Date.now(),
    })
    await logPermissionChange(ctx, {
      orgId: org._id,
      userId: user._id,
      by: null,
      change: 'role',
      from: null,
      to: 'admin',
      via: 'organizations:bootstrapOrgAdmin',
    })

    return { action: 'created', userId: user._id, orgId: org._id }
  },
})
