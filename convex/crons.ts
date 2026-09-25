import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// Run daily at 6 AM UTC
// This syncs opportunities from 80K Hours and aisafety.com
crons.daily(
  'sync-opportunities',
  { hourUTC: 6, minuteUTC: 0 },
  internal.aggregation.sync.runFullSync,
)

// Run daily at 7 AM UTC (after opportunity sync at 6 AM)
// Syncs events from lu.ma for orgs with API keys configured
crons.daily(
  'sync-luma-events',
  { hourUTC: 7, minuteUTC: 0 },
  internal.events.sync.runFullEventSync,
)

// Run hourly to process match alerts for each timezone's 8 AM
// Each hour, users whose local time is 8 AM receive their alerts
crons.hourly(
  'send-match-alerts',
  { minuteUTC: 0 },
  internal.emails.batchActions.processMatchAlertBatch,
  {},
)

// Run hourly at :15 to process deadline reminders for each timezone's 8 AM
// Offset from match alerts at :00 and event digests at :30
crons.cron(
  'send-deadline-reminders',
  '15 * * * *',
  internal.emails.batchActions.processDeadlineReminderBatch,
  {},
)

// Run weekly on Sunday evening UTC
// Covers Sunday afternoon/evening in Americas
crons.weekly(
  'send-weekly-digest',
  { dayOfWeek: 'sunday', hourUTC: 22, minuteUTC: 0 },
  internal.emails.batchActions.processWeeklyDigestBatch,
  {},
)

// Run hourly to process daily event digest for each timezone's 9 AM
// Offset from match alerts at :00 to avoid collision
crons.hourly(
  'send-daily-event-digest',
  { minuteUTC: 30 },
  internal.emails.batchActions.processDailyEventDigestBatch,
  {},
)

// Run weekly on Sunday evening UTC (same time as weekly opportunity digest)
// Users who have both enabled will get both in same window
crons.weekly(
  'send-weekly-event-digest',
  { dayOfWeek: 'sunday', hourUTC: 22, minuteUTC: 30 },
  internal.emails.batchActions.processWeeklyEventDigestBatch,
  {},
)

// Run every 10 minutes to check for ended events and schedule attendance prompts
// Prompts are sent 1 hour after event end to users who viewed the event
crons.interval(
  'check-ended-events',
  { minutes: 10 },
  internal.attendance.scheduler.schedulePostEventPrompts,
)

// Run daily at 4 AM UTC (before match alerts at 8 AM)
// Computes engagement scores for all org members with stale scores
crons.daily(
  'compute-engagement-scores',
  { hourUTC: 4, minuteUTC: 0 },
  internal.engagement.compute.runEngagementBatch,
)

// Keep in-person events in step with Luma in case a webhook is missed
crons.interval(
  'sync-social-event-guests',
  { minutes: 10 },
  internal.social.lumaSync.pullAllOpenEvents,
  {},
)

export default crons
