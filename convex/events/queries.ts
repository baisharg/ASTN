import { v } from 'convex/values'
import { internalQuery, query } from '../_generated/server'
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

    return { upcoming, past }
  },
})

/**
 * Get events for dashboard - prioritize user's orgs.
 * Returns events from orgs user has joined first, then other org events for discovery.
 */
export const getDashboardEvents = query({
  args: {},
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

    // Enrich events with org info (only include events where we found the org)
    const enrichedEvents = allEvents
      .map((event) => {
        const org = orgMap[event.orgId.toString()]
        return org
          ? {
              ...event,
              org,
            }
          : null
      })
      .filter((e): e is NonNullable<typeof e> => e !== null)

    // Split by membership
    const userOrgEvents = enrichedEvents.filter((e) =>
      userOrgIds.has(e.orgId.toString()),
    )
    const otherOrgEvents = enrichedEvents.filter(
      (e) => !userOrgIds.has(e.orgId.toString()),
    )

    return {
      userOrgEvents,
      otherOrgEvents,
    }
  },
})
