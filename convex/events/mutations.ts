import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'
import { internal } from '../_generated/api'

/**
 * Upsert events from Lu.ma API for an organization.
 * Creates new events or updates existing ones by lumaEventId.
 */
export const upsertEvents = internalMutation({
  args: {
    orgId: v.id('organizations'),
    events: v.array(
      v.object({
        lumaEventId: v.string(),
        title: v.string(),
        description: v.optional(v.string()),
        startAt: v.number(),
        endAt: v.optional(v.number()),
        timezone: v.string(),
        coverUrl: v.optional(v.string()),
        url: v.string(),
        location: v.optional(v.string()),
        isVirtual: v.boolean(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { orgId, events }) => {
    const now = Date.now()

    for (const event of events) {
      // Check if event already exists
      // Each org keeps its own row for a Luma event.
      const existing = await ctx.db
        .query('events')
        .withIndex('by_orgId_and_lumaEventId', (q) =>
          q.eq('orgId', orgId).eq('lumaEventId', event.lumaEventId),
        )
        .first()

      if (existing) {
        // This endpoint reports an end time, a cover and an address for
        // every event, so one that is missing was removed in Luma and is
        // removed here. It has no descriptions, so the row keeps its own.
        await ctx.db.patch('events', existing._id, {
          ...event,
          endAt: event.endAt,
          coverUrl: event.coverUrl,
          location: event.location,
          syncedAt: now,
        })
      } else {
        // Create new event
        const newEventId = await ctx.db.insert('events', {
          ...event,
          orgId,
          syncedAt: now,
        })

        // Notify users with "all" frequency preference (async to avoid timeout)
        await ctx.scheduler.runAfter(
          0,
          internal.notifications.realtime.notifyAllFrequencyUsers,
          { eventId: newEventId, orgId },
        )
      }
    }
    return null
  },
})

/**
 * Update the eventsLastSynced timestamp on an organization.
 */
export const updateOrgSyncTimestamp = internalMutation({
  args: {
    orgId: v.id('organizations'),
    timestamp: v.number(),
  },
  handler: async (ctx, { orgId, timestamp }) => {
    await ctx.db.patch('organizations', orgId, { eventsLastSynced: timestamp })
  },
})
