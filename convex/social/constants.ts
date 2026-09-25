/**
 * Limits and error codes shared by the social backend and its pages. No
 * imports, so client code can import this file directly.
 */

export const MAX_OUTGOING_PENDING = 5
export const MAX_NOTE_LENGTH = 280
export const DEFAULT_MEETING_MINUTES = 20
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
  | 'not_found'

export type MeetingErrorData = { code: MeetingErrorCode; message: string }
