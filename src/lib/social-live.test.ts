import { ENDED_CARD_MS, endedRecently } from './social-live'

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
