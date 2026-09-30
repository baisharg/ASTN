'use node'
import { v } from 'convex/values'
import { action, internalAction } from '../_generated/server'
import { internal } from '../_generated/api'
import { log } from '../lib/logging'
import { fetchLumaEvents, resolveLumaCalendarId } from './lumaClient'
import type { Id } from '../_generated/dataModel'

/**
 * Resolve a Lu.ma calendar URL to its calendar API ID.
 * Called from admin settings when configuring event sync.
 */
export const resolveLumaCalendar = action({
  args: { calendarUrl: v.string() },
  returns: v.string(),
  handler: async (_ctx, { calendarUrl }) => {
    return await resolveLumaCalendarId(calendarUrl)
  },
})

/**
 * Sync events for a single organization from Lu.ma, through the old public
 * endpoint (no API key needed). Orgs on the calendar of LUMA_API_KEY use the
 * official API instead (convex/luma/sync.ts), which also mirrors private
 * events and guest lists.
 */
export const syncOrgEvents = internalAction({
  args: { orgId: v.id('organizations') },
  returns: v.null(),
  handler: async (ctx, { orgId }) => {
    // Get org's lu.ma config
    const org = await ctx.runQuery(internal.orgs.queries.getById, { orgId })
    if (!org?.lumaCalendarApiId) {
      log('info', 'Org has no lu.ma calendar ID, skipping', { orgId })
      return null
    }

    log('info', 'Syncing events for org', { orgName: org.name })

    // Fetch upcoming and recent past events from the public API
    const [upcomingEvents, pastEvents] = await Promise.all([
      fetchLumaEvents(org.lumaCalendarApiId, { period: 'upcoming' }),
      fetchLumaEvents(org.lumaCalendarApiId, { period: 'past' }),
    ])

    // Combine and dedupe by event API ID
    const seen = new Set<string>()
    const allEntries = [...upcomingEvents, ...pastEvents].filter((entry) => {
      if (seen.has(entry.event.api_id)) return false
      seen.add(entry.event.api_id)
      return true
    })

    log('info', 'Fetched events from lu.ma', {
      orgName: org.name,
      upcoming: upcomingEvents.length,
      past: pastEvents.length,
      total: allEntries.length,
    })

    // Transform lu.ma events to our schema format
    const events = allEntries.map((entry) => ({
      lumaEventId: entry.event.api_id,
      title: entry.event.name,
      description: undefined as string | undefined,
      startAt: new Date(entry.event.start_at).getTime(),
      endAt: entry.event.end_at
        ? new Date(entry.event.end_at).getTime()
        : undefined,
      timezone: entry.event.timezone,
      coverUrl: entry.event.cover_url ?? undefined,
      // The endpoint returns only the slug; store the full URL like the
      // official API does.
      url: /^https?:\/\//.test(entry.event.url)
        ? entry.event.url
        : `https://luma.com/${entry.event.url}`,
      location:
        entry.event.geo_address_info?.full_address ??
        entry.event.geo_address_info?.address ??
        entry.event.geo_address_info?.city ??
        undefined,
      isVirtual: entry.event.location_type === 'online',
    }))

    // Upsert events to database
    if (events.length > 0) {
      await ctx.runMutation(internal.events.mutations.upsertEvents, {
        orgId,
        events,
      })
    }

    // Update org's sync timestamp
    await ctx.runMutation(internal.events.mutations.updateOrgSyncTimestamp, {
      orgId,
      timestamp: Date.now(),
    })

    log('info', 'Synced events for org', {
      orgName: org.name,
      eventCount: events.length,
    })

    return null
  },
})

/**
 * Run full event sync for all organizations with Lu.ma configured.
 * Called by daily cron job.
 */
export const runFullEventSync = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    log('info', 'Starting lu.ma event sync')

    // Get all orgs with lu.ma calendar IDs configured
    const orgsWithLuma = await ctx.runQuery(
      internal.events.queries.getOrgsWithLumaConfig,
    )

    log('info', 'Found orgs with lu.ma config', {
      orgCount: orgsWithLuma.length,
    })

    // Orgs on the API key's calendar get a full official-API sync (events,
    // then guests into the CRM); the rest keep the public endpoint.
    const official: Array<Id<'organizations'>> = await ctx.runAction(
      internal.luma.sync.officialApiOrgs,
      {},
    )
    for (const orgId of official) {
      try {
        await ctx.runAction(internal.luma.sync.syncOrg, { orgId, mode: 'full' })
      } catch (error) {
        log('error', 'Failed to sync org events (Luma API)', {
          orgId,
          error: String(error),
        })
      }
    }

    // Sync each org's events (staggered to avoid rate limits)
    for (const org of orgsWithLuma) {
      if (official.includes(org._id)) continue
      try {
        await ctx.runAction(internal.events.sync.syncOrgEvents, {
          orgId: org._id,
        })

        // 1 second delay between orgs to avoid rate limits
        await new Promise((resolve) => setTimeout(resolve, 1000))
      } catch (error) {
        log('error', 'Failed to sync org events', {
          orgName: org.name,
          error: String(error),
        })
        // Continue with other orgs even if one fails
      }
    }

    log('info', 'Event sync complete')
    return null
  },
})
