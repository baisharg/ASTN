/**
 * Limits, error codes and the small rules shared by the social backend and
 * its pages. No imports, so client code can import this file directly.
 */

export const MAX_OUTGOING_PENDING = 5
export const MAX_NOTE_LENGTH = 280
export const DEFAULT_MEETING_MINUTES = 20
// A meeting can run at most this long past its original length.
export const MAX_MEETING_EXTENSION_MINUTES = 15
// Without explicit 1:1 times, they run from the event start for this long
// (or until the event's end, when it has one).
export const DEFAULT_EVENT_HOURS = 6

/** Why a 1:1 action was refused. Sent as ConvexError data `{ code }`. */
export type MeetingErrorCode =
  | 'closed'
  | 'not_attendee'
  | 'self'
  | 'busy'
  | 'limit'
  | 'self_in_meeting'
  | 'they_in_meeting'
  | 'ended'
  | 'extension_limit'
  | 'not_found'

export type MeetingErrorData = { code: MeetingErrorCode; message: string }

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
