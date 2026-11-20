import { ConvexError, v } from 'convex/values'
import { internalQuery } from './_generated/server'
import type { QueryCtx } from './_generated/server'

/**
 * The org's permission changes, newest first, with names next to the ids.
 * Internal, so only the Convex dashboard or the CLI can read it:
 * `npx convex run permissionLog:listForOrg '{"orgSlug":"baish"}'`.
 */
export const listForOrg = internalQuery({
  args: { orgSlug: v.string(), limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      at: v.string(),
      person: v.string(),
      by: v.string(),
      change: v.string(),
      course: v.union(v.string(), v.null()),
      from: v.union(v.string(), v.null()),
      to: v.union(v.string(), v.null()),
      via: v.string(),
    }),
  ),
  handler: async (ctx, { orgSlug, limit }) => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', orgSlug))
      .unique()
    if (!org) throw new ConvexError(`No org with slug "${orgSlug}".`)
    const rows = await ctx.db
      .query('permissionChanges')
      .withIndex('by_orgId', (q) => q.eq('orgId', org._id))
      .order('desc')
      .take(limit ?? 100)
    const names = new Map<string, string>()
    const nameOf = async (userId: string | null) => {
      if (userId === null) return 'CLI / system'
      if (!names.has(userId)) names.set(userId, await describe(ctx, userId))
      return names.get(userId)!
    }
    return await Promise.all(
      rows.map(async (r) => ({
        at: new Date(r._creationTime).toISOString(),
        person: await nameOf(r.userId),
        by: await nameOf(r.by),
        change: r.change,
        course: r.course ?? null,
        from: r.from,
        to: r.to,
        via: r.via,
      })),
    )
  },
})

async function describe(ctx: QueryCtx, userId: string): Promise<string> {
  const profile = await ctx.db
    .query('profiles')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first()
  const label = profile?.name ?? profile?.email
  return label ? `${label} (${userId})` : userId
}
