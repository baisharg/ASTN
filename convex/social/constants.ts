/**
 * Limits, error codes and the small rules shared by the social backend and
 * its pages. No imports, so client code can import this file directly.
 */

export const MAX_OUTGOING_PENDING = 5
export const MAX_NOTE_LENGTH = 280
// A private note about a person at the event can be this long.
export const MAX_MEETING_NOTE_LENGTH = 2000
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

/**
 * When a pending request expires. Its time to be answered starts once the
 * person asked is free: at `now`, or when the meeting they are in is due to
 * end (`busyUntil`), so a request waiting behind a meeting isn't lost while
 * that meeting runs.
 */
export function requestExpiryTime(
  now: number,
  busyUntil: number | null,
): number {
  return Math.max(now, busyUntil ?? now) + REQUEST_EXPIRY_MS
}

/** Why a 1:1 action was refused. Sent as ConvexError data `{ code }`. */
export type MeetingErrorCode =
  | 'closed'
  | 'not_attendee'
  | 'self'
  | 'self_busy'
  | 'they_unavailable'
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

/**
 * How 1:1 requests relate to suggestions. Counts only the requests that
 * recorded `requesterWasSuggested`; older ones are left out, so an event from
 * before it was recorded shows zeros instead of "none came from a
 * suggestion".
 */
export type SuggestionOutcome = {
  requests: number
  // Requests sent to someone the requester had been suggested.
  requestsToSuggested: number
  // Requests that were accepted, each of which started a meeting.
  meetings: number
  meetingsFromSuggested: number
  // What requestsToSuggested / requests would be if people asked at random:
  // the share of attendee pairs that are a suggestion. Null with fewer than
  // two attendees.
  chanceShare: number | null
}

export function suggestionOutcome(input: {
  requests: Array<{
    status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired'
    requesterWasSuggested?: boolean
  }>
  // Suggestions currently assigned at the event, over all attendees.
  suggestionCount: number
  // Approved attendees with an account.
  attendeeCount: number
}): SuggestionOutcome {
  const tracked = input.requests.filter(
    (r) => r.requesterWasSuggested !== undefined,
  )
  const accepted = tracked.filter((r) => r.status === 'accepted')
  const pairs = input.attendeeCount * (input.attendeeCount - 1)
  return {
    requests: tracked.length,
    requestsToSuggested: tracked.filter((r) => r.requesterWasSuggested).length,
    meetings: accepted.length,
    meetingsFromSuggested: accepted.filter((r) => r.requesterWasSuggested)
      .length,
    chanceShare: pairs > 0 ? Math.min(1, input.suggestionCount / pairs) : null,
  }
}

// How many of a person's finished 1:1s the "Mis reuniones" page lists.
export const MAX_MY_MEETINGS = 100

/**
 * Whether the event shows attendees "Mis reuniones": the list of the 1:1s
 * they had, with a private note per person. Off unless an admin switched it
 * on for the event, so an event nobody touched keeps its pages as they were.
 */
export function showsMyMeetings(event: {
  myMeetingsEnabled?: boolean | null
}): boolean {
  return event.myMeetingsEnabled === true
}

/**
 * One person's finished meetings, most recent first: the ones they asked
 * for and the ones they accepted, merged by when each started and cut at
 * MAX_MY_MEETINGS.
 */
export function latestMeetingsFirst<T extends { startedAt: number }>(
  asked: ReadonlyArray<T>,
  accepted: ReadonlyArray<T>,
): Array<T> {
  return [...asked, ...accepted]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, MAX_MY_MEETINGS)
}

/** How long a finished meeting lasted, in milliseconds. */
export function meetingLengthMs(meeting: {
  startedAt: number
  endedAt: number
}): number {
  return Math.max(0, meeting.endedAt - meeting.startedAt)
}

/**
 * What is stored for a private note the author wrote as `text`: the text
 * without surrounding whitespace, cut at MAX_MEETING_NOTE_LENGTH. Null means
 * there is nothing to keep, so the note is deleted.
 */
export function meetingNoteToStore(text: string): string | null {
  return text.trim().slice(0, MAX_MEETING_NOTE_LENGTH).trimEnd() || null
}
