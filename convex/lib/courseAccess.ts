import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { getUserId } from './auth'
import { courseOf } from './courses'
import type { CourseTag } from './courses'

/**
 * Per-course access for team members who are not org admins. Admins see and
 * do everything; anyone else sees an opportunity only through a grant for its
 * course tag: "read" shows the opportunity, its applications, answers and
 * availability; "edit" also lets them change statuses, emails, polls and
 * custom forms. Creating, duplicating, archiving or deleting opportunities,
 * and everything that is not a course (CRM, events, members, canonical
 * forms, settings), stays with admins.
 */
export type AccessLevel = 'read' | 'edit'

export interface OrgAccess {
  isAdmin: boolean
  courses: Map<CourseTag, AccessLevel>
}

export async function getOrgAccess(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  orgId: Id<'organizations'>,
): Promise<OrgAccess | null> {
  const membership = await ctx.db
    .query('orgMemberships')
    .withIndex('by_user_and_org', (q) =>
      q.eq('userId', userId).eq('orgId', orgId),
    )
    .first()
  if (!membership) return null
  const courses = new Map<CourseTag, AccessLevel>()
  if (membership.role !== 'admin') {
    const grants = await ctx.db
      .query('courseAccess')
      .withIndex('by_org_and_user', (q) =>
        q.eq('orgId', orgId).eq('userId', userId),
      )
      .collect()
    for (const g of grants) courses.set(g.course as CourseTag, g.level)
  }
  return { isAdmin: membership.role === 'admin', courses }
}

/** Whether `access` reaches `opportunity` at `level`. */
export function canAccessOpportunity(
  access: OrgAccess | null,
  opportunity: Pick<Doc<'orgOpportunities'>, 'tags'>,
  level: AccessLevel,
): boolean {
  if (!access) return false
  if (access.isAdmin) return true
  const course = courseOf(opportunity.tags)
  if (!course) return false
  const granted = access.courses.get(course)
  return granted === 'edit' || (granted === 'read' && level === 'read')
}

/**
 * Require the current user to reach `opportunity` at `level`: an org admin,
 * or a member with a grant for its course. Returns the user id.
 */
export async function requireOpportunityAccess(
  ctx: QueryCtx | MutationCtx,
  opportunity: Pick<Doc<'orgOpportunities'>, 'orgId' | 'tags'>,
  level: AccessLevel,
): Promise<string> {
  const userId = await getUserId(ctx)
  if (!userId) throw new Error('Not authenticated')
  const access = await getOrgAccess(ctx, userId, opportunity.orgId)
  if (!canAccessOpportunity(access, opportunity, level)) {
    throw new Error(
      level === 'edit' ? 'Edit access required' : 'Admin access required',
    )
  }
  return userId
}

/** Like requireOpportunityAccess, but answers instead of throwing. */
export async function hasOpportunityAccess(
  ctx: QueryCtx | MutationCtx,
  opportunity: Pick<Doc<'orgOpportunities'>, 'orgId' | 'tags'>,
  level: AccessLevel,
): Promise<boolean> {
  const userId = await getUserId(ctx)
  if (!userId) return false
  const access = await getOrgAccess(ctx, userId, opportunity.orgId)
  return canAccessOpportunity(access, opportunity, level)
}

/**
 * Whether `userId` manages roles and course permissions in the org: an owner,
 * or any admin while the org has no owner yet (so the first one can be set).
 */
export async function canManagePermissions(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  orgId: Id<'organizations'>,
): Promise<boolean> {
  const memberships = await ctx.db
    .query('orgMemberships')
    .withIndex('by_org', (q) => q.eq('orgId', orgId))
    .collect()
  const mine = memberships.find((m) => m.userId === userId)
  if (!mine || mine.role !== 'admin') return false
  return mine.isOwner === true || !memberships.some((m) => m.isOwner === true)
}

/** Throws unless the current user manages roles and permissions. */
export async function requirePermissionManager(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
): Promise<string> {
  const userId = await getUserId(ctx)
  if (!userId) throw new Error('Not authenticated')
  if (!(await canManagePermissions(ctx, userId, orgId))) {
    throw new Error('Only owners can change roles and permissions')
  }
  return userId
}

/** Drop someone's course grants, e.g. when they leave or become an admin. */
export async function deleteCourseGrants(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  userId: string,
): Promise<void> {
  const grants = await ctx.db
    .query('courseAccess')
    .withIndex('by_org_and_user', (q) =>
      q.eq('orgId', orgId).eq('userId', userId),
    )
    .collect()
  for (const g of grants) await ctx.db.delete('courseAccess', g._id)
}
