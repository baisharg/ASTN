import {
  PERSONAL_LINK_MAX_SECONDS,
  PERSONAL_LINK_MIN_SECONDS,
  eventPageUrl,
  personalEventLink,
  personalLinkLifetimeSeconds,
  personalLinkRefusal,
  splitGuestName,
} from '../../convex/social/constants'

// The rules of personal event links in convex/social/constants.ts: who may
// get one, how long it works and what its address looks like. Kept under
// src/ so the Convex bundler never sees a test file.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

const HOUR = 3600
const DAY = 24 * HOUR

describe('personalLinkRefusal', () => {
  const unusedAccount = {
    kind: 'existing' as const,
    emailIsVerifiedPrimary: true,
    hasSignedIn: false,
    hasAstnData: false,
    hasAdminRole: false,
  }

  test('a guest whose email has no account gets a link (and an account)', () => {
    expect(
      personalLinkRefusal({
        account: { kind: 'none' },
        emailHasOtherData: false,
      }),
    ).toBe(null)
  })

  test('an account nobody has signed in to gets a link again', () => {
    expect(
      personalLinkRefusal({ account: unusedAccount, emailHasOtherData: false }),
    ).toBe(null)
  })

  test('an account someone has signed in to never gets a link', () => {
    expect(
      personalLinkRefusal({
        account: { ...unusedAccount, hasSignedIn: true },
        emailHasOtherData: false,
      }),
    ).toBe('account_in_use')
  })

  test('an account the site holds data for never gets a link, whatever Clerk says about sign-ins', () => {
    expect(
      personalLinkRefusal({
        account: { ...unusedAccount, hasAstnData: true },
        emailHasOtherData: false,
      }),
    ).toBe('account_in_use')
  })

  test('an account that only has the email as a secondary or unverified address gets no link', () => {
    expect(
      personalLinkRefusal({
        account: { ...unusedAccount, emailIsVerifiedPrimary: false },
        emailHasOtherData: false,
      }),
    ).toBe('email_not_primary')
  })

  test('an account that administers an organization gets no link, even unused', () => {
    expect(
      personalLinkRefusal({
        account: { ...unusedAccount, hasAdminRole: true },
        emailHasOtherData: false,
      }),
    ).toBe('account_has_role')
  })

  test('an email with data outside the organization gets no link, with or without an account', () => {
    expect(
      personalLinkRefusal({
        account: { kind: 'none' },
        emailHasOtherData: true,
      }),
    ).toBe('email_has_other_data')
    expect(
      personalLinkRefusal({ account: unusedAccount, emailHasOtherData: true }),
    ).toBe('email_has_other_data')
  })
})

describe('personalLinkLifetimeSeconds', () => {
  const now = Date.UTC(2026, 10, 12, 18, 0)

  test('a link made on Thursday works until the 1:1s close on Saturday', () => {
    const closeAt = Date.UTC(2026, 10, 14, 22, 0)
    expect(personalLinkLifetimeSeconds(now, closeAt)).toBe(2 * DAY + 4 * HOUR)
  })

  test('a link for an event far away works for the maximum only', () => {
    expect(PERSONAL_LINK_MAX_SECONDS).toBe(7 * DAY)
    expect(personalLinkLifetimeSeconds(now, now + 30 * DAY * 1000)).toBe(
      7 * DAY,
    )
  })

  test('a link made at the end of the event, or after it, works for the minimum', () => {
    expect(PERSONAL_LINK_MIN_SECONDS).toBe(HOUR)
    expect(personalLinkLifetimeSeconds(now, now + 60_000)).toBe(HOUR)
    expect(personalLinkLifetimeSeconds(now, now - DAY * 1000)).toBe(HOUR)
  })
})

describe('personal link addresses', () => {
  test('the event page address is the one attendees already use', () => {
    expect(eventPageUrl('https://safetytalent.org', 'baish', 'social')).toBe(
      'https://safetytalent.org/org/baish/e/social',
    )
    expect(eventPageUrl('https://safetytalent.org/', 'baish', 'social')).toBe(
      'https://safetytalent.org/org/baish/e/social',
    )
  })

  test('the token goes in the fragment, which is not sent to the server', () => {
    const link = personalEventLink(
      'https://safetytalent.org/org/baish/e/social',
      'a.b/c+d',
    )
    expect(link).toBe(
      'https://safetytalent.org/org/baish/e/social#ticket=a.b%2Fc%2Bd',
    )
    const url = new URL(link)
    expect(url.search).toBe('')
    expect(url.pathname).toBe('/org/baish/e/social')
  })
})

describe('splitGuestName', () => {
  test('the first word is the first name and the rest the last name', () => {
    expect(splitGuestName('Ana María Pérez')).toEqual({
      firstName: 'Ana',
      lastName: 'María Pérez',
    })
    expect(splitGuestName('  Ana  ')).toEqual({ firstName: 'Ana' })
  })

  test('no name gives no names', () => {
    expect(splitGuestName(undefined)).toEqual({})
    expect(splitGuestName(null)).toEqual({})
    expect(splitGuestName('   ')).toEqual({})
  })
})
