import {
  autoApprovesKnownGuests,
  shouldAutoApprove,
} from '../../convex/social/lib'

// Who is approved without an admin (convex/social/events.ts register,
// importAllowlist and updateEvent; convex/social/lumaSync.ts applyLumaGuest).
// Kept under src/ so the Convex bundler never sees a test file.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
}

const known = { status: 'pending_approval', onAllowlist: true } as const

describe('autoApprovesKnownGuests', () => {
  test('an event without the setting auto-approves once it is published', () => {
    expect(autoApprovesKnownGuests({ status: 'published' })).toBe(true)
    expect(autoApprovesKnownGuests({ status: 'closed' })).toBe(true)
    expect(
      autoApprovesKnownGuests({ status: 'published', autoApproveKnown: true }),
    ).toBe(true)
  })

  test('a draft never auto-approves, whatever the setting', () => {
    expect(autoApprovesKnownGuests({ status: 'draft' })).toBe(false)
    expect(
      autoApprovesKnownGuests({ status: 'draft', autoApproveKnown: true }),
    ).toBe(false)
  })

  test('an event with the setting off never auto-approves', () => {
    expect(
      autoApprovesKnownGuests({ status: 'published', autoApproveKnown: false }),
    ).toBe(false)
    expect(
      autoApprovesKnownGuests({ status: 'closed', autoApproveKnown: false }),
    ).toBe(false)
  })
})

describe('shouldAutoApprove', () => {
  test('someone on the allowlist is approved at a published event', () => {
    expect(shouldAutoApprove({ status: 'published' }, known)).toBe(true)
  })

  test('someone not on the allowlist waits for an admin', () => {
    expect(
      shouldAutoApprove(
        { status: 'published' },
        { status: 'pending_approval', onAllowlist: false },
      ),
    ).toBe(false)
  })

  test('nobody is approved on a draft: guests pulled from Luma stay pending', () => {
    expect(shouldAutoApprove({ status: 'draft' }, known)).toBe(false)
  })

  test('nobody is approved at an event that picks its guests', () => {
    expect(
      shouldAutoApprove(
        { status: 'published', autoApproveKnown: false },
        known,
      ),
    ).toBe(false)
  })

  test('only a guest waiting for approval is approved: a decline or a waitlist spot stays', () => {
    for (const status of [
      'declined',
      'waitlist',
      'invited',
      'approved',
    ] as const) {
      expect(
        shouldAutoApprove(
          { status: 'published' },
          { status, onAllowlist: true },
        ),
      ).toBe(false)
    }
  })
})
