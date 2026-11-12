import { ConvexError, v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalMutation, internalQuery } from '../_generated/server'
import { getLumaCalendar, hasLumaApiKey } from '../social/luma'
import type { Id } from '../_generated/dataModel'
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server'

/**
 * LUMA_API_KEY belongs to one Luma calendar, and only the one ASTN org
 * bound to that calendar may use it: to sync, create or edit events, email
 * guests, or push guest changes.
 *
 * Which org that is comes from the LUMA_OWNER_ORG_SLUG environment variable
 * (the org's slug). When it is set, only that org is bound, whatever any
 * org's Luma settings say; if no org has that slug, nobody is bound.
 *
 * When the variable is not set, the binding is read from the orgs' own Luma
 * settings, which their admins can edit: an org is bound when its Luma
 * calendar id (or the slug of its public calendar URL) matches the key's
 * calendar, and if two orgs match, neither may use the key.
 */

// Actions re-read the key's calendar from Luma when the cached one is older.
const CALENDAR_CACHE_MS = 60 * 60 * 1000

const NOT_CONNECTED =
  'Luma no está conectado para esta organización: la clave de Luma es de otro calendario.'

/** How the org bound to the key's calendar is decided. */
export type OwnerSource = 'env' | 'org_settings'

/** The org slug in LUMA_OWNER_ORG_SLUG, or null when it isn't set. */
export function configuredOwnerSlug(): string | null {
  const slug = process.env.LUMA_OWNER_ORG_SLUG?.trim().toLowerCase()
  return slug ? slug : null
}

function ownerSource(): OwnerSource {
  return configuredOwnerSlug() === null ? 'org_settings' : 'env'
}

/**
 * The orgs bound to `calendarId` when LUMA_OWNER_ORG_SLUG is set: the one org
 * with that slug, and only for the key's own calendar. A slug that matches
 * no org (or more than one) binds nobody.
 */
export function orgsBoundByOwnerSlug<OrgId>(input: {
  calendarId: string
  // The calendar LUMA_API_KEY belongs to, when it has been read.
  keyCalendarId: string | null
  orgsWithOwnerSlug: Array<OrgId>
}): Array<OrgId> {
  if (input.keyCalendarId === null) return []
  if (input.calendarId !== input.keyCalendarId) return []
  return input.orgsWithOwnerSlug.length === 1 ? input.orgsWithOwnerSlug : []
}

/** Orgs bound to this calendar (see the top of this file). */
export async function orgsForCalendar(
  ctx: QueryCtx | MutationCtx,
  calendarId: string,
  calendarSlug: string | null | undefined,
): Promise<Array<Id<'organizations'>>> {
  const ownerSlug = configuredOwnerSlug()
  if (ownerSlug !== null) {
    const keyCalendar = await cachedCalendar(ctx)
    const owners = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', ownerSlug))
      .take(2)
    return orgsBoundByOwnerSlug({
      calendarId,
      keyCalendarId: keyCalendar?.calendarId ?? null,
      orgsWithOwnerSlug: owners.map((org) => org._id),
    })
  }
  // A few dozen orgs at most.
  const orgs = await ctx.db.query('organizations').take(1000)
  const slug = calendarSlug?.toLowerCase()
  return orgs
    .filter((org) => {
      if (org.lumaCalendarApiId) return org.lumaCalendarApiId === calendarId
      if (!slug || !org.lumaCalendarUrl) return false
      try {
        const path = new URL(org.lumaCalendarUrl).pathname
        return path.replace(/^\//, '').split('/')[0].toLowerCase() === slug
      } catch {
        return false
      }
    })
    .map((org) => org._id)
}

/** The one org bound to a calendar, or null (none, or ambiguous). */
export async function orgForCalendar(
  ctx: QueryCtx | MutationCtx,
  calendarId: string,
  calendarSlug?: string | null,
): Promise<Id<'organizations'> | null> {
  let slug = calendarSlug
  if (slug === undefined || slug === null) {
    // Webhooks carry only the id; the cache knows the key calendar's slug.
    const cached = await cachedCalendar(ctx)
    if (cached?.calendarId === calendarId) slug = cached.slug
  }
  const orgs = await orgsForCalendar(ctx, calendarId, slug)
  return orgs.length === 1 ? orgs[0] : null
}

async function cachedCalendar(ctx: QueryCtx | MutationCtx) {
  return await ctx.db.query('lumaApiCalendar').first()
}

/** The org allowed to use LUMA_API_KEY, from the cached calendar. */
export async function apiCalendarOrg(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<'organizations'> | null> {
  if (!hasLumaApiKey()) return null
  const calendar = await cachedCalendar(ctx)
  if (!calendar) return null
  return await orgForCalendar(ctx, calendar.calendarId, calendar.slug)
}

export async function orgOwnsApiCalendar(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
): Promise<boolean> {
  return (await apiCalendarOrg(ctx)) === orgId
}

/** For queries and mutations (they can't call Luma; uses the cache). */
export async function requireOrgOwnsApiCalendar(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
): Promise<void> {
  if (!(await orgOwnsApiCalendar(ctx, orgId))) {
    throw new ConvexError(NOT_CONNECTED)
  }
}

export const getCachedCalendar = internalQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      calendarId: v.string(),
      slug: v.union(v.string(), v.null()),
      checkedAt: v.number(),
      orgId: v.union(v.id('organizations'), v.null()),
      boundOrgCount: v.number(),
      // 'env' when LUMA_OWNER_ORG_SLUG decides the bound org.
      ownerSource: v.union(v.literal('env'), v.literal('org_settings')),
    }),
  ),
  handler: async (ctx) => {
    const calendar = await cachedCalendar(ctx)
    if (!calendar) return null
    const orgs = await orgsForCalendar(ctx, calendar.calendarId, calendar.slug)
    return {
      calendarId: calendar.calendarId,
      slug: calendar.slug ?? null,
      checkedAt: calendar.checkedAt,
      orgId: orgs.length === 1 ? orgs[0] : null,
      boundOrgCount: orgs.length,
      ownerSource: ownerSource(),
    }
  },
})

export const setCachedCalendar = internalMutation({
  args: { calendarId: v.string(), slug: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { calendarId, slug }) => {
    const existing = await cachedCalendar(ctx)
    const doc = { calendarId, slug: slug ?? undefined, checkedAt: Date.now() }
    if (existing) await ctx.db.replace('lumaApiCalendar', existing._id, doc)
    else await ctx.db.insert('lumaApiCalendar', doc)
    return null
  },
})

/**
 * For actions: the key's calendar (re-read from Luma when the cache is
 * stale or `fresh`) and the one org bound to it.
 */
export async function resolveApiCalendar(
  ctx: ActionCtx,
  options?: { fresh?: boolean },
): Promise<{
  calendarId: string
  orgId: Id<'organizations'> | null
  boundOrgCount: number
  ownerSource: OwnerSource
}> {
  let cached = await ctx.runQuery(internal.luma.binding.getCachedCalendar, {})
  if (
    !cached ||
    options?.fresh ||
    cached.checkedAt < Date.now() - CALENDAR_CACHE_MS
  ) {
    const calendar = await getLumaCalendar()
    await ctx.runMutation(internal.luma.binding.setCachedCalendar, {
      calendarId: calendar.id,
      slug: calendar.slug,
    })
    cached = await ctx.runQuery(internal.luma.binding.getCachedCalendar, {})
  }
  if (!cached) throw new Error('Luma calendar cache missing')
  return {
    calendarId: cached.calendarId,
    orgId: cached.orgId,
    boundOrgCount: cached.boundOrgCount,
    ownerSource: cached.ownerSource,
  }
}

/**
 * For actions, before using the key for this org: the org must be the one
 * bound to the key's calendar.
 */
export async function assertOrgOwnsApiCalendar(
  ctx: ActionCtx,
  orgId: Id<'organizations'>,
): Promise<void> {
  if (!hasLumaApiKey()) {
    throw new ConvexError('Luma no está conectado (falta LUMA_API_KEY)')
  }
  const { orgId: owner } = await resolveApiCalendar(ctx)
  if (owner !== orgId) throw new ConvexError(NOT_CONNECTED)
}
