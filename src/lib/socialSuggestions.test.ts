import {
  EVENT_RUN_INTERVAL_MS,
  RERANK_INTERVAL_MS,
  cleanSuggestionPicks,
  decideRefresh,
  decideRerankTiming,
} from '../../convex/social/suggestions'

// The pure rules behind when event suggestions are generated
// (convex/social/suggestions.ts). The assignment has its own file,
// socialSuggestionAssignment.test.ts. Kept under src/ so the Convex bundler
// never sees a test file.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

const NOW = 1_700_000_000_000
const MINUTE = 60 * 1000

/** An attendee with suggestions in their language, shortly after a run. */
const SETTLED: Parameters<typeof decideRefresh>[0] = {
  now: NOW,
  eventRunInProgress: false,
  lastEventRunStartedAt: NOW - 5 * MINUTE,
  coveredByLastEventRun: true,
  rankInProgress: false,
  hasRanking: true,
  rankingLanguage: 'es',
  language: 'es',
}

describe('decideRefresh: what opening the people page sets in motion', () => {
  test('nothing, for an attendee with suggestions shortly after a run', () => {
    expect(decideRefresh(SETTLED)).toEqual({ kind: 'none' })
  })

  test("the first request at an event starts the event's first run", () => {
    expect(
      decideRefresh({
        ...SETTLED,
        lastEventRunStartedAt: undefined,
        coveredByLastEventRun: false,
        hasRanking: false,
        rankingLanguage: undefined,
      }),
    ).toEqual({ kind: 'eventRun', trigger: 'attendee' })
  })

  test('while an event run that includes them is under way, the attendee waits', () => {
    expect(
      decideRefresh({
        ...SETTLED,
        eventRunInProgress: true,
        hasRanking: false,
        rankingLanguage: undefined,
        rankInProgress: true,
      }),
    ).toEqual({ kind: 'wait' })
    // Also with an older ranking, or one in another language.
    expect(
      decideRefresh({ ...SETTLED, eventRunInProgress: true, language: 'en' }),
    ).toEqual({ kind: 'wait' })
  })

  test('someone who arrives during a run that does not include them is ranked on their own', () => {
    const arrival = {
      ...SETTLED,
      eventRunInProgress: true,
      coveredByLastEventRun: false,
      hasRanking: false,
      rankingLanguage: undefined,
    }
    expect(decideRefresh(arrival)).toEqual({
      kind: 'ownRank',
      reason: 'missing',
    })
    // Once their own ranking is under way, they wait for it.
    expect(decideRefresh({ ...arrival, rankInProgress: true })).toEqual({
      kind: 'wait',
    })
  })

  test('someone new, soon after the last run, is ranked on their own', () => {
    const arrival = {
      ...SETTLED,
      lastEventRunStartedAt: NOW - EVENT_RUN_INTERVAL_MS + MINUTE,
      coveredByLastEventRun: false,
      hasRanking: false,
      rankingLanguage: undefined,
    }
    expect(decideRefresh(arrival)).toEqual({
      kind: 'ownRank',
      reason: 'missing',
    })
    expect(decideRefresh({ ...arrival, rankInProgress: true })).toEqual({
      kind: 'wait',
    })
  })

  test('someone new, once the interval since the last run has passed, starts a run for everyone', () => {
    expect(
      decideRefresh({
        ...SETTLED,
        lastEventRunStartedAt: NOW - EVENT_RUN_INTERVAL_MS,
        coveredByLastEventRun: false,
        hasRanking: false,
        rankingLanguage: undefined,
      }),
    ).toEqual({ kind: 'eventRun', trigger: 'attendance' })
  })

  test('an attendee whose ranking failed in the last run is ranked on their own, never through a new run', () => {
    expect(
      decideRefresh({
        ...SETTLED,
        lastEventRunStartedAt: NOW - 2 * EVENT_RUN_INTERVAL_MS,
        coveredByLastEventRun: true,
        hasRanking: false,
        rankingLanguage: undefined,
      }),
    ).toEqual({ kind: 'ownRank', reason: 'missing' })
  })

  test('a ranking in another language is redone for that attendee', () => {
    expect(decideRefresh({ ...SETTLED, language: 'en' })).toEqual({
      kind: 'ownRank',
      reason: 'language',
    })
  })

  test('once the interval has passed, an attendee with suggestions checks for new attendees', () => {
    expect(
      decideRefresh({
        ...SETTLED,
        lastEventRunStartedAt: NOW - EVENT_RUN_INTERVAL_MS,
      }),
    ).toEqual({ kind: 'checkAttendance' })
    expect(
      decideRefresh({
        ...SETTLED,
        lastEventRunStartedAt: NOW - EVENT_RUN_INTERVAL_MS + 1,
      }),
    ).toEqual({ kind: 'none' })
  })
})

describe('decideRerankTiming: redoing a ranking for a language switch', () => {
  test('with no earlier request it ranks right away', () => {
    expect(
      decideRerankTiming({ now: NOW, lastRequestedAt: undefined }),
    ).toEqual({ kind: 'now' })
  })

  test('once the interval has passed it ranks right away', () => {
    expect(
      decideRerankTiming({
        now: NOW,
        lastRequestedAt: NOW - RERANK_INTERVAL_MS,
      }),
    ).toEqual({ kind: 'now' })
  })

  test('inside the interval it books one ranking for when the interval ends', () => {
    expect(
      decideRerankTiming({ now: NOW, lastRequestedAt: NOW - MINUTE }),
    ).toEqual({ kind: 'later', runAt: NOW - MINUTE + RERANK_INTERVAL_MS })
  })

  test('while a ranking is booked, another switch books nothing more', () => {
    expect(
      decideRerankTiming({ now: NOW, lastRequestedAt: NOW + 5 * MINUTE }),
    ).toEqual({ kind: 'booked' })
  })
})

describe('cleanSuggestionPicks', () => {
  const userIdByKey = new Map([
    ['p1', 'user_me'],
    ['p2', 'user_ana'],
    ['p3', 'user_bruno'],
    ['p4', 'user_carla'],
  ])
  const clean = (picks: Parameters<typeof cleanSuggestionPicks>[0], max = 10) =>
    cleanSuggestionPicks(picks, { userIdByKey, selfId: 'user_me', max })

  test('keeps known candidates in the order the model gave them', () => {
    expect(
      clean([
        { person: 'p3', reason: 'Bruno needs evals help.', topics: ['Evals'] },
        { person: ' p2 ', reason: ' Ana hires. ', topics: [' Hiring ', ''] },
      ]),
    ).toEqual([
      {
        userId: 'user_bruno',
        reason: 'Bruno needs evals help.',
        topics: ['Evals'],
      },
      { userId: 'user_ana', reason: 'Ana hires.', topics: ['Hiring'] },
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
    ).toEqual([{ userId: 'user_bruno', reason: 'First.', topics: [] }])
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
    expect(result[1].userId).toBe('user_bruno')
  })
})
