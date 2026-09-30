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
        // Update existing event
        await ctx.db.patch('events', existing._id, {
          ...event,
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
