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
  // Only at events with booking on: a booked 1:1 of the person acting
  // ('self') or of the other one starts too soon for a meeting now, or for
  // more time in the one in progress.
  | 'self_booking_soon'
  | 'they_booking_soon'
  | 'extension_booking'

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

// ── Booked 1:1s (events with `bookingEnabled`) ─────────────────────────

// How long after a slot starts the person who is there waits for the other
// before they can release the booking.
export const NO_SHOW_GRACE_MS = 5 * 60 * 1000
// A meet-now meeting needs at least this long before either person's next
// booked 1:1; with less, it can't start.
export const MIN_MEET_NOW_MS = 5 * 60 * 1000
// Proposals a person can have waiting for an answer at once.
export const MAX_PENDING_PROPOSALS = 10
// No event has more slots than this; only stops a bad window from looping.
const MAX_SLOTS = 500

/** Why a booking action was refused. Sent as ConvexError data `{ code }`. */
export type BookingErrorCode =
  | 'booking_off'
  | 'not_attendee'
  | 'self'
  | 'not_found'
  | 'slot_invalid'
  | 'slot_past'
  | 'self_booked'
  | 'they_booked'
  | 'slot_full'
  | 'already_booked'
  | 'limit'
  | 'proposal_expired'
  | 'not_started'
  | 'slot_over'
  | 'self_in_meeting'
  | 'they_in_meeting'
  | 'release_too_early'

export type BookingErrorData = { code: BookingErrorCode; message: string }

/** A stretch of time: a slot, or the time a booking holds. */
export type TimeSpan = { start: number; end: number }

export function spansOverlap(a: TimeSpan, b: TimeSpan): boolean {
  return a.start < b.end && b.start < a.end
}

/**
 * Whether attendees can book 1:1s at an event: the setting is on and the
 * event is not a draft. Unlike meet-now, booking needs neither the 1:1
 * window to be open nor anyone to be at the event.
 */
export function bookingOpen(event: {
  status: SocialEventStatus
  bookingEnabled?: boolean
}): boolean {
  return event.bookingEnabled === true && event.status !== 'draft'
}

/**
 * The slots of an event: its 1:1 window cut into consecutive stretches of
 * `meetingMinutes`, starting when the window opens. Time left over at the end
 * that doesn't fit a whole slot is not a slot.
 */
export function bookingSlots(
  window: { openAt: number; closeAt: number },
  meetingMinutes: number,
): Array<TimeSpan> {
  const length = meetingMinutes * 60 * 1000
  if (!(length > 0)) return []
  const slots: Array<TimeSpan> = []
  for (
    let start = window.openAt;
    start + length <= window.closeAt && slots.length < MAX_SLOTS;
    start += length
  ) {
    slots.push({ start, end: start + length })
  }
  return slots
}

/** The event's slot that starts at `start`, or null when there is none. */
export function slotStartingAt(
  window: { openAt: number; closeAt: number },
  meetingMinutes: number,
  start: number,
): TimeSpan | null {
  return (
    bookingSlots(window, meetingMinutes).find((s) => s.start === start) ?? null
  )
}

/** A booked 1:1's time and the number of the place reserved for it, if any. */
export type Reservation = TimeSpan & { spotNumber: number | null }

/**
 * Capacity rule. The place a new booking in `slot` gets:
 * - an event with no places at all books without one (`spotNumber` null):
 *   the two people agree where to meet, as a meet-now meeting does when
 *   every place is taken;
 * - otherwise each place holds one booked 1:1 per slot, so an event with S
 *   places books S per slot; the booking gets the highest-numbered place
 *   that is free in the slot (meet-now takes the lowest, so the two rarely
 *   want the same one);
 * - once every place is reserved, the slot is not bookable.
 */
export function placeForBooking(
  spotNumbers: ReadonlyArray<number>,
  slot: TimeSpan,
  reservations: ReadonlyArray<Reservation>,
): { bookable: true; spotNumber: number | null } | { bookable: false } {
  if (spotNumbers.length === 0) return { bookable: true, spotNumber: null }
  const taken = new Set(
    reservations.filter((r) => spansOverlap(r, slot)).map((r) => r.spotNumber),
  )
  const free = spotNumbers.filter((n) => !taken.has(n))
  if (free.length === 0) return { bookable: false }
  return { bookable: true, spotNumber: Math.max(...free) }
}

/** Why a slot can't be proposed between two people, each with its message. */
export type SlotBlock = Extract<
  BookingErrorCode,
  'slot_past' | 'self_booked' | 'they_booked' | 'slot_full'
>

/**
 * Why `slot` can't be booked between two people at `now`, or null when it
 * can: it has to start in the future, both have to be free in it, and it
 * has to have a place left (see placeForBooking).
 */
export function slotBlock(input: {
  slot: TimeSpan
  now: number
  // The booked 1:1s each of the two already has.
  mine: ReadonlyArray<TimeSpan>
  theirs: ReadonlyArray<TimeSpan>
  spotNumbers: ReadonlyArray<number>
  // Every booked 1:1 of the event.
  reservations: ReadonlyArray<Reservation>
}): SlotBlock | null {
  const { slot } = input
  if (slot.start <= input.now) return 'slot_past'
  if (input.mine.some((b) => spansOverlap(b, slot))) return 'self_booked'
  if (input.theirs.some((b) => spansOverlap(b, slot))) return 'they_booked'
  if (!placeForBooking(input.spotNumbers, slot, input.reservations).bookable) {
    return 'slot_full'
  }
  return null
}

/**
 * Whether a proposal can still be answered at `now`: it is waiting and its
 * slot hasn't started. An unanswered proposal expires when its slot starts.
 */
export function proposalOpen(
  proposal: { status: string; slotStart: number },
  now: number,
): boolean {
  return proposal.status === 'proposed' && proposal.slotStart > now
}

/**
 * When a person's next booked 1:1 starts: the earliest start among their
 * bookings that haven't ended at `now`. A time in the past means one is due
 * right now. Null without any.
 */
export function nextBookingStart(
  bookings: ReadonlyArray<TimeSpan>,
  now: number,
): number | null {
  const starts = bookings.filter((b) => b.end > now).map((b) => b.start)
  return starts.length > 0 ? Math.min(...starts) : null
}

/**
 * Meet-now next to a booking. When a meeting that starts at `now` ends, or
 * who keeps it from starting:
 * - with booking off, or when neither person has a booked 1:1 coming, it
 *   runs its full length, as it always did;
 * - otherwise it ends when the first of their booked 1:1s starts, so it
 *   never runs into one;
 * - if that leaves less than MIN_MEET_NOW_MS, it can't start: `blockedBy`
 *   says whose booking is in the way ('self' is the person acting).
 */
export function meetNowWindow(input: {
  bookingEnabled: boolean
  now: number
  meetingMinutes: number
  selfNextBookingAt: number | null
  theirNextBookingAt: number | null
}): { endsAt: number } | { blockedBy: 'self' | 'they' } {
  const fullEnd = input.now + input.meetingMinutes * 60 * 1000
  if (!input.bookingEnabled) return { endsAt: fullEnd }
  const self = input.selfNextBookingAt ?? Infinity
  const they = input.theirNextBookingAt ?? Infinity
  const endsAt = Math.min(fullEnd, self, they)
  if (endsAt === fullEnd) return { endsAt }
  if (endsAt - input.now < MIN_MEET_NOW_MS) {
    return { blockedBy: self <= they ? 'self' : 'they' }
  }
  return { endsAt }
}

/**
 * The places a meeting running from `from` to `to` may not take because a
 * booked 1:1 has them reserved in that time. With booking off, none: a
 * meet-now meeting takes any free place, as it always did.
 */
export function spotsHeldForBookings(input: {
  bookingEnabled: boolean
  reservations: ReadonlyArray<Reservation>
  from: number
  to: number
}): Array<number> {
  if (!input.bookingEnabled) return []
  const time = { start: input.from, end: input.to }
  return input.reservations.flatMap((r) =>
    r.spotNumber !== null && spansOverlap(r, time) ? [r.spotNumber] : [],
  )
}

/**
 * How many of the `granted` extension minutes a meeting ending at `endsAt`
 * gets when the first booked 1:1 of either person starts at
 * `nextBookingAt`: only those that fit before it. With booking off, or no
 * booking coming, all of them.
 */
export function extensionBeforeBooking(input: {
  bookingEnabled: boolean
  granted: number
  endsAt: number
  nextBookingAt: number | null
}): number {
  if (!input.bookingEnabled || input.nextBookingAt === null) {
    return input.granted
  }
  const room = Math.floor((input.nextBookingAt - input.endsAt) / 60_000)
  return Math.max(0, Math.min(input.granted, room))
}

/**
 * Where a booked 1:1 stands for one of its two people at `now`:
 * - upcoming: its slot hasn't started;
 * - confirm: the slot is on and they haven't said they are there;
 * - waiting: they said so and the other hasn't, within NO_SHOW_GRACE_MS of
 *   the slot's start;
 * - can_release: still waiting after that. No-show rule: they can release
 *   the booking and be free again, and the other is told they missed it;
 * - over: the slot ended without the two starting.
 * Once both have said they are there the meeting starts and the booking is
 * no longer 'booked', so there is no stage for it.
 */
export type BookingStage =
  | 'upcoming'
  | 'confirm'
  | 'waiting'
  | 'can_release'
  | 'over'

export function bookingStage(
  booking: TimeSpan & { selfReadyAt: number | null },
  now: number,
): BookingStage {
  if (now < booking.start) return 'upcoming'
  if (now >= booking.end) return 'over'
  if (booking.selfReadyAt === null) return 'confirm'
  return now < booking.start + NO_SHOW_GRACE_MS ? 'waiting' : 'can_release'
}

export type BookingStatus =
  | 'proposed'
  | 'booked'
  | 'started'
  | 'declined'
  | 'withdrawn'
  | 'expired'
  | 'cancelled'
  | 'no_show'

/** What a person is told about a proposal or booking that didn't happen. */
export type BookingNotice = 'declined' | 'expired' | 'cancelled' | 'no_show'

/**
 * The notice `viewerId` gets about a row that ended without a meeting, or
 * null when they get none: the proposer hears that their proposal was
 * declined or expired; the other person hears that a booking was cancelled;
 * the person who wasn't there hears that the other released it. Whoever did
 * it themselves is not told, and neither is anyone once it is dismissed.
 */
export function bookingNoticeFor(
  row: {
    status: BookingStatus
    fromUserId: string
    closedBy?: string
    acknowledgedAt?: number
  },
  viewerId: string,
): BookingNotice | null {
  if (row.acknowledgedAt !== undefined) return null
  switch (row.status) {
    case 'declined':
    case 'expired':
      return row.fromUserId === viewerId ? row.status : null
    case 'cancelled':
    case 'no_show':
      return row.closedBy !== undefined && row.closedBy !== viewerId
        ? row.status
        : null
    default:
      return null
  }
}
