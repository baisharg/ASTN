import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'

type OrgScopedCrmTable =
  | 'crmContacts'
  | 'crmOrganizations'
  | 'crmOpportunities'
  | 'crmSubmissions'

/**
 * Load a CRM record by ID and verify it belongs to the caller-declared org.
 * Mirrors the read-getter pattern in `convex/crm.ts` so update/delete
 * mutations can't be tricked into mutating records the caller's bound
 * `orgId` doesn't cover.
 */
export async function requireOrgRecord<T extends OrgScopedCrmTable>(
  ctx: QueryCtx | MutationCtx,
  id: Id<T>,
  orgId: Id<'organizations'>,
  notFoundMsg: string,
): Promise<Doc<T>> {
  const record = await ctx.db.get(id)
  if (!record || record.orgId !== orgId) {
    throw new Error(notFoundMsg)
  }
  return record
}

/**
 * Try to look up a user's email from the legacy auth users table.
 * Post-Clerk-migration, userId is a Clerk subject string (not a valid Convex
 * document ID), so this will return null for migrated users.
 */
export async function getLegacyUserEmail(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<string | null> {
  try {
    const user = await ctx.db.get('users', userId as Id<'users'>)
    return user?.email ?? null
  } catch {
    return null
  }
}

/**
 * Get the current user's ID from Clerk identity.
 * Returns the Clerk subject (user_xxx) or null if not authenticated.
 */
export async function getUserId(
  ctx: QueryCtx | MutationCtx | ActionCtx,
): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity()
  return identity?.subject ?? null
}

/**
 * Require the current user to be authenticated.
 * Throws "Not authenticated" if no valid session exists.
 * Works with queries, mutations, and actions.
 */
export async function requireAuth(
  ctx: QueryCtx | MutationCtx | ActionCtx,
): Promise<string> {
  const userId = await getUserId(ctx)
  if (!userId) {
    throw new Error('Not authenticated')
  }
  return userId
}

/**
 * Require the current user to be an admin of a specific organization.
 * Uses the by_user_and_org index for efficient single-row lookup.
 */
export async function requireOrgAdmin(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
): Promise<string> {
  const userId = await getUserId(ctx)
  if (!userId) throw new Error('Not authenticated')

  const membership = await ctx.db
    .query('orgMemberships')
    .withIndex('by_user_and_org', (q) =>
      q.eq('userId', userId).eq('orgId', orgId),
    )
    .first()

  if (!membership || membership.role !== 'admin') {
    throw new Error('Admin access required')
  }

  return userId
}

/**
 * Require the current user to be an admin of at least one organization.
 * Throws "Not authenticated" if no valid session exists.
 * Throws "Admin access required" if user is not an admin of any org.
 *
 * Use this for legacy admin endpoints that operate on global data
 * (e.g., opportunity CRUD) where no specific orgId is available.
 */
export async function requireAnyOrgAdmin(
  ctx: QueryCtx | MutationCtx,
): Promise<string> {
  const userId = await getUserId(ctx)
  if (!userId) {
    throw new Error('Not authenticated')
  }

  const membership = await ctx.db
    .query('orgMemberships')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .filter((q) => q.eq(q.field('role'), 'admin'))
    .first()

  if (!membership) {
    throw new Error('Admin access required')
  }

  return userId
}

/**
 * Require the current user to be a platform admin.
 * Throws "Not authenticated" if no valid session exists.
 * Throws "Platform admin access required" if user is not a platform admin.
 *
 * Use this for platform-wide admin endpoints (e.g., reviewing org applications).
 */
export async function requirePlatformAdmin(
  ctx: QueryCtx | MutationCtx,
): Promise<string> {
  const userId = await getUserId(ctx)
  if (!userId) {
    throw new Error('Not authenticated')
  }

  const admin = await ctx.db
    .query('platformAdmins')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first()

  if (!admin) {
    throw new Error('Platform admin access required')
  }

  return userId
}

/**
 * Check if the current user is a platform admin (non-throwing).
 * Returns false if not authenticated or not a platform admin.
 *
 * Use this for frontend gating (show/hide admin UI elements).
 */
export async function isPlatformAdmin(
  ctx: QueryCtx | MutationCtx,
): Promise<boolean> {
  const userId = await getUserId(ctx)
  if (!userId) return false

  const admin = await ctx.db
    .query('platformAdmins')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first()

  return !!admin
}

/**
 * Require the current user to be an admin of the org that owns a specific space.
 * Returns userId, space document, and membership document.
 *
 * Use this for space-level admin operations (e.g., approving guest visits).
 */
export async function requireSpaceAdmin(
  ctx: QueryCtx | MutationCtx,
  spaceId: Id<'coworkingSpaces'>,
): Promise<{
  userId: string
  space: Doc<'coworkingSpaces'>
  membership: Doc<'orgMemberships'>
}> {
  const userId = await requireAuth(ctx)

  const space = await ctx.db.get('coworkingSpaces', spaceId)
  if (!space) throw new Error('Space not found')

  const membership = await ctx.db
    .query('orgMemberships')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .filter((q) => q.eq(q.field('orgId'), space.orgId))
    .first()

  if (!membership || membership.role !== 'admin') {
    throw new Error('Not authorized - must be org admin')
  }

  return { userId, space, membership }
}
