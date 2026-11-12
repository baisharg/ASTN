import { MAX_OUTGOING_PENDING } from '../../convex/social/constants'
import {
  ENDED_CARD_MS,
  OUTCOME_VISIBLE_MS,
  endedRecently,
  expiryMinutesLeft,
  requestBlock,
  visibleOutcomes,
} from './social-live'
import type { RequestBlockLive } from './social-live'

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
