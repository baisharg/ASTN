import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalMutation } from '../_generated/server'
import { isPublicEvent } from '../events/queries'

const ONE_WEEK = 7 * 24 * 60 * 60 * 1000
const ONE_DAY = 24 * 60 * 60 * 1000
const ONE_HOUR = 60 * 60 * 1000

/**
 * Schedule reminders for a user who viewed an event
 * Called internally from recordEventView via scheduler
 */
export const scheduleRemindersForViewInternal = internalMutation({
  args: { eventId: v.id('events'), userId: v.string() },
  handler: async (ctx, { eventId, userId }) => {
    const event = await ctx.db.get('events', eventId)
    if (!event || !isPublicEvent(event)) return

    const profile = await ctx.db
      .query('profiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()

    const prefs = profile?.eventNotificationPreferences?.reminderTiming
    if (!prefs) return // No reminder preferences set

    // Don't schedule if notifications are disabled
    if (profile.eventNotificationPreferences?.frequency === 'none') return

    const now = Date.now()

    // Helper to schedule a reminder
    const scheduleReminder = async (
      timing: '1_week' | '1_day' | '1_hour',
      offset: number,
    ) => {
      const scheduledFor = event.startAt - offset
      if (scheduledFor <= now) return // Already passed

      // Check if already scheduled
      const existing = await ctx.db
        .query('scheduledReminders')
        .withIndex('by_user_event', (q) =>
          q.eq('userId', userId).eq('eventId', eventId),
        )
        .filter((q) => q.eq(q.field('timing'), timing))
        .first()

      if (existing) return // Already scheduled

      // Schedule the reminder
      const functionId = await ctx.scheduler.runAt(
        scheduledFor,
        internal.notifications.scheduler.sendReminder,
        { eventId, userId, timing },
      )

      // Track the scheduled function
      await ctx.db.insert('scheduledReminders', {
        eventId,
        userId,
        timing,
        scheduledFunctionId: functionId.toString(),
        scheduledFor,
      })
    }

    // Schedule based on preferences
    if (prefs.oneWeekBefore) {
      await scheduleReminder('1_week', ONE_WEEK)
    }
    if (prefs.oneDayBefore) {
      await scheduleReminder('1_day', ONE_DAY)
    }
    if (prefs.oneHourBefore) {
      await scheduleReminder('1_hour', ONE_HOUR)
    }
  },
})

/**
 * Send a reminder notification (called by scheduler)
 */
export const sendReminder = internalMutation({
  args: {
    eventId: v.id('events'),
    userId: v.string(),
    timing: v.union(
      v.literal('1_week'),
      v.literal('1_day'),
      v.literal('1_hour'),
    ),
  },
  handler: async (ctx, { eventId, userId, timing }) => {
    const event = await ctx.db.get('events', eventId)
    if (!event) return // Event deleted

    // Canceled or made private in Luma since the reminder was scheduled.
    if (!isPublicEvent(event)) {
      const stale = await ctx.db
        .query('scheduledReminders')
        .withIndex('by_user_event', (q) =>
          q.eq('userId', userId).eq('eventId', eventId),
        )
        .filter((q) => q.eq(q.field('timing'), timing))
        .first()
      if (stale) await ctx.db.delete('scheduledReminders', stale._id)
      return
    }

    const org = await ctx.db.get('organizations', event.orgId)

    const timingLabels = {
      '1_week': 'in 1 week',
      '1_day': 'tomorrow',
      '1_hour': 'in 1 hour',
    }

    // Create in-app notification
    await ctx.db.insert('notifications', {
      userId,
      type: 'event_reminder',
      eventId,
      orgId: event.orgId,
      title: `Event ${timingLabels[timing]}: ${event.title}`,
      body: org?.name || 'Event reminder',
      actionUrl: event.url,
      read: false,
      createdAt: Date.now(),
    })

    // Remove from scheduled reminders
    const scheduled = await ctx.db
      .query('scheduledReminders')
      .withIndex('by_user_event', (q) =>
        q.eq('userId', userId).eq('eventId', eventId),
      )
      .filter((q) => q.eq(q.field('timing'), timing))
      .first()

    if (scheduled) {
      await ctx.db.delete('scheduledReminders', scheduled._id)
    }
  },
})

/**
 * Cancel all reminders for an event (call when event is deleted or significantly changed)
 */
export const cancelEventReminders = internalMutation({
  args: { eventId: v.id('events') },
  handler: async (ctx, { eventId }) => {
    const reminders = await ctx.db
      .query('scheduledReminders')
      .withIndex('by_event', (q) => q.eq('eventId', eventId))
      .collect()

    for (const reminder of reminders) {
      try {
        await ctx.scheduler.cancel(reminder.scheduledFunctionId as any)
      } catch {
        // Scheduled function may have already run
      }
      await ctx.db.delete('scheduledReminders', reminder._id)
    }
  },
})
