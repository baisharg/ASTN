import {
  MAX_MEETING_EXTENSION_MINUTES,
  compareAttendees,
  extensionMinutesGranted,
  meetingsOpenNow,
  requestExpiryTime,
  requestPastExpiry,
  suggestionOutcome,
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

describe('requestExpiryTime', () => {
  const TEN_MINUTES = 10 * 60 * 1000

  test('a request to someone who is free expires 10 minutes after it is sent', () => {
    expect(requestExpiryTime(1_000, null)).toBe(1_000 + TEN_MINUTES)
  })

  test('a request to someone in a meeting expires 10 minutes after that meeting is due to end', () => {
    expect(requestExpiryTime(1_000, 900_000)).toBe(900_000 + TEN_MINUTES)
  })

  test('a meeting that is already over time does not shorten the 10 minutes', () => {
    expect(requestExpiryTime(1_000_000, 900_000)).toBe(1_000_000 + TEN_MINUTES)
  })
})

describe('suggestionOutcome: how 1:1 requests relate to suggestions', () => {
  test('counts requests and meetings that followed a suggestion', () => {
    const outcome = suggestionOutcome({
      requests: [
        { status: 'accepted', requesterWasSuggested: true },
        { status: 'accepted', requesterWasSuggested: false },
        { status: 'declined', requesterWasSuggested: true },
        { status: 'pending', requesterWasSuggested: false },
        { status: 'expired', requesterWasSuggested: false },
      ],
      suggestionCount: 20,
      attendeeCount: 5,
    })
    expect(outcome.requests).toBe(5)
    expect(outcome.requestsToSuggested).toBe(2)
    expect(outcome.meetings).toBe(2)
    expect(outcome.meetingsFromSuggested).toBe(1)
  })

  test('leaves out requests from before this was recorded', () => {
    const outcome = suggestionOutcome({
      requests: [
        { status: 'accepted' },
        { status: 'declined' },
        { status: 'accepted', requesterWasSuggested: true },
      ],
      suggestionCount: 10,
      attendeeCount: 10,
    })
    expect(outcome.requests).toBe(1)
    expect(outcome.meetings).toBe(1)
    expect(outcome.meetingsFromSuggested).toBe(1)
  })

  test('the chance share is the part of attendee pairs that are a suggestion', () => {
    // 11 attendees with 5 suggestions each: 55 of 110 ordered pairs.
    expect(
      suggestionOutcome({
        requests: [],
        suggestionCount: 55,
        attendeeCount: 11,
      }).chanceShare,
    ).toBe(0.5)
  })

  test('there is no chance share with fewer than two attendees', () => {
    expect(
      suggestionOutcome({ requests: [], suggestionCount: 0, attendeeCount: 1 })
        .chanceShare,
    ).toBe(null)
  })
})
