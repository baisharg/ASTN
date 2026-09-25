import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation, mutation, query } from './_generated/server'
import { getUserId } from './lib/auth'
import { debouncedSchedule } from './lib/debouncer'
import { safeLinkedinUrl } from './social/lib'
import { socialVisibilityValidator } from './social/validators'

// Section completeness rules
const COMPLETENESS_SECTIONS = [
  {
    id: 'basicInfo',
    label: 'Basic Information',
    check: (profile: Record<string, unknown>) =>
      Boolean(profile.name) && Boolean(profile.location),
  },
  {
    id: 'education',
    label: 'Education',
    check: (profile: Record<string, unknown>) =>
      Array.isArray(profile.education) && profile.education.length > 0,
  },
  {
    id: 'workHistory',
    label: 'Work History',
    check: (profile: Record<string, unknown>) =>
      Array.isArray(profile.workHistory) && profile.workHistory.length > 0,
  },
  {
    id: 'careerGoals',
    label: 'Career Goals',
    check: (profile: Record<string, unknown>) => Boolean(profile.careerGoals),
  },
  {
    id: 'skills',
    label: 'Skills',
    check: (profile: Record<string, unknown>) =>
      Array.isArray(profile.skills) && profile.skills.length > 0,
  },
  {
    id: 'matchPreferences',
    label: 'Match Preferences',
    check: (profile: Record<string, unknown>) => {
      const prefs = profile.matchPreferences as
        | { remotePreference?: string }
        | undefined
      return prefs !== undefined && prefs.remotePreference !== undefined
    },
  },
  {
    id: 'privacy',
    label: 'Privacy Settings',
    check: (profile: Record<string, unknown>) =>
      profile.privacySettings !== undefined &&
      typeof profile.privacySettings === 'object' &&
      profile.privacySettings !== null &&
      'defaultVisibility' in profile.privacySettings,
  },
]

/** Compute profile completeness from a profile record (shared logic). */
export function computeProfileCompleteness(
  profile: Record<string, unknown> | null,
) {
  if (!profile) {
    return {
      sections: COMPLETENESS_SECTIONS.map((section) => ({
        id: section.id,
        label: section.label,
        isComplete: false,
      })),
      completedCount: 0,
      totalCount: COMPLETENESS_SECTIONS.length,
      percentage: 0,
      isFullyComplete: false,
    }
  }

  const sections = COMPLETENESS_SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    isComplete: section.check(profile),
  }))

  const completedCount = sections.filter((s) => s.isComplete).length
  const totalCount = sections.length

  return {
    sections,
    completedCount,
    totalCount,
    percentage: Math.round((completedCount / totalCount) * 100),
    isFullyComplete: completedCount === totalCount,
  }
}

/** Threshold: minimum completed sections to unlock matching. */
export const MATCH_UNLOCK_THRESHOLD = 5

/** Sections that must be complete regardless of threshold. */
export const MATCH_REQUIRED_SECTIONS = ['careerGoals'] as const

/** Check whether a profile meets the completeness bar for match computation. */
export function isProfileMatchReady(profile: Record<string, unknown> | null) {
  const completeness = computeProfileCompleteness(profile)

  const missingRequired = MATCH_REQUIRED_SECTIONS.filter(
    (id) => !completeness.sections.find((s) => s.id === id)?.isComplete,
  )

  const sectionsNeeded = Math.max(
    0,
    MATCH_UNLOCK_THRESHOLD - completeness.completedCount,
  )

  const ready =
    completeness.completedCount >= MATCH_UNLOCK_THRESHOLD &&
    missingRequired.length === 0

  return {
    ready,
    completedCount: completeness.completedCount,
    totalCount: completeness.totalCount,
    missingRequired: missingRequired as Array<string>,
    sectionsNeeded,
  }
}

// Get or create profile for current user
export const getOrCreateProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx)
    if (!userId) {
      return null
    }

    // Try to find existing profile
    const existing = await ctx.db
      .query('profiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()

    if (existing) {
      return existing
    }

    // Return null if no profile exists (will be created on first update)
    return null
  },
})

// Create profile for current user (called on first edit)
export const create = mutation({
  args: { timezone: v.optional(v.string()) },
  returns: v.id('profiles'),
  handler: async (ctx, { timezone }) => {
    const userId = await getUserId(ctx)
    if (!userId) {
      throw new Error('Not authenticated')
    }

    // Check if profile already exists
    const existing = await ctx.db
      .query('profiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()

    if (existing) {
      return existing._id
    }

    // Grab email from Clerk identity to store on profile
    const identity = await ctx.auth.getUserIdentity()

    // Validate timezone if provided
    const validTimezone =
      timezone && isValidIANATimezone(timezone) ? timezone : 'UTC'

    const now = Date.now()
    const profileId = await ctx.db.insert('profiles', {
      userId,
      email: identity?.email ?? undefined,
      createdAt: now,
      updatedAt: now,
      notificationPreferences: {
        matchAlerts: { enabled: true },
        weeklyDigest: { enabled: true },
        deadlineReminders: { enabled: true },
        timezone: validTimezone,
      },
      eventNotificationPreferences: {
        frequency: 'weekly',
        reminderTiming: {
          oneWeekBefore: true,
          oneDayBefore: true,
          oneHourBefore: true,
        },
      },
    })

    // Mark guest as having become a member (if they were a guest)
    await ctx.scheduler.runAfter(0, internal.guestProfiles.markGuestAsMember, {
      userId,
      profileId,
    })

    return profileId
  },
})

// Debounced matchesStaleAt writer — target for debouncedSchedule
export const setMatchesStale = internalMutation({
  args: { profileId: v.id('profiles') },
  returns: v.null(),
  handler: async (ctx, { profileId }) => {
    await ctx.db.patch('profiles', profileId, { matchesStaleAt: Date.now() })
    return null
  },
})

// Update specific field(s) with timestamp
export const updateField = mutation({
  args: {
    profileId: v.id('profiles'),
    updates: v.object({
      name: v.optional(v.string()),
      pronouns: v.optional(v.string()),
      location: v.optional(v.string()),
      headline: v.optional(v.string()),
      linkedinUrl: v.optional(v.string()),
      education: v.optional(
        v.array(
          v.object({
            institution: v.string(),
            degree: v.optional(v.string()),
            field: v.optional(v.string()),
            startYear: v.optional(v.number()),
            endYear: v.optional(v.number()),
            current: v.optional(v.boolean()),
          }),
        ),
      ),
      workHistory: v.optional(
        v.array(
          v.object({
            organization: v.string(),
            title: v.string(),
            startDate: v.optional(v.number()),
            endDate: v.optional(v.number()),
            current: v.optional(v.boolean()),
            description: v.optional(v.string()),
          }),
        ),
      ),
      skills: v.optional(v.array(v.string())),
      careerGoals: v.optional(v.string()),
      aiSafetyInterests: v.optional(v.array(v.string())),
      seeking: v.optional(v.string()),
      canHelpWith: v.optional(v.string()),
      socialVisibility: v.optional(socialVisibilityValidator),
      enrichmentSummary: v.optional(v.string()),
      hasEnrichmentConversation: v.optional(v.boolean()),
      privacySettings: v.optional(
        v.object({
          defaultVisibility: v.union(
            v.literal('public'),
            v.literal('connections'),
            v.literal('private'),
          ),
          sectionVisibility: v.optional(
            v.object({
              basicInfo: v.optional(v.string()),
              education: v.optional(v.string()),
              workHistory: v.optional(v.string()),
              skills: v.optional(v.string()),
              careerGoals: v.optional(v.string()),
            }),
          ),
          hiddenFromOrgs: v.optional(v.array(v.string())),
        }),
      ),
      matchPreferences: v.optional(
        v.object({
          remotePreference: v.optional(
            v.union(
              v.literal('remote_only'),
              v.literal('on_site_ok'),
              v.literal('no_preference'),
            ),
          ),
          roleTypes: v.optional(v.array(v.string())),
          experienceLevels: v.optional(v.array(v.string())),
          willingToRelocate: v.optional(v.boolean()),
          workAuthorization: v.optional(v.string()),
          minimumSalaryUSD: v.optional(v.number()),
          availability: v.optional(
            v.union(
              v.literal('immediately'),
              v.literal('within_1_month'),
              v.literal('within_3_months'),
              v.literal('within_6_months'),
              v.literal('not_available'),
            ),
          ),
          commitmentTypes: v.optional(
            v.array(
              v.union(
                v.literal('full_time'),
                v.literal('part_time'),
                v.literal('contract'),
                v.literal('fellowship'),
                v.literal('internship'),
                v.literal('volunteer'),
              ),
            ),
          ),
        }),
      ),
    }),
  },
  handler: async (ctx, { profileId, updates: rawUpdates }) => {
    // Only store LinkedIn links that are safe to render as links.
    const updates = { ...rawUpdates }
    if (updates.linkedinUrl !== undefined) {
      const safe = safeLinkedinUrl(updates.linkedinUrl)
      if (updates.linkedinUrl.trim() && !safe) {
        throw new ConvexError('That is not a LinkedIn profile URL')
      }
      updates.linkedinUrl = safe ?? undefined
    }
    const userId = await getUserId(ctx)
    if (!userId) {
      throw new Error('Not authenticated')
    }

    // Verify ownership
    const profile = await ctx.db.get('profiles', profileId)
    if (!profile || profile.userId !== userId) {
      throw new Error('Profile not found or not authorized')
    }

    // Lazy-backfill email from Clerk identity if missing
    let emailBackfill: Record<string, string> = {}
    if (!profile.email) {
      const identity = await ctx.auth.getUserIdentity()
      if (identity?.email) {
        emailBackfill = { email: identity.email }
      }
    }

    // Fields that affect match quality - trigger staleness indicator
    const MATCH_AFFECTING_FIELDS = new Set([
      'skills',
      'education',
      'workHistory',
      'careerGoals',
      'aiSafetyInterests',
      'seeking',
      'enrichmentSummary',
      'privacySettings',
      'matchPreferences',
    ])

    const affectsMatches = Object.keys(updates).some((f) =>
      MATCH_AFFECTING_FIELDS.has(f),
    )

    await ctx.db.patch('profiles', profileId, {
      ...updates,
      ...emailBackfill,
      updatedAt: Date.now(),
    })

    if (affectsMatches) {
      await debouncedSchedule(
        ctx,
        'match-staleness',
        profileId,
        internal.profiles.setMatchesStale,
        { profileId },
      )
    }

    return { success: true }
  },
})

/** @deprecated Use getMyCompleteness instead. This endpoint will be removed. */
export const getCompleteness = query({
  args: { profileId: v.id('profiles') },
  handler: async (ctx, { profileId }) => {
    // Auth + ownership check (returns null for unauthenticated/unauthorized)
    const userId = await getUserId(ctx)
    if (!userId) return null

    const profile = await ctx.db.get('profiles', profileId)
    if (!profile || profile.userId !== userId) {
      return null
    }

    return computeProfileCompleteness(
      profile as unknown as Record<string, unknown>,
    )
  },
})

// Get notification preferences for current user
export const getNotificationPreferences = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx)
    if (!userId) {
      return null
    }

    const profile = await ctx.db
      .query('profiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()

    if (!profile) {
      return null
    }

    if (!profile.notificationPreferences) return null
    return {
      ...profile.notificationPreferences,
      deadlineReminders: profile.notificationPreferences.deadlineReminders ?? {
        enabled: true,
      },
    }
  },
})

// Validate IANA timezone string using Intl.DateTimeFormat
function isValidIANATimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz })
    return true
  } catch {
    return false
  }
}

// Update notification preferences for current user
export const updateNotificationPreferences = mutation({
  args: {
    matchAlertsEnabled: v.boolean(),
    weeklyDigestEnabled: v.boolean(),
    deadlineRemindersEnabled: v.boolean(),
    timezone: v.string(),
  },
  handler: async (
    ctx,
    {
      matchAlertsEnabled,
      weeklyDigestEnabled,
      deadlineRemindersEnabled,
      timezone,
    },
  ) => {
    const userId = await getUserId(ctx)
    if (!userId) {
      throw new Error('Not authenticated')
    }

    // Validate IANA timezone using Intl.DateTimeFormat
    if (!isValidIANATimezone(timezone)) {
      throw new Error(
        'Invalid timezone format. Expected IANA timezone (e.g., America/New_York)',
      )
    }

    // Get or create profile
    let profile = await ctx.db
      .query('profiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()

    if (!profile) {
      // Create profile if it doesn't exist
      const now = Date.now()
      const profileId = await ctx.db.insert('profiles', {
        userId,
        createdAt: now,
        updatedAt: now,
      })
      profile = (await ctx.db.get('profiles', profileId))!

      // Mark guest as having become a member (if they were a guest)
      await ctx.scheduler.runAfter(
        0,
        internal.guestProfiles.markGuestAsMember,
        { userId, profileId },
      )
    }

    // Update notification preferences
    await ctx.db.patch('profiles', profile._id, {
      notificationPreferences: {
        matchAlerts: { enabled: matchAlertsEnabled },
        weeklyDigest: { enabled: weeklyDigestEnabled },
        deadlineReminders: { enabled: deadlineRemindersEnabled },
        timezone,
      },
      updatedAt: Date.now(),
    })

    return { success: true }
  },
})

// Get completeness for current user's profile
export const getMyCompleteness = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx)
    if (!userId) {
      return null
    }

    const profile = await ctx.db
      .query('profiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()

    return computeProfileCompleteness(
      profile ? (profile as unknown as Record<string, unknown>) : null,
    )
  },
})

// Convert YYYY-MM date string to Unix timestamp (first of month)
// Returns undefined for "present", empty string, or invalid format
function convertDateString(dateStr?: string): number | undefined {
  if (!dateStr || dateStr.toLowerCase() === 'present') return undefined
  const parts = dateStr.split('-')
  if (parts.length < 2) return undefined
  const year = parseInt(parts[0], 10)
  const month = parseInt(parts[1], 10)
  if (isNaN(year) || isNaN(month)) return undefined
  return Date.UTC(year, month - 1, 1)
}

// Apply extracted profile data from resume/CV
// Creates profile if user doesn't have one yet
export const applyExtractedProfile = mutation({
  args: {
    extractedData: v.object({
      name: v.optional(v.string()),
      location: v.optional(v.string()),
      education: v.optional(
        v.array(
          v.object({
            institution: v.string(),
            degree: v.optional(v.string()),
            field: v.optional(v.string()),
            startYear: v.optional(v.number()),
            endYear: v.optional(v.number()),
            current: v.optional(v.boolean()),
          }),
        ),
      ),
      workHistory: v.optional(
        v.array(
          v.object({
            organization: v.string(),
            title: v.string(),
            startDate: v.optional(v.string()), // YYYY-MM string from extraction
            endDate: v.optional(v.string()), // YYYY-MM or "present"
            current: v.optional(v.boolean()),
            description: v.optional(v.string()),
          }),
        ),
      ),
      skills: v.optional(v.array(v.string())),
    }),
  },
  handler: async (ctx, { extractedData }) => {
    const userId = await getUserId(ctx)
    if (!userId) {
      throw new Error('Not authenticated')
    }

    // Get or create profile
    let profile = await ctx.db
      .query('profiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()

    const now = Date.now()

    if (!profile) {
      // Create profile if it doesn't exist
      const profileId = await ctx.db.insert('profiles', {
        userId,
        createdAt: now,
        updatedAt: now,
      })
      profile = (await ctx.db.get('profiles', profileId))!

      // Mark guest as having become a member (if they were a guest)
      await ctx.scheduler.runAfter(
        0,
        internal.guestProfiles.markGuestAsMember,
        { userId, profileId },
      )
    }

    // Build updates object with only provided fields
    const updates: Record<string, unknown> = {}

    if (extractedData.name !== undefined) {
      updates.name = extractedData.name
    }

    if (extractedData.location !== undefined) {
      updates.location = extractedData.location
    }

    // Education maps directly (uses year numbers, no conversion needed)
    if (extractedData.education !== undefined) {
      updates.education = extractedData.education
    }

    // Work history needs date conversion from strings to timestamps
    if (extractedData.workHistory !== undefined) {
      updates.workHistory = extractedData.workHistory.map((work) => ({
        organization: work.organization,
        title: work.title,
        startDate: convertDateString(work.startDate),
        endDate: convertDateString(work.endDate),
        current: work.current,
        description: work.description,
      }))
    }

    if (extractedData.skills !== undefined) {
      updates.skills = extractedData.skills
    }

    // Only update if there's something to update
    if (Object.keys(updates).length > 0) {
      // Resume data affects match quality - mark matches as stale
      const MATCH_AFFECTING_EXTRACTED = new Set([
        'education',
        'workHistory',
        'skills',
      ])
      const affectsMatches = Object.keys(updates).some((f) =>
        MATCH_AFFECTING_EXTRACTED.has(f),
      )

      await ctx.db.patch('profiles', profile._id, {
        ...updates,
        updatedAt: now,
      })

      if (affectsMatches) {
        await debouncedSchedule(
          ctx,
          'match-staleness',
          profile._id,
          internal.profiles.setMatchesStale,
          { profileId: profile._id },
        )
      }
    }

    return { success: true, profileId: profile._id }
  },
})

// Get location privacy setting for current user
export const getLocationPrivacy = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx)
    if (!userId) {
      return null
    }

    const profile = await ctx.db
      .query('profiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()

    if (!profile) {
      return { locationDiscoverable: false }
    }

    return {
      locationDiscoverable:
        profile.privacySettings?.locationDiscoverable ?? false,
    }
  },
})

// Update location privacy setting for current user
export const updateLocationPrivacy = mutation({
  args: { locationDiscoverable: v.boolean() },
  handler: async (ctx, { locationDiscoverable }) => {
    const userId = await getUserId(ctx)
    if (!userId) {
      throw new Error('Not authenticated')
    }

    const profile = await ctx.db
      .query('profiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()

    if (!profile) {
      throw new Error('Profile not found')
    }

    // Merge with existing privacy settings
    const existingSettings = profile.privacySettings ?? {
      defaultVisibility: 'private' as const,
    }

    await ctx.db.patch('profiles', profile._id, {
      privacySettings: {
        ...existingSettings,
        locationDiscoverable,
      },
      updatedAt: Date.now(),
    })

    return { success: true }
  },
})

// Get event notification preferences for current user
export const getEventNotificationPreferences = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx)
    if (!userId) return null

    const profile = await ctx.db
      .query('profiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()

    if (!profile?.eventNotificationPreferences) {
      // Return defaults for new users (weekly digest, 1 day + 1 hour reminders)
      return {
        frequency: 'weekly' as const,
        reminderTiming: {
          oneWeekBefore: false,
          oneDayBefore: true,
          oneHourBefore: true,
        },
        mutedOrgIds: [] as Array<string>,
      }
    }

    return {
      ...profile.eventNotificationPreferences,
      mutedOrgIds: profile.eventNotificationPreferences.mutedOrgIds ?? [],
    }
  },
})

// Update event notification preferences for current user
export const updateEventNotificationPreferences = mutation({
  args: {
    frequency: v.union(
      v.literal('all'),
      v.literal('daily'),
      v.literal('weekly'),
      v.literal('none'),
    ),
    reminderTiming: v.object({
      oneWeekBefore: v.boolean(),
      oneDayBefore: v.boolean(),
      oneHourBefore: v.boolean(),
    }),
    mutedOrgIds: v.array(v.id('organizations')),
  },
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const profile = await ctx.db
      .query('profiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()

    if (!profile) throw new Error('Profile not found')

    await ctx.db.patch('profiles', profile._id, {
      eventNotificationPreferences: {
        frequency: args.frequency,
        reminderTiming: args.reminderTiming,
        mutedOrgIds: args.mutedOrgIds,
      },
      updatedAt: Date.now(),
    })

    return { success: true }
  },
})

// Ensure email and name are populated from Clerk identity.
// Call this from the frontend on auth to lazy-backfill existing profiles.
export const ensureIdentityFields = mutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity?.subject) return false

    const userId = identity.subject
    const profile = await ctx.db
      .query('profiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()

    if (!profile) return false

    const patch: Record<string, string> = {}
    if (!profile.email && identity.email) patch.email = identity.email
    if (!profile.name && identity.name) patch.name = identity.name

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch('profiles', profile._id, patch)
      return true
    }

    return false
  },
})
