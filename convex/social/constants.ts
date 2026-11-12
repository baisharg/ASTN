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

// ── Personal links ──────────────────────────────────────────────────────
// A personal link is the event page's address with a Clerk sign-in token in
// its fragment. Whoever opens it is signed in as the guest it was made for,
// so the token is a credential: single-use, short-lived, never stored.

/** The key of the sign-in token in a personal link's fragment. */
export const SIGN_IN_TICKET_PARAM = 'ticket'

/** How many guests one call may make personal links for. */
export const PERSONAL_LINKS_PER_CALL = 10

const HOUR_SECONDS = 3600
// A link made after (or just before) the end of the 1:1s still works this long.
export const PERSONAL_LINK_MIN_SECONDS = HOUR_SECONDS
// A link never works longer than this, however far away the event is.
export const PERSONAL_LINK_MAX_SECONDS = 7 * 24 * HOUR_SECONDS

/**
 * How long a personal link made at `now` works, in seconds: until the event's
 * 1:1s close, but at least PERSONAL_LINK_MIN_SECONDS and at most
 * PERSONAL_LINK_MAX_SECONDS. A link sent two days before the event is still
 * good on the day, and none outlives the event by more than the minimum.
 */
export function personalLinkLifetimeSeconds(
  now: number,
  meetingsCloseAt: number,
): number {
  const untilClose = Math.ceil((meetingsCloseAt - now) / 1000)
  return Math.min(
    PERSONAL_LINK_MAX_SECONDS,
    Math.max(PERSONAL_LINK_MIN_SECONDS, untilClose),
  )
}

/** The address of an event's page. */
export function eventPageUrl(
  baseUrl: string,
  orgSlug: string,
  eventSlug: string,
): string {
  const base = baseUrl.replace(/\/+$/, '')
  return `${base}/org/${encodeURIComponent(orgSlug)}/e/${encodeURIComponent(eventSlug)}`
}

/**
 * The event page's address carrying a sign-in token. The token goes in the
 * fragment, which browsers send neither to the server nor in a referrer.
 */
export function personalEventLink(eventUrl: string, ticket: string): string {
  return `${eventUrl}#${SIGN_IN_TICKET_PARAM}=${encodeURIComponent(ticket)}`
}

/**
 * Why a guest gets no personal link:
 * - `account_in_use`: someone has signed in to the account with their email.
 *   It is theirs; nobody else is given a way in.
 * - `email_not_primary`: an account has their email, but not as its verified
 *   primary address, which is the one the site knows an account by.
 * - `account_has_role`: the account administers an organization or the
 *   platform.
 * - `email_has_other_data`: signing in with their email for the first time
 *   would attach data from outside this event's organization to the account
 *   (an account from before the move to Clerk, or applications sent to
 *   another organization without an account).
 */
export type PersonalLinkRefusal =
  | 'account_in_use'
  | 'email_not_primary'
  | 'account_has_role'
  | 'email_has_other_data'

/** What is known about the account a personal link would sign in to. */
export type PersonalLinkAccount =
  // No account has the guest's email: one is created.
  | { kind: 'none' }
  | {
      kind: 'existing'
      // The guest's email is the account's primary address and is verified.
      emailIsVerifiedPrimary: boolean
      // Someone has signed in to the account at least once.
      hasSignedIn: boolean
      // The account is an admin of any organization or of the platform.
      hasAdminRole: boolean
    }

/**
 * Whether a guest may get a personal link, as the reason they may not, or
 * null when they may. A link is only ever made for an account nobody has
 * signed in to, holding nothing from outside the event's organization: an
 * event admin chooses who is on the guest list, so being on it proves
 * nothing about who owns the email.
 */
export function personalLinkRefusal(input: {
  account: PersonalLinkAccount
  emailHasOtherData: boolean
}): PersonalLinkRefusal | null {
  const { account } = input
  if (account.kind === 'existing') {
    if (!account.emailIsVerifiedPrimary) return 'email_not_primary'
    if (account.hasSignedIn) return 'account_in_use'
    if (account.hasAdminRole) return 'account_has_role'
  }
  if (input.emailHasOtherData) return 'email_has_other_data'
  return null
}

/**
 * A guest's name as the first and last name of a new account: the first word
 * and the rest. No name gives no names.
 */
export function splitGuestName(name: string | undefined | null): {
  firstName?: string
  lastName?: string
} {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return {}
  if (words.length === 1) return { firstName: words[0] }
  return { firstName: words[0], lastName: words.slice(1).join(' ') }
}
