import { ConvexError, v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { getUserId } from '../lib/auth'
import {
  deleteCourseGrants,
  requirePermissionManager,
} from '../lib/courseAccess'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'

// Helper: Require current user is an admin of the given org
async function requireOrgAdmin(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
): Promise<Doc<'orgMemberships'>> {
  const userId = await getUserId(ctx)
  if (!userId) {
    throw new Error('Not authenticated')
  }

  const membership = await ctx.db
    .query('orgMemberships')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .filter((q) => q.eq(q.field('orgId'), orgId))
    .first()

  if (!membership) {
    throw new Error('Not a member of this organization')
  }

  if (membership.role !== 'admin') {
    throw new Error('Admin access required')
  }

  return membership
}

// Remove a member from the organization
export const removeMember = mutation({
  args: {
    orgId: v.id('organizations'),
    membershipId: v.id('orgMemberships'),
  },
  handler: async (ctx, { orgId, membershipId }) => {
    const adminMembership = await requireOrgAdmin(ctx, orgId)

    // Get the target membership
    const targetMembership = await ctx.db.get('orgMemberships', membershipId)
    if (!targetMembership) {
      throw new Error('Membership not found')
    }

    // Verify the membership is for this org
    if (targetMembership.orgId !== orgId) {
      throw new Error('Membership is not for this organization')
    }

    // Cannot remove yourself (use leaveOrg instead)
    if (targetMembership._id === adminMembership._id) {
      throw new Error(
        'Cannot remove yourself. Use the leave organization option instead.',
      )
    }

    // Delete the membership, and the course access that came with it
    await ctx.db.delete('orgMemberships', membershipId)
    await deleteCourseGrants(ctx, orgId, targetMembership.userId)

    return { success: true }
  },
})

// Promote a member to admin
export const promoteToAdmin = mutation({
  args: {
    orgId: v.id('organizations'),
    membershipId: v.id('orgMemberships'),
  },
  handler: async (ctx, { orgId, membershipId }) => {
    // Admins see every course, so making one is an owner's call.
    await requirePermissionManager(ctx, orgId)

    // Get the target membership
    const targetMembership = await ctx.db.get('orgMemberships', membershipId)
    if (!targetMembership) {
      throw new Error('Membership not found')
    }

    // Verify the membership is for this org
    if (targetMembership.orgId !== orgId) {
      throw new Error('Membership is not for this organization')
    }

    // Update role to admin; course grants are moot for an admin
    await ctx.db.patch('orgMemberships', membershipId, {
      role: 'admin',
    })
    await deleteCourseGrants(ctx, orgId, targetMembership.userId)

    return { success: true }
  },
})

// Demote an admin to member
export const demoteToMember = mutation({
  args: {
    orgId: v.id('organizations'),
    membershipId: v.id('orgMemberships'),
  },
  handler: async (ctx, { orgId, membershipId }) => {
    await requirePermissionManager(ctx, orgId)
    const adminMembership = await requireOrgAdmin(ctx, orgId)

    // Get the target membership
    const targetMembership = await ctx.db.get('orgMemberships', membershipId)
    if (!targetMembership) {
      throw new Error('Membership not found')
    }

    // Verify the membership is for this org
    if (targetMembership.orgId !== orgId) {
      throw new Error('Membership is not for this organization')
    }

    // The org always keeps an owner: the last one can't stop being admin
    if (targetMembership.isOwner === true) {
      const owners = (
        await ctx.db
          .query('orgMemberships')
          .withIndex('by_org', (q) => q.eq('orgId', orgId))
          .collect()
      ).filter((m) => m.isOwner === true)
      if (owners.length === 1) {
        throw new ConvexError('Make someone else an owner first.')
      }
    }

    // Cannot demote yourself if you're the last admin
    if (targetMembership._id === adminMembership._id) {
      const otherAdmins = await ctx.db
        .query('orgMemberships')
        .withIndex('by_org_role', (q) =>
          q.eq('orgId', orgId).eq('role', 'admin'),
        )
        .collect()

      // Filter out current user
      const remainingAdmins = otherAdmins.filter(
        (m) => m._id !== adminMembership._id,
      )

      if (remainingAdmins.length === 0) {
        throw new Error(
          'Cannot demote yourself as the last admin. Promote another member to admin first.',
        )
      }
    }

    // Update role to member
    await ctx.db.patch('orgMemberships', membershipId, {
      role: 'member',
      isOwner: undefined,
    })

    return { success: true }
  },
})

// Create an invite link for the organization
export const createInviteLink = mutation({
  args: {
    orgId: v.id('organizations'),
    expiresInDays: v.optional(v.number()),
  },
  handler: async (ctx, { orgId, expiresInDays }) => {
    const adminMembership = await requireOrgAdmin(ctx, orgId)

    // Generate a unique token
    const token = crypto.randomUUID()

    // Default to 30-day expiration if not specified
    const DEFAULT_INVITE_EXPIRY_DAYS = 30
    const expiresAt =
      Date.now() +
      (expiresInDays ?? DEFAULT_INVITE_EXPIRY_DAYS) * 24 * 60 * 60 * 1000

    // Insert invite link
    await ctx.db.insert('orgInviteLinks', {
      orgId,
      token,
      createdBy: adminMembership._id,
      createdAt: Date.now(),
      expiresAt,
    })

    return { token }
  },
})

// Get all invite links for the organization
export const getInviteLinks = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgAdmin(ctx, orgId)

    const inviteLinks = await ctx.db
      .query('orgInviteLinks')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()

    // Filter out expired links and add metadata
    const now = Date.now()
    return inviteLinks
      .filter((link) => !link.expiresAt || link.expiresAt > now)
      .map((link) => ({
        ...link,
        isExpired: link.expiresAt ? link.expiresAt < now : false,
      }))
  },
})

// Revoke an invite link
export const revokeInviteLink = mutation({
  args: { inviteLinkId: v.id('orgInviteLinks') },
  handler: async (ctx, { inviteLinkId }) => {
    // Get the invite link to check its orgId
    const inviteLink = await ctx.db.get('orgInviteLinks', inviteLinkId)
    if (!inviteLink) {
      throw new Error('Invite link not found')
    }

    // Verify admin access to this org
    await requireOrgAdmin(ctx, inviteLink.orgId)

    // Delete the invite link
    await ctx.db.delete('orgInviteLinks', inviteLinkId)

    return { success: true }
  },
})

// Get all members with their full profiles (for admin dashboard and export)
// Per CONTEXT.md: Admins see full profiles (joining means consent)
export const getAllMembersWithProfiles = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgAdmin(ctx, orgId)

    // Get all memberships for this org
    const memberships = await ctx.db
      .query('orgMemberships')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()

    // Fetch full profile and user email for each membership
    const membersWithProfiles = await Promise.all(
      memberships.map(async (membership) => {
        // Get profile
        const profile = await ctx.db
          .query('profiles')
          .withIndex('by_user', (q) => q.eq('userId', membership.userId))
          .first()

        const email = profile?.email ?? null

        // Calculate profile completeness
        let completeness = 0
        if (profile) {
          const sections = [
            Boolean(profile.name) && Boolean(profile.location),
            Array.isArray(profile.education) && profile.education.length > 0,
            Array.isArray(profile.workHistory) &&
              profile.workHistory.length > 0,
            Boolean(profile.careerGoals),
            Array.isArray(profile.skills) && profile.skills.length > 0,
            profile.hasEnrichmentConversation === true,
            profile.privacySettings !== undefined &&
              typeof profile.privacySettings === 'object' &&
              'defaultVisibility' in profile.privacySettings,
          ]
          completeness = Math.round(
            (sections.filter(Boolean).length / sections.length) * 100,
          )
        }

        return {
          membership,
          profile,
          email,
          completeness,
        }
      }),
    )

    return membersWithProfiles
  },
})

// Update lu.ma configuration for the organization
export const updateLumaConfig = mutation({
  args: {
    orgId: v.id('organizations'),
    lumaCalendarUrl: v.optional(v.string()),
    lumaCalendarApiId: v.optional(v.string()),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, { orgId, lumaCalendarUrl, lumaCalendarApiId }) => {
    await requireOrgAdmin(ctx, orgId)

    // Get current org to verify it exists
    const org = await ctx.db.get('organizations', orgId)
    if (!org) {
      throw new Error('Organization not found')
    }

    // Update lu.ma config fields
    await ctx.db.patch('organizations', orgId, {
      lumaCalendarUrl: lumaCalendarUrl || undefined,
      lumaCalendarApiId: lumaCalendarApiId || undefined,
    })

    return { success: true }
  },
})

// Get lu.ma configuration for an organization (admin only)
export const getLumaConfig = query({
  args: { orgId: v.id('organizations') },
  returns: v.object({
    lumaCalendarUrl: v.optional(v.string()),
    lumaCalendarApiId: v.optional(v.string()),
    eventsLastSynced: v.optional(v.number()),
  }),
  handler: async (ctx, { orgId }) => {
    await requireOrgAdmin(ctx, orgId)

    const org = await ctx.db.get('organizations', orgId)
    if (!org) {
      throw new Error('Organization not found')
    }

    return {
      lumaCalendarUrl: org.lumaCalendarUrl,
      lumaCalendarApiId: org.lumaCalendarApiId,
      eventsLastSynced: org.eventsLastSynced,
    }
  },
})

// ============================================
// Phase 31: Org Self-Configuration
// ============================================

// Get full org profile for admin setup page
export const getOrgProfile = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgAdmin(ctx, orgId)

    const org = await ctx.db.get('organizations', orgId)
    if (!org) {
      throw new Error('Organization not found')
    }

    // If logoStorageId exists, resolve the URL
    let resolvedLogoUrl = org.logoUrl ?? null
    if (org.logoStorageId) {
      const url = await ctx.storage.getUrl(org.logoStorageId)
      if (url) resolvedLogoUrl = url
    }

    return {
      ...org,
      resolvedLogoUrl,
    }
  },
})

// Update org profile fields (self-configuration)
export const updateOrgProfile = mutation({
  args: {
    orgId: v.id('organizations'),
    description: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    website: v.optional(v.string()),
    socialLinks: v.optional(
      v.array(
        v.object({
          platform: v.string(),
          url: v.string(),
        }),
      ),
    ),
  },
  handler: async (ctx, { orgId, ...updates }) => {
    await requireOrgAdmin(ctx, orgId)

    const org = await ctx.db.get('organizations', orgId)
    if (!org) {
      throw new Error('Organization not found')
    }

    // Build patch object, only including provided fields
    const patch: Record<string, unknown> = {}
    if (updates.description !== undefined)
      patch.description = updates.description
    if (updates.contactEmail !== undefined)
      patch.contactEmail = updates.contactEmail
    if (updates.website !== undefined) patch.website = updates.website
    if (updates.socialLinks !== undefined)
      patch.socialLinks = updates.socialLinks

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch('organizations', orgId, patch)
    }

    return { success: true }
  },
})

// Save uploaded org logo
export const saveOrgLogo = mutation({
  args: {
    orgId: v.id('organizations'),
    storageId: v.id('_storage'),
  },
  handler: async (ctx, { orgId, storageId }) => {
    await requireOrgAdmin(ctx, orgId)

    const org = await ctx.db.get('organizations', orgId)
    if (!org) {
      throw new Error('Organization not found')
    }

    // Delete old logo from storage if it exists
    if (org.logoStorageId) {
      await ctx.storage.delete(org.logoStorageId)
    }

    // Resolve the URL for the new logo
    const logoUrl = await ctx.storage.getUrl(storageId)

    // Update org with new logo
    await ctx.db.patch('organizations', orgId, {
      logoStorageId: storageId,
      logoUrl: logoUrl ?? undefined,
    })

    return { success: true, logoUrl }
  },
})

// Remove org logo
export const removeOrgLogo = mutation({
  args: {
    orgId: v.id('organizations'),
  },
  handler: async (ctx, { orgId }) => {
    await requireOrgAdmin(ctx, orgId)

    const org = await ctx.db.get('organizations', orgId)
    if (!org) {
      throw new Error('Organization not found')
    }

    // Delete from storage if it exists
    if (org.logoStorageId) {
      await ctx.storage.delete(org.logoStorageId)
    }

    await ctx.db.patch('organizations', orgId, {
      logoStorageId: undefined,
      logoUrl: undefined,
    })

    return { success: true }
  },
})

// Get onboarding progress for the org (computed from field completeness)
export const getOnboardingProgress = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    await requireOrgAdmin(ctx, orgId)

    const org = await ctx.db.get('organizations', orgId)
    if (!org) {
      throw new Error('Organization not found')
    }

    // Check for invite link
    const inviteLinks = await ctx.db
      .query('orgInviteLinks')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const hasActiveInviteLink = inviteLinks.some(
      (link) => !link.expiresAt || link.expiresAt > Date.now(),
    )

    // Check for co-working space
    const space = await ctx.db
      .query('coworkingSpaces')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .first()

    const steps = [
      {
        id: 'logo',
        label: 'Upload organization logo',
        complete: Boolean(org.logoStorageId || org.logoUrl),
        route: 'setup',
      },
      {
        id: 'description',
        label: 'Add organization description',
        complete: Boolean(org.description && org.description.trim().length > 0),
        route: 'setup',
      },
      {
        id: 'contact',
        label: 'Set contact email',
        complete: Boolean(org.contactEmail),
        route: 'setup',
      },
      {
        id: 'invite',
        label: 'Create an invite link for members',
        complete: hasActiveInviteLink,
        route: 'setup',
      },
      {
        id: 'space',
        label: 'Configure co-working space',
        complete: Boolean(space),
        route: 'space',
      },
    ]

    const completedCount = steps.filter((s) => s.complete).length
    const percentage = Math.round((completedCount / steps.length) * 100)

    return {
      steps,
      completedCount,
      totalCount: steps.length,
      percentage,
      isComplete: completedCount === steps.length,
    }
  },
})

// Ensure an active invite link exists and return it (for bulk invite flow)
export const getOrCreateInviteLink = mutation({
  args: {
    orgId: v.id('organizations'),
  },
  handler: async (ctx, { orgId }) => {
    const adminMembership = await requireOrgAdmin(ctx, orgId)

    // Check for existing active link
    const existingLinks = await ctx.db
      .query('orgInviteLinks')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const now = Date.now()
    const activeLink = existingLinks.find(
      (link) => !link.expiresAt || link.expiresAt > now,
    )

    if (activeLink) {
      return { token: activeLink.token }
    }

    // Create a new invite link
    const token = crypto.randomUUID()
    await ctx.db.insert('orgInviteLinks', {
      orgId,
      token,
      createdBy: adminMembership._id,
      createdAt: now,
    })

    return { token }
  },
})
