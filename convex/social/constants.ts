/**
 * Limits, error codes and the small rules shared by the social backend and
 * its pages. No imports, so client code can import this file directly.
 */

export const MAX_OUTGOING_PENDING = 5
export const MAX_NOTE_LENGTH = 280
export const DEFAULT_MEETING_MINUTES = 20
// A meeting can run at most this long past its original length.
export const MAX_MEETING_EXTENSION_MINUTES = 15
// A request nobody answered expires this long after it was sent.
export const REQUEST_EXPIRY_MS = 10 * 60 * 1000
// After a decline, the same person can't be asked again for this long.
export const DECLINE_COOLDOWN_MS = 10 * 60 * 1000
// Without explicit 1:1 times, they run from the event start for this long
// (or until the event's end, when it has one).
export const DEFAULT_EVENT_HOURS = 6

export type SocialEventStatus = 'draft' | 'published' | 'closed'

/**
 * What an attendee is doing right now. Whether they are at the event at all
 * is a separate boolean (`here`) next to it.
 */
export type AttendeeState = 'available' | 'in_meeting' | 'busy'

/**
 * Whether 1:1s are running at `now`: inside the 1:1 window of an event that
 * is not a draft. A 'closed' event only stopped taking new registrations, so
 * its 1:1s run like a published event's.
 */
export function meetingsOpenNow(
  status: SocialEventStatus,
  window: { openAt: number; closeAt: number },
  now: number,
): boolean {
  return status !== 'draft' && now >= window.openAt && now <= window.closeAt
}

/**
 * Order of the attendee list: people who are at the event first, then by
 * name.
 */
export function compareAttendees(
  a: { here: boolean; name: string },
  b: { here: boolean; name: string },
): number {
  if (a.here !== b.here) return a.here ? -1 : 1
  return a.name.localeCompare(b.name)
}

/**
 * Whether a pending request can no longer be answered at `now`. The
 * scheduled job marks it 'expired' at the same moment; this covers the
 * instant before it has run.
 */
export function requestPastExpiry(
  request: { expiresAt?: number },
  now: number,
): boolean {
  return request.expiresAt !== undefined && request.expiresAt <= now
}

/** Why a 1:1 action was refused. Sent as ConvexError data `{ code }`. */
export type MeetingErrorCode =
  | 'closed'
  | 'not_attendee'
  | 'self'
  | 'not_here'
  | 'declined_recently'
  | 'busy'
  | 'limit'
  | 'request_expired'
  | 'self_in_meeting'
  | 'they_in_meeting'
  | 'ended'
  | 'extension_limit'
  | 'not_found'

export type MeetingErrorData = { code: MeetingErrorCode; message: string }

/** Why a registration was refused. Sent as ConvexError data `{ code }`. */
export type RegisterErrorCode =
  | 'not_authenticated'
  | 'no_email'
  | 'registration_closed'

export type RegisterErrorData = { code: RegisterErrorCode; message: string }

/**
 * How many of the `requested` minutes a meeting that was already extended by
 * `usedMinutes` can still get. 0 means it has reached the limit.
 */
export function extensionMinutesGranted(
  usedMinutes: number,
  requested: number,
): number {
  const left = Math.max(0, MAX_MEETING_EXTENSION_MINUTES - usedMinutes)
  return Math.min(left, Math.max(1, Math.round(requested)))
}
