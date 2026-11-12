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

// How many approved guests the attendee pages read per event (the list of
// people, 1:1 requests and suggestions all start from them).
export const APPROVED_GUESTS_READ_LIMIT = 500

// How many pre-approved people one press of "add to this event" takes. On an
// event linked to Luma each one costs up to four Luma requests (the
// calendar check when its hourly cache has run out, look up, add, read
// back). Luma allows 200 requests a minute per calendar, so one press uses
// at most 160 and leaves the rest for the guest pulls.
export const MAX_PREAPPROVED_GUESTS_PER_ADD = 40

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

// ── Personal links ──────────────────────────────────────────────────────
// A personal link is the event page's address with a Clerk sign-in token in
// its fragment. Whoever opens it is signed in as the guest it was made for,
// so the token is a credential: single-use, short-lived, never stored.

/** The key of the sign-in token in a personal link's fragment. */
export const SIGN_IN_TICKET_PARAM = 'ticket'

/** How many guests one call may make personal links for. */
export const PERSONAL_LINKS_PER_CALL = 10

const HOUR_SECONDS = 3600
// A link made shortly before the 1:1s close still works this long. (Once
// they have closed, no link is made for the event.)
export const PERSONAL_LINK_MIN_SECONDS = HOUR_SECONDS
// A link never works longer than this, however far away the event is.
export const PERSONAL_LINK_MAX_SECONDS = 7 * 24 * HOUR_SECONDS

/**
 * How long a personal link made at `now` works, in seconds: until the event's
 * 1:1s close, but at least PERSONAL_LINK_MIN_SECONDS and at most
 * PERSONAL_LINK_MAX_SECONDS. A link sent two days before the event is still
 * good on the day, and none outlives the 1:1s by more than the minimum.
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
 * - `account_in_use`: Clerk has a sign-in, activity or a session on record
 *   for the account with their email, or the site holds data for it (see
 *   `getAccountFacts` in convex/social/events.ts for which). It is theirs;
 *   nobody else is given a way in. This includes an account a personal link
 *   was already used on.
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
      // Clerk has a sign-in, activity or a session on record for the account.
      hasSignedIn: boolean
      // The site holds data keyed by the account.
      hasAstnData: boolean
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
    if (account.hasAdminRole) return 'account_has_role'
    if (account.hasSignedIn || account.hasAstnData) return 'account_in_use'
  }
  if (input.emailHasOtherData) return 'email_has_other_data'
  return null
}

/** What the personal link log holds about one attempt to make a link. */
type PersonalLinkLogRow<LogId> = {
  _id: LogId
  createdAt: number
  expiresAt: number
  finishedAt?: number
  signInTokenId?: string
  tokenClosedAt?: number
}

// How long an attempt that has not ended keeps a second one for the same
// email from starting. One guest's link takes a few requests to Clerk, well
// under this. An attempt older than this is ended by the next one.
export const PERSONAL_LINK_IN_FLIGHT_MS = 2 * 60 * 1000

/** How many attempts one email may have within PERSONAL_LINK_MAX_SECONDS. */
export const PERSONAL_LINK_ATTEMPTS_BOUND = 200

// Convex stops an action after this long (docs.convex.dev/functions/actions).
const CONVEX_ACTION_LIMIT_MS = 10 * 60 * 1000

/**
 * How long after an attempt starts it is settled (see
 * `personalLinkSettlement`): late enough that the call which started it has
 * returned or been stopped.
 */
export const PERSONAL_LINK_SETTLE_AFTER_MS =
  CONVEX_ACTION_LIMIT_MS + 2 * 60 * 1000

/**
 * Why a new attempt for an email does not start, or null when it does:
 * another one is in flight, or the email has had as many attempts as the log
 * is read for (the earlier links could not all be found and revoked).
 */
export function personalLinkStartRefusal<LogId>(
  rows: ReadonlyArray<PersonalLinkLogRow<LogId>>,
  now: number,
): 'link_in_progress' | 'too_many_links' | null {
  if (rows.length >= PERSONAL_LINK_ATTEMPTS_BOUND) return 'too_many_links'
  return personalLinkInFlight(rows, now) ? 'link_in_progress' : null
}

/**
 * Whether an attempt ended with its link released to the admin. Only such an
 * attempt's token is meant to keep working.
 */
export function personalLinkWasReleased(row: {
  finishedAt?: number
  noLinkReason?: string
}): boolean {
  return row.finishedAt !== undefined && row.noLinkReason === undefined
}

/**
 * What is left to do for an attempt once the call that started it is over.
 * - `withdraw`: its link was not released, because it was refused, its call
 *   failed or died, or a later attempt ended it. Nobody holds the link: the
 *   attempt is ended if it is still open, and its token revoked if it has
 *   one that may work.
 * - `findAccount`: it asked Clerk to create an account and never recorded
 *   which one, so Clerk is asked whether the email has an account now.
 */
export function personalLinkSettlement(row: {
  finishedAt?: number
  noLinkReason?: string
  accountCreationStartedAt?: number
  accountUserId?: string
}): { withdraw: boolean; findAccount: boolean } {
  return {
    withdraw: !personalLinkWasReleased(row),
    findAccount:
      row.accountCreationStartedAt !== undefined &&
      row.accountUserId === undefined,
  }
}

/**
 * Why no personal link is made for an event right now, or null: guests can't
 * open a draft's page, and an event whose 1:1s have closed has nothing left
 * to sign in for.
 */
export function personalLinkEventRefusal(
  event: { status: string },
  meetingsCloseAt: number,
  now: number,
): 'draft' | 'meetings_closed' | null {
  if (event.status === 'draft') return 'draft'
  return now >= meetingsCloseAt ? 'meetings_closed' : null
}

/**
 * Whether a link for the same email is being made right now, by this or
 * another admin. While one is, no second one is started, so an account never
 * gets two links from calls that overlap.
 */
export function personalLinkInFlight<LogId>(
  rows: ReadonlyArray<PersonalLinkLogRow<LogId>>,
  now: number,
): boolean {
  return rows.some(
    (row) =>
      row.finishedAt === undefined &&
      now - row.createdAt < PERSONAL_LINK_IN_FLIGHT_MS,
  )
}

/**
 * The sign-in tokens among `rows` that may still work: made, not expired,
 * and not known to be used or revoked. These are revoked before a new link
 * is made for the same email, and when the account's owner signs in.
 */
export function openPersonalLinkTokens<LogId>(
  rows: ReadonlyArray<PersonalLinkLogRow<LogId>>,
  now: number,
): Array<{ logId: LogId; signInTokenId: string }> {
  return rows.flatMap((row) =>
    row.signInTokenId !== undefined &&
    row.tokenClosedAt === undefined &&
    row.expiresAt > now
      ? [{ logId: row._id, signInTokenId: row.signInTokenId }]
      : [],
  )
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
