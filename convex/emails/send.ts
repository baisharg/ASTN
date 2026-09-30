import { toZonedTime } from 'date-fns-tz'
import { v } from 'convex/values'
import { Resend } from '@convex-dev/resend'
import { internalMutation, internalQuery } from '../_generated/server'
import { components } from '../_generated/api'
import { log } from '../lib/logging'
import { getLegacyUserEmail } from '../lib/auth'
import { takePublicEvents } from '../events/queries'

// Initialize Resend component
// For production: set RESEND_API_KEY in Convex dashboard
// For local development: testMode prevents actual email sending
export const resend = new Resend(components.resend, {
  testMode: false,
})

// From address for all ASTN emails
const FROM_ADDRESS = 'ASTN <notifications@safetytalent.org>'

/**
 * Send a match alert email
 * Called by the notification scheduler when new great-tier matches are found
 */
export const sendMatchAlert = internalMutation({
  args: {
    to: v.string(),
    subject: v.string(),
    html: v.string(),
    unsubscribeUrl: v.optional(v.string()),
  },
  handler: async (ctx, { to, subject, html, unsubscribeUrl }) => {
    await resend.sendEmail(ctx, {
      from: FROM_ADDRESS,
      to,
      subject,
      html,
      ...(unsubscribeUrl && {
        headers: [
          { name: 'List-Unsubscribe', value: `<${unsubscribeUrl}>` },
          {
            name: 'List-Unsubscribe-Post',
            value: 'List-Unsubscribe=One-Click',
          },
        ],
      }),
    })
  },
})

/**
 * Send a weekly digest email
 * Called by the weekly cron job for users with digest enabled
 */
export const sendWeeklyDigest = internalMutation({
  args: {
    to: v.string(),
    subject: v.string(),
    html: v.string(),
    unsubscribeUrl: v.optional(v.string()),
  },
  handler: async (ctx, { to, subject, html, unsubscribeUrl }) => {
    await resend.sendEmail(ctx, {
      from: FROM_ADDRESS,
      to,
      subject,
      html,
      ...(unsubscribeUrl && {
        headers: [
          { name: 'List-Unsubscribe', value: `<${unsubscribeUrl}>` },
          {
            name: 'List-Unsubscribe-Post',
            value: 'List-Unsubscribe=One-Click',
          },
        ],
      }),
    })
  },
})

/**
 * Get users whose local time matches the target hour for match alerts
 * Used by the hourly cron to process timezone-aware email delivery
 * Uses direct ctx.db.get with Id cast instead of full-table-scan filter
 */
export const getUsersForMatchAlertBatch = internalQuery({
  args: { targetLocalHour: v.number() },
  handler: async (ctx, { targetLocalHour }) => {
    // Get all profiles with match alerts enabled
    const profiles = await ctx.db.query('profiles').collect()

    const now = new Date()

    // Pass 1: Filter eligible profiles (alerts enabled + correct timezone hour)
    const eligible = profiles.filter((profile) => {
      if (
        !profile.notificationPreferences ||
        !profile.notificationPreferences.matchAlerts.enabled
      ) {
        return false
      }
      const timezone = profile.notificationPreferences.timezone || 'UTC'
      const userLocalTime = toZonedTime(now, timezone)
      const userLocalHour = userLocalTime.getHours()
      return userLocalHour === targetLocalHour
    })

    // Pass 2: Batch fetch user emails from legacy auth table
    const emails = await Promise.all(
      eligible.map((p) => getLegacyUserEmail(ctx, p.userId)),
    )

    log('info', 'getUsersForMatchAlertBatch', {
      totalProfiles: profiles.length,
      eligible: eligible.length,
      batchedUserReads: eligible.length,
    })

    // Pass 3: Build result
    const usersToNotify: Array<{
      userId: string
      email: string
      timezone: string
      profileId: (typeof profiles)[0]['_id']
      userName: string
    }> = []

    for (let i = 0; i < eligible.length; i++) {
      const email = emails[i]
      const profile = eligible[i]
      if (email) {
        usersToNotify.push({
          userId: profile.userId,
          email,
          timezone: profile.notificationPreferences?.timezone || 'UTC',
          profileId: profile._id,
          userName: profile.name || 'there',
        })
      }
    }

    return usersToNotify
  },
})

/**
 * Get users with weekly digest enabled
 * Uses direct ctx.db.get with Id cast instead of full-table-scan filter
 */
export const getUsersForWeeklyDigestBatch = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Get all profiles with weekly digest enabled
    const profiles = await ctx.db.query('profiles').collect()

    // Pass 1: Filter eligible profiles (digest enabled)
    const eligible = profiles.filter(
      (profile) =>
        profile.notificationPreferences &&
        profile.notificationPreferences.weeklyDigest.enabled,
    )

    // Pass 2: Batch fetch user emails from legacy auth table
    const emails = await Promise.all(
      eligible.map((p) => getLegacyUserEmail(ctx, p.userId)),
    )

    log('info', 'getUsersForWeeklyDigestBatch', {
      totalProfiles: profiles.length,
      eligible: eligible.length,
      batchedUserReads: eligible.length,
    })

    // Pass 3: Build result
    const usersToNotify: Array<{
      userId: string
      email: string
      profileId: (typeof profiles)[0]['_id']
      userName: string
      completedSections: Array<string>
      hasEnrichmentConversation: boolean
    }> = []

    for (let i = 0; i < eligible.length; i++) {
      const email = emails[i]
      const profile = eligible[i]
      if (email) {
        usersToNotify.push({
          userId: profile.userId,
          email,
          profileId: profile._id,
          userName: profile.name || 'there',
          completedSections: profile.completedSections || [],
          hasEnrichmentConversation: profile.hasEnrichmentConversation || false,
        })
      }
    }

    return usersToNotify
  },
})

/**
 * Mark matches as no longer new (after alert email sent)
 */
export const markMatchesNotNew = internalMutation({
  args: {
    matchIds: v.array(v.id('matches')),
  },
  handler: async (ctx, { matchIds }) => {
    for (const matchId of matchIds) {
      await ctx.db.patch('matches', matchId, { isNew: false })
    }
  },
})

/**
 * Get new great-tier matches for a profile
 * Only "great" tier matches trigger alerts (per CONTEXT.md)
 */
export const getNewGreatMatches = internalQuery({
  args: { profileId: v.id('profiles') },
  handler: async (ctx, { profileId }) => {
    return await ctx.db
      .query('matches')
      .withIndex('by_profile_tier', (q) =>
        q.eq('profileId', profileId).eq('tier', 'great'),
      )
      .filter((q) => q.eq(q.field('isNew'), true))
      .collect()
  },
})

/**
 * Get ALL great-tier matches for a profile (regardless of isNew).
 * Used for the first-computation email where matches may already be viewed.
 */
export const getAllGreatMatches = internalQuery({
  args: { profileId: v.id('profiles') },
  returns: v.array(v.any()),
  handler: async (ctx, { profileId }) => {
    return await ctx.db
      .query('matches')
      .withIndex('by_profile_tier', (q) =>
        q.eq('profileId', profileId).eq('tier', 'great'),
      )
      .collect()
  },
})

/**
 * Get profile email info by ID (for sending emails from actions)
 */
export const getProfileEmailInfo = internalQuery({
  args: { profileId: v.id('profiles') },
  returns: v.union(
    v.object({
      email: v.string(),
      name: v.string(),
      matchAlertsEnabled: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, { profileId }) => {
    const profile = await ctx.db.get('profiles', profileId)
    if (!profile?.email) return null
    return {
      email: profile.email,
      name: profile.name ?? 'there',
      matchAlertsEnabled:
        profile.notificationPreferences?.matchAlerts.enabled ?? false,
    }
  },
})

/**
 * Get recent matches for a profile (for weekly digest)
 */
export const getRecentMatches = internalQuery({
  args: {
    profileId: v.id('profiles'),
    since: v.number(),
  },
  handler: async (ctx, { profileId, since }) => {
    const matches = await ctx.db
      .query('matches')
      .withIndex('by_profile', (q) => q.eq('profileId', profileId))
      .collect()

    // Filter to matches computed after the since timestamp
    return matches.filter((m) => m.computedAt >= since)
  },
})

/**
 * Get opportunity by ID
 */
export const getOpportunity = internalQuery({
  args: { opportunityId: v.id('opportunities') },
  handler: async (ctx, { opportunityId }) => {
    return await ctx.db.get('opportunities', opportunityId)
  },
})

/**
 * Get matches closing soon for a profile (deadline within 7 days)
 * Used in weekly digest "Closing Soon" section
 */
export const getMatchesClosingSoon = internalQuery({
  args: { profileId: v.id('profiles') },
  returns: v.array(
    v.object({
      title: v.string(),
      org: v.string(),
      tier: v.string(),
      deadline: v.number(),
      status: v.string(),
      sourceUrl: v.string(),
    }),
  ),
  handler: async (ctx, { profileId }) => {
    const matches = await ctx.db
      .query('matches')
      .withIndex('by_profile', (q) => q.eq('profileId', profileId))
      .collect()

    const now = Date.now()
    const sevenDaysFromNow = now + 7 * 24 * 60 * 60 * 1000

    const closingSoon: Array<{
      title: string
      org: string
      tier: string
      deadline: number
      status: string
      sourceUrl: string
    }> = []

    for (const match of matches) {
      // Only saved or active, great or good tier
      const status = match.status ?? 'active'
      if (status !== 'saved' && status !== 'active') continue
      if (match.tier !== 'great' && match.tier !== 'good') continue
      if (match.appliedAt) continue

      // Check deadline from snapshot
      const deadline = match.opportunitySnapshot?.deadline
      if (!deadline || deadline <= now || deadline > sevenDaysFromNow) continue

      closingSoon.push({
        title: match.opportunitySnapshot?.title ?? 'Unknown',
        org: match.opportunitySnapshot?.organization ?? 'Unknown',
        tier: match.tier,
        deadline,
        status,
        sourceUrl: match.opportunitySnapshot?.sourceUrl ?? '',
      })
    }

    // Sort by deadline ascending
    return closingSoon.sort((a, b) => a.deadline - b.deadline)
  },
})

// ===== Deadline Reminder Email Functions =====

/**
 * Get users whose local time matches the target hour for deadline reminders
 * Same pattern as getUsersForMatchAlertBatch but filters on deadlineReminders pref
 */
export const getUsersForDeadlineReminderBatch = internalQuery({
  args: { targetLocalHour: v.number() },
  returns: v.array(
    v.object({
      userId: v.string(),
      email: v.string(),
      timezone: v.string(),
      profileId: v.id('profiles'),
      userName: v.string(),
    }),
  ),
  handler: async (ctx, { targetLocalHour }) => {
    const profiles = await ctx.db.query('profiles').collect()
    const now = new Date()

    // Filter: deadline reminders enabled (missing = enabled) + correct timezone hour
    const eligible = profiles.filter((profile) => {
      if (!profile.notificationPreferences) return false
      const deadlineReminders =
        profile.notificationPreferences.deadlineReminders
      if (deadlineReminders && !deadlineReminders.enabled) return false
      const timezone = profile.notificationPreferences.timezone || 'UTC'
      const userLocalTime = toZonedTime(now, timezone)
      const userLocalHour = userLocalTime.getHours()
      return userLocalHour === targetLocalHour
    })

    const emails = await Promise.all(
      eligible.map((p) => getLegacyUserEmail(ctx, p.userId)),
    )

    log('info', 'getUsersForDeadlineReminderBatch', {
      totalProfiles: profiles.length,
      eligible: eligible.length,
    })

    const usersToNotify: Array<{
      userId: string
      email: string
      timezone: string
      profileId: (typeof profiles)[0]['_id']
      userName: string
    }> = []

    for (let i = 0; i < eligible.length; i++) {
      const email = emails[i]
      const profile = eligible[i]
      if (email) {
        usersToNotify.push({
          userId: profile.userId,
          email,
          timezone: profile.notificationPreferences?.timezone || 'UTC',
          profileId: profile._id,
          userName: profile.name || 'there',
        })
      }
    }

    return usersToNotify
  },
})

/**
 * Get matches needing deadline reminders for a profile
 * Returns oneDay (deadline <= 24h) and sevenDay (deadline <= 7d but > 1d) buckets
 */
export const getMatchesNeedingDeadlineReminder = internalQuery({
  args: { profileId: v.id('profiles') },
  returns: v.object({
    oneDay: v.array(
      v.object({
        matchId: v.id('matches'),
        title: v.string(),
        org: v.string(),
        tier: v.string(),
        deadline: v.number(),
        isSaved: v.boolean(),
        sourceUrl: v.string(),
      }),
    ),
    sevenDay: v.array(
      v.object({
        matchId: v.id('matches'),
        title: v.string(),
        org: v.string(),
        tier: v.string(),
        deadline: v.number(),
        isSaved: v.boolean(),
        sourceUrl: v.string(),
      }),
    ),
  }),
  handler: async (ctx, { profileId }) => {
    const matches = await ctx.db
      .query('matches')
      .withIndex('by_profile', (q) => q.eq('profileId', profileId))
      .collect()

    const now = Date.now()
    const oneDayFromNow = now + 24 * 60 * 60 * 1000
    const sevenDaysFromNow = now + 7 * 24 * 60 * 60 * 1000

    const oneDay: Array<{
      matchId: (typeof matches)[0]['_id']
      title: string
      org: string
      tier: string
      deadline: number
      isSaved: boolean
      sourceUrl: string
    }> = []

    const sevenDay: Array<{
      matchId: (typeof matches)[0]['_id']
      title: string
      org: string
      tier: string
      deadline: number
      isSaved: boolean
      sourceUrl: string
    }> = []

    for (const match of matches) {
      const status = match.status ?? 'active'
      if (status !== 'saved' && status !== 'active') continue
      if (match.tier !== 'great' && match.tier !== 'good') continue
      if (match.appliedAt) continue

      // Use snapshot deadline, then verify with live opportunity
      const snapshotDeadline = match.opportunitySnapshot?.deadline
      if (!snapshotDeadline || snapshotDeadline <= now) continue

      // Fetch live opportunity to verify deadline hasn't changed
      const opportunity = await ctx.db.get('opportunities', match.opportunityId)
      const deadline = opportunity?.deadline ?? snapshotDeadline
      if (deadline <= now || deadline > sevenDaysFromNow) continue

      const item = {
        matchId: match._id,
        title:
          match.opportunitySnapshot?.title ?? opportunity?.title ?? 'Unknown',
        org:
          match.opportunitySnapshot?.organization ??
          opportunity?.organization ??
          'Unknown',
        tier: match.tier,
        deadline,
        isSaved: status === 'saved',
        sourceUrl:
          match.opportunitySnapshot?.sourceUrl ?? opportunity?.sourceUrl ?? '',
      }

      if (deadline <= oneDayFromNow) {
        // One-day bucket: not already sent
        if (!match.deadlineRemindersSent?.oneDay) {
          oneDay.push(item)
        }
      } else {
        // Seven-day bucket: not already sent
        if (!match.deadlineRemindersSent?.sevenDay) {
          sevenDay.push(item)
        }
      }
    }

    return {
      oneDay: oneDay.sort((a, b) => a.deadline - b.deadline),
      sevenDay: sevenDay.sort((a, b) => a.deadline - b.deadline),
    }
  },
})

/**
 * Mark deadline reminders as sent for matches
 */
export const markDeadlineRemindersSent = internalMutation({
  args: {
    matchIds: v.array(v.id('matches')),
    reminderType: v.union(v.literal('sevenDay'), v.literal('oneDay')),
  },
  returns: v.null(),
  handler: async (ctx, { matchIds, reminderType }) => {
    for (const matchId of matchIds) {
      const match = await ctx.db.get('matches', matchId)
      if (!match) continue
      await ctx.db.patch('matches', matchId, {
        deadlineRemindersSent: {
          ...match.deadlineRemindersSent,
          [reminderType]: true,
        },
      })
    }
    return null
  },
})

/**
 * Send a deadline reminder email
 */
export const sendDeadlineReminder = internalMutation({
  args: {
    to: v.string(),
    subject: v.string(),
    html: v.string(),
    unsubscribeUrl: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { to, subject, html, unsubscribeUrl }) => {
    await resend.sendEmail(ctx, {
      from: FROM_ADDRESS,
      to,
      subject,
      html,
      ...(unsubscribeUrl && {
        headers: [
          { name: 'List-Unsubscribe', value: `<${unsubscribeUrl}>` },
          {
            name: 'List-Unsubscribe-Post',
            value: 'List-Unsubscribe=One-Click',
          },
        ],
      }),
    })
    return null
  },
})

// ===== Feedback Notification Email =====

/**
 * Send a notification email when someone submits feedback
 */
export const sendFeedbackNotification = internalMutation({
  args: {
    featureRequests: v.optional(v.string()),
    bugReports: v.optional(v.string()),
    page: v.string(),
    userId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { featureRequests, bugReports, page, userId }) => {
    const to = process.env.FEEDBACK_NOTIFICATION_EMAIL
    if (!to) return null

    const sections = []
    if (featureRequests) {
      sections.push(
        `<h3>Feature Requests</h3><p>${featureRequests.replace(/\n/g, '<br>')}</p>`,
      )
    }
    if (bugReports) {
      sections.push(
        `<h3>Bug Reports</h3><p>${bugReports.replace(/\n/g, '<br>')}</p>`,
      )
    }

    const html = `
      <h2>New Feedback Submitted</h2>
      <p><strong>Page:</strong> ${page}</p>
      <p><strong>User:</strong> ${userId ?? 'Anonymous'}</p>
      ${sections.join('')}
    `

    await resend.sendEmail(ctx, {
      from: FROM_ADDRESS,
      to,
      subject: `[ASTN Feedback] New feedback from ${page}`,
      html,
    })
    return null
  },
})

// ===== Event Digest Email Functions =====

/**
 * Send an event digest email
 * Called by the event digest batch actions
 */
export const sendEventDigest = internalMutation({
  args: {
    to: v.string(),
    subject: v.string(),
    html: v.string(),
    unsubscribeUrl: v.optional(v.string()),
  },
  handler: async (ctx, { to, subject, html, unsubscribeUrl }) => {
    await resend.sendEmail(ctx, {
      from: FROM_ADDRESS,
      to,
      subject,
      html,
      ...(unsubscribeUrl && {
        headers: [
          { name: 'List-Unsubscribe', value: `<${unsubscribeUrl}>` },
          {
            name: 'List-Unsubscribe-Post',
            value: 'List-Unsubscribe=One-Click',
          },
        ],
      }),
    })
  },
})

/**
 * Get users whose local time matches the target hour for daily event digest
 * Uses direct ctx.db.get with Id cast instead of full-table-scan filter
 */
export const getUsersForDailyEventDigestBatch = internalQuery({
  args: { targetLocalHour: v.number() },
  handler: async (ctx, { targetLocalHour }) => {
    const profiles = await ctx.db.query('profiles').collect()
    const now = new Date()
    type ProfileId = (typeof profiles)[0]['_id']
    type OrgId = NonNullable<
      (typeof profiles)[0]['eventNotificationPreferences']
    >['mutedOrgIds'] extends Array<infer T> | undefined
      ? T
      : never

    // Pass 1: Filter eligible profiles (daily frequency + correct timezone hour)
    const eligible = profiles.filter((profile) => {
      if (profile.eventNotificationPreferences?.frequency !== 'daily')
        return false
      const timezone = profile.notificationPreferences?.timezone || 'UTC'
      const userLocalTime = toZonedTime(now, timezone)
      const userLocalHour = userLocalTime.getHours()
      return userLocalHour === targetLocalHour
    })

    // Pass 2: Batch fetch user emails from legacy auth table
    const emails = await Promise.all(
      eligible.map((p) => getLegacyUserEmail(ctx, p.userId)),
    )

    log('info', 'getUsersForDailyEventDigestBatch', {
      totalProfiles: profiles.length,
      eligible: eligible.length,
      batchedUserReads: eligible.length,
    })

    // Pass 3: Build result
    const usersToNotify: Array<{
      userId: string
      email: string
      timezone: string
      profileId: ProfileId
      userName: string
      mutedOrgIds: Array<OrgId>
    }> = []

    for (let i = 0; i < eligible.length; i++) {
      const email = emails[i]
      const profile = eligible[i]
      if (email) {
        usersToNotify.push({
          userId: profile.userId,
          email,
          timezone: profile.notificationPreferences?.timezone || 'UTC',
          profileId: profile._id,
          userName: profile.name || 'there',
          mutedOrgIds: profile.eventNotificationPreferences!.mutedOrgIds || [],
        })
      }
    }
    return usersToNotify
  },
})

/**
 * Get users with weekly event digest enabled
 * Uses direct ctx.db.get with Id cast instead of full-table-scan filter
 */
export const getUsersForWeeklyEventDigestBatch = internalQuery({
  args: {},
  handler: async (ctx) => {
    const profiles = await ctx.db.query('profiles').collect()
    type ProfileId = (typeof profiles)[0]['_id']
    type OrgId = NonNullable<
      (typeof profiles)[0]['eventNotificationPreferences']
    >['mutedOrgIds'] extends Array<infer T> | undefined
      ? T
      : never

    // Pass 1: Filter eligible profiles (weekly frequency)
    const eligible = profiles.filter(
      (profile) => profile.eventNotificationPreferences?.frequency === 'weekly',
    )

    // Pass 2: Batch fetch user emails from legacy auth table
    const emails = await Promise.all(
      eligible.map((p) => getLegacyUserEmail(ctx, p.userId)),
    )

    log('info', 'getUsersForWeeklyEventDigestBatch', {
      totalProfiles: profiles.length,
      eligible: eligible.length,
      batchedUserReads: eligible.length,
    })

    // Pass 3: Build result
    const usersToNotify: Array<{
      userId: string
      email: string
      profileId: ProfileId
      userName: string
      mutedOrgIds: Array<OrgId>
    }> = []

    for (let i = 0; i < eligible.length; i++) {
      const email = emails[i]
      const profile = eligible[i]
      if (email) {
        usersToNotify.push({
          userId: profile.userId,
          email,
          profileId: profile._id,
          userName: profile.name || 'there',
          mutedOrgIds: profile.eventNotificationPreferences!.mutedOrgIds || [],
        })
      }
    }
    return usersToNotify
  },
})

/**
 * Get upcoming events for a user from their org memberships
 * Excludes muted orgs
 */
export const getUpcomingEventsForUser = internalQuery({
  args: {
    userId: v.string(),
    mutedOrgIds: v.array(v.id('organizations')),
    since: v.number(),
  },
  handler: async (ctx, { userId, mutedOrgIds, since }) => {
    // Get user's org memberships
    const memberships = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()

    const orgIds = memberships
      .map((m) => m.orgId)
      .filter((id) => !mutedOrgIds.includes(id))

    // Get upcoming events from user's (non-muted) orgs
    const events: Array<{
      title: string
      orgName: string
      startAt: number
      location?: string
      isVirtual: boolean
      url: string
      description?: string
    }> = []

    for (const orgId of orgIds) {
      const org = await ctx.db.get('organizations', orgId)
      if (!org) continue

      // The Luma mirror also holds private and canceled events.
      const orgEvents = await takePublicEvents(
        ctx.db
          .query('events')
          .withIndex('by_org_start', (q) =>
            q.eq('orgId', orgId).gt('startAt', since),
          ),
        10,
      )

      for (const e of orgEvents) {
        events.push({
          title: e.title,
          orgName: org.name,
          startAt: e.startAt,
          location: e.location,
          isVirtual: e.isVirtual,
          url: e.url,
          description: e.description,
        })
      }
    }

    // Sort by start time and limit to 20
    return events.sort((a, b) => a.startAt - b.startAt).slice(0, 20)
  },
})
