import { MAX_OUTGOING_PENDING } from '../../convex/social/constants'
import { ENDED_CARD_MS, endedRecently, requestBlock } from './social-live'
import type { RequestBlockLive } from './social-live'

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
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
  const idle: RequestBlockLive = { meeting: null, incoming: [], outgoing: [] }
  const ana = { userId: 'ana', state: 'available' as const, here: true }

  test('someone who is at the event and available can be asked', () => {
    expect(requestBlock(idle, true, ana)).toBe(null)
  })

  test('nobody can be asked while 1:1s are not open', () => {
    expect(requestBlock(idle, false, ana)).toBe('closed')
  })

  test('someone who has not arrived cannot be asked', () => {
    expect(requestBlock(idle, true, { ...ana, here: false })).toBe('not_here')
  })

  test('someone who is not taking requests cannot be asked', () => {
    expect(requestBlock(idle, true, { ...ana, state: 'busy' })).toBe('busy')
  })

  test('someone in a meeting can be asked: the request waits in their queue', () => {
    expect(requestBlock(idle, true, { ...ana, state: 'in_meeting' })).toBe(null)
  })

  test('the viewer cannot have more than the limit of requests waiting', () => {
    const full = {
      ...idle,
      outgoing: Array.from({ length: MAX_OUTGOING_PENDING }, () => ({})),
    }
    expect(requestBlock(full, true, ana)).toBe('limit')
  })

  test('when they already asked, sending accepts: it only needs both people free', () => {
    const asked = { ...idle, incoming: [{ from: { userId: 'ana' } }] }
    expect(requestBlock(asked, true, { ...ana, here: false })).toBe(null)
    expect(requestBlock(asked, true, { ...ana, state: 'in_meeting' })).toBe(
      'they_in_meeting',
    )
    expect(requestBlock({ ...asked, meeting: {} }, true, ana)).toBe(
      'self_in_meeting',
    )
  })
})
