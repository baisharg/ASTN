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
import { suggestionLanguageValidator } from './validators'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import type { Infer } from 'convex/values'

// Don't regenerate a person's suggestions more often than this.
const REFRESH_INTERVAL_MS = 10 * 60 * 1000
const MAX_CANDIDATES = 150

type SuggestionLanguage = Infer<typeof suggestionLanguageValidator>

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
    const status = await ctx.db
      .query('socialAttendeeStatus')
      .withIndex('by_eventId_and_userId', (q) =>
        q.eq('eventId', eventId).eq('userId', userId),
      )
      .first()
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
    return null
  },
})

/**
 * Record a request for suggestions and decide when to generate them. At most
 * one generation per REFRESH_INTERVAL_MS per person, whatever the language:
 * a language switch inside the window saves the language and books one run
 * for when the window ends (which reads the latest language then).
 * Kept on the attendee status row so it doesn't touch the guest rows every
 * attendee's queries read.
 */
async function markSuggestionsRequested(
  ctx: MutationCtx,
  eventId: Id<'socialEvents'>,
  userId: string,
  now: number,
  language: SuggestionLanguage | undefined,
): Promise<'now' | 'later' | 'recent'> {
  const row = await ctx.db
    .query('socialAttendeeStatus')
    .withIndex('by_eventId_and_userId', (q) =>
      q.eq('eventId', eventId).eq('userId', userId),
    )
    .first()
  const lang = language ?? row?.suggestionsLanguage
  const last = row?.suggestionsRequestedAt

  if (last === undefined || now - last >= REFRESH_INTERVAL_MS) {
    const fields = { suggestionsRequestedAt: now, suggestionsLanguage: lang }
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
    return 'now'
  }

  // Inside the window (row exists here). Same language: nothing to do.
  if (!row || lang === row.suggestionsLanguage) return 'recent'
  // `last` in the future means a run is already booked; it will pick up the
  // new language, so only store it.
  if (last > now) {
    await ctx.db.patch('socialAttendeeStatus', row._id, {
      suggestionsLanguage: lang,
    })
    return 'recent'
  }
  const runAt = last + REFRESH_INTERVAL_MS
  await ctx.db.patch('socialAttendeeStatus', row._id, {
    suggestionsLanguage: lang,
    suggestionsRequestedAt: runAt,
  })
  await ctx.scheduler.runAt(
    runAt,
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
      // Admin-triggered: always runs, but still records the request time so
      // attendees' own refreshes stay throttled.
      await markSuggestionsRequested(ctx, eventId, g.userId, now, undefined)
      // Spread the calls out a little to stay clear of rate limits.
      await ctx.scheduler.runAfter(
        scheduled * 1500,
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
