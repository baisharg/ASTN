import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { getUserId } from './auth'
import { OTHER_COURSE, courseOf } from './courses'
import { logPermissionChange } from './permissionLog'

/**
 * Who opens which courses. Only org admins reach courses; members don't.
 * - Owners and admins with all courses (`courseScope` absent or 'all') open
 *   every course, including "Other" (opportunities without a course tag) and
 *   courses added later.
 * - Admins with chosen courses (`courseScope: 'chosen'`) open only the
 *   courses in their `courseAccess` grants: "read" shows the opportunity,
 *   its applications, answers, availability and surveys; "edit" also lets
 *   them change statuses, emails, polls, surveys and forms.
 * Everything that is not a course (CRM, events, members, settings, the MCP)
 * is the same for every admin. Canonicals and permissions are for owners.
 */
export type AccessLevel = 'read' | 'edit'

export interface OrgAccess {
  isAdmin: boolean
  isOwner: boolean
  /** Opens every course, now and later. */
  allCourses: boolean
  /** The granted courses, when `allCourses` is false. */
  courses: Map<string, AccessLevel>
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
  return await accessOf(ctx, membership)
}

/** The access a membership gives. */
export async function accessOf(
  ctx: QueryCtx | MutationCtx,
  membership: Doc<'orgMemberships'>,
): Promise<OrgAccess> {
  const courses = new Map<string, AccessLevel>()
  const isAdmin = membership.role === 'admin'
  const isOwner = isAdmin && membership.isOwner === true
  const allCourses = isOwner || (isAdmin && membership.courseScope !== 'chosen')
  if (isAdmin && !allCourses) {
    const grants = await ctx.db
      .query('courseAccess')
      .withIndex('by_org_and_user', (q) =>
        q.eq('orgId', membership.orgId).eq('userId', membership.userId),
      )
      .collect()
    for (const g of grants) courses.set(g.course, g.level)
  }
  return { isAdmin, isOwner, allCourses, courses }
}

/** The access column an opportunity falls under: its course, or "Other". */
export function accessCourseOf(
  tags: ReadonlyArray<string> | undefined,
): string {
  return courseOf(tags) ?? OTHER_COURSE
}

/** Whether `access` reaches `opportunity` at `level`. */
export function canAccessOpportunity(
  access: OrgAccess | null,
  opportunity: Pick<Doc<'orgOpportunities'>, 'tags'>,
  level: AccessLevel,
): boolean {
  if (!access?.isAdmin) return false
  if (access.allCourses) return true
  const granted = access.courses.get(accessCourseOf(opportunity.tags))
  return granted === 'edit' || (granted === 'read' && level === 'read')
}

/**
 * Require the current user to reach `opportunity` at `level`: an admin with
 * every course or with a grant for its course. Returns the user id.
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

/**
 * Drop someone's course grants, e.g. when they leave or become an admin, and
 * record each one in the permission log.
 */
export async function deleteCourseGrants(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  userId: string,
  by: string | null,
  via: string,
): Promise<void> {
  const grants = await ctx.db
    .query('courseAccess')
    .withIndex('by_org_and_user', (q) =>
      q.eq('orgId', orgId).eq('userId', userId),
    )
    .collect()
  for (const g of grants) {
    await ctx.db.delete('courseAccess', g._id)
    await logPermissionChange(ctx, {
      orgId,
      userId,
      by,
      change: 'course',
      course: g.course,
      from: g.level,
      to: null,
      via,
    })
  }
}
