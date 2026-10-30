import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { getUserId, requireOrgAdmin } from './lib/auth'
import { getOrgAccess } from './lib/courseAccess'
import { COURSE_TAGS } from './lib/courses'

const levelValidator = v.union(v.literal('read'), v.literal('edit'))

/**
 * What the current user can reach in the org: everything as an admin, or the
 * courses they were granted. Null when they are not a member.
 */
export const myAccess = query({
  args: { orgId: v.id('organizations') },
  returns: v.union(
    v.object({
      isAdmin: v.boolean(),
      courses: v.array(v.object({ course: v.string(), level: levelValidator })),
    }),
    v.null(),
  ),
  handler: async (ctx, { orgId }) => {
    const userId = await getUserId(ctx)
    if (!userId) return null
    const access = await getOrgAccess(ctx, userId, orgId)
    if (!access) return null
    return {
      isAdmin: access.isAdmin,
      courses: [...access.courses].map(([course, level]) => ({
        course,
        level,
      })),
    }
  },
})

/** Every course grant in the org, with the person's name and email (admins). */
export const list = query({
  args: { orgId: v.id('organizations') },
  returns: v.array(
    v.object({
      userId: v.string(),
      name: v.union(v.string(), v.null()),
      email: v.union(v.string(), v.null()),
      course: v.string(),
      level: levelValidator,
    }),
  ),
  handler: async (ctx, { orgId }) => {
    await requireOrgAdmin(ctx, orgId)
    const grants = await ctx.db
      .query('courseAccess')
      .withIndex('by_org_and_course', (q) => q.eq('orgId', orgId))
      .collect()
    return await Promise.all(
      grants.map(async (g) => {
        const profile = await ctx.db
          .query('profiles')
          .withIndex('by_user', (q) => q.eq('userId', g.userId))
          .first()
        return {
          userId: g.userId,
          name: profile?.name ?? null,
          email: profile?.email ?? null,
          course: g.course,
          level: g.level,
        }
      }),
    )
  },
})

/**
 * Give a member read or edit access to one course, change it, or take it
 * away (`level: null`). Admins only; admins themselves need no grants.
 */
export const setAccess = mutation({
  args: {
    orgId: v.id('organizations'),
    userId: v.string(),
    course: v.string(),
    level: v.union(levelValidator, v.null()),
  },
  returns: v.null(),
  handler: async (ctx, { orgId, userId, course, level }) => {
    const adminId = await requireOrgAdmin(ctx, orgId)
    if (!(COURSE_TAGS as ReadonlyArray<string>).includes(course)) {
      throw new ConvexError(`Unknown course "${course}".`)
    }
    const membership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user_and_org', (q) =>
        q.eq('userId', userId).eq('orgId', orgId),
      )
      .first()
    if (!membership) {
      throw new ConvexError('That person is not a member of the organization.')
    }
    const existing = (
      await ctx.db
        .query('courseAccess')
        .withIndex('by_org_and_user', (q) =>
          q.eq('orgId', orgId).eq('userId', userId),
        )
        .collect()
    ).find((g) => g.course === course)
    if (level === null) {
      if (existing) await ctx.db.delete('courseAccess', existing._id)
    } else if (existing) {
      await ctx.db.patch('courseAccess', existing._id, {
        level,
        grantedBy: adminId,
        grantedAt: Date.now(),
      })
    } else {
      await ctx.db.insert('courseAccess', {
        orgId,
        userId,
        course,
        level,
        grantedBy: adminId,
        grantedAt: Date.now(),
      })
    }
    return null
  },
})
