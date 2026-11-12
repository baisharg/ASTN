import {
  MAX_SUGGESTIONS,
  SUGGESTION_CAP,
  assignSuggestions,
} from '../../convex/social/suggestions'

// The event-wide assignment that turns every attendee's ranked candidates
// into their suggestions (convex/social/suggestions.ts assignSuggestions).
// Kept under src/ so the Convex bundler never sees a test file.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

type Rankings = Record<string, Array<string>>

/** Run the assignment over `{ attendee: [candidates, best first] }`. */
function assign(
  rankings: Rankings,
  options: {
    perAttendee?: number
    cap?: number
    metPairs?: Array<[string, string]>
    eligible?: Array<string>
  } = {},
): Rankings {
  const result = assignSuggestions({
    rankings: Object.entries(rankings).map(([userId, candidates]) => ({
      userId,
      candidates,
    })),
    eligibleUserIds: options.eligible ?? Object.keys(rankings),
    metPairs: options.metPairs ?? [],
    perAttendee: options.perAttendee ?? MAX_SUGGESTIONS,
    cap: options.cap ?? SUGGESTION_CAP,
  })
  return Object.fromEntries(result)
}

/** How many attendees each person is suggested to. */
function timesSuggested(result: Rankings): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const picks of Object.values(result)) {
    for (const pick of picks) counts[pick] = (counts[pick] ?? 0) + 1
  }
  return counts
}

describe('assignSuggestions: the basics', () => {
  test('each attendee gets their best candidates, best first', () => {
    expect(
      assign({
        ana: ['bruno', 'carla', 'dani'],
        bruno: ['dani', 'ana'],
        carla: ['ana'],
        dani: ['carla', 'bruno', 'ana'],
      }),
    ).toEqual({
      ana: ['bruno', 'carla', 'dani'],
      bruno: ['dani', 'ana'],
      carla: ['ana'],
      dani: ['carla', 'bruno', 'ana'],
    })
  })

  test('nobody gets more than the per-attendee limit', () => {
    const others = ['b', 'c', 'd', 'e', 'f', 'g', 'h']
    const rankings: Rankings = { a: others }
    for (const other of others) rankings[other] = []
    expect(assign(rankings).a).toEqual(['b', 'c', 'd', 'e', 'f'])
  })

  test('nobody is suggested to themselves', () => {
    expect(assign({ a: ['a', 'b'], b: ['b', 'a'] })).toEqual({
      a: ['b'],
      b: ['a'],
    })
  })

  test('a candidate listed twice is suggested once', () => {
    expect(assign({ a: ['b', 'b', 'c'], b: [], c: [] }).a).toEqual(['b', 'c'])
  })

  test('an attendee with no candidates gets an empty list', () => {
    expect(assign({ a: [], b: ['a'] })).toEqual({ a: [], b: ['a'] })
  })

  test('an attendee whose candidates run out gets fewer suggestions', () => {
    expect(assign({ a: ['b'], b: ['a', 'c'], c: [] }).a).toEqual(['b'])
  })
})

describe('assignSuggestions: who is eligible', () => {
  test('someone who is no longer an attendee is not suggested', () => {
    expect(
      assign({ a: ['gone', 'b'], b: ['a', 'gone'] }, { eligible: ['a', 'b'] }),
    ).toEqual({ a: ['b'], b: ['a'] })
  })

  test('someone who is no longer an attendee gets no suggestions', () => {
    expect(
      assign(
        { a: ['b'], gone: ['a', 'b'], b: ['a'] },
        { eligible: ['a', 'b'] },
      ),
    ).toEqual({ a: ['b'], b: ['a'] })
  })

  test('an attendee without a ranking can still be suggested', () => {
    expect(assign({ a: ['b'] }, { eligible: ['a', 'b'] })).toEqual({
      a: ['b'],
    })
  })
})

describe('assignSuggestions: pairs who met', () => {
  test('a pair who met is not suggested, whichever way round it is recorded', () => {
    expect(
      assign(
        { a: ['b', 'c'], b: ['a', 'c'], c: ['a', 'b'] },
        { metPairs: [['b', 'a']] },
      ),
    ).toEqual({ a: ['c'], b: ['c'], c: ['a', 'b'] })
  })

  test('the next candidate takes the place of the one already met', () => {
    const rankings = {
      a: ['b', 'c', 'd', 'e', 'f', 'g'],
      b: [],
      c: [],
      d: [],
      e: [],
      f: [],
      g: [],
    }
    expect(assign(rankings).a).toEqual(['b', 'c', 'd', 'e', 'f'])
    expect(assign(rankings, { metPairs: [['a', 'c']] }).a).toEqual([
      'b',
      'd',
      'e',
      'f',
      'g',
    ])
  })

  test('someone who met everyone on their list gets nobody', () => {
    expect(
      assign(
        { a: ['b', 'c'], b: [], c: [] },
        {
          metPairs: [
            ['a', 'b'],
            ['c', 'a'],
          ],
        },
      ).a,
    ).toEqual([])
  })
})

describe('assignSuggestions: the cap on how often one person is suggested', () => {
  test('a person everyone ranks first is suggested to at most `cap` attendees', () => {
    const fans = ['a', 'b', 'c', 'd', 'e', 'f']
    const rankings: Rankings = { star: [] }
    for (const fan of fans) rankings[fan] = ['star', 'other']
    rankings.other = []
    const result = assign(rankings, { cap: 3 })
    expect(timesSuggested(result)).toEqual({ star: 3, other: 3 })
    // The first three in turn order get the star and the rest their next
    // best, which is then at the cap too.
    expect(result.a).toEqual(['star'])
    expect(result.c).toEqual(['star'])
    expect(result.d).toEqual(['other'])
    expect(result.f).toEqual(['other'])
  })

  test('the cap is never exceeded to fill a list', () => {
    const result = assign({ a: ['x'], b: ['x'], c: ['x'], x: [] }, { cap: 2 })
    expect(result).toEqual({ a: ['x'], b: ['x'], c: [], x: [] })
  })

  test('with the real limits the cap cannot bind in an event of nine', () => {
    // Each person can be suggested to the eight others at most.
    const people = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
    const rankings: Rankings = {}
    for (const person of people) {
      rankings[person] = people.filter((other) => other !== person)
    }
    const result = assign(rankings)
    for (const person of people) {
      expect(result[person]).toEqual(rankings[person].slice(0, MAX_SUGGESTIONS))
    }
  })
})

describe('assignSuggestions: fairness', () => {
  test('everyone gets a first pick before anyone gets a second', () => {
    // Picking attendee by attendee, `a` would take both and leave `b` none.
    expect(
      assign({ a: ['x', 'y'], b: ['x', 'y'], x: [], y: [] }, { cap: 1 }),
    ).toEqual({ a: ['x'], b: ['y'], x: [], y: [] })
  })

  test('turns reverse every other round, so the last to choose chooses first next', () => {
    const wanted = ['p', 'q', 'r', 's', 't', 'u']
    const rankings: Rankings = { a: wanted, b: wanted, c: wanted }
    for (const person of wanted) rankings[person] = []
    const result = assign(rankings, { cap: 1, perAttendee: 2 })
    // Round 1 in order a, b, c; round 2 in order c, b, a.
    expect(result.a).toEqual(['p', 'u'])
    expect(result.b).toEqual(['q', 't'])
    expect(result.c).toEqual(['r', 's'])
  })

  test('the result does not depend on the order the rankings are given in', () => {
    const rankings: Rankings = {
      a: ['x', 'y'],
      b: ['x', 'y'],
      c: ['y', 'x'],
      x: ['a'],
      y: ['b'],
    }
    const reversed = Object.fromEntries(Object.entries(rankings).reverse())
    expect(assign(reversed, { cap: 2 })).toEqual(assign(rankings, { cap: 2 }))
  })
})

describe('assignSuggestions: a worked example with six attendees', () => {
  // Small limits so the cap binds: two suggestions each, and nobody suggested
  // to more than two people. Ana and Bruno already met.
  const rankings: Rankings = {
    ana: ['fede', 'bruno', 'carla', 'dani'],
    bruno: ['fede', 'ana', 'eva'],
    carla: ['fede', 'eva', 'ana'],
    dani: ['fede', 'carla', 'bruno'],
    eva: [],
    fede: ['ana', 'bruno', 'carla'],
  }

  test('round by round, with the cap and the met pair applied', () => {
    expect(
      assign(rankings, {
        perAttendee: 2,
        cap: 2,
        metPairs: [['ana', 'bruno']],
      }),
    ).toEqual({
      // Round 1 (ana → fede): ana fede, bruno fede, then fede is at the cap:
      // carla eva, dani carla, eva nobody, fede ana.
      // Round 2 (fede → ana): fede bruno, eva nobody, dani bruno, carla ana,
      // bruno eva (fede is taken, ana he met), ana carla (bruno she met).
      ana: ['fede', 'carla'],
      bruno: ['fede', 'eva'],
      carla: ['eva', 'ana'],
      dani: ['carla', 'bruno'],
      eva: [],
      fede: ['ana', 'bruno'],
    })
  })

  test('with the real limits everyone gets their whole list, minus who they met', () => {
    expect(assign(rankings, { metPairs: [['ana', 'bruno']] })).toEqual({
      ana: ['fede', 'carla', 'dani'],
      bruno: ['fede', 'eva'],
      carla: ['fede', 'eva', 'ana'],
      dani: ['fede', 'carla', 'bruno'],
      eva: [],
      fede: ['ana', 'bruno', 'carla'],
    })
  })
})

describe('assignSuggestions: every rule at once, on a larger event', () => {
  // 40 attendees with made-up but repeatable rankings that all favour the
  // same few people, so the cap binds.
  const people = Array.from({ length: 40 }, (_, i) => `u${i + 10}`)
  let seed = 7
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const rankings: Rankings = {}
  for (const person of people) {
    const popular = people.slice(0, 6).filter((p) => p !== person)
    const rest = people
      .slice(6)
      .filter((p) => p !== person)
      .sort(() => random() - 0.5)
    rankings[person] = [...popular, ...rest].slice(0, 10)
  }
  const metPairs: Array<[string, string]> = [
    ['u10', 'u20'],
    ['u31', 'u11'],
    ['u12', 'u13'],
  ]
  const result = assign(rankings, { metPairs })

  test('nobody is suggested to more attendees than the cap', () => {
    const counts = timesSuggested(result)
    expect(Math.max(...Object.values(counts))).toBe(SUGGESTION_CAP)
  })

  test('every list is within the limit, in ranking order, without repeats or the attendee', () => {
    for (const person of people) {
      const picks = result[person]
      expect(picks.length <= MAX_SUGGESTIONS).toBe(true)
      expect(new Set(picks).size).toBe(picks.length)
      expect(picks.includes(person)).toBe(false)
      const positions = picks.map((pick) => rankings[person].indexOf(pick))
      expect(positions.every((p) => p >= 0)).toBe(true)
      expect(positions).toEqual([...positions].sort((a, b) => a - b))
    }
  })

  test('no pair who met is suggested', () => {
    for (const [a, b] of metPairs) {
      expect(result[a].includes(b)).toBe(false)
      expect(result[b].includes(a)).toBe(false)
    }
  })

  test('running it again gives the same result', () => {
    expect(assign(rankings, { metPairs })).toEqual(result)
  })
})
