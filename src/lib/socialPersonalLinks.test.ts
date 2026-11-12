import {
  PERSONAL_LINK_IN_FLIGHT_MS,
  PERSONAL_LINK_MAX_SECONDS,
  PERSONAL_LINK_MIN_SECONDS,
  eventPageUrl,
  openPersonalLinkTokens,
  personalEventLink,
  personalLinkInFlight,
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

  test('a link made in the last minutes of the 1:1s works for the minimum', () => {
    expect(PERSONAL_LINK_MIN_SECONDS).toBe(HOUR)
    expect(personalLinkLifetimeSeconds(now, now + 60_000)).toBe(HOUR)
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

describe('one working link per account', () => {
  const now = Date.UTC(2026, 10, 12, 18, 0)
  const row = (
    id: string,
    fields: {
      createdAt?: number
      expiresAt?: number
      finishedAt?: number
      signInTokenId?: string
      tokenClosedAt?: number
    },
  ) => ({
    _id: id,
    createdAt: now - 3_600_000,
    expiresAt: now + 3_600_000,
    ...fields,
  })

  test('an account no link was made for has nothing in flight and nothing to revoke', () => {
    expect(personalLinkInFlight([], now)).toBe(false)
    expect(openPersonalLinkTokens([], now)).toEqual([])
  })

  test('an attempt that has not finished blocks a second one, until it is taken for dead', () => {
    const started = row('a', { createdAt: now - 5_000 })
    expect(personalLinkInFlight([started], now)).toBe(true)
    expect(
      personalLinkInFlight(
        [row('a', { createdAt: now - PERSONAL_LINK_IN_FLIGHT_MS })],
        now,
      ),
    ).toBe(false)
    expect(
      personalLinkInFlight([{ ...started, finishedAt: now - 1_000 }], now),
    ).toBe(false)
  })

  test('the tokens to revoke are the ones made, not expired and not closed', () => {
    const rows = [
      row('open', { finishedAt: now - 10, signInTokenId: 'sit_open' }),
      // An attempt that died after its token was recorded.
      row('died', { signInTokenId: 'sit_died' }),
      row('closed', { signInTokenId: 'sit_closed', tokenClosedAt: now - 5 }),
      row('expired', { signInTokenId: 'sit_expired', expiresAt: now }),
      row('refused', { finishedAt: now - 10 }),
    ]
    expect(openPersonalLinkTokens(rows, now)).toEqual([
      { logId: 'open', signInTokenId: 'sit_open' },
      { logId: 'died', signInTokenId: 'sit_died' },
    ])
  })
})
