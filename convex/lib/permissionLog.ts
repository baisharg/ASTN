import type { MutationCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'

/**
 * One change to who someone is in an org or what they can open:
 * - `role`: their membership role (`admin`, `member`; null = not in the org)
 * - `owner`: whether they are an owner (`yes`, `no`)
 * - `course`: their access to `course` (`read`, `edit`; null = none)
 */
export interface PermissionChange {
  orgId: Id<'organizations'>
  userId: string
  /** Who made the change; null when it ran from the CLI or the system. */
  by: string | null
  change: 'role' | 'owner' | 'course'
  course?: string
  from: string | null
  to: string | null
  /** The function that made it, e.g. `orgs/admin:demoteToMember`. */
  via: string
}

/**
 * Record a permission change in `permissionChanges`. Every function that
 * changes a role, the owner flag or a course grant calls this in the same
 * transaction, so the record cannot miss a change or record one that failed.
 * Nothing in the app reads it: it is read from the Convex dashboard or with
 * `npx convex run permissionLog:listForOrg`.
 */
export async function logPermissionChange(
  ctx: MutationCtx,
  entry: PermissionChange,
): Promise<void> {
  if (entry.from === entry.to) return
  await ctx.db.insert('permissionChanges', entry)
}
