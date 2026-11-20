import { ConvexError, v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import { getUserId } from './lib/auth'
import {
  canManagePermissions,
  deleteCourseGrants,
  getOrgAccess,
  requirePermissionManager,
} from './lib/courseAccess'
import { ACCESS_COURSES } from './lib/courses'
import { logPermissionChange } from './lib/permissionLog'

const levelValidator = v.union(v.literal('read'), v.literal('edit'))

/**
 * What the current user can reach in the org: whether they are an admin,
 * whether they open every course, and otherwise their granted courses.
 * Null when they are not a member.
 */
export const myAccess = query({
  args: { orgId: v.id('organizations') },
  returns: v.union(
    v.object({
      isAdmin: v.boolean(),
      isOwner: v.boolean(),
      // Owners manage roles and course access (any admin while there is none).
      canManage: v.boolean(),
      allCourses: v.boolean(),
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
      isOwner: access.isOwner,
      canManage: await canManagePermissions(ctx, userId, orgId),
      allCourses: access.allCourses,
      courses: [...access.courses].map(([course, level]) => ({
        course,
        level,
      })),
    }
  },
})

/** Every course grant of the org's admins with chosen courses (owners). */
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
    await requirePermissionManager(ctx, orgId)
    const grants = await ctx.db
      .query('courseAccess')
      .withIndex('by_org_and_course', (q) => q.eq('orgId', orgId))
      .collect()
    const members = await ctx.db
      .query('orgMemberships')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const chosen = new Set(
      members
        .filter(
          (m) =>
            m.role === 'admin' &&
            m.isOwner !== true &&
            m.courseScope === 'chosen',
        )
        .map((m) => m.userId),
    )
    return await Promise.all(
      grants
        .filter((g) => chosen.has(g.userId))
        .map(async (g) => {
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
 * Whether an admin opens every course (`all`) or only the ones granted to
 * them (`chosen`). Owners only; owners themselves always open every course.
 * It never changes whether someone is an admin: that is done in Members.
 * Moving to `all` drops their grants, so moving back starts from none.
 */
export const setScope = mutation({
  args: {
    orgId: v.id('organizations'),
    membershipId: v.id('orgMemberships'),
    scope: v.union(v.literal('all'), v.literal('chosen')),
  },
  returns: v.null(),
  handler: async (ctx, { orgId, membershipId, scope }) => {
    const managerId = await requirePermissionManager(ctx, orgId)
    const target = await ctx.db.get('orgMemberships', membershipId)
    if (!target || target.orgId !== orgId) {
      throw new ConvexError('Membership not found')
    }
    if (target.role !== 'admin') {
      throw new ConvexError('Make them an admin first, in Members.')
    }
    if (target.isOwner === true) {
      throw new ConvexError('Owners open every course.')
    }
    const via = 'courseAccess:setScope'
    const from = target.courseScope === 'chosen' ? 'chosen' : 'all'
    await ctx.db.patch('orgMemberships', membershipId, {
      courseScope: scope === 'chosen' ? 'chosen' : undefined,
    })
    await logPermissionChange(ctx, {
      orgId,
      userId: target.userId,
      by: managerId,
      change: 'scope',
      from,
      to: scope,
      via,
    })
    if (scope === 'all') {
      await deleteCourseGrants(ctx, orgId, target.userId, managerId, via)
    }
    return null
  },
})

/**
 * Give an admin with chosen courses read or edit access to one course
 * ("Other" covers opportunities without a course tag), change it, or take
 * it away (`level: null`). Owners only.
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
    const adminId = await requirePermissionManager(ctx, orgId)
    if (!ACCESS_COURSES.includes(course)) {
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
    if (membership.role !== 'admin') {
      throw new ConvexError('Make them an admin first, in Members.')
    }
    if (membership.isOwner === true || membership.courseScope !== 'chosen') {
      throw new ConvexError(
        'They open every course. Switch them to chosen courses first.',
      )
    }
    const existing = (
      await ctx.db
        .query('courseAccess')
        .withIndex('by_org_and_user', (q) =>
          q.eq('orgId', orgId).eq('userId', userId),
        )
        .collect()
    ).find((g) => g.course === course)
    await logPermissionChange(ctx, {
      orgId,
      userId,
      by: adminId,
      change: 'course',
      course,
      from: existing?.level ?? null,
      to: level,
      via: 'courseAccess:setAccess',
    })
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

/**
 * Make an admin an owner, or take it away. Owners open every course, edit
 * the canonicals and manage roles and course access. Owners only (any admin while the org has none); the last owner
 * cannot step down, so the org is never left without one by accident.
 */
export const setOwner = mutation({
  args: {
    orgId: v.id('organizations'),
    membershipId: v.id('orgMemberships'),
    owner: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, { orgId, membershipId, owner }) => {
    const managerId = await requirePermissionManager(ctx, orgId)
    const target = await ctx.db.get('orgMemberships', membershipId)
    if (!target || target.orgId !== orgId) {
      throw new ConvexError('Membership not found')
    }
    // Stepping down would lock you out of this very page: another owner
    // has to do it.
    if (!owner && target.userId === managerId && target.isOwner === true) {
      throw new ConvexError('Another owner has to remove you as owner.')
    }
    if (owner && target.role !== 'admin') {
      throw new ConvexError('Make them an admin first, in Members.')
    }
    if (!owner) {
      const owners = (
        await ctx.db
          .query('orgMemberships')
          .withIndex('by_org', (q) => q.eq('orgId', orgId))
          .collect()
      ).filter((m) => m.isOwner === true)
      if (owners.length === 1 && owners[0]._id === membershipId) {
        throw new ConvexError('Make someone else an owner first.')
      }
    }
    const via = 'courseAccess:setOwner'
    // An owner opens every course, and keeps doing so if they step down.
    await ctx.db.patch('orgMemberships', membershipId, {
      isOwner: owner || undefined,
      ...(owner ? { courseScope: undefined } : {}),
    })
    await logPermissionChange(ctx, {
      orgId,
      userId: target.userId,
      by: managerId,
      change: 'owner',
      from: target.isOwner === true ? 'yes' : 'no',
      to: owner ? 'yes' : 'no',
      via,
    })
    if (owner && target.courseScope === 'chosen') {
      await logPermissionChange(ctx, {
        orgId,
        userId: target.userId,
        by: managerId,
        change: 'scope',
        from: 'chosen',
        to: 'all',
        via,
      })
      await deleteCourseGrants(ctx, orgId, target.userId, managerId, via)
    }
    return null
  },
})

/**
 * Make an admin an owner from the CLI (`npx convex run`), for when no owner
 * can do it from the page: e.g. someone removed their own ownership before
 * that was blocked. Internal, so neither the web nor the MCP can call it.
 */
export const forceOwner = internalMutation({
  args: { membershipId: v.id('orgMemberships') },
  returns: v.null(),
  handler: async (ctx, { membershipId }) => {
    const target = await ctx.db.get('orgMemberships', membershipId)
    if (!target) throw new ConvexError('Membership not found')
    if (target.role !== 'admin') {
      throw new ConvexError('Only an admin can be an owner.')
    }
    await ctx.db.patch('orgMemberships', membershipId, { isOwner: true })
    await logPermissionChange(ctx, {
      orgId: target.orgId,
      userId: target.userId,
      by: null,
      change: 'owner',
      from: target.isOwner === true ? 'yes' : 'no',
      to: 'yes',
      via: 'courseAccess:forceOwner',
    })
    return null
  },
})
