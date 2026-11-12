import { MAX_OUTGOING_PENDING } from '../../convex/social/constants'
import type {
  AttendeeState,
  MeetingErrorCode,
} from '../../convex/social/constants'

/**
 * Pure rules for the attendee's live 1:1 screens: what to show for a given
 * live state and clock reading. No React and no Convex client, so they can be
 * tested directly (social-live.test.ts).
 */

/** How long after a meeting ends the meeting page still says so. */
export const ENDED_CARD_MS = 10 * 60 * 1000

/**
 * Whether a meeting that ended at `endedAt` (server time) is recent enough,
 * by this device's clock, to show "Reunión terminada". A device whose clock
 * runs behind the server sees a time in the future, which counts as recent.
 */
export function endedRecently(endedAt: number, now: number): boolean {
  return now - endedAt < ENDED_CARD_MS
}

// ── Requests ────────────────────────────────────────────────────────────

/**
 * Whole minutes until a request expires, rounded up so "1 min" shows until
 * the last second; 0 once the time has passed.
 */
export function expiryMinutesLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 60_000))
}

/** How long a declined or expired request stays on the requester's screens. */
export const OUTCOME_VISIBLE_MS = 30 * 60 * 1000

/** The outcomes recent enough, by this device's clock, to still show. */
export function visibleOutcomes<T extends { resolvedAt: number }>(
  resolved: ReadonlyArray<T>,
  now: number,
): Array<T> {
  return resolved.filter((r) => now - r.resolvedAt < OUTCOME_VISIBLE_MS)
}

/** Reasons the "meet now" button is disabled, each with its own message. */
export type RequestBlock = Extract<
  MeetingErrorCode,
  | 'closed'
  | 'self_busy'
  | 'they_unavailable'
  | 'declined_recently'
  | 'not_here'
  | 'busy'
  | 'limit'
  | 'self_in_meeting'
  | 'they_in_meeting'
>

/** The part of the viewer's live state that requestBlock reads. */
export type RequestBlockLive = {
  availability: 'available' | 'busy'
  meeting: object | null
  incoming: ReadonlyArray<{ from: { userId: string } }>
  outgoing: ReadonlyArray<object>
  cooldowns: ReadonlyArray<{ userId: string; askAgainAt: number }>
}

/**
 * Why the viewer can't ask `other` to meet right now, or null if they can.
 * Mirrors the checks in requestMeeting: when the other person already asked,
 * sending accepts their request, which needs both people free and the other
 * still available.
 */
export function requestBlock(
  live: RequestBlockLive,
  meetingsOpen: boolean,
  other: { userId: string; state: AttendeeState; here: boolean },
  now: number,
): RequestBlock | null {
  if (!meetingsOpen) return 'closed'
  if (live.incoming.some((r) => r.from.userId === other.userId)) {
    if (live.meeting) return 'self_in_meeting'
    if (other.state === 'in_meeting') return 'they_in_meeting'
    if (other.state === 'busy') return 'they_unavailable'
    return null
  }
  if (live.availability === 'busy') return 'self_busy'
  const declinedMe = live.cooldowns.find((c) => c.userId === other.userId)
  if (declinedMe && declinedMe.askAgainAt > now) return 'declined_recently'
  if (!other.here) return 'not_here'
  if (other.state === 'busy') return 'busy'
  if (live.outgoing.length >= MAX_OUTGOING_PENDING) return 'limit'
  return null
}

// ── Alerts ──────────────────────────────────────────────────────────────

/** What the event layout has already seen of the viewer's live state. */
export type AlertsSeen = {
  /** The event and account this belongs to. */
  key: string
  incomingIds: ReadonlyArray<string>
  meetingId: string | null
}

/**
 * Compare the viewer's live state with what was seen before: which incoming
 * requests are new, and whether a meeting just started. The first state seen
 * for a `key` only sets the baseline, so nothing that was already there when
 * the page loaded alerts.
 */
export function liveAlerts<
  Incoming extends { _id: string },
  Meeting extends { _id: string },
>(
  seen: AlertsSeen | null,
  key: string,
  live: { incoming: ReadonlyArray<Incoming>; meeting: Meeting | null },
): {
  seen: AlertsSeen
  newIncoming: Array<Incoming>
  startedMeeting: Meeting | null
} {
  const incomingIds = live.incoming.map((r) => r._id)
  if (!seen || seen.key !== key) {
    return {
      seen: { key, incomingIds, meetingId: live.meeting?._id ?? null },
      newIncoming: [],
      startedMeeting: null,
    }
  }
  const newIncoming = live.incoming.filter(
    (r) => !seen.incomingIds.includes(r._id),
  )
  const startedMeeting =
    live.meeting && live.meeting._id !== seen.meetingId ? live.meeting : null
  return {
    seen: {
      key,
      // Ids stay seen after their request is gone, so nothing alerts twice.
      incomingIds: [...seen.incomingIds, ...newIncoming.map((r) => r._id)],
      meetingId: live.meeting?._id ?? seen.meetingId,
    },
    newIncoming,
    startedMeeting,
  }
}

/** The tab title while `count` requests wait for the viewer's answer. */
export function titleWithCount(title: string, count: number): string {
  return count > 0 ? `(${count}) ${title}` : title
}

// ── Time's up ───────────────────────────────────────────────────────────

// The job that ends a meeting can run this much before its end time.
const TIME_UP_SLACK_MS = 2000

/** Whether an ended meeting used up its time, as opposed to being ended early. */
export function meetingRanOut(ended: {
  endedAt: number
  endsAt: number
}): boolean {
  return ended.endedAt >= ended.endsAt - TIME_UP_SLACK_MS
}

/** The meeting the meeting page is timing, and whether it signalled its end. */
export type TimeUpWatch = {
  meetingId: string
  endsAt: number
  signalled: boolean
}

/**
 * Whether the meeting page should signal "time's up" now. It does once per
 * meeting and end time, on whichever comes first: this device's clock
 * reaching the end time, or the meeting being ended by the server because
 * its time ran out (the two race, and the device clock may be off). A
 * meeting that was already over when the page opened, or that someone ended
 * early, doesn't signal.
 */
export function watchTimeUp(
  watch: TimeUpWatch | null,
  live: {
    meeting: { _id: string; endsAt: number } | null
    lastEnded: { _id: string; endedAt: number; endsAt: number } | null
  },
  now: number,
): { watch: TimeUpWatch | null; timeUp: boolean } {
  const meeting = live.meeting
  if (meeting) {
    if (
      !watch ||
      watch.meetingId !== meeting._id ||
      watch.endsAt !== meeting.endsAt
    ) {
      // A meeting just opened on this page, or it was extended.
      return {
        watch: {
          meetingId: meeting._id,
          endsAt: meeting.endsAt,
          signalled: now >= meeting.endsAt,
        },
        timeUp: false,
      }
    }
    if (!watch.signalled && now >= meeting.endsAt) {
      return { watch: { ...watch, signalled: true }, timeUp: true }
    }
    return { watch, timeUp: false }
  }
  const ended = live.lastEnded
  const timeUp =
    watch !== null &&
    !watch.signalled &&
    ended !== null &&
    ended._id === watch.meetingId &&
    meetingRanOut(ended)
  return { watch: null, timeUp }
}

// ── Booked 1:1s ─────────────────────────────────────────────────────────

/**
 * The booked 1:1s whose slot is on at `now` and that haven't started: the
 * ones the viewer is asked to go to right now.
 */
export function bookingsDueNow<
  T extends {
    status: 'booked' | 'started'
    slotStart: number
    slotEnd: number
  },
>(bookings: ReadonlyArray<T>, now: number): Array<T> {
  return bookings.filter(
    (b) => b.status === 'booked' && b.slotStart <= now && now < b.slotEnd,
  )
}

/**
 * The proposals that can still be answered, by this device's clock: those
 * whose slot hasn't started. The server expires them at that moment.
 */
export function openProposals<T extends { slotStart: number }>(
  proposals: ReadonlyArray<T>,
  now: number,
): Array<T> {
  return proposals.filter((p) => p.slotStart > now)
}

/** What the event layout has already alerted about the viewer's agenda. */
export type AgendaSeen = {
  /** The event and account this belongs to. */
  key: string
  proposalIds: ReadonlyArray<string>
  dueIds: ReadonlyArray<string>
}

/**
 * Compare the viewer's agenda with what was seen before: which proposals
 * arrived, and which booked 1:1s just reached their slot. The first agenda
 * seen for a `key` sets the baseline for proposals, so the ones that were
 * waiting when the page loaded don't alert; a booked 1:1 whose slot is on
 * alerts even then, because the person has somewhere to be.
 */
export function agendaAlerts<
  Proposal extends { _id: string; slotStart: number },
  Booking extends {
    _id: string
    status: 'booked' | 'started'
    slotStart: number
    slotEnd: number
  },
>(
  seen: AgendaSeen | null,
  key: string,
  agenda: {
    incoming: ReadonlyArray<Proposal>
    bookings: ReadonlyArray<Booking>
  },
  now: number,
): { seen: AgendaSeen; newProposals: Array<Proposal>; due: Array<Booking> } {
  const open = openProposals(agenda.incoming, now)
  const first = !seen || seen.key !== key
  const before: Pick<AgendaSeen, 'proposalIds' | 'dueIds'> = first
    ? { proposalIds: [], dueIds: [] }
    : seen
  const newProposals = first
    ? []
    : open.filter((p) => !before.proposalIds.includes(p._id))
  const due = bookingsDueNow(agenda.bookings, now).filter(
    (b) => !before.dueIds.includes(b._id),
  )
  return {
    seen: {
      key,
      proposalIds: first
        ? open.map((p) => p._id)
        : [...before.proposalIds, ...newProposals.map((p) => p._id)],
      dueIds: [...before.dueIds, ...due.map((b) => b._id)],
    },
    newProposals,
    due,
  }
}
