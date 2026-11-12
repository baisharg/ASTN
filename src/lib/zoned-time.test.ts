import { carryZonedTime, timeOnEventNight, zonedToEpoch } from './zoned-time'

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
}

const BA = 'America/Argentina/Buenos_Aires'
const LONDON = 'Europe/London'

describe('timeOnEventNight', () => {
  test('a time before the start is on the next day', () => {
    expect(timeOnEventNight('2026-10-10', '19:00', '01:00', BA)).toBe(
      zonedToEpoch('2026-10-11', '01:00', BA),
    )
    expect(timeOnEventNight('2026-10-10', '19:00', '22:00', BA)).toBe(
      zonedToEpoch('2026-10-10', '22:00', BA),
    )
  })
})

describe('carryZonedTime', () => {
  const old = { date: '2026-10-10', timeZone: BA }

  test('a time on the first day moves to the new first day', () => {
    expect(
      carryZonedTime(zonedToEpoch('2026-10-10', '18:30', BA), old, {
        date: '2026-10-17',
        timeZone: BA,
      }),
    ).toBe(zonedToEpoch('2026-10-17', '18:30', BA))
  })

  test('a time on a later day stays that many days later', () => {
    expect(
      carryZonedTime(zonedToEpoch('2026-10-11', '01:00', BA), old, {
        date: '2026-10-17',
        timeZone: BA,
      }),
    ).toBe(zonedToEpoch('2026-10-18', '01:00', BA))
    expect(
      carryZonedTime(zonedToEpoch('2026-10-12', '17:00', BA), old, {
        date: '2026-11-30',
        timeZone: BA,
      }),
    ).toBe(zonedToEpoch('2026-12-02', '17:00', BA))
  })

  test('a new timezone keeps the wall-clock time', () => {
    expect(
      carryZonedTime(zonedToEpoch('2026-10-10', '20:00', BA), old, {
        date: '2026-10-10',
        timeZone: LONDON,
      }),
    ).toBe(zonedToEpoch('2026-10-10', '20:00', LONDON))
  })

  test('crossing a clock change keeps the wall-clock time', () => {
    // London leaves summer time on 25 October 2026.
    expect(
      carryZonedTime(
        zonedToEpoch('2026-10-24', '20:00', LONDON),
        { date: '2026-10-24', timeZone: LONDON },
        { date: '2026-10-31', timeZone: LONDON },
      ),
    ).toBe(zonedToEpoch('2026-10-31', '20:00', LONDON))
  })
})
