import { ConvexError, v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalMutation, mutation, query } from '../_generated/server'
import { getUserId, requireAuth } from '../lib/auth'
import {
  MAX_NOTE_LENGTH,
  MAX_PENDING_PROPOSALS,
  bookingNoticeFor,
  bookingOpen,
  bookingSlots,
  bookingStage,
  placeForBooking,
  proposalOpen,
  slotBlock,
  slotStartingAt,
  spansOverlap,
} from './constants'
import {
  attendeeCard,
  bookedRowsAround,
  bookedRowsOf,
  findSuggestion,
  getGuestByUser,
  meetingsWindow,
  reservationOf,
} from './lib'
import { activeMeetingFor, recordArrival, startMeeting } from './meetings'
import type { BookingErrorCode, SlotBlock, TimeSpan } from './constants'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/**
 * 1:1s booked for a set time, at events with `bookingEnabled`. A person
 * proposes one of the event's slots to another, who accepts or declines;
 * an accepted proposal is a booking with a place reserved. When the slot
 * starts each says they are there, and once both have, the meeting starts
 * as a socialMeetings row like any meet-now meeting. The rules are the pure
 * functions in ./constants.
 */

/** Refuse a booking action with a code the pages translate. */
function refuse(code: BookingErrorCode, message: string): never {
  throw new ConvexError({ code, message })
}

const SLOT_BLOCK_MESSAGES: Record<SlotBlock, string> = {
  slot_past: 'That time has already started',
  self_booked: 'You already have a 1:1 booked at that time',
  they_booked: 'They already have a 1:1 booked at that time',
  slot_full: 'That time has no places left',
}

/** The event, when attendees can book 1:1s at it. */
async function requireBookingEvent(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
): Promise<Doc<'socialEvents'>> {
  const event = await ctx.db.get('socialEvents', eventId)
  if (!event) refuse('not_found', 'Event not found')
  if (!bookingOpen(event)) {
    refuse('booking_off', 'Booking 1:1s is not available at this event')
  }
  return event
}

async function isApprovedAttendee(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
  userId: string,
): Promise<boolean> {
  return (await getGuestByUser(ctx, eventId, userId))?.status === 'approved'
}

async function requireApprovedAttendee(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
  userId: string,
): Promise<void> {
  if (!(await isApprovedAttendee(ctx, eventId, userId))) {
    refuse('not_attendee', 'Only confirmed attendees can do this')
  }
}

async function eventSpots(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
): Promise<Array<Doc<'socialEventSpots'>>> {
  return await ctx.db
    .query('socialEventSpots')
    .withIndex('by_eventId_and_number', (q) => q.eq('eventId', eventId))
    .take(200)
}

function slotOf(row: Doc<'socialBookings'>): TimeSpan {
  return { start: row.slotStart, end: row.slotEnd }
}

function partnerOf(row: Doc<'socialBookings'>, userId: string): string {
  return row.fromUserId === userId ? row.toUserId : row.fromUserId
}

// A person's proposals and bookings at one event, read in one go. Far more
// than a person makes; only bounds the read.
const ROWS_PER_PERSON = 300

/** Every row `userId` proposed or was proposed, whatever became of it. */
async function rowsOf(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
  userId: string,
): Promise<Array<Doc<'socialBookings'>>> {
  const [asFrom, asTo] = await Promise.all([
    ctx.db
      .query('socialBookings')
      .withIndex('by_eventId_and_fromUserId_and_status', (q) =>
        q.eq('eventId', eventId).eq('fromUserId', userId),
      )
      .take(ROWS_PER_PERSON),
    ctx.db
      .query('socialBookings')
      .withIndex('by_eventId_and_toUserId_and_status', (q) =>
        q.eq('eventId', eventId).eq('toUserId', userId),
      )
      .take(ROWS_PER_PERSON),
  ])
  return [...asFrom, ...asTo]
}

/** The proposals waiting for an answer that `userId` sent or received. */
async function pendingProposalsOf(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
  userId: string,
): Promise<Array<Doc<'socialBookings'>>> {
  const [sent, received] = await Promise.all([
    ctx.db
      .query('socialBookings')
      .withIndex('by_eventId_and_fromUserId_and_status', (q) =>
        q
          .eq('eventId', eventId)
          .eq('fromUserId', userId)
          .eq('status', 'proposed'),
      )
      .take(ROWS_PER_PERSON),
    ctx.db
      .query('socialBookings')
      .withIndex('by_eventId_and_toUserId_and_status', (q) =>
        q
          .eq('eventId', eventId)
          .eq('toUserId', userId)
          .eq('status', 'proposed'),
      )
      .take(ROWS_PER_PERSON),
  ])
  return [...sent, ...received]
}

/**
 * The time a person is taken: their booked 1:1s, and the meeting they are
 * in right now (which may run into a slot that is about to start).
 */
async function takenTimesOf(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
  userId: string,
  booked: Array<Doc<'socialBookings'>>,
): Promise<Array<TimeSpan>> {
  const meeting = await activeMeetingFor(ctx, eventId, userId)
  return [
    ...booked.map(slotOf),
    ...(meeting ? [{ start: meeting.startedAt, end: meeting.endsAt }] : []),
  ]
}

/**
 * Whether `slot` can be booked between `selfId` and `otherId` at `now`, and
 * the place it would get. `alreadyBooked` is true when the two already have
 * a booked 1:1 together that hasn't ended: one at a time per pair.
 */
async function slotAvailability(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
  slot: TimeSpan,
  selfId: string,
  otherId: string,
  now: number,
) {
  const [mine, theirs, around, spots] = await Promise.all([
    bookedRowsOf(ctx, eventId, selfId),
    bookedRowsOf(ctx, eventId, otherId),
    bookedRowsAround(ctx, eventId, slot.start, slot.end),
    eventSpots(ctx, eventId),
  ])
  const spotNumbers = spots.map((s) => s.number)
  const reservations = around.map(reservationOf)
  return {
    alreadyBooked: mine.some(
      (row) => partnerOf(row, selfId) === otherId && row.slotEnd > now,
    ),
    block: slotBlock({
      slot,
      now,
      mine: await takenTimesOf(ctx, eventId, selfId, mine),
      theirs: await takenTimesOf(ctx, eventId, otherId, theirs),
      spotNumbers,
      reservations,
    }),
    place: placeForBooking(spotNumbers, slot, reservations),
  }
}

/**
 * Turn a proposal into a booking: `row.toUserId` accepts it. Both must still
 * be free in the slot and the slot must have a place left. The other
 * proposals for that time to or from either of the two expire, since none of
 * them can be accepted any more.
 */
export async function acceptProposal(
  ctx: MutationCtx,
  row: Doc<'socialBookings'>,
): Promise<void> {
  const now = Date.now()
  if (!proposalOpen(row, now)) {
    refuse('proposal_expired', 'This proposal has expired')
  }
  await requireApprovedAttendee(ctx, row.eventId, row.fromUserId)
  const slot = slotOf(row)
  const { alreadyBooked, block, place } = await slotAvailability(
    ctx,
    row.eventId,
    slot,
    row.toUserId,
    row.fromUserId,
    now,
  )
  if (alreadyBooked) {
    refuse('already_booked', 'You two already have a 1:1 booked')
  }
  if (block) refuse(block, SLOT_BLOCK_MESSAGES[block])
  if (!place.bookable) refuse('slot_full', SLOT_BLOCK_MESSAGES.slot_full)

  await ctx.db.patch('socialBookings', row._id, {
    status: 'booked',
    spotNumber: place.spotNumber ?? undefined,
    respondedAt: now,
  })
  const others = [
    ...(await pendingProposalsOf(ctx, row.eventId, row.fromUserId)),
    ...(await pendingProposalsOf(ctx, row.eventId, row.toUserId)),
  ]
  const expired = new Set<Id<'socialBookings'>>([row._id])
  for (const other of others) {
    if (expired.has(other._id) || !spansOverlap(slotOf(other), slot)) continue
    expired.add(other._id)
    await ctx.db.patch('socialBookings', other._id, {
      status: 'expired',
      respondedAt: now,
    })
  }
}

/** The caller's row when they are one of its two people. */
async function requireOwnRow(
  ctx: MutationCtx,
  bookingId: Id<'socialBookings'>,
): Promise<{ row: Doc<'socialBookings'>; userId: string }> {
  const userId = await requireAuth(ctx)
  const row = await ctx.db.get('socialBookings', bookingId)
  if (!row || (row.fromUserId !== userId && row.toUserId !== userId)) {
    refuse('not_found', 'Booking not found')
  }
  return { row, userId }
}

// ── Queries ─────────────────────────────────────────────────────────────

const cardValidator = v.object({
  userId: v.string(),
  name: v.string(),
  initials: v.string(),
  headline: v.union(v.string(), v.null()),
})

const proposalValidator = v.object({
  _id: v.id('socialBookings'),
  // The other person: who proposed it, or who it was proposed to.
  partner: cardValidator,
  slotStart: v.number(),
  slotEnd: v.number(),
  note: v.union(v.string(), v.null()),
  createdAt: v.number(),
})

/**
 * The caller's booked 1:1s in time order, the proposals waiting on either
 * side, and what they haven't been told yet about ones that fell through.
 * Null unless they are an approved attendee of an event with booking on.
 * Nothing here depends on the time: the pages compare with their own clock
 * (a proposal whose slot started, a booking whose slot is on or over).
 */
export const getMyAgenda = query({
  args: { eventId: v.id('socialEvents') },
  returns: v.union(
    v.null(),
    v.object({
      bookings: v.array(
        v.object({
          _id: v.id('socialBookings'),
          partner: cardValidator,
          slotStart: v.number(),
          slotEnd: v.number(),
          // 'started' once both said they were there; `meetingId` is then
          // the meeting, in progress or over.
          status: v.union(v.literal('booked'), v.literal('started')),
          meetingId: v.union(v.id('socialMeetings'), v.null()),
          // The reserved place; null when the booking has none.
          spot: v.union(
            v.null(),
            v.object({
              number: v.number(),
              label: v.union(v.string(), v.null()),
            }),
          ),
          // Why the caller was suggested this person, when they were.
          why: v.union(v.string(), v.null()),
          topics: v.array(v.string()),
          // When each said, during the slot, that they are there.
          selfReadyAt: v.union(v.number(), v.null()),
          partnerReadyAt: v.union(v.number(), v.null()),
        }),
      ),
      incoming: v.array(proposalValidator),
      outgoing: v.array(proposalValidator),
      notices: v.array(
        v.object({
          _id: v.id('socialBookings'),
          partner: cardValidator,
          slotStart: v.number(),
          kind: v.union(
            v.literal('declined'),
            v.literal('expired'),
            v.literal('cancelled'),
            v.literal('no_show'),
          ),
        }),
      ),
    }),
  ),
  handler: async (ctx, { eventId }) => {
    const userId = await getUserId(ctx)
    if (!userId) return null
    const event = await ctx.db.get('socialEvents', eventId)
    if (!event || !bookingOpen(event)) return null
    if (!(await isApprovedAttendee(ctx, eventId, userId))) return null

    const [rows, spots] = await Promise.all([
      rowsOf(ctx, eventId, userId),
      eventSpots(ctx, eventId),
    ])
    const byStart = (a: { slotStart: number }, b: { slotStart: number }) =>
      a.slotStart - b.slotStart
    const card = (row: Doc<'socialBookings'>) =>
      attendeeCard(ctx, eventId, partnerOf(row, userId))

    const bookings = await Promise.all(
      rows
        .filter((row) => row.status === 'booked' || row.status === 'started')
        .map(async (row) => {
          const partnerId = partnerOf(row, userId)
          const fromSelf = row.fromUserId === userId
          const spot = spots.find((s) => s.number === row.spotNumber)
          const [mine, theirs] = await Promise.all([
            findSuggestion(ctx, eventId, userId, partnerId),
            findSuggestion(ctx, eventId, partnerId, userId),
          ])
          return {
            _id: row._id,
            partner: await card(row),
            slotStart: row.slotStart,
            slotEnd: row.slotEnd,
            status:
              row.status === 'started'
                ? ('started' as const)
                : ('booked' as const),
            meetingId: row.meetingId ?? null,
            spot: spot
              ? { number: spot.number, label: spot.label ?? null }
              : null,
            why: mine?.reason ?? null,
            topics: mine?.topics ?? theirs?.topics ?? [],
            selfReadyAt: (fromSelf ? row.fromReadyAt : row.toReadyAt) ?? null,
            partnerReadyAt:
              (fromSelf ? row.toReadyAt : row.fromReadyAt) ?? null,
          }
        }),
    )

    const proposal = async (row: Doc<'socialBookings'>) => ({
      _id: row._id,
      partner: await card(row),
      slotStart: row.slotStart,
      slotEnd: row.slotEnd,
      note: row.note ?? null,
      createdAt: row.createdAt,
    })
    const pending = rows.filter((row) => row.status === 'proposed')

    const notices = await Promise.all(
      rows.flatMap((row) => {
        const kind = bookingNoticeFor(row, userId)
        if (kind === null) return []
        return [
          (async () => ({
            _id: row._id,
            partner: await card(row),
            slotStart: row.slotStart,
            kind,
          }))(),
        ]
      }),
    )

    return {
      bookings: bookings.sort(byStart),
      incoming: (
        await Promise.all(
          pending.filter((row) => row.toUserId === userId).map(proposal),
        )
      ).sort(byStart),
      outgoing: (
        await Promise.all(
          pending.filter((row) => row.fromUserId === userId).map(proposal),
        )
      ).sort(byStart),
      notices: notices.sort(byStart),
    }
  },
})

/**
 * The event's slots, each with why the caller can't book it with
 * `withUserId` (null when they can): one of them is taken at that time (a
 * booked 1:1, or the meeting they are in), or the slot has no places left. Which slots have already started is left to
 * the page's clock. Null unless both are approved attendees of an event
 * with booking on.
 */
export const getSlotsWith = query({
  args: { eventId: v.id('socialEvents'), withUserId: v.string() },
  returns: v.union(
    v.null(),
    v.array(
      v.object({
        start: v.number(),
        end: v.number(),
        block: v.union(
          v.null(),
          v.literal('self_booked'),
          v.literal('they_booked'),
          v.literal('slot_full'),
        ),
      }),
    ),
  ),
  handler: async (ctx, { eventId, withUserId }) => {
    const userId = await getUserId(ctx)
    if (!userId || userId === withUserId) return null
    const event = await ctx.db.get('socialEvents', eventId)
    if (!event || !bookingOpen(event)) return null
    if (
      !(await isApprovedAttendee(ctx, eventId, userId)) ||
      !(await isApprovedAttendee(ctx, eventId, withUserId))
    ) {
      return null
    }

    const slots = bookingSlots(meetingsWindow(event), event.meetingMinutes)
    if (slots.length === 0) return []
    const [mine, theirs, booked, spots] = await Promise.all([
      bookedRowsOf(ctx, eventId, userId),
      bookedRowsOf(ctx, eventId, withUserId),
      bookedRowsAround(
        ctx,
        eventId,
        slots[0].start,
        slots[slots.length - 1].end,
      ),
      eventSpots(ctx, eventId),
    ])
    const input = {
      // Every slot counts as still to come: the page hides the ones that
      // started.
      now: Number.NEGATIVE_INFINITY,
      mine: await takenTimesOf(ctx, eventId, userId, mine),
      theirs: await takenTimesOf(ctx, eventId, withUserId, theirs),
      spotNumbers: spots.map((s) => s.number),
      reservations: booked.map(reservationOf),
    }
    return slots.map((slot) => {
      const block = slotBlock({ ...input, slot })
      return { ...slot, block: block === 'slot_past' ? null : block }
    })
  },
})

// ── Mutations ───────────────────────────────────────────────────────────

/**
 * Propose one of the event's slots to another attendee. Neither has to be
 * at the event, and it works before the event starts. If they already
 * proposed that slot to the caller, this accepts it. A new proposal to
 * someone replaces the caller's earlier one to them that is still waiting.
 */
export const propose = mutation({
  args: {
    eventId: v.id('socialEvents'),
    toUserId: v.string(),
    slotStart: v.number(),
    note: v.optional(v.string()),
  },
  returns: v.object({
    bookingId: v.id('socialBookings'),
    // True when this accepted their proposal for the same slot.
    booked: v.boolean(),
  }),
  handler: async (ctx, { eventId, toUserId, slotStart, note }) => {
    const userId = await requireAuth(ctx)
    if (toUserId === userId) refuse('self', "You can't meet yourself")
    const event = await requireBookingEvent(ctx, eventId)
    await requireApprovedAttendee(ctx, eventId, userId)
    await requireApprovedAttendee(ctx, eventId, toUserId)

    const slot = slotStartingAt(
      meetingsWindow(event),
      event.meetingMinutes,
      slotStart,
    )
    if (!slot) refuse('slot_invalid', 'That is not one of the event’s times')
    const now = Date.now()

    const pending = await pendingProposalsOf(ctx, eventId, userId)
    const reverse = pending.find(
      (row) =>
        row.fromUserId === toUserId &&
        row.slotStart === slot.start &&
        proposalOpen(row, now),
    )
    if (reverse) {
      await acceptProposal(ctx, reverse)
      return { bookingId: reverse._id, booked: true }
    }

    const { alreadyBooked, block } = await slotAvailability(
      ctx,
      eventId,
      slot,
      userId,
      toUserId,
      now,
    )
    if (alreadyBooked) {
      refuse('already_booked', 'You two already have a 1:1 booked')
    }
    if (block) refuse(block, SLOT_BLOCK_MESSAGES[block])

    const sent = pending.filter(
      (row) => row.fromUserId === userId && proposalOpen(row, now),
    )
    const earlier = sent.filter((row) => row.toUserId === toUserId)
    const same = earlier.find((row) => row.slotStart === slot.start)
    if (same) return { bookingId: same._id, booked: false }
    if (sent.length - earlier.length >= MAX_PENDING_PROPOSALS) {
      refuse(
        'limit',
        `You can have at most ${MAX_PENDING_PROPOSALS} proposals waiting at once`,
      )
    }
    for (const row of earlier) {
      await ctx.db.patch('socialBookings', row._id, {
        status: 'withdrawn',
        respondedAt: now,
      })
    }

    const bookingId = await ctx.db.insert('socialBookings', {
      eventId,
      fromUserId: userId,
      toUserId,
      slotStart: slot.start,
      slotEnd: slot.end,
      note: note?.trim().slice(0, MAX_NOTE_LENGTH) || undefined,
      status: 'proposed',
      createdAt: now,
    })
    await ctx.scheduler.runAt(
      slot.start,
      internal.social.bookings.expireProposalIfDue,
      { bookingId },
    )
    return { bookingId, booked: false }
  },
})

/** Accept or decline a proposal the caller received. */
export const respond = mutation({
  args: { bookingId: v.id('socialBookings'), accept: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { bookingId, accept }) => {
    const { row, userId } = await requireOwnRow(ctx, bookingId)
    if (row.toUserId !== userId) refuse('not_found', 'Booking not found')
    await requireBookingEvent(ctx, row.eventId)
    await requireApprovedAttendee(ctx, row.eventId, userId)
    if (accept) {
      // Accepting twice is fine; accepting what is gone is not.
      if (row.status === 'booked' || row.status === 'started') return null
      await acceptProposal(ctx, row)
      return null
    }
    if (row.status !== 'proposed') return null
    const now = Date.now()
    await ctx.db.patch('socialBookings', bookingId, {
      status: 'declined',
      respondedAt: now,
      closedBy: userId,
      closedAt: now,
    })
    return null
  },
})

/** Take back a proposal the caller sent that is still waiting. */
export const withdrawProposal = mutation({
  args: { bookingId: v.id('socialBookings') },
  returns: v.null(),
  handler: async (ctx, { bookingId }) => {
    const { row, userId } = await requireOwnRow(ctx, bookingId)
    if (row.fromUserId !== userId) refuse('not_found', 'Booking not found')
    if (row.status !== 'proposed') return null
    await ctx.db.patch('socialBookings', bookingId, {
      status: 'withdrawn',
      respondedAt: Date.now(),
    })
    return null
  },
})

/**
 * Call off a booked 1:1 that hasn't started. Either of the two can; the
 * other is told. Its place and both people's time are free again.
 */
export const cancelBooking = mutation({
  args: { bookingId: v.id('socialBookings') },
  returns: v.null(),
  handler: async (ctx, { bookingId }) => {
    const { row, userId } = await requireOwnRow(ctx, bookingId)
    if (row.status !== 'booked') return null
    await ctx.db.patch('socialBookings', bookingId, {
      status: 'cancelled',
      closedBy: userId,
      closedAt: Date.now(),
    })
    return null
  },
})

/**
 * "Ya estoy": during the slot, the caller says they are at the place. Once
 * both have, the meeting starts (a socialMeetings row that ends with the
 * slot, at the reserved place when it is free) and its id is returned; until
 * then null.
 */
export const confirmHere = mutation({
  args: { bookingId: v.id('socialBookings') },
  returns: v.union(v.id('socialMeetings'), v.null()),
  handler: async (ctx, { bookingId }) => {
    const { row, userId } = await requireOwnRow(ctx, bookingId)
    if (row.status === 'started') return row.meetingId ?? null
    if (row.status !== 'booked') refuse('not_found', 'Booking not found')
    const event = await requireBookingEvent(ctx, row.eventId)
    await requireApprovedAttendee(ctx, row.eventId, userId)

    const now = Date.now()
    const fromSelf = row.fromUserId === userId
    const stage = bookingStage(
      {
        ...slotOf(row),
        selfReadyAt: (fromSelf ? row.fromReadyAt : row.toReadyAt) ?? null,
      },
      now,
    )
    if (stage === 'upcoming') {
      refuse('not_started', 'This 1:1 has not started yet')
    }
    if (stage === 'over') refuse('slot_over', 'The time for this 1:1 is over')
    if (await activeMeetingFor(ctx, row.eventId, userId)) {
      refuse('self_in_meeting', 'Finish your current meeting first')
    }

    // Saying so means being at the event.
    await recordArrival(ctx, row.eventId, userId)
    const ready = fromSelf ? { fromReadyAt: now } : { toReadyAt: now }
    const partnerId = partnerOf(row, userId)
    const partnerReady = fromSelf ? row.toReadyAt : row.fromReadyAt
    if (partnerReady === undefined) {
      if (stage === 'confirm') {
        await ctx.db.patch('socialBookings', bookingId, ready)
      }
      return null
    }
    if (await activeMeetingFor(ctx, row.eventId, partnerId)) {
      refuse('they_in_meeting', 'They are in a meeting right now')
    }
    // The one who was waiting is told; the caller is already looking.
    const meetingId = await startMeeting(ctx, event, partnerId, userId, {
      endsAt: row.slotEnd,
      bookingId,
      reservedSpotNumber: row.spotNumber,
    })
    await ctx.db.patch('socialBookings', bookingId, {
      ...ready,
      status: 'started',
      meetingId,
    })
    return meetingId
  },
})

/**
 * No-show: the caller said they were there, the other didn't within
 * NO_SHOW_GRACE_MS of the slot's start, so the caller releases the booking
 * and is free again. The other is told they missed it.
 */
export const releaseNoShow = mutation({
  args: { bookingId: v.id('socialBookings') },
  returns: v.null(),
  handler: async (ctx, { bookingId }) => {
    const { row, userId } = await requireOwnRow(ctx, bookingId)
    if (row.status !== 'booked') return null
    const now = Date.now()
    const selfReadyAt =
      (row.fromUserId === userId ? row.fromReadyAt : row.toReadyAt) ?? null
    if (bookingStage({ ...slotOf(row), selfReadyAt }, now) !== 'can_release') {
      refuse(
        'release_too_early',
        'You can release it a few minutes after saying you are there',
      )
    }
    await ctx.db.patch('socialBookings', bookingId, {
      status: 'no_show',
      closedBy: userId,
      closedAt: now,
    })
    return null
  },
})

/** The caller has seen the notice about a row that fell through. */
export const dismissNotice = mutation({
  args: { bookingId: v.id('socialBookings') },
  returns: v.null(),
  handler: async (ctx, { bookingId }) => {
    const { row, userId } = await requireOwnRow(ctx, bookingId)
    if (bookingNoticeFor(row, userId) !== null) {
      await ctx.db.patch('socialBookings', bookingId, {
        acknowledgedAt: Date.now(),
      })
    }
    return null
  },
})

/**
 * Scheduled for a proposal's slot start; no-op if it was answered or taken
 * back first.
 */
export const expireProposalIfDue = internalMutation({
  args: { bookingId: v.id('socialBookings') },
  returns: v.null(),
  handler: async (ctx, { bookingId }) => {
    const row = await ctx.db.get('socialBookings', bookingId)
    if (!row || row.status !== 'proposed') return null
    const now = Date.now()
    // The scheduler can run a moment early.
    if (proposalOpen(row, now + 1000)) return null
    await ctx.db.patch('socialBookings', bookingId, {
      status: 'expired',
      respondedAt: now,
    })
    return null
  },
})
