import { keepsStatusOverLuma } from '../../convex/social/lib'

// Which guest rows keep their ASTN status when Luma reports a different one
// (convex/social/lumaSync.ts applyLumaGuest). Kept under src/ so the Convex
// bundler never sees a test file.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
}

describe('keepsStatusOverLuma', () => {
  test('any status still being pushed to Luma is kept', () => {
    expect(keepsStatusOverLuma({ status: 'approved', lumaSync: 'pending' })).toBe(
      true,
    )
    expect(
      keepsStatusOverLuma({ status: 'pending_approval', lumaSync: 'pending' }),
    ).toBe(true)
  })

  test('an approve or decline whose push failed is kept, so a pull cannot undo it', () => {
    expect(keepsStatusOverLuma({ status: 'approved', lumaSync: 'error' })).toBe(
      true,
    )
    expect(keepsStatusOverLuma({ status: 'declined', lumaSync: 'error' })).toBe(
      true,
    )
  })

  test('a registration whose push failed follows Luma, so an approval made in Luma reaches ASTN', () => {
    expect(
      keepsStatusOverLuma({ status: 'pending_approval', lumaSync: 'error' }),
    ).toBe(false)
    expect(keepsStatusOverLuma({ status: 'waitlist', lumaSync: 'error' })).toBe(
      false,
    )
    expect(keepsStatusOverLuma({ status: 'invited', lumaSync: 'error' })).toBe(
      false,
    )
  })

  test('a status Luma already has follows what Luma reports', () => {
    expect(keepsStatusOverLuma({ status: 'approved', lumaSync: 'synced' })).toBe(
      false,
    )
  })

  test('a guest of an event not linked to Luma follows Luma once it is linked', () => {
    expect(
      keepsStatusOverLuma({ status: 'approved', lumaSync: 'not_linked' }),
    ).toBe(false)
  })
})
