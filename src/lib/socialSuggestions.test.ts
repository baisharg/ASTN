import {
  REFRESH_INTERVAL_MS,
  cleanSuggestionPicks,
  decideSuggestionRequest,
} from '../../convex/social/suggestions'

// The pure rules behind event suggestions (convex/social/suggestions.ts).
// Kept under src/ so the Convex bundler never sees a test file.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

const NOW = 1_700_000_000_000
const MINUTE = 60 * 1000

describe('decideSuggestionRequest', () => {
  test('a first request generates right away', () => {
    expect(
      decideSuggestionRequest({
        now: NOW,
        lastRequestedAt: undefined,
        storedLanguage: undefined,
        language: 'es',
      }),
    ).toEqual({ kind: 'now' })
  })

  test('a request once the interval has passed generates right away', () => {
    expect(
      decideSuggestionRequest({
        now: NOW,
        lastRequestedAt: NOW - REFRESH_INTERVAL_MS,
        storedLanguage: 'es',
        language: 'es',
      }),
    ).toEqual({ kind: 'now' })
  })

  test('a repeat request inside the interval does nothing', () => {
    expect(
      decideSuggestionRequest({
        now: NOW,
        lastRequestedAt: NOW - MINUTE,
        storedLanguage: 'es',
        language: 'es',
      }),
    ).toEqual({ kind: 'recent', saveLanguage: false })
  })

  test('a language switch inside the interval books one run for when it ends', () => {
    expect(
      decideSuggestionRequest({
        now: NOW,
        lastRequestedAt: NOW - MINUTE,
        storedLanguage: 'es',
        language: 'en',
      }),
    ).toEqual({ kind: 'later', runAt: NOW - MINUTE + REFRESH_INTERVAL_MS })
  })

  test('a second switch while a run is booked only stores the language', () => {
    expect(
      decideSuggestionRequest({
        now: NOW,
        lastRequestedAt: NOW + 5 * MINUTE,
        storedLanguage: 'en',
        language: 'es',
      }),
    ).toEqual({ kind: 'recent', saveLanguage: true })
  })

  test('after a failed run released the throttle, the retry generates right away', () => {
    // A failed run clears the request time (recordSuggestionsOutcome).
    expect(
      decideSuggestionRequest({
        now: NOW,
        lastRequestedAt: undefined,
        storedLanguage: 'es',
        language: 'es',
      }),
    ).toEqual({ kind: 'now' })
  })
})

describe('cleanSuggestionPicks', () => {
  const userIdByKey = new Map([
    ['p1', 'user_me'],
    ['p2', 'user_ana'],
    ['p3', 'user_bruno'],
    ['p4', 'user_carla'],
  ])
  const clean = (picks: Parameters<typeof cleanSuggestionPicks>[0], max = 5) =>
    cleanSuggestionPicks(picks, { userIdByKey, selfId: 'user_me', max })

  test('keeps known candidates in the order the model gave them', () => {
    expect(
      clean([
        { person: 'p3', reason: 'Bruno needs evals help.', topics: ['Evals'] },
        { person: ' p2 ', reason: ' Ana hires. ', topics: [' Hiring ', ''] },
      ]),
    ).toEqual([
      {
        suggestedUserId: 'user_bruno',
        reason: 'Bruno needs evals help.',
        topics: ['Evals'],
      },
      {
        suggestedUserId: 'user_ana',
        reason: 'Ana hires.',
        topics: ['Hiring'],
      },
    ])
  })

  test('drops the attendee themselves, unknown keys, repeats and picks without a reason', () => {
    expect(
      clean([
        { person: 'p1', reason: 'Yourself.', topics: [] },
        { person: 'p9', reason: 'Not on the list.', topics: [] },
        { person: 'p2', reason: '   ', topics: [] },
        { person: 'p3', reason: 'First.', topics: [] },
        { person: 'p3', reason: 'Again.', topics: [] },
      ]),
    ).toEqual([{ suggestedUserId: 'user_bruno', reason: 'First.', topics: [] }])
  })

  test('stops at the maximum and trims long text and extra topics', () => {
    const result = clean(
      [
        {
          person: 'p2',
          reason: 'r'.repeat(700),
          topics: ['a', 'b', 'c', 'd'].map((t) => t.repeat(200)),
        },
        { person: 'p3', reason: 'Second.', topics: [] },
        { person: 'p4', reason: 'Third.', topics: [] },
      ],
      2,
    )
    expect(result.length).toBe(2)
    expect(result[0].reason.length).toBe(600)
    expect(result[0].topics.length).toBe(3)
    expect(result[0].topics[0].length).toBe(160)
    expect(result[1].suggestedUserId).toBe('user_bruno')
  })
})
