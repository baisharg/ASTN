import {
  MAX_MEETING_EXTENSION_MINUTES,
  extensionMinutesGranted,
} from '../../convex/social/constants'

// The 1:1 rules in convex/social/constants.ts that the backend enforces and
// the pages mirror. Kept under src/ so the Convex bundler never sees a test
// file.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
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
