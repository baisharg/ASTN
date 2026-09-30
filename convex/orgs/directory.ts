import { v } from 'convex/values'
import { query } from '../_generated/server'
import { getUserId } from '../lib/auth'

// Get organization by slug
export const getOrgBySlug = query({
  args: { slug: v.string() },
  returns: v.any(),
  handler: async (ctx, { slug }) => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .first()
    if (!org) return null

    // Resolve fresh logo URL from storage (stored URLs expire)
    let logoUrl = org.logoUrl
    if (org.logoStorageId) {
      const url = await ctx.storage.getUrl(org.logoStorageId)
      if (url) logoUrl = url
    }

    // Never send the stored Luma key to the client.
    const { lumaApiKey: _lumaApiKey, ...publicOrg } = org
    return { ...publicOrg, logoUrl }
  },
})

// Get visible members for an organization's directory. Only members of the
// org can see it; everyone else gets an empty list.
export const getVisibleMembers = query({
  args: { orgId: v.id('organizations') },
  returns: v.any(),
  handler: async (ctx, { orgId }) => {
    const viewerId = await getUserId(ctx)
    if (!viewerId) return []
    const viewerMembership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user_and_org', (q) =>
        q.eq('userId', viewerId).eq('orgId', orgId),
      )
      .first()
    if (!viewerMembership) return []

    // Get all memberships with visible directory visibility
    const memberships = await ctx.db
      .query('orgMemberships')
      .withIndex('by_org_and_directoryVisibility', (q) =>
        q.eq('orgId', orgId).eq('directoryVisibility', 'visible'),
      )
      .collect()

    // Fetch profile data for each member
    const membersWithProfiles = await Promise.all(
      memberships.map(async (membership) => {
        // Get profile for this user
        const profile = await ctx.db
          .query('profiles')
          .withIndex('by_user', (q) => q.eq('userId', membership.userId))
          .first()

        return {
          membershipId: membership._id,
          userId: membership.userId,
          role: membership.role,
          profile: profile
            ? {
                name: profile.name || 'Anonymous',
                headline: profile.headline,
                skills: [...(profile.skills || [])]
                  .sort((a, b) => a.localeCompare(b))
                  .slice(0, 3),
                location: profile.location,
              }
            : {
                name: 'Anonymous',
                headline: undefined,
                skills: [],
                location: undefined,
              },
        }
      }),
    )

    // Sort: admins first, then alphabetically by name
    return membersWithProfiles.sort((a, b) => {
      // Admins first
      if (a.role === 'admin' && b.role !== 'admin') return -1
      if (b.role === 'admin' && a.role !== 'admin') return 1
      // Then alphabetically by name
      return a.profile.name.localeCompare(b.profile.name)
    })
  },
})

// Validate an invite token
export const validateInviteToken = query({
  args: { token: v.string() },
  returns: v.any(),
  handler: async (ctx, { token }) => {
    // Find invite by token
    const invite = await ctx.db
      .query('orgInviteLinks')
      .withIndex('by_token', (q) => q.eq('token', token))
      .first()

    if (!invite) {
      return { valid: false as const }
    }

    // Check expiration
    if (invite.expiresAt && invite.expiresAt < Date.now()) {
      return { valid: false as const }
    }

    // Get org details
    const org = await ctx.db.get('organizations', invite.orgId)
    if (!org) {
      return { valid: false as const }
    }

    return {
      valid: true as const,
      orgId: invite.orgId,
      orgName: org.name,
      orgSlug: org.slug,
    }
  },
})

// Get member count for an organization
export const getMemberCount = query({
  args: { orgId: v.id('organizations') },
  returns: v.number(),
  handler: async (ctx, { orgId }) => {
    const memberships = await ctx.db
      .query('orgMemberships')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()

    return memberships.length
  },
})
