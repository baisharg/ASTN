import {
  configuredOwnerSlug,
  orgsBoundByOwnerSlug,
} from '../../convex/luma/binding'

// Which org may use LUMA_API_KEY when LUMA_OWNER_ORG_SLUG is set
// (convex/luma/binding.ts orgsForCalendar). Kept under src/ so the Convex
// bundler never sees a test file.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

describe('configuredOwnerSlug', () => {
  const withEnv = (value: string | undefined, check: () => void) => {
    const before = process.env.LUMA_OWNER_ORG_SLUG
    if (value === undefined) delete process.env.LUMA_OWNER_ORG_SLUG
    else process.env.LUMA_OWNER_ORG_SLUG = value
    try {
      check()
    } finally {
      if (before === undefined) delete process.env.LUMA_OWNER_ORG_SLUG
      else process.env.LUMA_OWNER_ORG_SLUG = before
    }
  }

  test('is null when the variable is unset or blank, so the org settings decide', () => {
    withEnv(undefined, () => expect(configuredOwnerSlug()).toBe(null))
    withEnv('   ', () => expect(configuredOwnerSlug()).toBe(null))
  })

  test('is the slug, trimmed and lowercased, when it is set', () => {
    withEnv(' BAISH ', () => expect(configuredOwnerSlug()).toBe('baish'))
  })
})

describe('orgsBoundByOwnerSlug', () => {
  test("the org with the owner slug is bound to the key's calendar", () => {
    expect(
      orgsBoundByOwnerSlug({
        calendarId: 'cal-key',
        keyCalendarId: 'cal-key',
        orgsWithOwnerSlug: ['org-owner'],
      }),
    ).toEqual(['org-owner'])
  })

  test('it is not bound to any other calendar', () => {
    expect(
      orgsBoundByOwnerSlug({
        calendarId: 'cal-other',
        keyCalendarId: 'cal-key',
        orgsWithOwnerSlug: ['org-owner'],
      }),
    ).toEqual([])
  })

  test('a slug no org has binds nobody', () => {
    expect(
      orgsBoundByOwnerSlug({
        calendarId: 'cal-key',
        keyCalendarId: 'cal-key',
        orgsWithOwnerSlug: [],
      }),
    ).toEqual([])
  })

  test('a slug two orgs share binds nobody', () => {
    expect(
      orgsBoundByOwnerSlug({
        calendarId: 'cal-key',
        keyCalendarId: 'cal-key',
        orgsWithOwnerSlug: ['org-a', 'org-b'],
      }),
    ).toEqual([])
  })

  test("nobody is bound before the key's calendar has been read", () => {
    expect(
      orgsBoundByOwnerSlug({
        calendarId: 'cal-key',
        keyCalendarId: null,
        orgsWithOwnerSlug: ['org-owner'],
      }),
    ).toEqual([])
  })
})
