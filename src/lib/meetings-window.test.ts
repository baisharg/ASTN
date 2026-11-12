import { DEFAULT_EVENT_HOURS } from '../../convex/social/constants'
import {
  eventEndAt,
  meetingsWindowProblem,
  resolveMeetingsClose,
  resolveMeetingsOpen,
} from './meetings-window'
import { zonedToEpoch } from './zoned-time'

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
}

const TZ = 'America/Argentina/Buenos_Aires'
const at = (date: string, time: string) => zonedToEpoch(date, time, TZ)

// Saturday 19:00 to Sunday 01:00.
const night = {
  startAt: at('2026-10-10', '19:00'),
  endAt: at('2026-10-11', '01:00'),
  timezone: TZ,
}
// Saturday 10:00 to Sunday 18:00.
const weekend = {
  startAt: at('2026-10-10', '10:00'),
  endAt: at('2026-10-11', '18:00'),
  timezone: TZ,
}
const noEnd = { startAt: at('2026-10-10', '19:00'), timezone: TZ }

describe('eventEndAt', () => {
  test('an event without an end lasts the default hours', () => {
    expect(eventEndAt(night)).toBe(night.endAt)
    expect(eventEndAt(noEnd)).toBe(
      noEnd.startAt + DEFAULT_EVENT_HOURS * 3600 * 1000,
    )
  })
})

describe('resolveMeetingsOpen', () => {
  test('a time before the event starts is that same day, not the next', () => {
    expect(resolveMeetingsOpen('18:30', night)).toBe(at('2026-10-10', '18:30'))
    expect(resolveMeetingsOpen('18:30', noEnd)).toBe(at('2026-10-10', '18:30'))
  })

  test('a time during the event is the day the event is on at that time', () => {
    expect(resolveMeetingsOpen('19:00', night)).toBe(at('2026-10-10', '19:00'))
    expect(resolveMeetingsOpen('20:30', night)).toBe(at('2026-10-10', '20:30'))
    expect(resolveMeetingsOpen('00:30', night)).toBe(at('2026-10-11', '00:30'))
  })

  test('on an event of several days it is the first day that fits', () => {
    expect(resolveMeetingsOpen('11:00', weekend)).toBe(
      at('2026-10-10', '11:00'),
    )
    // 09:00 on Saturday is before the start; the event is on at 09:00 Sunday.
    expect(resolveMeetingsOpen('09:00', weekend)).toBe(
      at('2026-10-11', '09:00'),
    )
  })
})

describe('resolveMeetingsClose', () => {
  test('a time during the event is the day the event is on at that time', () => {
    expect(resolveMeetingsClose('23:00', night)).toBe(at('2026-10-10', '23:00'))
    expect(resolveMeetingsClose('00:30', night)).toBe(at('2026-10-11', '00:30'))
    expect(resolveMeetingsClose('01:00', night)).toBe(at('2026-10-11', '01:00'))
  })

  test('a time after the event ends is the first one after the end', () => {
    expect(resolveMeetingsClose('02:00', night)).toBe(at('2026-10-11', '02:00'))
    const evening = {
      startAt: at('2026-10-10', '19:00'),
      endAt: at('2026-10-10', '23:00'),
      timezone: TZ,
    }
    expect(resolveMeetingsClose('23:30', evening)).toBe(
      at('2026-10-10', '23:30'),
    )
    expect(resolveMeetingsClose('01:00', evening)).toBe(
      at('2026-10-11', '01:00'),
    )
  })

  test('on an event of several days it is the last day that fits', () => {
    expect(resolveMeetingsClose('17:00', weekend)).toBe(
      at('2026-10-11', '17:00'),
    )
    expect(resolveMeetingsClose('20:00', weekend)).toBe(
      at('2026-10-10', '20:00'),
    )
  })
})

describe('meetingsWindowProblem', () => {
  test('no explicit times: 1:1s follow the event', () => {
    expect(meetingsWindowProblem(night, null, null)).toBe(null)
    expect(meetingsWindowProblem(noEnd, null, null)).toBe(null)
  })

  test('opening half an hour before the event is fine', () => {
    expect(meetingsWindowProblem(night, at('2026-10-10', '18:30'), null)).toBe(
      null,
    )
  })

  test('opening the day after the event never overlaps it', () => {
    // What "18:30" used to be saved as for an event starting at 19:00.
    expect(meetingsWindowProblem(night, at('2026-10-11', '18:30'), null)).toBe(
      'opens_after_event',
    )
    expect(
      meetingsWindowProblem(
        night,
        at('2026-10-11', '18:30'),
        at('2026-10-11', '20:00'),
      ),
    ).toBe('opens_after_event')
  })

  test('closing before the event starts never overlaps it', () => {
    expect(
      meetingsWindowProblem(
        night,
        at('2026-10-10', '17:00'),
        at('2026-10-10', '18:00'),
      ),
    ).toBe('closes_before_event')
  })

  test('closing before opening', () => {
    expect(
      meetingsWindowProblem(
        night,
        at('2026-10-10', '22:00'),
        at('2026-10-10', '21:00'),
      ),
    ).toBe('closes_before_opening')
  })

  test('closing right when the event starts leaves no time for 1:1s', () => {
    expect(meetingsWindowProblem(night, null, at('2026-10-10', '19:00'))).toBe(
      'closes_before_event',
    )
  })
})
