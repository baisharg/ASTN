import { MAX_OUTGOING_PENDING } from '../../convex/social/constants'
import {
  ENDED_CARD_MS,
  OUTCOME_VISIBLE_MS,
  agendaAlerts,
  bookingsDueNow,
  endedRecently,
  expiryMinutesLeft,
  liveAlerts,
  meetingRanOut,
  openProposals,
  requestBlock,
  titleWithCount,
  visibleOutcomes,
  watchTimeUp,
} from './social-live'
import type { RequestBlockLive, TimeUpWatch } from './social-live'

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

const NOW = 1_800_000_000_000

describe('endedRecently', () => {
  test('a meeting that just ended is recent', () => {
    expect(endedRecently(NOW - 5_000, NOW)).toBe(true)
  })

  test('a meeting that ended before the page was opened is still recent', () => {
    expect(endedRecently(NOW - 4 * 60_000, NOW)).toBe(true)
  })

  test('after ten minutes the ended card goes away', () => {
    expect(endedRecently(NOW - ENDED_CARD_MS + 1, NOW)).toBe(true)
    expect(endedRecently(NOW - ENDED_CARD_MS, NOW)).toBe(false)
    expect(endedRecently(NOW - 60 * 60_000, NOW)).toBe(false)
  })

  test('a device clock behind the server still shows it', () => {
    expect(endedRecently(NOW + 30_000, NOW)).toBe(true)
  })
})

describe('requestBlock', () => {
  const idle: RequestBlockLive = {
    availability: 'available',
    meeting: null,
    incoming: [],
    outgoing: [],
    cooldowns: [],
  }
  const ana = { userId: 'ana', state: 'available' as const, here: true }

  test('someone who is at the event and available can be asked', () => {
    expect(requestBlock(idle, true, ana, NOW)).toBe(null)
  })

  test('nobody can be asked while 1:1s are not open', () => {
    expect(requestBlock(idle, false, ana, NOW)).toBe('closed')
  })

  test('someone who has not arrived cannot be asked', () => {
    expect(requestBlock(idle, true, { ...ana, here: false }, NOW)).toBe(
      'not_here',
    )
  })

  test('someone who is not taking requests cannot be asked', () => {
    expect(requestBlock(idle, true, { ...ana, state: 'busy' }, NOW)).toBe(
      'busy',
    )
  })

  test('someone in a meeting can be asked: the request waits in their queue', () => {
    expect(requestBlock(idle, true, { ...ana, state: 'in_meeting' }, NOW)).toBe(
      null,
    )
  })

  test('the viewer cannot have more than the limit of requests waiting', () => {
    const full = {
      ...idle,
      outgoing: Array.from({ length: MAX_OUTGOING_PENDING }, () => ({})),
    }
    expect(requestBlock(full, true, ana, NOW)).toBe('limit')
  })

  test('when they already asked, sending accepts: it only needs both people free', () => {
    const asked = { ...idle, incoming: [{ from: { userId: 'ana' } }] }
    expect(requestBlock(asked, true, { ...ana, here: false }, NOW)).toBe(null)
    expect(
      requestBlock(asked, true, { ...ana, state: 'in_meeting' }, NOW),
    ).toBe('they_in_meeting')
    expect(requestBlock({ ...asked, meeting: {} }, true, ana, NOW)).toBe(
      'self_in_meeting',
    )
  })

  test('a viewer who is not available cannot ask, but can still accept', () => {
    const away = { ...idle, availability: 'busy' as const }
    expect(requestBlock(away, true, ana, NOW)).toBe('self_busy')
    const awayButAsked = { ...away, incoming: [{ from: { userId: 'ana' } }] }
    expect(requestBlock(awayButAsked, true, ana, NOW)).toBe(null)
  })

  test('a request from someone who became unavailable cannot be accepted', () => {
    const asked = { ...idle, incoming: [{ from: { userId: 'ana' } }] }
    expect(requestBlock(asked, true, { ...ana, state: 'busy' }, NOW)).toBe(
      'they_unavailable',
    )
  })

  test('someone who just declined cannot be asked again until the wait is over', () => {
    const declined = {
      ...idle,
      cooldowns: [{ userId: 'ana', askAgainAt: NOW + 60_000 }],
    }
    expect(requestBlock(declined, true, ana, NOW)).toBe('declined_recently')
    expect(requestBlock(declined, true, ana, NOW + 60_000)).toBe(null)
    expect(requestBlock(declined, true, { ...ana, userId: 'bruno' }, NOW)).toBe(
      null,
    )
  })

  test('a recent decline does not stop accepting a request they sent since', () => {
    const askedAfterDeclining = {
      ...idle,
      incoming: [{ from: { userId: 'ana' } }],
      cooldowns: [{ userId: 'ana', askAgainAt: NOW + 60_000 }],
    }
    expect(requestBlock(askedAfterDeclining, true, ana, NOW)).toBe(null)
  })
})

describe('expiryMinutesLeft', () => {
  test('counts whole minutes, rounding up', () => {
    expect(expiryMinutesLeft(NOW + 10 * 60_000, NOW)).toBe(10)
    expect(expiryMinutesLeft(NOW + 6 * 60_000 + 1, NOW)).toBe(7)
    expect(expiryMinutesLeft(NOW + 20_000, NOW)).toBe(1)
  })

  test('is 0 once the time has passed', () => {
    expect(expiryMinutesLeft(NOW, NOW)).toBe(0)
    expect(expiryMinutesLeft(NOW - 5_000, NOW)).toBe(0)
  })
})

describe('visibleOutcomes', () => {
  test('keeps declined and expired requests for half an hour', () => {
    const recent = { id: 'recent', resolvedAt: NOW - 60_000 }
    const old = { id: 'old', resolvedAt: NOW - OUTCOME_VISIBLE_MS }
    expect(visibleOutcomes([recent, old], NOW)).toEqual([recent])
  })
})

describe('liveAlerts', () => {
  const KEY = 'event:me'
  const fromAna = { _id: 'r1', from: 'Ana' }
  const fromBruno = { _id: 'r2', from: 'Bruno' }
  const meeting = { _id: 'm1' }

  test('what was already there when the page loaded does not alert', () => {
    const first = liveAlerts(null, KEY, { incoming: [fromAna], meeting })
    expect(first.newIncoming).toEqual([])
    expect(first.startedMeeting).toBe(null)
    expect(first.seen).toEqual({
      key: KEY,
      incomingIds: ['r1'],
      meetingId: 'm1',
    })
  })

  test('a request that arrives afterwards alerts once', () => {
    const loaded = liveAlerts(null, KEY, { incoming: [fromAna], meeting: null })
    const next = liveAlerts(loaded.seen, KEY, {
      incoming: [fromAna, fromBruno],
      meeting: null,
    })
    expect(next.newIncoming).toEqual([fromBruno])
    const again = liveAlerts(next.seen, KEY, {
      incoming: [fromAna, fromBruno],
      meeting: null,
    })
    expect(again.newIncoming).toEqual([])
  })

  test('a meeting that starts afterwards is reported once', () => {
    const loaded = liveAlerts(null, KEY, { incoming: [], meeting: null })
    const started = liveAlerts(loaded.seen, KEY, { incoming: [], meeting })
    expect(started.startedMeeting).toBe(meeting)
    const still = liveAlerts(started.seen, KEY, { incoming: [], meeting })
    expect(still.startedMeeting).toBe(null)
    const ended = liveAlerts(still.seen, KEY, { incoming: [], meeting: null })
    expect(ended.startedMeeting).toBe(null)
  })

  test('another event or account starts from a new baseline', () => {
    const loaded = liveAlerts(null, KEY, { incoming: [], meeting: null })
    const other = liveAlerts(loaded.seen, 'event:someone-else', {
      incoming: [fromAna],
      meeting,
    })
    expect(other.newIncoming).toEqual([])
    expect(other.startedMeeting).toBe(null)
  })
})

describe('titleWithCount', () => {
  test('puts the number of waiting requests before the title', () => {
    expect(titleWithCount('Social · BAISH', 2)).toBe('(2) Social · BAISH')
  })

  test('leaves the title alone when nothing is waiting', () => {
    expect(titleWithCount('Social · BAISH', 0)).toBe('Social · BAISH')
  })
})

describe('watchTimeUp', () => {
  const END = NOW + 60_000
  const meeting = { _id: 'm1', endsAt: END }
  const running = { meeting, lastEnded: null }
  const watching: TimeUpWatch = {
    meetingId: 'm1',
    endsAt: END,
    signalled: false,
  }

  test('starts watching a meeting without signalling', () => {
    expect(watchTimeUp(null, running, NOW)).toEqual({
      watch: watching,
      timeUp: false,
    })
  })

  test('signals once when this device reaches the end time', () => {
    const atZero = watchTimeUp(watching, running, END)
    expect(atZero.timeUp).toBe(true)
    expect(watchTimeUp(atZero.watch, running, END + 1_000).timeUp).toBe(false)
  })

  test('signals when the server ends the meeting first because its time ran out', () => {
    const ended = {
      meeting: null,
      lastEnded: { _id: 'm1', endedAt: END, endsAt: END },
    }
    // This device's clock is 5 seconds behind the server.
    const result = watchTimeUp(watching, ended, END - 5_000)
    expect(result).toEqual({ watch: null, timeUp: true })
  })

  test('does not signal twice when the device reached zero before the server ended it', () => {
    const atZero = watchTimeUp(watching, running, END)
    const ended = {
      meeting: null,
      lastEnded: { _id: 'm1', endedAt: END + 200, endsAt: END },
    }
    expect(watchTimeUp(atZero.watch, ended, END + 1_000).timeUp).toBe(false)
  })

  test('does not signal when someone ended the meeting early', () => {
    const endedEarly = {
      meeting: null,
      lastEnded: { _id: 'm1', endedAt: END - 30_000, endsAt: END },
    }
    expect(watchTimeUp(watching, endedEarly, END - 30_000).timeUp).toBe(false)
  })

  test('does not signal for a meeting that was already over when the page opened', () => {
    const opened = watchTimeUp(null, running, END + 500)
    expect(opened.timeUp).toBe(false)
    expect(watchTimeUp(opened.watch, running, END + 1_500).timeUp).toBe(false)
  })

  test('an extension is watched again from its new end time', () => {
    const extended = {
      meeting: { _id: 'm1', endsAt: END + 300_000 },
      lastEnded: null,
    }
    const rearmed = watchTimeUp(watching, extended, END - 1_000)
    expect(rearmed.timeUp).toBe(false)
    expect(watchTimeUp(rearmed.watch, extended, END).timeUp).toBe(false)
    expect(watchTimeUp(rearmed.watch, extended, END + 300_000).timeUp).toBe(
      true,
    )
  })
})

describe('meetingRanOut', () => {
  test('a meeting ended at its end time ran out; one ended well before did not', () => {
    expect(meetingRanOut({ endedAt: 60_000, endsAt: 60_000 })).toBe(true)
    expect(meetingRanOut({ endedAt: 59_000, endsAt: 60_000 })).toBe(true)
    expect(meetingRanOut({ endedAt: 20_000, endsAt: 60_000 })).toBe(false)
  })
})

describe('bookingsDueNow', () => {
  const booking = (status: 'booked' | 'started') => ({
    status,
    slotStart: 1_000,
    slotEnd: 2_000,
  })

  test('a booked 1:1 is due from the start of its slot to its end', () => {
    expect(bookingsDueNow([booking('booked')], 999).length).toBe(0)
    expect(bookingsDueNow([booking('booked')], 1_000).length).toBe(1)
    expect(bookingsDueNow([booking('booked')], 1_999).length).toBe(1)
    expect(bookingsDueNow([booking('booked')], 2_000).length).toBe(0)
  })

  test('one that already started is a meeting, not something due', () => {
    expect(bookingsDueNow([booking('started')], 1_500).length).toBe(0)
  })
})

describe('openProposals', () => {
  test('a proposal can be answered until its slot starts', () => {
    const proposals = [{ slotStart: 1_000 }, { slotStart: 3_000 }]
    expect(openProposals(proposals, 500).length).toBe(2)
    expect(openProposals(proposals, 1_000)).toEqual([{ slotStart: 3_000 }])
  })
})

describe('agendaAlerts', () => {
  const proposal = (_id: string) => ({ _id, slotStart: 5_000 })
  const booking = (_id: string) => ({
    _id,
    status: 'booked' as const,
    slotStart: 1_000,
    slotEnd: 2_000,
  })

  test('proposals that were waiting when the page loaded do not alert', () => {
    const first = agendaAlerts(
      null,
      'e:u',
      { incoming: [proposal('p1')], bookings: [] },
      0,
    )
    expect(first.newProposals).toEqual([])
    const next = agendaAlerts(
      first.seen,
      'e:u',
      { incoming: [proposal('p1'), proposal('p2')], bookings: [] },
      0,
    )
    expect(next.newProposals.map((p) => p._id)).toEqual(['p2'])
  })

  test('a proposal alerts once', () => {
    const first = agendaAlerts(null, 'e:u', { incoming: [], bookings: [] }, 0)
    const agenda = { incoming: [proposal('p1')], bookings: [] }
    const second = agendaAlerts(first.seen, 'e:u', agenda, 0)
    expect(second.newProposals.length).toBe(1)
    expect(agendaAlerts(second.seen, 'e:u', agenda, 0).newProposals).toEqual([])
  })

  test('a booked 1:1 alerts when its slot starts, once', () => {
    const agenda = { incoming: [], bookings: [booking('b1')] }
    const early = agendaAlerts(null, 'e:u', agenda, 500)
    expect(early.due).toEqual([])
    const atStart = agendaAlerts(early.seen, 'e:u', agenda, 1_000)
    expect(atStart.due.map((b) => b._id)).toEqual(['b1'])
    expect(agendaAlerts(atStart.seen, 'e:u', agenda, 1_200).due).toEqual([])
  })

  test('a 1:1 whose slot is already on when the page loads alerts too', () => {
    const agenda = { incoming: [], bookings: [booking('b1')] }
    expect(agendaAlerts(null, 'e:u', agenda, 1_500).due.length).toBe(1)
  })

  test('another account on the same device starts from its own baseline', () => {
    const first = agendaAlerts(null, 'e:u1', { incoming: [], bookings: [] }, 0)
    const other = agendaAlerts(
      first.seen,
      'e:u2',
      { incoming: [proposal('p1')], bookings: [] },
      0,
    )
    expect(other.newProposals).toEqual([])
  })
})
