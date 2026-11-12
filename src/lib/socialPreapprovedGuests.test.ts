import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APPROVED_GUESTS_READ_LIMIT,
  MAX_PREAPPROVED_GUESTS_PER_ADD,
  PREAPPROVED_ADD_APPROVED_LIMIT,
  planPreapprovedAdd,
} from '../../convex/social/constants'
import {
  keepsStatusOverLuma,
  lumaStatusToPush,
  shouldAutoApprove,
} from '../../convex/social/lib'

// Adding people from the org's pre-approved list to an event as approved
// guests (convex/social/events.ts addPreapprovedGuests, and the "Preaprobados"
// tab that calls it). Kept under src/ so the Convex bundler never sees a test
// file.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

const ORG = 'org-baish'
const ana = { orgId: ORG, email: 'ana@example.com', name: 'Ana' }
const beto = { orgId: ORG, email: 'beto@example.com' }

function plan(
  selected: Parameters<typeof planPreapprovedAdd>[0]['selected'],
  options: { guestEmails?: Array<string>; approvedCount?: number } = {},
) {
  return planPreapprovedAdd({
    orgId: ORG,
    selected,
    guestEmails: new Set(options.guestEmails ?? []),
    approvedCount: options.approvedCount ?? 0,
  })
}

describe('planPreapprovedAdd', () => {
  test('with nobody selected nobody is added, however long the org list is', () => {
    expect(plan([])).toEqual({
      toAdd: [],
      alreadyGuest: 0,
      invalid: 0,
      overLimitBy: 0,
    })
  })

  test('only the selected people are added, with the name the list has', () => {
    expect(plan([ana, beto]).toAdd).toEqual([
      { email: 'ana@example.com', name: 'Ana' },
      { email: 'beto@example.com', name: undefined },
    ])
    expect(plan([beto]).toAdd).toEqual([
      { email: 'beto@example.com', name: undefined },
    ])
  })

  test('someone who already has a guest row for the event is skipped', () => {
    const result = plan([ana, beto], { guestEmails: ['ana@example.com'] })
    expect(result.toAdd).toEqual([
      { email: 'beto@example.com', name: undefined },
    ])
    expect(result.alreadyGuest).toBe(1)
  })

  test('someone selected twice is added once', () => {
    const result = plan([ana, ana])
    expect(result.toAdd.length).toBe(1)
    expect(result.alreadyGuest).toBe(1)
  })

  test('an entry that was removed, is from another org or has no email address is invalid', () => {
    const result = plan([
      null,
      { orgId: 'org-other', email: 'carla@example.com' },
      { orgId: ORG, email: 'not an email' },
      ana,
    ])
    expect(result.invalid).toBe(3)
    expect(result.toAdd).toEqual([{ email: 'ana@example.com', name: 'Ana' }])
  })

  test('the event takes people until it has the limit of approved guests', () => {
    const atLimit = PREAPPROVED_ADD_APPROVED_LIMIT
    expect(plan([ana, beto], { approvedCount: atLimit - 2 }).overLimitBy).toBe(
      0,
    )
    expect(plan([ana, beto], { approvedCount: atLimit - 1 }).overLimitBy).toBe(
      1,
    )
    expect(plan([ana, beto], { approvedCount: atLimit + 50 }).overLimitBy).toBe(
      2,
    )
  })

  test('people already at the event do not count against the limit', () => {
    expect(
      plan([ana], {
        guestEmails: ['ana@example.com'],
        approvedCount: PREAPPROVED_ADD_APPROVED_LIMIT,
      }).overLimitBy,
    ).toBe(0)
  })

  test('the limit leaves room for registrations under what the attendee pages read', () => {
    expect(PREAPPROVED_ADD_APPROVED_LIMIT < APPROVED_GUESTS_READ_LIMIT).toBe(
      true,
    )
    expect(APPROVED_GUESTS_READ_LIMIT).toBe(500)
  })

  test("one press on a Luma-linked event leaves a fifth of Luma's 200 requests a minute free", () => {
    // A new guest costs at most four requests: the calendar check, look up,
    // add, read back.
    expect(MAX_PREAPPROVED_GUESTS_PER_ADD * 4 <= 160).toBe(true)
  })
})

describe('a guest added from the pre-approved list', () => {
  const added = { status: 'approved', source: 'allowlist' } as const

  test('is sent to Luma as approved, like any approval', () => {
    expect(lumaStatusToPush(added)).toBe('approved')
  })

  test('keeps the approval while the push to Luma is on its way or failed', () => {
    expect(keepsStatusOverLuma({ ...added, lumaSync: 'pending' })).toBe(true)
    expect(keepsStatusOverLuma({ ...added, lumaSync: 'error' })).toBe(true)
  })
})

// Being on the pre-approved list still does nothing by itself: the list only
// approves a registration that exists, and only the admin's button creates a
// guest row for someone who has not registered.
describe('when nobody presses the button', () => {
  const srcDir = fileURLToPath(new URL('..', import.meta.url)).replace(
    /\/$/,
    '',
  )
  const convexDir = join(srcDir, '../convex')

  function sourceFiles(dir: string): Array<string> {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        return entry.name === '_generated' ? [] : sourceFiles(path)
      }
      return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')
        ? [path]
        : []
    })
  }

  function filesMentioning(dir: string, text: string): Array<string> {
    return sourceFiles(dir)
      .filter((path) => readFileSync(path, 'utf8').includes(text))
      .map((path) => path.slice(dir.length + 1))
      .sort()
  }

  test('the pre-approved list approves a pending registration and nothing else', () => {
    const published = { status: 'published' } as const
    expect(
      shouldAutoApprove(published, {
        status: 'pending_approval',
        onAllowlist: true,
      }),
    ).toBe(true)
    for (const status of ['declined', 'waitlist', 'invited'] as const) {
      expect(shouldAutoApprove(published, { status, onAllowlist: true })).toBe(
        false,
      )
    }
  })

  test('no backend code calls the mutation: no cron, migration, import or webhook adds these guests', () => {
    expect(filesMentioning(convexDir, 'addPreapprovedGuests')).toEqual([
      'social/events.ts',
    ])
  })

  test('guest rows marked as added from the list are written in one place', () => {
    expect(filesMentioning(convexDir, "source: 'allowlist'")).toEqual([
      'social/events.ts',
    ])
  })

  test('the only caller in the app is the Preaprobados tab of an event', () => {
    expect(filesMentioning(srcDir, 'addPreapprovedGuests')).toEqual([
      'components/social-admin/AllowlistTab.tsx',
    ])
  })
})
