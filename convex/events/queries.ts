import { v } from 'convex/values'
import { internalQuery, query } from '../_generated/server'
import type { Infer } from 'convex/values'
import type { Doc } from '../_generated/dataModel'

/**
 * Whether an event may be shown to members and the public. The Luma mirror
 * also copies private and members-only events, and keeps canceled ones.
 */
export function isPublicEvent(event: Doc<'events'>): boolean {
  return !event.canceled && (event.visibility ?? 'public') === 'public'
}

/** Private events may come in runs; read at most this many to fill a list. */
export const PUBLIC_SCAN_LIMIT = 1000

/**
 * The first `limit` public events of an ordered query, reading rows until
 * that many are found or PUBLIC_SCAN_LIMIT rows have been read.
 */
export async function takePublicEvents(
  rows: AsyncIterable<Doc<'events'>>,
  limit: number,
): Promise<Array<Doc<'events'>>> {
  const out: Array<Doc<'events'>> = []
  let scanned = 0
  for await (const row of rows) {
    if (isPublicEvent(row)) out.push(row)
    if (out.length >= limit || ++scanned >= PUBLIC_SCAN_LIMIT) break
  }
  return out
}

/**
 * What members and visitors may read of an event. The mirror row also holds
 * guest counts, capacity, approval settings and sync state, which stay on
 * the server.
 */
const publicEventValidator = v.object({
  _id: v.id('events'),
  title: v.string(),
  startAt: v.number(),
  endAt: v.optional(v.number()),
  timezone: v.string(),
  coverUrl: v.optional(v.string()),
  url: v.string(),
  location: v.optional(v.string()),
  isVirtual: v.boolean(),
})

export function toPublicEvent(
  event: Doc<'events'>,
): Infer<typeof publicEventValidator> {
  return {
    _id: event._id,
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt,
    timezone: event.timezone,
    coverUrl: event.coverUrl,
    url: event.url,
    location: event.location,
    isVirtual: event.isVirtual,
  }
}

const dashboardEventValidator = publicEventValidator.extend({
  org: v.object({
    name: v.string(),
    slug: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
  }),
})

/**
 * Get all organizations that have Lu.ma calendar sync configured.
 * Used by sync action to know which orgs to sync events from.
 */
export const getOrgsWithLumaConfig = internalQuery({
  args: {},
  returns: v.array(v.object({ _id: v.id('organizations'), name: v.string() })),
  handler: async (ctx) => {
    const orgs = await ctx.db.query('organizations').collect()

    // Filter to orgs with lu.ma calendar API ID configured
    return orgs
      .filter((org) => org.lumaCalendarApiId)
      .map((org) => ({ _id: org._id, name: org.name }))
  },
})

/**
 * Get events for an organization's event page.
 * Returns upcoming events first, then past events.
 */
export const getOrgEvents = query({
  args: { orgId: v.id('organizations') },
  returns: v.object({
    upcoming: v.array(publicEventValidator),
    past: v.array(publicEventValidator),
  }),
  handler: async (ctx, { orgId }) => {
    const now = Date.now()

    const upcoming = await takePublicEvents(
      ctx.db
        .query('events')
        .withIndex('by_org_start', (q) =>
          q.eq('orgId', orgId).gte('startAt', now),
        )
        .order('asc'),
      50,
    )

    const past = await takePublicEvents(
      ctx.db
        .query('events')
        .withIndex('by_org_start', (q) =>
          q.eq('orgId', orgId).lt('startAt', now),
        )
        .order('desc'),
      20,
    )

    return {
      upcoming: upcoming.map(toPublicEvent),
      past: past.map(toPublicEvent),
    }
  },
})

/**
 * Get events for dashboard - prioritize user's orgs.
 * Returns events from orgs user has joined first, then other org events for discovery.
 */
export const getDashboardEvents = query({
  args: {},
  returns: v.object({
    userOrgEvents: v.array(dashboardEventValidator),
    otherOrgEvents: v.array(dashboardEventValidator),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return { userOrgEvents: [], otherOrgEvents: [] }
    }

    const userId = identity.subject

    // Get user's org memberships
    const memberships = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()

    const userOrgIds = new Set(memberships.map((m) => m.orgId.toString()))

    // Get upcoming events (next 30 days)
    const now = Date.now()
    const thirtyDaysFromNow = now + 30 * 24 * 60 * 60 * 1000

    // Fetch all upcoming events
    const allEvents = await takePublicEvents(
      ctx.db
        .query('events')
        .withIndex('by_startAt', (q) =>
          q.gte('startAt', now).lte('startAt', thirtyDaysFromNow),
        )
        .order('asc'),
      50,
    )

    // Get org details for each event
    const orgsData = await Promise.all(
      allEvents.map((event) => ctx.db.get('organizations', event.orgId)),
    )

    // Resolve fresh logo URLs from storage (stored URLs expire)
    const resolvedLogos = await Promise.all(
      orgsData.map(async (org) => {
        if (!org) return undefined
        if (org.logoStorageId) {
          const url = await ctx.storage.getUrl(org.logoStorageId)
          if (url) return url
        }
        return org.logoUrl
      }),
    )

    // Create org map using string keys for reliable comparison
    const orgMap: Record<
      string,
      { name: string; slug?: string; logoUrl?: string } | undefined
    > = {}
    for (let i = 0; i < allEvents.length; i++) {
      const org = orgsData[i]
      if (org) {
        orgMap[allEvents[i].orgId.toString()] = {
          name: org.name,
          slug: org.slug,
          logoUrl: resolvedLogos[i],
        }
      }
    }

    // Split by membership, with each event's public fields and its org
    // (events whose org is gone are left out).
    const userOrgEvents: Array<Infer<typeof dashboardEventValidator>> = []
    const otherOrgEvents: Array<Infer<typeof dashboardEventValidator>> = []
    for (const event of allEvents) {
      const org = orgMap[event.orgId.toString()]
      if (!org) continue
      const enriched = { ...toPublicEvent(event), org }
      if (userOrgIds.has(event.orgId.toString())) userOrgEvents.push(enriched)
      else otherOrgEvents.push(enriched)
    }

    return {
      userOrgEvents,
      otherOrgEvents,
    }
  },
})
