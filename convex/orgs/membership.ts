import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { getUserId } from '../lib/auth'
import { deleteCourseGrants } from '../lib/courseAccess'
import type { Id } from '../_generated/dataModel'

// Get current user's membership for a given org
export const getMembership = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    const userId = await getUserId(ctx)
    if (!userId) {
      return null
    }

    return await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('orgId'), orgId))
      .first()
  },
})

// Get all orgs the current user belongs to
export const getUserMemberships = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('orgMemberships'),
      _creationTime: v.number(),
      userId: v.string(),
      orgId: v.id('organizations'),
      role: v.string(),
      directoryVisibility: v.string(),
      joinedAt: v.number(),
      invitedBy: v.optional(v.id('orgMemberships')),
      org: v.object({
        _id: v.id('organizations'),
        name: v.string(),
        slug: v.optional(v.string()),
        logoUrl: v.optional(v.string()),
      }),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getUserId(ctx)
    if (!userId) {
      return []
    }

    const memberships = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()

    // Fetch org details for each membership, resolving logo storage URLs
    const results = []
    for (const membership of memberships) {
      const org = await ctx.db.get('organizations', membership.orgId)
      if (!org) continue
      let logoUrl = org.logoUrl
      if (org.logoStorageId) {
        const url = await ctx.storage.getUrl(org.logoStorageId)
        if (url) logoUrl = url
      }
      results.push({
        _id: membership._id,
        _creationTime: membership._creationTime,
        userId: membership.userId,
        orgId: membership.orgId,
        role: membership.role,
        directoryVisibility: membership.directoryVisibility,
        joinedAt: membership.joinedAt,
        invitedBy: membership.invitedBy,
        org: {
          _id: org._id,
          name: org.name,
          slug: org.slug,
          logoUrl,
        },
      })
    }

    return results
  },
})

// Join an organization
export const joinOrg = mutation({
  args: {
    orgId: v.id('organizations'),
    inviteToken: v.optional(v.string()),
    directoryVisibility: v.union(v.literal('visible'), v.literal('hidden')),
  },
  handler: async (ctx, { orgId, inviteToken, directoryVisibility }) => {
    const userId = await getUserId(ctx)
    if (!userId) {
      throw new Error('Not authenticated')
    }

    // Check org exists
    const org = await ctx.db.get('organizations', orgId)
    if (!org) {
      throw new Error('Organization not found')
    }

    // Check user not already a member
    const existingMembership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('orgId'), orgId))
      .first()

    if (existingMembership) {
      throw new Error('Already a member of this organization')
    }

    // If invite token provided, validate it
    let inviteMembership: { _id: Id<'orgMemberships'> } | null = null
    if (inviteToken) {
      const invite = await ctx.db
        .query('orgInviteLinks')
        .withIndex('by_token', (q) => q.eq('token', inviteToken))
        .first()

      if (!invite) {
        throw new Error('Invalid invite link')
      }

      if (invite.orgId !== orgId) {
        throw new Error('Invite link is for a different organization')
      }

      // Check expiration
      if (invite.expiresAt && invite.expiresAt < Date.now()) {
        throw new Error('Invite link has expired')
      }

      // Get the membership that created this invite for the invitedBy field
      inviteMembership = await ctx.db.get('orgMemberships', invite.createdBy)
    }

    // Check if this is the first member (becomes admin per CONTEXT.md)
    const existingMembers = await ctx.db
      .query('orgMemberships')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .first()

    const role = existingMembers ? 'member' : 'admin'

    // Remove this org from hiddenFromOrgs if present (joining = granting visibility)
    const profile = await ctx.db
      .query('profiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()

    if (profile?.privacySettings?.hiddenFromOrgs?.length) {
      const orgIdStr = orgId.toString()
      const filtered = profile.privacySettings.hiddenFromOrgs.filter(
        (id) => id !== orgIdStr,
      )
      if (filtered.length !== profile.privacySettings.hiddenFromOrgs.length) {
        await ctx.db.patch('profiles', profile._id, {
          privacySettings: {
            ...profile.privacySettings,
            hiddenFromOrgs: filtered,
          },
        })
      }
    }

    // Backfill name and email from Clerk identity if profile is missing them
    if (profile && (!profile.name || !profile.email)) {
      const identity = await ctx.auth.getUserIdentity()
      const patch: Record<string, string> = {}
      if (!profile.name && identity?.name) patch.name = identity.name
      if (!profile.email && identity?.email) patch.email = identity.email
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch('profiles', profile._id, patch)
      }
    }

    // Insert membership
    const membershipId = await ctx.db.insert('orgMemberships', {
      userId,
      orgId,
      role,
      directoryVisibility,
      joinedAt: Date.now(),
      invitedBy: inviteMembership?._id,
    })

    return await ctx.db.get('orgMemberships', membershipId)
  },
})

// Join org by slug (used for auto-join after signup via invite link)
export const joinOrgBySlug = mutation({
  args: {
    slug: v.string(),
    inviteToken: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ success: v.literal(true), orgSlug: v.string() }),
    v.object({ success: v.literal(false), reason: v.string() }),
  ),
  handler: async (ctx, { slug, inviteToken }) => {
    const userId = await getUserId(ctx)
    if (!userId) {
      return { success: false as const, reason: 'Not authenticated' }
    }

    // Look up org by slug
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .first()

    if (!org) {
      return { success: false as const, reason: 'Organization not found' }
    }

    // Already a member? That's fine, just return success
    const existing = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('orgId'), org._id))
      .first()

    if (existing) {
      return { success: true as const, orgSlug: slug }
    }

    // Validate invite token if provided
    let inviteMembership: { _id: Id<'orgMemberships'> } | null = null
    if (inviteToken) {
      const invite = await ctx.db
        .query('orgInviteLinks')
        .withIndex('by_token', (q) => q.eq('token', inviteToken))
        .first()

      if (!invite || invite.orgId !== org._id) {
        return { success: false as const, reason: 'Invalid invite link' }
      }
      if (invite.expiresAt && invite.expiresAt < Date.now()) {
        return { success: false as const, reason: 'Invite link has expired' }
      }
      inviteMembership = await ctx.db.get('orgMemberships', invite.createdBy)
    }

    // First member becomes admin
    const existingMembers = await ctx.db
      .query('orgMemberships')
      .withIndex('by_org', (q) => q.eq('orgId', org._id))
      .first()

    const role = existingMembers ? 'member' : 'admin'

    // Remove this org from hiddenFromOrgs if present (joining = granting visibility)
    const profile = await ctx.db
      .query('profiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()

    if (profile?.privacySettings?.hiddenFromOrgs?.length) {
      const orgIdStr = org._id.toString()
      const filtered = profile.privacySettings.hiddenFromOrgs.filter(
        (id) => id !== orgIdStr,
      )
      if (filtered.length !== profile.privacySettings.hiddenFromOrgs.length) {
        await ctx.db.patch('profiles', profile._id, {
          privacySettings: {
            ...profile.privacySettings,
            hiddenFromOrgs: filtered,
          },
        })
      }
    }

    // Backfill name and email from Clerk identity if profile is missing them
    if (profile && (!profile.name || !profile.email)) {
      const identity = await ctx.auth.getUserIdentity()
      const patch: Record<string, string> = {}
      if (!profile.name && identity?.name) patch.name = identity.name
      if (!profile.email && identity?.email) patch.email = identity.email
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch('profiles', profile._id, patch)
      }
    }

    await ctx.db.insert('orgMemberships', {
      userId,
      orgId: org._id,
      role,
      directoryVisibility: 'visible',
      joinedAt: Date.now(),
      invitedBy: inviteMembership?._id,
    })

    return { success: true as const, orgSlug: slug }
  },
})

// Leave an organization
export const leaveOrg = mutation({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    const userId = await getUserId(ctx)
    if (!userId) {
      throw new Error('Not authenticated')
    }

    // Get user's membership
    const membership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('orgId'), orgId))
      .first()

    if (!membership) {
      throw new Error('Not a member of this organization')
    }

    // If user is an admin, check there are other admins
    if (membership.role === 'admin') {
      const otherAdmins = await ctx.db
        .query('orgMemberships')
        .withIndex('by_org_role', (q) =>
          q.eq('orgId', orgId).eq('role', 'admin'),
        )
        .collect()

      // Filter out current user
      const remainingAdmins = otherAdmins.filter((m) => m.userId !== userId)

      if (remainingAdmins.length === 0) {
        throw new Error(
          'Cannot leave organization as the last admin. Promote another member to admin first.',
        )
      }
    }

    // Delete membership, and the course access that came with it
    await ctx.db.delete('orgMemberships', membership._id)
    await deleteCourseGrants(ctx, membership.orgId, membership.userId)

    return { success: true }
  },
})

// Update directory visibility
export const setDirectoryVisibility = mutation({
  args: {
    orgId: v.id('organizations'),
    visibility: v.union(v.literal('visible'), v.literal('hidden')),
  },
  handler: async (ctx, { orgId, visibility }) => {
    const userId = await getUserId(ctx)
    if (!userId) {
      throw new Error('Not authenticated')
    }

    // Get user's membership
    const membership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('orgId'), orgId))
      .first()

    if (!membership) {
      throw new Error('Not a member of this organization')
    }

    // Update visibility
    await ctx.db.patch('orgMemberships', membership._id, {
      directoryVisibility: visibility,
    })

    return { success: true }
  },
})
