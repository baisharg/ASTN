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

// How many approved guests the attendee pages read per event (the list of
// people, 1:1 requests and suggestions all start from them).
export const APPROVED_GUESTS_READ_LIMIT = 500

// How many pre-approved people one press of "add to this event" takes. On an
// event linked to Luma each one costs three Luma requests (look up, add,
// read back), and Luma allows 200 requests a minute per calendar.
export const MAX_PREAPPROVED_GUESTS_PER_ADD = 50

// Adding pre-approved people stops when the event would pass this many
// approved guests, which leaves room under APPROVED_GUESTS_READ_LIMIT for
// the people who register afterwards.
export const PREAPPROVED_ADD_APPROVED_LIMIT = 400

/** Whether `email` has the shape of an email address. */
export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

/**
 * What adding the selected pre-approved people to an event does. The
 * selection is the only source of people: nobody on the org's list is added
 * unless they are in `selected`.
 *
 * - `toAdd`: the people who become approved guests, each once.
 * - `alreadyGuest`: selected people who are guests of the event already,
 *   whatever their status (they keep it), or who appear twice in `selected`.
 * - `invalid`: entries that no longer exist (null), belong to another org, or
 *   hold something that is not an email address.
 * - `overLimitBy`: how many more than the event has room for; above 0,
 *   nobody is added.
 *
 * Emails are compared as given: list entries and guest rows both store them
 * lowercased.
 */
export function planPreapprovedAdd(input: {
  orgId: string
  selected: Array<{ orgId: string; email: string; name?: string } | null>
  // Emails of everyone who has a guest row for the event.
  guestEmails: ReadonlySet<string>
  // The event's approved guests right now.
  approvedCount: number
}): {
  toAdd: Array<{ email: string; name?: string }>
  alreadyGuest: number
  invalid: number
  overLimitBy: number
} {
  const toAdd: Array<{ email: string; name?: string }> = []
  const adding = new Set<string>()
  let alreadyGuest = 0
  let invalid = 0
  for (const entry of input.selected) {
    if (!entry || entry.orgId !== input.orgId || !looksLikeEmail(entry.email)) {
      invalid++
    } else if (input.guestEmails.has(entry.email) || adding.has(entry.email)) {
      alreadyGuest++
    } else {
      adding.add(entry.email)
      toAdd.push({ email: entry.email, name: entry.name })
    }
  }
  const room = Math.max(0, PREAPPROVED_ADD_APPROVED_LIMIT - input.approvedCount)
  return {
    toAdd,
    alreadyGuest,
    invalid,
    overLimitBy: Math.max(0, toAdd.length - room),
  }
}
