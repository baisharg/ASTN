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
  PROFILE_SECTIONS,
  approvedGuests,
  attendeeCard,
  attendeeVisibleProfile,
  getGuestByUser,
  getProfileByUser,
  isProfileReadyForMatching,
  meetingsWindow,
  requireEventAdmin,
  sharedProfileParts,
} from './lib'
import {
  suggestionLanguageValidator,
  suggestionRunTriggerValidator,
  suggestionsStatusValidator,
} from './validators'
import type { AttendeeVisibleProfile } from './lib'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Infer } from 'convex/values'

/**
 * Who should meet whom at an in-person event.
 *
 * 1. Rank: for each attendee the model ranks up to MAX_RANKED people from
 *    the roster (convex/social/suggestionsAction.ts). The ranking is stored
 *    in socialSuggestionCandidates.
 * 2. Assign: one deterministic pass over every attendee's ranking picks up
 *    to MAX_SUGGESTIONS people each (assignSuggestions) and writes them to
 *    socialSuggestions. It calls no model, so it re-runs whenever a ranking
 *    changes or people have met.
 *
 * An event run ranks every approved attendee with a ready profile and then
 * assigns once (socialSuggestionRuns). At most one runs per event at a time.
 */

// How many people the model ranks for an attendee, and how many of those
// the attendee is suggested.
export const MAX_RANKED = 10
export const MAX_SUGGESTIONS = 5
// How many attendees any one person is suggested to, so the people everyone
// wants to meet are not suggested to the whole room.
export const SUGGESTION_CAP = 8
// New attendees start an event run at most this often, counted from the
// start of the last run.
export const EVENT_RUN_INTERVAL_MS = 15 * 60 * 1000
// An attendee's own ranking is redone for a language switch at most this
// often.
export const RERANK_INTERVAL_MS = 10 * 60 * 1000
// A ranking that hasn't reported back this long after it was due counts as
// failed: its action crashed. An action that runs to the end reports well
// inside this (two model calls of at most MODEL_TIMEOUT_MS each).
const RANK_TIMEOUT_MS = 10 * 60 * 1000
// How long one model call for a ranking may take before it is aborted.
export const MODEL_TIMEOUT_MS = 4 * 60 * 1000
// A "generating" state older than this is no longer believed: whatever was
// meant to settle it did not.
export const GENERATING_STALE_MS = RANK_TIMEOUT_MS + 5 * 60 * 1000
// The most an assignment may use of a transaction, as a nested mutation.
// Kept under the transaction's own limits so that when an assignment is too
// big it fails on its own and the caller can still record that it did.
const ASSIGNMENT_LIMITS = {
  bytesRead: 12 * 1024 * 1024,
  documentsRead: 24_000,
  databaseQueries: 3_000,
  bytesWritten: 12 * 1024 * 1024,
  documentsWritten: 12_000,
}
// Rankings of one run start this far apart, to stay clear of rate limits.
const RANK_STAGGER_MS = 1500
const MAX_ROSTER = 150
// Approved guests read per event (approvedGuests).
const MAX_EVENT_ATTENDEES = 500

type SuggestionLanguage = Infer<typeof suggestionLanguageValidator>
type RunTrigger = Infer<typeof suggestionRunTriggerValidator>

const rankedCandidateValidator = v.object({
  userId: v.string(),
  reason: v.string(),
  topics: v.array(v.string()),
})

// ── Pure rules ──────────────────────────────────────────────────────────

/**
 * A profile as the suggestions model reads it. Takes what
 * attendeeVisibleProfile shares, so sections the person keeps private never
 * reach the model.
 */
export function summarizeProfile(
  visible: AttendeeVisibleProfile,
  fallbackName: string | undefined,
): string {
  const lines: Array<string> = []
  lines.push(`Nombre: ${visible.name ?? fallbackName ?? 'Sin nombre'}`)
  if (visible.headline) lines.push(`Titular: ${visible.headline}`)
  const jobs = visible.workHistory
    .slice(0, 3)
    .map(
      (w) => `${w.title} en ${w.organization}${w.current ? ' (actual)' : ''}`,
    )
  if (jobs.length) lines.push(`Trayectoria: ${jobs.join('; ')}`)
  const schools = visible.education
    .slice(0, 2)
    .map((e) => [e.degree, e.field, e.institution].filter(Boolean).join(', '))
  if (schools.length) lines.push(`Formación: ${schools.join('; ')}`)
  if (visible.seeking) lines.push(`Busca: ${visible.seeking}`)
  if (visible.canHelpWith) {
    lines.push(`Puede ayudar con: ${visible.canHelpWith}`)
  }
  if (visible.careerGoals) lines.push(`Objetivos: ${visible.careerGoals}`)
  if (visible.interests.length) {
    lines.push(`Intereses: ${visible.interests.join(', ')}`)
  }
  if (visible.skills.length) {
    lines.push(`Habilidades: ${visible.skills.slice(0, 8).join(', ')}`)
  }
  return lines.join('\n')
}

/**
 * Turn the model's picks into a ranking to save: known people only, never
 * the attendee themselves, no repeats, each with a reason, trimmed to the
 * lengths the pages are laid out for, at most `max`.
 */
export function cleanSuggestionPicks(
  picks: Array<{ person: string; reason: string; topics: Array<string> }>,
  args: { userIdByKey: Map<string, string>; selfId: string; max: number },
): Array<{ userId: string; reason: string; topics: Array<string> }> {
  const seen = new Set<string>()
  const ranked = []
  for (const pick of picks) {
    if (ranked.length >= args.max) break
    const userId = args.userIdByKey.get(pick.person.trim())
    const reason = pick.reason.trim().slice(0, 600)
    if (!userId || userId === args.selfId || seen.has(userId) || !reason) {
      continue
    }
    seen.add(userId)
    ranked.push({
      userId,
      reason,
      topics: pick.topics
        .map((topic) => topic.trim().slice(0, 160))
        .filter(Boolean)
        .slice(0, 3),
    })
  }
  return ranked
}

/** One key for a pair of people, whichever way round they are given. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}\n${b}` : `${b}\n${a}`
}

/**
 * Pick each attendee's suggestions from everyone's rankings.
 *
 * Goes round by round: in a round every attendee gets their best candidate
 * still available, so everyone has a first pick before anyone has a second.
 * A candidate is available to an attendee when they are an eligible attendee
 * other than themselves, not already picked for them, the two haven't met,
 * and the candidate is suggested to fewer than `cap` attendees so far.
 *
 * Attendees take turns in user id order, reversed every other round, so the
 * same people don't always choose first. An attendee whose candidates run
 * out simply ends up with fewer picks (possibly none); the cap is never
 * exceeded to fill a list. The same input always gives the same result.
 *
 * Returns the picks, best first, of every eligible attendee in `rankings`.
 */
export function assignSuggestions(input: {
  /** Each attendee's candidates, best first. */
  rankings: Array<{ userId: string; candidates: Array<string> }>
  /** Who can be suggested and receive suggestions: the event's attendees. */
  eligibleUserIds: Array<string>
  /** Pairs who have had, or are having, a meeting at this event. */
  metPairs: Array<[string, string]>
  /** How many suggestions each attendee gets at most. */
  perAttendee: number
  /** How many attendees one person is suggested to at most. */
  cap: number
}): Map<string, Array<string>> {
  const eligible = new Set(input.eligibleUserIds)
  const met = new Set(input.metPairs.map(([a, b]) => pairKey(a, b)))

  // One ranking per eligible attendee (the first given), in user id order.
  const byAttendee = new Map<
    string,
    { userId: string; candidates: Array<string>; picks: Array<string> }
  >()
  for (const ranking of input.rankings) {
    if (!eligible.has(ranking.userId) || byAttendee.has(ranking.userId)) {
      continue
    }
    byAttendee.set(ranking.userId, { ...ranking, picks: [] })
  }
  const attendees = [...byAttendee.values()].sort((a, b) =>
    a.userId < b.userId ? -1 : 1,
  )

  const suggestedTo = new Map<string, number>()
  for (let round = 0; round < input.perAttendee; round++) {
    const turns = round % 2 === 0 ? attendees : [...attendees].reverse()
    for (const attendee of turns) {
      const pick = attendee.candidates.find(
        (candidate) =>
          candidate !== attendee.userId &&
          eligible.has(candidate) &&
          !attendee.picks.includes(candidate) &&
          !met.has(pairKey(attendee.userId, candidate)) &&
          (suggestedTo.get(candidate) ?? 0) < input.cap,
      )
      if (pick === undefined) continue
      attendee.picks.push(pick)
      suggestedTo.set(pick, (suggestedTo.get(pick) ?? 0) + 1)
    }
  }
  return new Map(attendees.map((a) => [a.userId, a.picks]))
}

export type RefreshDecision =
  // An event run, or the attendee's own ranking, is already under way.
  | { kind: 'wait' }
  // Rank everyone at the event, then assign.
  | { kind: 'eventRun'; trigger: 'attendee' | 'attendance' }
  // Rank only this attendee: they have no ranking (`missing`), or theirs is
  // written in another language (`language`, limited by decideRerankTiming).
  | { kind: 'ownRank'; reason: 'missing' | 'language' }
  // The attendee is fine; start an event run if attendees with a ready
  // profile joined since the last one.
  | { kind: 'checkAttendance' }
  | { kind: 'none' }

/**
 * What an attendee's request for suggestions (opening the people page, or
 * its periodic check while open) sets in motion.
 *
 * - The first request at an event starts its first run.
 * - New attendees start a run at most every EVENT_RUN_INTERVAL_MS. One who
 *   arrives sooner than that after the last run, or while a run that doesn't
 *   include them is under way, is ranked on their own so they aren't left
 *   waiting; the next run then includes them for everyone else.
 * - An attendee the last run covered but who has no ranking (it failed) is
 *   ranked on their own, never through a whole new run.
 * - Once the event's 1:1s have closed, nobody is ranked: the suggestions an
 *   attendee has stay as they are.
 */
export function decideRefresh(input: {
  now: number
  /** Whether the event's 1:1 window has closed. */
  meetingsOver: boolean
  eventRunInProgress: boolean
  /** When the event's last run started (running or finished), if any. */
  lastEventRunStartedAt: number | undefined
  /** Whether that run ranks, or ranked, this attendee. */
  coveredByLastEventRun: boolean
  /** Whether a ranking for this attendee is under way. */
  rankInProgress: boolean
  hasRanking: boolean
  rankingLanguage: SuggestionLanguage | undefined
  /** The language the attendee's page is in. */
  language: SuggestionLanguage
}): RefreshDecision {
  if (input.meetingsOver) return { kind: 'none' }
  const needsOwnRank = !input.hasRanking && !input.rankInProgress
  if (input.eventRunInProgress) {
    return needsOwnRank && !input.coveredByLastEventRun
      ? { kind: 'ownRank', reason: 'missing' }
      : { kind: 'wait' }
  }
  if (input.lastEventRunStartedAt === undefined) {
    return { kind: 'eventRun', trigger: 'attendee' }
  }
  const runDue =
    input.now - input.lastEventRunStartedAt >= EVENT_RUN_INTERVAL_MS
  if (!input.hasRanking) {
    if (runDue && !input.coveredByLastEventRun) {
      return { kind: 'eventRun', trigger: 'attendance' }
    }
    return needsOwnRank
      ? { kind: 'ownRank', reason: 'missing' }
      : { kind: 'wait' }
  }
  if (input.rankingLanguage !== input.language) {
    return { kind: 'ownRank', reason: 'language' }
  }
  return runDue ? { kind: 'checkAttendance' } : { kind: 'none' }
}

/**
 * Whether a ranking for an attendee is under way, going by their status row:
 * marked as generating, and recently enough to still be believed.
 */
export function isRankInProgress(
  status: {
    suggestionsStatus?: 'generating' | 'ready' | 'nobody' | 'failed'
    suggestionsStatusAt?: number
  } | null,
  now: number,
): boolean {
  return (
    status?.suggestionsStatus === 'generating' &&
    now - (status.suggestionsStatusAt ?? 0) < GENERATING_STALE_MS
  )
}

export type RerankTiming =
  // Rank right away.
  | { kind: 'now' }
  // Book one ranking for `runAt`.
  | { kind: 'later'; runAt: number }
  // A ranking is already booked; it reads the language when it runs.
  | { kind: 'booked' }

/**
 * When to redo an attendee's ranking for a language switch: at most once per
 * RERANK_INTERVAL_MS per person, so flipping the language back and forth
 * books a single ranking for when the interval ends. `lastRequestedAt` is
 * when their ranking was last requested; a time in the future is a booked
 * one. A failed ranking clears it, so the next request ranks right away.
 */
export function decideRerankTiming(input: {
  now: number
  lastRequestedAt: number | undefined
}): RerankTiming {
  const { now, lastRequestedAt: last } = input
  if (last === undefined || now - last >= RERANK_INTERVAL_MS) {
    return { kind: 'now' }
  }
  if (last > now) return { kind: 'booked' }
  return { kind: 'later', runAt: last + RERANK_INTERVAL_MS }
}

// ── Reads ───────────────────────────────────────────────────────────────

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

async function rankingOf(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
  userId: string,
): Promise<Doc<'socialSuggestionCandidates'> | null> {
  return await ctx.db
    .query('socialSuggestionCandidates')
    .withIndex('by_eventId_and_userId', (q) =>
      q.eq('eventId', eventId).eq('userId', userId),
    )
    .first()
}

/** The event's current or last run. */
async function latestRun(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
): Promise<Doc<'socialSuggestionRuns'> | null> {
  return await ctx.db
    .query('socialSuggestionRuns')
    .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
    .order('desc')
    .first()
}

/**
 * Whether a run is still ranking. Its timeout check closes it at
 * `timeoutAt`; a run still open well after that is treated as over.
 */
function isRunning(
  run: Doc<'socialSuggestionRuns'> | null,
  now: number,
): run is Doc<'socialSuggestionRuns'> {
  return (
    run !== null && run.status === 'running' && now < run.timeoutAt + 60_000
  )
}

/** The language an attendee's suggestions are written in. */
function suggestionLanguage(
  status: Doc<'socialAttendeeStatus'> | null,
  profile: Doc<'profiles'> | null,
): SuggestionLanguage {
  return (
    status?.suggestionsLanguage ??
    (profile?.preferredLanguage === 'en' ? 'en' : 'es')
  )
}

/** Approved guests with an account and a profile ready for matching. */
async function readyAttendeeIds(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
): Promise<Array<string>> {
  const guests = await approvedGuests(ctx, eventId)
  const ready = new Set<string>()
  for (const guest of guests) {
    if (!guest.userId || ready.has(guest.userId)) continue
    const profile = await getProfileByUser(ctx, guest.userId)
    if (isProfileReadyForMatching(profile)) ready.add(guest.userId)
  }
  return [...ready]
}

/** Whether the attendee is still suggested someone they already met. */
async function isSuggestedSomeoneMet(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
  userId: string,
): Promise<boolean> {
  const suggestions = await ctx.db
    .query('socialSuggestions')
    .withIndex('by_eventId_and_userId_and_rank', (q) =>
      q.eq('eventId', eventId).eq('userId', userId),
    )
    .take(20)
  if (suggestions.length === 0) return false
  const [asA, asB] = await Promise.all([
    ctx.db
      .query('socialMeetings')
      .withIndex('by_eventId_and_userA_and_status', (q) =>
        q.eq('eventId', eventId).eq('userA', userId).eq('status', 'ended'),
      )
      .take(200),
    ctx.db
      .query('socialMeetings')
      .withIndex('by_eventId_and_userB_and_status', (q) =>
        q.eq('eventId', eventId).eq('userB', userId).eq('status', 'ended'),
      )
      .take(200),
  ])
  const met = new Set([...asA.map((m) => m.userB), ...asB.map((m) => m.userA)])
  return suggestions.some((s) => met.has(s.suggestedUserId))
}

// ── Writes shared by the functions below ────────────────────────────────

/**
 * Mark an attendee's ranking as under way. The request time and language
 * live on the attendee status row so they don't touch the guest rows.
 */
async function markGenerating(
  ctx: MutationCtx,
  args: {
    eventId: Id<'socialEvents'>
    userId: string
    row: Doc<'socialAttendeeStatus'> | null
    now: number
    language: SuggestionLanguage | undefined
  },
): Promise<void> {
  const { eventId, userId, row, now, language } = args
  const fields = {
    // A later time here is a ranking already booked for then; keep it.
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
}

/**
 * Keep the language an attendee's suggestions are written in on their status
 * row, creating the row if they have none. Writes only when it changes.
 * Returns the row as it is afterwards.
 */
async function storeSuggestionLanguage(
  ctx: MutationCtx,
  args: {
    eventId: Id<'socialEvents'>
    userId: string
    row: Doc<'socialAttendeeStatus'> | null
    now: number
    language: SuggestionLanguage
  },
): Promise<Doc<'socialAttendeeStatus'> | null> {
  const { eventId, userId, row, now, language } = args
  if (row?.suggestionsLanguage === language) return row
  if (row) {
    await ctx.db.patch('socialAttendeeStatus', row._id, {
      suggestionsLanguage: language,
    })
    return { ...row, suggestionsLanguage: language }
  }
  const rowId = await ctx.db.insert('socialAttendeeStatus', {
    eventId,
    userId,
    availability: 'available',
    suggestionsLanguage: language,
    updatedAt: now,
  })
  return await ctx.db.get('socialAttendeeStatus', rowId)
}

/**
 * Mark an attendee's ranking as failed, if it is still marked as under way,
 * and release the limit on asking again.
 */
async function markFailedIfGenerating(
  ctx: MutationCtx,
  eventId: Id<'socialEvents'>,
  userId: string,
  now: number,
): Promise<void> {
  const row = await attendeeStatusRow(ctx, eventId, userId)
  if (row?.suggestionsStatus !== 'generating') return
  await ctx.db.patch('socialAttendeeStatus', row._id, {
    suggestionsStatus: 'failed',
    suggestionsStatusAt: now,
    suggestionsRequestedAt: undefined,
  })
}

/** Forget an attendee's ranking request: there was nothing to rank. */
async function clearRankingRequest(
  ctx: MutationCtx,
  eventId: Id<'socialEvents'>,
  userId: string,
): Promise<void> {
  const row = await attendeeStatusRow(ctx, eventId, userId)
  if (!row) return
  await ctx.db.patch('socialAttendeeStatus', row._id, {
    suggestionsStatus: undefined,
    suggestionsStatusAt: undefined,
    suggestionsRequestedAt: undefined,
  })
}

/** Rank one attendee now, outside an event run. */
async function startOwnRank(
  ctx: MutationCtx,
  args: {
    eventId: Id<'socialEvents'>
    userId: string
    row: Doc<'socialAttendeeStatus'> | null
    now: number
    language: SuggestionLanguage
  },
): Promise<void> {
  await markGenerating(ctx, args)
  const { eventId, userId, now } = args
  await ctx.scheduler.runAfter(
    0,
    internal.social.suggestionsAction.generateForUser,
    { eventId, userId },
  )
  await ctx.scheduler.runAfter(
    RANK_TIMEOUT_MS,
    internal.social.suggestions.expireSuggestionsRun,
    { eventId, userId, statusAt: now },
  )
}

/**
 * Start an event run: rank every approved attendee with a ready profile,
 * a little apart from each other. The assignment follows when the last
 * ranking reports (recordRankOutcome) or at the run's timeout. Returns how
 * many attendees the run ranks; 0 means there was nobody and no run started.
 */
async function startEventRun(
  ctx: MutationCtx,
  args: {
    eventId: Id<'socialEvents'>
    trigger: RunTrigger
    now: number
    /** From readyAttendeeIds, when the caller already has it. */
    attendeeUserIds?: Array<string>
  },
): Promise<number> {
  const { eventId, trigger, now } = args
  const attendeeUserIds =
    args.attendeeUserIds ?? (await readyAttendeeIds(ctx, eventId))
  if (attendeeUserIds.length === 0) return 0
  const timeoutAt =
    now + attendeeUserIds.length * RANK_STAGGER_MS + RANK_TIMEOUT_MS
  const runId = await ctx.db.insert('socialSuggestionRuns', {
    eventId,
    trigger,
    status: 'running',
    startedAt: now,
    timeoutAt,
    attendeeUserIds,
    pendingUserIds: attendeeUserIds,
    succeeded: 0,
    failedUserIds: [],
    skipped: 0,
  })
  for (const [index, userId] of attendeeUserIds.entries()) {
    const row = await attendeeStatusRow(ctx, eventId, userId)
    await markGenerating(ctx, {
      eventId,
      userId,
      row,
      now,
      language: row?.suggestionsLanguage,
    })
    await ctx.scheduler.runAfter(
      index * RANK_STAGGER_MS,
      internal.social.suggestionsAction.generateForUser,
      { eventId, userId, runId },
    )
  }
  await ctx.scheduler.runAt(
    timeoutAt,
    internal.social.suggestions.finishStalledSuggestionRun,
    { runId },
  )
  return attendeeUserIds.length
}

/**
 * Re-pick everyone's suggestions from the stored rankings and save what
 * changed. Reads the whole event (guests, rankings, meetings, current
 * suggestions) and calls no model.
 *
 * An attendee whose picks are the same keeps their rows untouched. The row
 * for the person an attendee is meeting right now always stays, because the
 * meeting page reads its topics from it. Attendees a run is still ranking
 * keep their "generating" state; everyone else with a ranking becomes
 * `ready` or `nobody`.
 */
async function assignEventSuggestions(
  ctx: MutationCtx,
  eventId: Id<'socialEvents'>,
  now: number,
): Promise<void> {
  const run = await latestRun(ctx, eventId)
  const stillRanking = new Set(isRunning(run, now) ? run.pendingUserIds : [])
  const guests = await approvedGuests(ctx, eventId)
  const rankings = await ctx.db
    .query('socialSuggestionCandidates')
    .withIndex('by_eventId_and_userId', (q) => q.eq('eventId', eventId))
    .take(MAX_EVENT_ATTENDEES)
  const meetingsWith = (status: Doc<'socialMeetings'>['status']) =>
    ctx.db
      .query('socialMeetings')
      .withIndex('by_eventId_and_status', (q) =>
        q.eq('eventId', eventId).eq('status', status),
      )
      .take(4000)
  const [activeMeetings, endedMeetings] = await Promise.all([
    meetingsWith('active'),
    meetingsWith('ended'),
  ])

  const picks = assignSuggestions({
    rankings: rankings.map((r) => ({
      userId: r.userId,
      candidates: r.candidates.map((c) => c.userId),
    })),
    eligibleUserIds: guests.flatMap((g) => (g.userId ? [g.userId] : [])),
    metPairs: [...activeMeetings, ...endedMeetings].map((m) => [
      m.userA,
      m.userB,
    ]),
    perAttendee: MAX_SUGGESTIONS,
    cap: SUGGESTION_CAP,
  })

  const meetingNow = new Set(
    activeMeetings.map((m) => pairKey(m.userA, m.userB)),
  )
  for (const ranking of rankings) {
    const picked = picks.get(ranking.userId)
    // Not in the assignment: no longer an approved attendee.
    if (!picked) continue
    const candidateById = new Map(ranking.candidates.map((c) => [c.userId, c]))
    const wanted = picked.flatMap((id) => candidateById.get(id) ?? [])
    // Best first (the index ends in rank).
    const currentRows = await ctx.db
      .query('socialSuggestions')
      .withIndex('by_eventId_and_userId_and_rank', (q) =>
        q.eq('eventId', eventId).eq('userId', ranking.userId),
      )
      .take(50)
    const replaceable = currentRows.filter(
      (row) => !meetingNow.has(pairKey(row.userId, row.suggestedUserId)),
    )
    const unchanged =
      replaceable.length === wanted.length &&
      replaceable.every(
        (row, i) =>
          row.suggestedUserId === wanted[i].userId &&
          row.reason === wanted[i].reason &&
          row.topics.join('\n') === wanted[i].topics.join('\n'),
      )
    if (!unchanged) {
      for (const row of replaceable) {
        await ctx.db.delete('socialSuggestions', row._id)
      }
      for (const [rank, candidate] of wanted.entries()) {
        await ctx.db.insert('socialSuggestions', {
          eventId,
          userId: ranking.userId,
          suggestedUserId: candidate.userId,
          rank,
          reason: candidate.reason,
          topics: candidate.topics,
          generatedAt: now,
        })
      }
    }

    if (stillRanking.has(ranking.userId)) continue
    const status = wanted.length > 0 ? 'ready' : 'nobody'
    const row = await attendeeStatusRow(ctx, eventId, ranking.userId)
    if (row && row.suggestionsStatus !== status) {
      await ctx.db.patch('socialAttendeeStatus', row._id, {
        suggestionsStatus: status,
        suggestionsStatusAt: now,
      })
    }
  }
}

/**
 * Assign for the whole event as a nested mutation: if it fails, only the
 * assignment's own writes roll back, and the caller goes on to record what
 * happened. Returns whether it succeeded.
 */
async function tryAssignEventSuggestions(
  ctx: MutationCtx,
  eventId: Id<'socialEvents'>,
): Promise<boolean> {
  try {
    const done: null = await ctx.runMutation(
      internal.social.suggestions.reassignEventSuggestions,
      { eventId },
      { transactionLimits: ASSIGNMENT_LIMITS },
    )
    return done === null
  } catch (error) {
    console.error('Suggestion assignment failed', eventId, error)
    return false
  }
}

/**
 * Close a run: record its totals and assign for the whole event. Then mark
 * as failed whoever is still "generating": the attendees whose ranking
 * failed and who had no earlier ranking to be assigned from, or, when the
 * assignment itself failed, everyone the run ranked. They can ask again
 * (refreshMySuggestions). `run` carries the final totals.
 */
async function finishRun(
  ctx: MutationCtx,
  run: Doc<'socialSuggestionRuns'>,
  now: number,
): Promise<void> {
  await ctx.db.patch('socialSuggestionRuns', run._id, {
    status: 'finished',
    finishedAt: now,
    pendingUserIds: [],
    succeeded: run.succeeded,
    failedUserIds: run.failedUserIds,
    skipped: run.skipped,
  })
  const assigned = await tryAssignEventSuggestions(ctx, run.eventId)
  const unsettled = assigned ? run.failedUserIds : run.attendeeUserIds
  for (const userId of unsettled) {
    await markFailedIfGenerating(ctx, run.eventId, userId, now)
  }
}

// ── Called by the ranking action ────────────────────────────────────────

export const getSuggestionContext = internalQuery({
  args: { eventId: v.id('socialEvents'), userId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      eventTitle: v.string(),
      matchingPrompt: v.union(v.string(), v.null()),
      language: suggestionLanguageValidator,
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
    if (!isProfileReadyForMatching(myProfile)) return null
    // The page's language, recorded when the attendee asked for suggestions.
    const status = await attendeeStatusRow(ctx, eventId, userId)

    const guests = await approvedGuests(ctx, eventId)
    const candidates: Array<{ userId: string; summary: string }> = []
    // The same roster (the attendee included) goes to every attendee's
    // request so the model provider can cache it.
    for (const g of guests) {
      if (!g.userId) continue
      const visible = attendeeVisibleProfile(
        await getProfileByUser(ctx, g.userId),
      )
      // People who share no profile to speak of make for vague suggestions.
      if (
        g.userId !== userId &&
        !visible.headline &&
        !visible.seeking &&
        !visible.workHistory.length
      ) {
        continue
      }
      candidates.push({
        userId: g.userId,
        summary: summarizeProfile(visible, g.name),
      })
      if (candidates.length >= MAX_ROSTER) break
    }
    return {
      eventTitle: event.title,
      matchingPrompt: event.matchingPrompt ?? null,
      language: suggestionLanguage(status, myProfile),
      me: summarizeProfile(attendeeVisibleProfile(myProfile), myGuest.name),
      candidates,
    }
  },
})

/**
 * How one attendee's ranking ended:
 * - ranked: the model's ranking, to store (it may be empty: nobody to rank)
 * - failed: the model call could not be completed, after its retry
 * - skipped: nothing to rank (no longer an approved attendee with a ready
 *   profile)
 *
 * With `runId`, the outcome also counts towards that event run, and the last
 * one in closes it, which assigns for the whole event. A ranking on its own
 * (or one that reports after its run was closed) is assigned straight away,
 * unless an event run is still to rank the same attendee.
 */
export const recordRankOutcome = internalMutation({
  args: {
    eventId: v.id('socialEvents'),
    userId: v.string(),
    runId: v.optional(v.id('socialSuggestionRuns')),
    outcome: v.union(
      v.object({
        kind: v.literal('ranked'),
        language: suggestionLanguageValidator,
        candidates: v.array(rankedCandidateValidator),
      }),
      v.object({ kind: v.literal('failed') }),
      v.object({ kind: v.literal('skipped') }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { eventId, userId, runId, outcome }) => {
    const now = Date.now()
    if (outcome.kind === 'ranked') {
      const ranking = {
        language: outcome.language,
        candidates: outcome.candidates,
        rankedAt: now,
      }
      const existing = await rankingOf(ctx, eventId, userId)
      if (existing) {
        await ctx.db.patch('socialSuggestionCandidates', existing._id, ranking)
      } else {
        await ctx.db.insert('socialSuggestionCandidates', {
          eventId,
          userId,
          ...ranking,
        })
      }
    }
    if (outcome.kind === 'skipped') {
      await clearRankingRequest(ctx, eventId, userId)
    }

    const run = runId ? await ctx.db.get('socialSuggestionRuns', runId) : null
    if (run?.status === 'running' && run.pendingUserIds.includes(userId)) {
      const reported: Doc<'socialSuggestionRuns'> = {
        ...run,
        pendingUserIds: run.pendingUserIds.filter((id) => id !== userId),
        succeeded: run.succeeded + (outcome.kind === 'ranked' ? 1 : 0),
        failedUserIds:
          outcome.kind === 'failed'
            ? [...run.failedUserIds, userId]
            : run.failedUserIds,
        skipped: run.skipped + (outcome.kind === 'skipped' ? 1 : 0),
      }
      if (reported.pendingUserIds.length === 0) {
        await finishRun(ctx, reported, now)
      } else {
        await ctx.db.patch('socialSuggestionRuns', run._id, {
          pendingUserIds: reported.pendingUserIds,
          succeeded: reported.succeeded,
          failedUserIds: reported.failedUserIds,
          skipped: reported.skipped,
        })
      }
      return null
    }

    // On its own. When an event run is still to rank this attendee, that
    // ranking decides their state.
    const eventRun = await latestRun(ctx, eventId)
    if (isRunning(eventRun, now) && eventRun.pendingUserIds.includes(userId)) {
      return null
    }
    const settled =
      outcome.kind === 'ranked' &&
      (await tryAssignEventSuggestions(ctx, eventId))
    if (!settled && outcome.kind !== 'skipped') {
      await markFailedIfGenerating(ctx, eventId, userId, now)
    }
    return null
  },
})

/**
 * Booked when an event run starts, for when every ranking should long have
 * reported. If the run is still open, the rankings that never reported count
 * as failed and the run is closed with what it has.
 */
export const finishStalledSuggestionRun = internalMutation({
  args: { runId: v.id('socialSuggestionRuns') },
  returns: v.null(),
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get('socialSuggestionRuns', runId)
    if (run?.status !== 'running') return null
    await finishRun(
      ctx,
      {
        ...run,
        failedUserIds: [...run.failedUserIds, ...run.pendingUserIds],
        pendingUserIds: [],
      },
      Date.now(),
    )
    return null
  },
})

/**
 * Booked when an attendee's own ranking starts. If that same ranking is
 * still marked as under way (its action timed out or crashed before
 * reporting), mark it failed.
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
    if (row?.suggestionsStatusAt !== statusAt) return null
    await markFailedIfGenerating(ctx, eventId, userId, Date.now())
    return null
  },
})

/**
 * Re-pick everyone's suggestions from the stored rankings, without calling
 * the model: after people met, so they are no longer suggested each other
 * and get the next person on their list instead.
 */
export const reassignEventSuggestions = internalMutation({
  args: { eventId: v.id('socialEvents') },
  returns: v.null(),
  handler: async (ctx, { eventId }) => {
    await assignEventSuggestions(ctx, eventId, Date.now())
    return null
  },
})

/**
 * Replace one attendee's suggestions with a finished list, without a ranking
 * or the event-wide assignment. Nothing schedules a generation that reports
 * through here; it stays for generation actions that were already running
 * when the ranking flow was released, and can be removed once none can be.
 */
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
 * Record that a generation ended without suggestions to save (`failed`, or
 * `skipped` when there was nothing to generate). Like saveSuggestions, it
 * stays for generation actions that were already running when the ranking
 * flow was released.
 */
export const recordSuggestionsOutcome = internalMutation({
  args: {
    eventId: v.id('socialEvents'),
    userId: v.string(),
    outcome: v.union(v.literal('failed'), v.literal('skipped')),
  },
  returns: v.null(),
  handler: async (ctx, { eventId, userId, outcome }) => {
    if (outcome === 'failed') {
      await markFailedIfGenerating(ctx, eventId, userId, Date.now())
    } else {
      await clearRankingRequest(ctx, eventId, userId)
    }
    return null
  },
})

// ── Public ──────────────────────────────────────────────────────────────

/**
 * Ask for suggestions. The attendee's people page calls this when it opens,
 * when its language changes and every few minutes while it stays open; what
 * it sets in motion is decided by decideRefresh. A call with nothing to do
 * writes nothing.
 *
 * Returns `scheduled` when a ranking is under way for the caller (their own
 * or an event run's), and `recent` when nothing new was started.
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
  handler: async (ctx, { eventId, language: pageLanguage }) => {
    const userId = await requireAuth(ctx)
    const guest = await getGuestByUser(ctx, eventId, userId)
    if (guest?.status !== 'approved') return 'not_attendee'
    const profile = await getProfileByUser(ctx, userId)
    if (!isProfileReadyForMatching(profile)) return 'profile_incomplete'

    const now = Date.now()
    const [event, storedRow, run, ranking] = await Promise.all([
      ctx.db.get('socialEvents', eventId),
      attendeeStatusRow(ctx, eventId, userId),
      latestRun(ctx, eventId),
      rankingOf(ctx, eventId, userId),
    ])
    const language = pageLanguage ?? suggestionLanguage(storedRow, profile)
    const decision = decideRefresh({
      now,
      meetingsOver: event === null || now >= meetingsWindow(event).closeAt,
      eventRunInProgress: isRunning(run, now),
      lastEventRunStartedAt: run?.startedAt,
      coveredByLastEventRun: run?.attendeeUserIds.includes(userId) ?? false,
      rankInProgress: isRankInProgress(storedRow, now),
      hasRanking: ranking !== null,
      rankingLanguage: ranking?.language,
      language,
    })

    // Store the page's language first: whatever ranks this attendee next
    // reads it from their status row.
    const row = await storeSuggestionLanguage(ctx, {
      eventId,
      userId,
      row: storedRow,
      now,
      language,
    })

    switch (decision.kind) {
      case 'wait':
        return 'scheduled'
      case 'eventRun':
        await startEventRun(ctx, { eventId, trigger: decision.trigger, now })
        return 'scheduled'
      case 'ownRank': {
        if (decision.reason === 'missing') {
          await startOwnRank(ctx, { eventId, userId, row, now, language })
          return 'scheduled'
        }
        const timing = decideRerankTiming({
          now,
          lastRequestedAt: row?.suggestionsRequestedAt,
        })
        if (timing.kind === 'now') {
          await startOwnRank(ctx, { eventId, userId, row, now, language })
          return 'scheduled'
        }
        if (timing.kind === 'later' && row) {
          await ctx.db.patch('socialAttendeeStatus', row._id, {
            suggestionsRequestedAt: timing.runAt,
          })
          await ctx.scheduler.runAt(
            timing.runAt,
            internal.social.suggestionsAction.generateForUser,
            { eventId, userId },
          )
        }
        return 'recent'
      }
      case 'checkAttendance': {
        const covered = new Set(run?.attendeeUserIds)
        const ready = await readyAttendeeIds(ctx, eventId)
        if (ready.some((id) => !covered.has(id))) {
          await startEventRun(ctx, {
            eventId,
            trigger: 'attendance',
            now,
            attendeeUserIds: ready,
          })
          return 'scheduled'
        }
        break
      }
      case 'none':
        break
    }

    // Nothing to rank. Assign again when the attendee has a ranking that
    // no assignment settled (a failed or stale one), or is still suggested
    // someone they have met since.
    const unsettled =
      ranking !== null &&
      !isRankInProgress(row, now) &&
      row?.suggestionsStatus !== 'ready' &&
      row?.suggestionsStatus !== 'nobody'
    if (unsettled || (await isSuggestedSomeoneMet(ctx, eventId, userId))) {
      await ctx.scheduler.runAfter(
        0,
        internal.social.suggestions.reassignEventSuggestions,
        { eventId },
      )
    }
    return 'recent'
  },
})

/**
 * Admin: start an event run now, whenever the last one was. While a run is
 * under way this starts nothing. Returns how many attendees the run ranks.
 */
export const generateAllSuggestions = mutation({
  args: { eventId: v.id('socialEvents') },
  returns: v.number(),
  handler: async (ctx, { eventId }) => {
    await requireEventAdmin(ctx, eventId)
    const now = Date.now()
    const run = await latestRun(ctx, eventId)
    if (isRunning(run, now)) return run.attendeeUserIds.length
    return await startEventRun(ctx, { eventId, trigger: 'admin', now })
  },
})

/**
 * Admin: the event's current or last run, or null before its first one. A
 * run that stalls is closed by its timeout check at `timeoutAt`.
 */
export const getSuggestionRun = query({
  args: { eventId: v.id('socialEvents') },
  returns: v.union(
    v.null(),
    v.object({
      status: v.union(v.literal('running'), v.literal('finished')),
      trigger: suggestionRunTriggerValidator,
      startedAt: v.number(),
      finishedAt: v.union(v.number(), v.null()),
      timeoutAt: v.number(),
      total: v.number(),
      succeeded: v.number(),
      failed: v.number(),
      skipped: v.number(),
    }),
  ),
  handler: async (ctx, { eventId }) => {
    await requireEventAdmin(ctx, eventId)
    const run = await latestRun(ctx, eventId)
    if (!run) return null
    return {
      status: run.status,
      trigger: run.trigger,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt ?? null,
      timeoutAt: run.timeoutAt,
      total: run.attendeeUserIds.length,
      succeeded: run.succeeded,
      failed: run.failedUserIds.length,
      skipped: run.skipped,
    }
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
 * Where the caller's suggestions stand: `idle` until a ranking was ever
 * started for them, then the state of their current or last one and when it
 * got there.
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

const sharedProfilePartValidator = v.union(
  v.literal('name'),
  v.literal('headline'),
  v.literal('seeking'),
  v.literal('canHelpWith'),
  v.literal('location'),
  v.literal('linkedin'),
  v.literal('workHistory'),
  v.literal('skills'),
  v.literal('careerGoals'),
  v.literal('interests'),
  v.literal('education'),
)

/**
 * What the caller's profile shares at in-person events, for the event
 * profile page to list: the parts other attendees see, the parts only the
 * suggestions model reads, and the sections left out because the person
 * keeps them private.
 */
export const getMySharedProfileParts = query({
  args: {},
  returns: v.object({
    attendees: v.array(sharedProfilePartValidator),
    suggestionsOnly: v.array(sharedProfilePartValidator),
    hiddenSections: v.array(
      v.union(...PROFILE_SECTIONS.map((section) => v.literal(section))),
    ),
  }),
  handler: async (ctx) => {
    const userId = await getUserId(ctx)
    const visible = attendeeVisibleProfile(
      userId ? await getProfileByUser(ctx, userId) : null,
    )
    return {
      ...sharedProfileParts(visible),
      hiddenSections: visible.hiddenSections,
    }
  },
})
