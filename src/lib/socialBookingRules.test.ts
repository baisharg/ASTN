import {
  MIN_MEET_NOW_MS,
  NO_SHOW_GRACE_MS,
  bookingNoticeFor,
  bookingOpen,
  bookingSlots,
  bookingStage,
  extensionBeforeBooking,
  extensionMinutesGranted,
  meetNowWindow,
  nextBookingStart,
  placeForBooking,
  proposalOpen,
  slotBlock,
  slotStartingAt,
  spotsHeldForBookings,
} from '../../convex/social/constants'

// The rules for booked 1:1s in convex/social/constants.ts: the slots of an
// event, capacity, meet-now next to a booking, and no-shows. The backend
// (convex/social/bookings.ts and the meet-now path in meetings.ts) enforces
// them and the pages mirror them.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

const MIN = 60_000
// 16:00 on some day; only differences matter.
const T0 = 1_000 * MIN
const at = (minutes: number) => T0 + minutes * MIN
const span = (from: number, to: number) => ({ start: at(from), end: at(to) })
const reserved = (from: number, to: number, spotNumber: number | null) => ({
  ...span(from, to),
  spotNumber,
})

describe('with booking off, the meet-now rules are the ones from before', () => {
  // The same situations with the setting on give other answers (below), so
  // these state what `bookingEnabled: false` keeps unchanged.
  const bookingInTenMinutes = at(10)

  test('a meeting runs its full length whatever is booked', () => {
    expect(
      meetNowWindow({
        bookingEnabled: false,
        now: at(0),
        meetingMinutes: 20,
        selfNextBookingAt: bookingInTenMinutes,
        theirNextBookingAt: at(-5),
      }),
    ).toEqual({ endsAt: at(20) })
  })

  test('no place is kept for a booking, so a meeting takes any free one', () => {
    expect(
      spotsHeldForBookings({
        bookingEnabled: false,
        reservations: [reserved(0, 20, 1), reserved(0, 20, 2)],
        from: at(0),
        to: at(20),
      }),
    ).toEqual([])
  })

  test('an extension gets every minute the 15-minute limit grants', () => {
    const granted = extensionMinutesGranted(0, 5)
    expect(
      extensionBeforeBooking({
        bookingEnabled: false,
        granted,
        endsAt: at(20),
        nextBookingAt: at(21),
      }),
    ).toBe(5)
  })

  test('an event without the setting, or with it off, has no booking', () => {
    expect(bookingOpen({ status: 'published' })).toBe(false)
    expect(bookingOpen({ status: 'published', bookingEnabled: false })).toBe(
      false,
    )
  })
})

describe('bookingOpen', () => {
  test('booking works from the moment the event is published', () => {
    expect(bookingOpen({ status: 'published', bookingEnabled: true })).toBe(
      true,
    )
  })

  test('closing registration leaves booking on', () => {
    expect(bookingOpen({ status: 'closed', bookingEnabled: true })).toBe(true)
  })

  test('a draft has no booking even with the setting on', () => {
    expect(bookingOpen({ status: 'draft', bookingEnabled: true })).toBe(false)
  })
})

describe('bookingSlots: the 1:1 window cut into slots', () => {
  test('a two-hour window of 20-minute meetings has six slots, back to back', () => {
    const slots = bookingSlots({ openAt: at(0), closeAt: at(120) }, 20)
    expect(slots.length).toBe(6)
    expect(slots[0]).toEqual(span(0, 20))
    expect(slots[1]).toEqual(span(20, 40))
    expect(slots[5]).toEqual(span(100, 120))
  })

  test('time at the end that does not fit a whole meeting is not a slot', () => {
    const slots = bookingSlots({ openAt: at(0), closeAt: at(70) }, 30)
    expect(slots).toEqual([span(0, 30), span(30, 60)])
  })

  test('a window shorter than one meeting has no slots', () => {
    expect(bookingSlots({ openAt: at(0), closeAt: at(10) }, 20)).toEqual([])
    expect(bookingSlots({ openAt: at(10), closeAt: at(0) }, 20)).toEqual([])
  })

  test('a meeting length of zero gives no slots instead of looping', () => {
    expect(bookingSlots({ openAt: at(0), closeAt: at(60) }, 0)).toEqual([])
  })

  test('slotStartingAt finds a slot by its start and nothing in between', () => {
    const window = { openAt: at(0), closeAt: at(60) }
    expect(slotStartingAt(window, 20, at(20))).toEqual(span(20, 40))
    expect(slotStartingAt(window, 20, at(25))).toBe(null)
    expect(slotStartingAt(window, 20, at(60))).toBe(null)
  })
})

describe('placeForBooking: capacity', () => {
  const slot = span(20, 40)

  test('an event with S places books S 1:1s per slot, then the slot is full', () => {
    const spots = [1, 2, 3]
    expect(placeForBooking(spots, slot, [])).toEqual({
      bookable: true,
      spotNumber: 3,
    })
    expect(placeForBooking(spots, slot, [reserved(20, 40, 3)])).toEqual({
      bookable: true,
      spotNumber: 2,
    })
    expect(
      placeForBooking(spots, slot, [
        reserved(20, 40, 3),
        reserved(20, 40, 2),
        reserved(20, 40, 1),
      ]),
    ).toEqual({ bookable: false })
  })

  test('a place reserved in another slot is free in this one', () => {
    expect(
      placeForBooking([1], slot, [reserved(0, 20, 1), reserved(40, 60, 1)]),
    ).toEqual({ bookable: true, spotNumber: 1 })
  })

  test('a booking whose time only partly overlaps the slot still holds its place', () => {
    // Bookings keep their times when an admin changes the meeting length.
    expect(placeForBooking([1], slot, [reserved(30, 45, 1)])).toEqual({
      bookable: false,
    })
  })

  test('an event with no places books without one and is never full', () => {
    expect(placeForBooking([], slot, [])).toEqual({
      bookable: true,
      spotNumber: null,
    })
    expect(
      placeForBooking([], slot, [
        reserved(20, 40, null),
        reserved(20, 40, null),
      ]),
    ).toEqual({ bookable: true, spotNumber: null })
  })

  test('bookings made while the event had no places do not use up places added later', () => {
    expect(placeForBooking([1], slot, [reserved(20, 40, null)])).toEqual({
      bookable: true,
      spotNumber: 1,
    })
  })
})

describe('slotBlock: which slots two people can book', () => {
  const base = {
    slot: span(20, 40),
    now: at(0),
    mine: [],
    theirs: [],
    spotNumbers: [1, 2],
    reservations: [],
  }

  test('a future slot in which both are free and a place is left can be booked', () => {
    expect(slotBlock(base)).toBe(null)
  })

  test('a slot that has started cannot', () => {
    expect(slotBlock({ ...base, now: at(20) })).toBe('slot_past')
    expect(slotBlock({ ...base, now: at(19) })).toBe(null)
  })

  test('a slot in which either already has a booked 1:1 cannot', () => {
    expect(slotBlock({ ...base, mine: [span(20, 40)] })).toBe('self_booked')
    expect(slotBlock({ ...base, theirs: [span(20, 40)] })).toBe('they_booked')
  })

  test('a booking in the slot before or after leaves this one free', () => {
    expect(
      slotBlock({ ...base, mine: [span(0, 20)], theirs: [span(40, 60)] }),
    ).toBe(null)
  })

  test('a meeting in progress that runs into the slot takes it too', () => {
    // A meet-now meeting from 16:10 to 16:30 leaves no 16:20 slot.
    expect(slotBlock({ ...base, mine: [span(10, 30)] })).toBe('self_booked')
    expect(slotBlock({ ...base, theirs: [span(10, 30)] })).toBe('they_booked')
    expect(slotBlock({ ...base, mine: [span(0, 20)] })).toBe(null)
  })

  test('a slot whose places are all reserved is not offered', () => {
    expect(
      slotBlock({
        ...base,
        reservations: [reserved(20, 40, 1), reserved(20, 40, 2)],
      }),
    ).toBe('slot_full')
  })
})

describe('proposalOpen: a proposal expires when its slot starts', () => {
  test('it can be answered until the slot starts', () => {
    const proposal = { status: 'proposed', slotStart: at(20) }
    expect(proposalOpen(proposal, at(0))).toBe(true)
    expect(proposalOpen(proposal, at(20) - 1)).toBe(true)
    expect(proposalOpen(proposal, at(20))).toBe(false)
  })

  test('one that was answered or taken back cannot be answered again', () => {
    for (const status of ['booked', 'declined', 'withdrawn', 'expired']) {
      expect(proposalOpen({ status, slotStart: at(20) }, at(0))).toBe(false)
    }
  })
})

describe('nextBookingStart', () => {
  test('the earliest booking that has not ended', () => {
    const bookings = [span(40, 60), span(-40, -20), span(80, 100)]
    expect(nextBookingStart(bookings, at(0))).toBe(at(40))
  })

  test('a booking whose slot is on counts, with a start in the past', () => {
    expect(nextBookingStart([span(-5, 15)], at(0))).toBe(at(-5))
  })

  test('none when every booking is over or there are none', () => {
    expect(nextBookingStart([span(-40, -20)], at(0))).toBe(null)
    expect(nextBookingStart([], at(0))).toBe(null)
  })
})

describe('meetNowWindow: meet now next to a booked 1:1', () => {
  const base = {
    bookingEnabled: true,
    now: at(0),
    meetingMinutes: 20,
    selfNextBookingAt: null,
    theirNextBookingAt: null,
  }

  test('with nothing booked, the meeting runs its full length', () => {
    expect(meetNowWindow(base)).toEqual({ endsAt: at(20) })
  })

  test('a booking that starts after the meeting would end does not shorten it', () => {
    expect(meetNowWindow({ ...base, selfNextBookingAt: at(20) })).toEqual({
      endsAt: at(20),
    })
    expect(meetNowWindow({ ...base, theirNextBookingAt: at(45) })).toEqual({
      endsAt: at(20),
    })
  })

  test('the meeting ends when the first booked 1:1 of either starts', () => {
    expect(
      meetNowWindow({
        ...base,
        selfNextBookingAt: at(15),
        theirNextBookingAt: at(8),
      }),
    ).toEqual({ endsAt: at(8) })
  })

  test('with less than 5 minutes before a booking, it cannot start', () => {
    expect(MIN_MEET_NOW_MS).toBe(5 * MIN)
    expect(meetNowWindow({ ...base, selfNextBookingAt: at(5) })).toEqual({
      endsAt: at(5),
    })
    expect(meetNowWindow({ ...base, selfNextBookingAt: at(4) })).toEqual({
      blockedBy: 'self',
    })
    expect(meetNowWindow({ ...base, theirNextBookingAt: at(4) })).toEqual({
      blockedBy: 'they',
    })
  })

  test('someone whose booked slot is on cannot meet now', () => {
    expect(meetNowWindow({ ...base, theirNextBookingAt: at(-3) })).toEqual({
      blockedBy: 'they',
    })
  })

  test('when both have a booking in the way, the one acting is told about their own', () => {
    expect(
      meetNowWindow({
        ...base,
        selfNextBookingAt: at(2),
        theirNextBookingAt: at(2),
      }),
    ).toEqual({ blockedBy: 'self' })
  })
})

describe('spotsHeldForBookings: a meet-now meeting leaves reserved places alone', () => {
  const held = (reservations: Array<ReturnType<typeof reserved>>) =>
    spotsHeldForBookings({
      bookingEnabled: true,
      reservations,
      from: at(10),
      to: at(30),
    })

  test('a place reserved in the current slot is held', () => {
    expect(held([reserved(0, 20, 4)])).toEqual([4])
  })

  test('so is one reserved in the next slot, which the meeting would run into', () => {
    expect(held([reserved(20, 40, 7)])).toEqual([7])
  })

  test('places reserved before or after the meeting are not', () => {
    expect(held([reserved(-10, 10, 1), reserved(30, 50, 2)])).toEqual([])
  })

  test('a booking without a place holds none', () => {
    expect(held([reserved(0, 20, null)])).toEqual([])
  })
})

describe('extensionBeforeBooking: more time only up to the next booked 1:1', () => {
  const base = { bookingEnabled: true, granted: 5, endsAt: at(20) }

  test('with nothing booked, the meeting gets what the limit grants', () => {
    expect(extensionBeforeBooking({ ...base, nextBookingAt: null })).toBe(5)
  })

  test('with room before the booking, too', () => {
    expect(extensionBeforeBooking({ ...base, nextBookingAt: at(40) })).toBe(5)
    expect(extensionBeforeBooking({ ...base, nextBookingAt: at(25) })).toBe(5)
  })

  test('only the minutes that fit before the booking', () => {
    expect(extensionBeforeBooking({ ...base, nextBookingAt: at(23) })).toBe(3)
  })

  test('none when the booking starts as the meeting ends, or already has', () => {
    expect(extensionBeforeBooking({ ...base, nextBookingAt: at(20) })).toBe(0)
    expect(extensionBeforeBooking({ ...base, nextBookingAt: at(10) })).toBe(0)
  })
})

describe('bookingStage: what a person can do with a booked 1:1, and the no-show rule', () => {
  const slot = span(20, 40)

  test('before the slot it is upcoming, whoever is there', () => {
    expect(bookingStage({ ...slot, selfReadyAt: null }, at(19))).toBe(
      'upcoming',
    )
  })

  test('once the slot starts, the person says they are there', () => {
    expect(bookingStage({ ...slot, selfReadyAt: null }, at(20))).toBe('confirm')
    expect(bookingStage({ ...slot, selfReadyAt: null }, at(39))).toBe('confirm')
  })

  test('having said so, they wait for the other for 5 minutes from the slot start', () => {
    expect(NO_SHOW_GRACE_MS).toBe(5 * MIN)
    expect(bookingStage({ ...slot, selfReadyAt: at(20) }, at(21))).toBe(
      'waiting',
    )
    expect(bookingStage({ ...slot, selfReadyAt: at(20) }, at(25) - 1)).toBe(
      'waiting',
    )
  })

  test('after those 5 minutes they can release the booking', () => {
    expect(bookingStage({ ...slot, selfReadyAt: at(20) }, at(25))).toBe(
      'can_release',
    )
  })

  test('someone who arrives late themselves can release at once, not 5 minutes later', () => {
    expect(bookingStage({ ...slot, selfReadyAt: at(31) }, at(31))).toBe(
      'can_release',
    )
  })

  test('nobody can release without having said they are there', () => {
    expect(bookingStage({ ...slot, selfReadyAt: null }, at(30))).toBe('confirm')
  })

  test('when the slot ends without the two starting, it is over', () => {
    expect(bookingStage({ ...slot, selfReadyAt: at(20) }, at(40))).toBe('over')
    expect(bookingStage({ ...slot, selfReadyAt: null }, at(40))).toBe('over')
  })
})

describe('bookingNoticeFor: who is told that a 1:1 fell through', () => {
  const row = { fromUserId: 'ana', closedBy: undefined as string | undefined }

  test('the proposer hears that their proposal was declined or expired', () => {
    expect(bookingNoticeFor({ ...row, status: 'declined' }, 'ana')).toBe(
      'declined',
    )
    expect(bookingNoticeFor({ ...row, status: 'expired' }, 'ana')).toBe(
      'expired',
    )
  })

  test('the person who declined, or never answered, is not told', () => {
    expect(bookingNoticeFor({ ...row, status: 'declined' }, 'bruno')).toBe(null)
    expect(bookingNoticeFor({ ...row, status: 'expired' }, 'bruno')).toBe(null)
  })

  test('a cancelled booking is told to the other person, not to who cancelled', () => {
    const cancelled = {
      ...row,
      status: 'cancelled' as const,
      closedBy: 'bruno',
    }
    expect(bookingNoticeFor(cancelled, 'ana')).toBe('cancelled')
    expect(bookingNoticeFor(cancelled, 'bruno')).toBe(null)
  })

  test('a no-show is told to the person who was not there', () => {
    const noShow = { ...row, status: 'no_show' as const, closedBy: 'ana' }
    expect(bookingNoticeFor(noShow, 'bruno')).toBe('no_show')
    expect(bookingNoticeFor(noShow, 'ana')).toBe(null)
  })

  test('a notice that was dismissed is not shown again', () => {
    expect(
      bookingNoticeFor(
        { ...row, status: 'declined', acknowledgedAt: 1 },
        'ana',
      ),
    ).toBe(null)
  })

  test('a proposal taken back, and anything still going, tells nobody', () => {
    for (const status of [
      'withdrawn',
      'proposed',
      'booked',
      'started',
    ] as const) {
      expect(bookingNoticeFor({ ...row, status }, 'ana')).toBe(null)
      expect(bookingNoticeFor({ ...row, status }, 'bruno')).toBe(null)
    }
  })
})
