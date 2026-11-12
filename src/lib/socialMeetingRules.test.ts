import {
  MAX_MEETING_EXTENSION_MINUTES,
  compareAttendees,
  extensionMinutesGranted,
  meetingsOpenNow,
  requestPastExpiry,
} from '../../convex/social/constants'

// The 1:1 rules in convex/social/constants.ts that the backend enforces and
// the pages mirror. Kept under src/ so the Convex bundler never sees a test
// file.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

describe('extensionMinutesGranted', () => {
  test('a meeting that was never extended gets what it asks for', () => {
    expect(extensionMinutesGranted(0, 5)).toBe(5)
  })

  test('three 5-minute extensions reach the limit and the fourth gets nothing', () => {
    expect(MAX_MEETING_EXTENSION_MINUTES).toBe(15)
    expect(extensionMinutesGranted(5, 5)).toBe(5)
    expect(extensionMinutesGranted(10, 5)).toBe(5)
    expect(extensionMinutesGranted(15, 5)).toBe(0)
  })

  test('a request larger than what is left only gets what is left', () => {
    expect(extensionMinutesGranted(12, 5)).toBe(3)
    expect(extensionMinutesGranted(0, 60)).toBe(15)
  })

  test('a meeting already past the limit gets nothing', () => {
    expect(extensionMinutesGranted(40, 5)).toBe(0)
  })

  test('odd requests are rounded and count as at least one minute', () => {
    expect(extensionMinutesGranted(0, 0)).toBe(1)
    expect(extensionMinutesGranted(0, -3)).toBe(1)
    expect(extensionMinutesGranted(0, 4.6)).toBe(5)
  })
})

describe('meetingsOpenNow', () => {
  const window = { openAt: 1_000, closeAt: 2_000 }

  test('a published event has 1:1s inside its window only', () => {
    expect(meetingsOpenNow('published', window, 999)).toBe(false)
    expect(meetingsOpenNow('published', window, 1_000)).toBe(true)
    expect(meetingsOpenNow('published', window, 1_500)).toBe(true)
    expect(meetingsOpenNow('published', window, 2_000)).toBe(true)
    expect(meetingsOpenNow('published', window, 2_001)).toBe(false)
  })

  test('closing registration leaves 1:1s running as on a published event', () => {
    expect(meetingsOpenNow('closed', window, 999)).toBe(false)
    expect(meetingsOpenNow('closed', window, 1_500)).toBe(true)
    expect(meetingsOpenNow('closed', window, 2_001)).toBe(false)
  })

  test('a draft never has 1:1s', () => {
    expect(meetingsOpenNow('draft', window, 1_500)).toBe(false)
  })
})

describe('compareAttendees', () => {
  test('people at the event come first, each group by name', () => {
    const list = [
      { name: 'Zoe', here: false },
      { name: 'Bruno', here: true },
      { name: 'Ana', here: false },
      { name: 'Carla', here: true },
    ]
    expect(list.sort(compareAttendees).map((a) => a.name)).toEqual([
      'Bruno',
      'Carla',
      'Ana',
      'Zoe',
    ])
  })
})

describe('requestPastExpiry', () => {
  test('a request can be answered until its expiry time', () => {
    expect(requestPastExpiry({ expiresAt: 2_000 }, 1_999)).toBe(false)
    expect(requestPastExpiry({ expiresAt: 2_000 }, 2_000)).toBe(true)
    expect(requestPastExpiry({ expiresAt: 2_000 }, 5_000)).toBe(true)
  })

  test('a request with no expiry time never expires', () => {
    expect(requestPastExpiry({}, 5_000)).toBe(false)
  })
})
