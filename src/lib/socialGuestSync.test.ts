import { hasStatusLumaLacks } from '../../convex/social/lib'

// Which guest rows keep their ASTN status when Luma reports a different one
// (convex/social/lumaSync.ts applyLumaGuest). Kept under src/ so the Convex
// bundler never sees a test file.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
}

describe('hasStatusLumaLacks', () => {
  test('a status still being pushed to Luma is kept', () => {
    expect(hasStatusLumaLacks('pending')).toBe(true)
  })

  test('a status whose push failed is kept, so a pull cannot undo an admin decision', () => {
    expect(hasStatusLumaLacks('error')).toBe(true)
  })

  test('a status Luma already has follows what Luma reports', () => {
    expect(hasStatusLumaLacks('synced')).toBe(false)
  })

  test('a guest of an event not linked to Luma follows Luma once it is linked', () => {
    expect(hasStatusLumaLacks('not_linked')).toBe(false)
  })
})
