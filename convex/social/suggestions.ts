import { v } from 'convex/values'
import { internal } from '../_generated/api'
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from '../_generated/server'
import { getUserId, requireAuth } from '../lib/auth'
import {
  approvedGuests,
  attendeeCard,
  getGuestByUser,
  getProfileByUser,
  isProfileReadyForMatching,
  requireEventAdmin,
} from './lib'
import {
  suggestionLanguageValidator,
  suggestionsStatusValidator,
} from './validators'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Infer } from 'convex/values'

// Don't regenerate a person's suggestions more often than this.
export const REFRESH_INTERVAL_MS = 10 * 60 * 1000
// A run still marked as generating after this long counts as failed: the
// action that was meant to report back never did.
const RUN_TIMEOUT_MS = 15 * 60 * 1000
const MAX_CANDIDATES = 150

type SuggestionLanguage = Infer<typeof suggestionLanguageValidator>

async function attendeeStatusRow(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
  userId: string,
): Promise<Doc<'socialAttendeeStatus'> | null> {
  return await ctx.db
    .query('socialAttendeeStatus')
    .withIndex('by_eventId_and_userId', (q) =>
      q.eq('eventId', eventId).eq('userId', userId),
    )
    .first()
}

function summarizeProfile(
  profile: Doc<'profiles'> | null,
  fallbackName: string | undefined,
): string {
  const lines: Array<string> = []
  lines.push(`Nombre: ${profile?.name ?? fallbackName ?? 'Sin nombre'}`)
  if (profile?.headline) lines.push(`Titular: ${profile.headline}`)
  const jobs = (profile?.workHistory ?? [])
    .slice(0, 3)
    .map(
      (w) => `${w.title} en ${w.organization}${w.current ? ' (actual)' : ''}`,
    )
  if (jobs.length) lines.push(`Trayectoria: ${jobs.join('; ')}`)
  const schools = (profile?.education ?? [])
    .slice(0, 2)
    .map((e) => [e.degree, e.field, e.institution].filter(Boolean).join(', '))
  if (schools.length) lines.push(`Formación: ${schools.join('; ')}`)
  if (profile?.seeking) lines.push(`Busca: ${profile.seeking}`)
  if (profile?.canHelpWith)
    lines.push(`Puede ayudar con: ${profile.canHelpWith}`)
  if (profile?.careerGoals) lines.push(`Objetivos: ${profile.careerGoals}`)
  if (profile?.aiSafetyInterests?.length) {
    lines.push(`Intereses: ${profile.aiSafetyInterests.join(', ')}`)
  }
  if (profile?.skills?.length) {
    lines.push(`Habilidades: ${profile.skills.slice(0, 8).join(', ')}`)
  }
  return lines.join('\n')
}

export const getSuggestionContext = internalQuery({
  args: { eventId: v.id('socialEvents'), userId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      eventTitle: v.string(),
      matchingPrompt: v.union(v.string(), v.null()),
      language: v.string(),
      me: v.string(),
      candidates: v.array(
        v.object({ userId: v.string(), summary: v.string() }),
      ),
    }),
  ),
  handler: async (ctx, { eventId, userId }) => {
    const event = await ctx.db.get('socialEvents', eventId)
    if (!event) return null
    const myGuest = await getGuestByUser(ctx, eventId, userId)
    if (myGuest?.status !== 'approved') return null
    const myProfile = await getProfileByUser(ctx, userId)
    // The page's language, recorded when the attendee asked for suggestions.
    const status = await attendeeStatusRow(ctx, eventId, userId)
    if (!isProfileReadyForMatching(myProfile)) return null

    const guests = await approvedGuests(ctx, eventId)
    const candidates: Array<{ userId: string; summary: string }> = []
    // The same roster (the attendee included) goes to every attendee's
    // request so the model provider can cache it.
    for (const g of guests) {
      if (!g.userId) continue
      const profile = await getProfileByUser(ctx, g.userId)
      // People with no profile to speak of make for vague suggestions.
      if (
        g.userId !== userId &&
        !profile?.headline &&
        !profile?.seeking &&
        !profile?.workHistory?.length
      ) {
        continue
      }
      candidates.push({
        userId: g.userId,
        summary: summarizeProfile(profile, g.name),
      })
      if (candidates.length >= MAX_CANDIDATES) break
    }
    return {
      eventTitle: event.title,
      matchingPrompt: event.matchingPrompt ?? null,
      language:
        status?.suggestionsLanguage ??
        (myProfile?.preferredLanguage === 'en' ? 'en' : 'es'),
      me: summarizeProfile(myProfile, myGuest.name),
      candidates,
    }
  },
})

export const saveSuggestions = internalMutation({
  args: {
    eventId: v.id('socialEvents'),
    userId: v.string(),
    suggestions: v.array(
      v.object({
        suggestedUserId: v.string(),
        reason: v.string(),
        topics: v.array(v.string()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { eventId, userId, suggestions }) => {
    const old = await ctx.db
      .query('socialSuggestions')
      .withIndex('by_eventId_and_userId_and_rank', (q) =>
        q.eq('eventId', eventId).eq('userId', userId),
      )
      .take(50)
    for (const row of old) await ctx.db.delete('socialSuggestions', row._id)
    const now = Date.now()
    for (const [rank, s] of suggestions.entries()) {
      await ctx.db.insert('socialSuggestions', {
        eventId,
        userId,
        suggestedUserId: s.suggestedUserId,
        rank,
        reason: s.reason,
        topics: s.topics,
        generatedAt: now,
      })
    }
    const status = await attendeeStatusRow(ctx, eventId, userId)
    if (status) {
      await ctx.db.patch('socialAttendeeStatus', status._id, {
        suggestionsStatus: suggestions.length > 0 ? 'ready' : 'nobody',
        suggestionsStatusAt: now,
      })
    }
    return null
  },
})

/**
 * Record that an attendee's run ended without suggestions to save.
 * - failed: the model call could not be completed. The throttle is released
 *   so the attendee can ask again straight away.
 * - skipped: there was nothing to run (no longer an approved attendee with a
 *   ready profile), so no run stays on record.
 */
export const recordSuggestionsOutcome = internalMutation({
  args: {
    eventId: v.id('socialEvents'),
    userId: v.string(),
    outcome: v.union(v.literal('failed'), v.literal('skipped')),
  },
  returns: v.null(),
  handler: async (ctx, { eventId, userId, outcome }) => {
    const row = await attendeeStatusRow(ctx, eventId, userId)
    if (!row) return null
    await ctx.db.patch('socialAttendeeStatus', row._id, {
      suggestionsStatus: outcome === 'failed' ? 'failed' : undefined,
      suggestionsStatusAt: outcome === 'failed' ? Date.now() : undefined,
      suggestionsRequestedAt: undefined,
    })
    return null
  },
})

/**
 * Booked when a run starts. If that same run is still marked as generating
 * (its action timed out or crashed before reporting), mark it failed.
 */
export const expireSuggestionsRun = internalMutation({
  args: {
    eventId: v.id('socialEvents'),
    userId: v.string(),
    statusAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { eventId, userId, statusAt }) => {
    const row = await attendeeStatusRow(ctx, eventId, userId)
    if (
      row?.suggestionsStatus !== 'generating' ||
      row.suggestionsStatusAt !== statusAt
    ) {
      return null
    }
    await ctx.db.patch('socialAttendeeStatus', row._id, {
      suggestionsStatus: 'failed',
      suggestionsStatusAt: Date.now(),
      suggestionsRequestedAt: undefined,
    })
    return null
  },
})

export type SuggestionRequestDecision =
  // Generate right away.
  | { kind: 'now' }
  // Save the new language and book one run for `runAt`.
  | { kind: 'later'; runAt: number }
  // Nothing to generate. `saveLanguage`: a run is already booked and will
  // use the new language once it is stored.
  | { kind: 'recent'; saveLanguage: boolean }

/**
 * What to do with a request for suggestions. At most one generation per
 * REFRESH_INTERVAL_MS per person, whatever the language: a language switch
 * inside the window books one run for when the window ends (which reads the
 * latest language then). A failed run clears `lastRequestedAt`, so the next
 * request runs straight away.
 */
export function decideSuggestionRequest(input: {
  now: number
  lastRequestedAt: number | undefined
  storedLanguage: SuggestionLanguage | undefined
  language: SuggestionLanguage | undefined
}): SuggestionRequestDecision {
  const { now, lastRequestedAt: last, storedLanguage, language } = input
  if (last === undefined || now - last >= REFRESH_INTERVAL_MS) {
    return { kind: 'now' }
  }
  if (language === storedLanguage) {
    return { kind: 'recent', saveLanguage: false }
  }
  // `last` in the future means a run is already booked.
  if (last > now) return { kind: 'recent', saveLanguage: true }
  return { kind: 'later', runAt: last + REFRESH_INTERVAL_MS }
}

/**
 * Mark an attendee's run as generating and book the check that fails it if
 * it never reports back. `startsInMs` is how long until the run's action
 * starts. The request time and language live on the attendee status row so
 * they don't touch the guest rows every attendee's queries read.
 */
async function markSuggestionsGenerating(
  ctx: MutationCtx,
  args: {
    eventId: Id<'socialEvents'>
    userId: string
    row: Doc<'socialAttendeeStatus'> | null
    now: number
    language: SuggestionLanguage | undefined
    startsInMs: number
  },
): Promise<void> {
  const { eventId, userId, row, now, language, startsInMs } = args
  const fields = {
    // A later time here is a run already booked for then; keep it.
    suggestionsRequestedAt: Math.max(now, row?.suggestionsRequestedAt ?? 0),
    suggestionsLanguage: language,
    suggestionsStatus: 'generating' as const,
    suggestionsStatusAt: now,
  }
  if (row) {
    await ctx.db.patch('socialAttendeeStatus', row._id, fields)
  } else {
    await ctx.db.insert('socialAttendeeStatus', {
      eventId,
      userId,
      availability: 'available',
      ...fields,
      updatedAt: now,
    })
  }
  await ctx.scheduler.runAfter(
    startsInMs + RUN_TIMEOUT_MS,
    internal.social.suggestions.expireSuggestionsRun,
    { eventId, userId, statusAt: now },
  )
}

/**
 * Record a request for suggestions and act on the decision (see
 * decideSuggestionRequest). Returns what was decided; the caller schedules
 * the run for 'now'.
 */
async function markSuggestionsRequested(
  ctx: MutationCtx,
  eventId: Id<'socialEvents'>,
  userId: string,
  now: number,
  language: SuggestionLanguage | undefined,
): Promise<'now' | 'later' | 'recent'> {
  const row = await attendeeStatusRow(ctx, eventId, userId)
  const lang = language ?? row?.suggestionsLanguage
  const decision = decideSuggestionRequest({
    now,
    lastRequestedAt: row?.suggestionsRequestedAt,
    storedLanguage: row?.suggestionsLanguage,
    language: lang,
  })

  if (decision.kind === 'now') {
    await markSuggestionsGenerating(ctx, {
      eventId,
      userId,
      row,
      now,
      language: lang,
      startsInMs: 0,
    })
    return 'now'
  }
  // Inside the window, so the row exists.
  if (!row) return 'recent'
  if (decision.kind === 'recent') {
    if (decision.saveLanguage) {
      await ctx.db.patch('socialAttendeeStatus', row._id, {
        suggestionsLanguage: lang,
      })
    }
    return 'recent'
  }
  await ctx.db.patch('socialAttendeeStatus', row._id, {
    suggestionsLanguage: lang,
    suggestionsRequestedAt: decision.runAt,
  })
  await ctx.scheduler.runAt(
    decision.runAt,
    internal.social.suggestionsAction.generateForUser,
    { eventId, userId },
  )
  return 'later'
}

/**
 * Ask for fresh suggestions. Throttled per person; the attendee screen calls
 * this when the people page opens.
 */
export const refreshMySuggestions = mutation({
  args: {
    eventId: v.id('socialEvents'),
    language: v.optional(suggestionLanguageValidator),
  },
  returns: v.union(
    v.literal('scheduled'),
    v.literal('recent'),
    v.literal('profile_incomplete'),
    v.literal('not_attendee'),
  ),
  handler: async (ctx, { eventId, language }) => {
    const userId = await requireAuth(ctx)
    const guest = await getGuestByUser(ctx, eventId, userId)
    if (guest?.status !== 'approved') return 'not_attendee'
    const profile = await getProfileByUser(ctx, userId)
    if (!isProfileReadyForMatching(profile)) return 'profile_incomplete'
    const when = await markSuggestionsRequested(
      ctx,
      eventId,
      userId,
      Date.now(),
      language,
    )
    if (when !== 'now') return 'recent'
    await ctx.scheduler.runAfter(
      0,
      internal.social.suggestionsAction.generateForUser,
      { eventId, userId },
    )
    return 'scheduled'
  },
})

/** Admin: regenerate suggestions for every attendee with a ready profile. */
export const generateAllSuggestions = mutation({
  args: { eventId: v.id('socialEvents') },
  returns: v.number(),
  handler: async (ctx, { eventId }) => {
    await requireEventAdmin(ctx, eventId)
    const guests = await approvedGuests(ctx, eventId)
    let scheduled = 0
    const now = Date.now()
    for (const g of guests) {
      if (!g.userId) continue
      const profile = await getProfileByUser(ctx, g.userId)
      if (!isProfileReadyForMatching(profile)) continue
      // Spread the calls out a little to stay clear of rate limits.
      const startsInMs = scheduled * 1500
      // Admin-triggered: always runs, and records the request time so
      // attendees' own refreshes stay throttled.
      const row = await attendeeStatusRow(ctx, eventId, g.userId)
      await markSuggestionsGenerating(ctx, {
        eventId,
        userId: g.userId,
        row,
        now,
        language: row?.suggestionsLanguage,
        startsInMs,
      })
      await ctx.scheduler.runAfter(
        startsInMs,
        internal.social.suggestionsAction.generateForUser,
        { eventId, userId: g.userId },
      )
      scheduled++
    }
    return scheduled
  },
})

export const getMySuggestions = query({
  args: { eventId: v.id('socialEvents') },
  returns: v.array(
    v.object({
      userId: v.string(),
      name: v.string(),
      initials: v.string(),
      headline: v.union(v.string(), v.null()),
      reason: v.string(),
      topics: v.array(v.string()),
    }),
  ),
  handler: async (ctx, { eventId }) => {
    const userId = await getUserId(ctx)
    if (!userId) return []
    const rows = await ctx.db
      .query('socialSuggestions')
      .withIndex('by_eventId_and_userId_and_rank', (q) =>
        q.eq('eventId', eventId).eq('userId', userId),
      )
      .take(10)
    const cards = await Promise.all(
      rows.map(async (row) => {
        const guest = await getGuestByUser(ctx, eventId, row.suggestedUserId)
        // Skip people who have since cancelled or been declined.
        if (guest?.status !== 'approved') return null
        return {
          ...(await attendeeCard(ctx, eventId, row.suggestedUserId)),
          reason: row.reason,
          topics: row.topics,
        }
      }),
    )
    return cards.filter((c) => c !== null)
  },
})

/**
 * Where the caller's suggestions stand: `idle` until a run was ever started
 * for them, then the state of their current or last run and when it got
 * there.
 */
export const getMySuggestionState = query({
  args: { eventId: v.id('socialEvents') },
  returns: v.object({
    status: v.union(v.literal('idle'), suggestionsStatusValidator),
    at: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, { eventId }) => {
    const userId = await getUserId(ctx)
    const row = userId ? await attendeeStatusRow(ctx, eventId, userId) : null
    return {
      status: row?.suggestionsStatus ?? ('idle' as const),
      at: row?.suggestionsStatusAt ?? null,
    }
  },
})

/**
 * Turn the model's picks into suggestions to save: known candidates only,
 * never the attendee themselves, no repeats, each with a reason, trimmed to
 * the lengths the pages are laid out for, at most `max`.
 */
export function cleanSuggestionPicks(
  picks: Array<{ person: string; reason: string; topics: Array<string> }>,
  args: { userIdByKey: Map<string, string>; selfId: string; max: number },
): Array<{ suggestedUserId: string; reason: string; topics: Array<string> }> {
  const seen = new Set<string>()
  const suggestions = []
  for (const pick of picks) {
    if (suggestions.length >= args.max) break
    const suggestedUserId = args.userIdByKey.get(pick.person.trim())
    const reason = pick.reason.trim().slice(0, 600)
    if (
      !suggestedUserId ||
      suggestedUserId === args.selfId ||
      seen.has(suggestedUserId) ||
      !reason
    ) {
      continue
    }
    seen.add(suggestedUserId)
    suggestions.push({
      suggestedUserId,
      reason,
      topics: pick.topics
        .map((topic) => topic.trim().slice(0, 160))
        .filter(Boolean)
        .slice(0, 3),
    })
  }
  return suggestions
}
