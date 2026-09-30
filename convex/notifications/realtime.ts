import { v } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import { internal } from '../_generated/api'
import { log } from '../lib/logging'
import { isPublicEvent } from '../events/queries'
import type { Id } from '../_generated/dataModel'

// Rate limit: max 5 event notifications per hour per user
const RATE_LIMIT_WINDOW = 60 * 60 * 1000 // 1 hour
const RATE_LIMIT_MAX = 5

/**
 * Get users with "all" frequency for a specific org
 * These users should receive immediate in-app notifications for new events
 */
export const getUsersForAllFrequency = internalQuery({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, { orgId }) => {
    // Get org members
    const memberships = await ctx.db
      .query('orgMemberships')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()

    const usersToNotify: Array<{
      userId: string
      profileId: Id<'profiles'>
    }> = []

    for (const membership of memberships) {
      const profile = await ctx.db
        .query('profiles')
        .withIndex('by_user', (q) => q.eq('userId', membership.userId))
        .first()

      if (!profile) continue

      // Check for "all" frequency
      if (profile.eventNotificationPreferences?.frequency !== 'all') continue

      // Check if org is muted
      const mutedOrgIds = profile.eventNotificationPreferences.mutedOrgIds
      if (mutedOrgIds && mutedOrgIds.includes(orgId)) continue

      usersToNotify.push({
        userId: membership.userId,
        profileId: profile._id,
      })
    }

    return usersToNotify
  },
})

/**
 * Send real-time notifications to users with "all" frequency when new events are created
 * Includes rate limiting to prevent notification fatigue
 */
export const notifyAllFrequencyUsers = internalMutation({
  args: {
    eventId: v.id('events'),
    orgId: v.id('organizations'),
  },
  handler: async (ctx, { eventId, orgId }) => {
    const event = await ctx.db.get('events', eventId)
    // The Luma mirror also holds private and canceled events.
    if (!event || !isPublicEvent(event)) return { notified: 0, rateLimited: 0 }

    const org = await ctx.db.get('organizations', orgId)
    if (!org) return { notified: 0, rateLimited: 0 }

    const users = await ctx.runQuery(
      internal.notifications.realtime.getUsersForAllFrequency,
      { orgId },
    )

    const now = Date.now()
    let notified = 0
    let rateLimited = 0

    for (const user of users) {
      // Check rate limit: count recent notifications for this user
      const recentNotifications = await ctx.db
        .query('notifications')
        .withIndex('by_user', (q) => q.eq('userId', user.userId))
        .filter((q) =>
          q.and(
            q.eq(q.field('type'), 'event_new'),
            q.gt(q.field('createdAt'), now - RATE_LIMIT_WINDOW),
          ),
        )
        .collect()

      if (recentNotifications.length >= RATE_LIMIT_MAX) {
        rateLimited++
        continue // Skip - user hit rate limit
      }

      // Create in-app notification
      await ctx.db.insert('notifications', {
        userId: user.userId,
        type: 'event_new',
        eventId,
        orgId,
        title: `New event: ${event.title}`,
        body: org.name,
        actionUrl: event.url,
        read: false,
        createdAt: now,
      })

      notified++
    }

    log('info', 'Real-time event notification complete', {
      notified,
      rateLimited,
    })
    return { notified, rateLimited }
  },
})
