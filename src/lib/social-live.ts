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

/** Reasons the "meet now" button is disabled, each with its own message. */
export type RequestBlock = Extract<
  MeetingErrorCode,
  | 'closed'
  | 'not_here'
  | 'busy'
  | 'limit'
  | 'self_in_meeting'
  | 'they_in_meeting'
>

/** The part of the viewer's live state that requestBlock reads. */
export type RequestBlockLive = {
  meeting: object | null
  incoming: ReadonlyArray<{ from: { userId: string } }>
  outgoing: ReadonlyArray<object>
}

/**
 * Why the viewer can't ask `other` to meet right now, or null if they can.
 * Mirrors the checks in requestMeeting: when the other person already asked,
 * sending accepts their request, which needs both people free.
 */
export function requestBlock(
  live: RequestBlockLive,
  meetingsOpen: boolean,
  other: { userId: string; state: AttendeeState; here: boolean },
): RequestBlock | null {
  if (!meetingsOpen) return 'closed'
  if (live.incoming.some((r) => r.from.userId === other.userId)) {
    if (live.meeting) return 'self_in_meeting'
    if (other.state === 'in_meeting') return 'they_in_meeting'
    return null
  }
  if (!other.here) return 'not_here'
  if (other.state === 'busy') return 'busy'
  if (live.outgoing.length >= MAX_OUTGOING_PENDING) return 'limit'
  return null
}
