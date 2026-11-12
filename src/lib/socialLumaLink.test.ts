import { detailsToFillFromLuma } from '../../convex/social/lib'

// What linking an ASTN event to a Luma event copies from Luma
// (convex/social/lumaSync.ts importLumaEvent). Kept under src/ so the Convex
// bundler never sees a test file.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

describe('detailsToFillFromLuma', () => {
  const luma = { venueAddress: 'Av. Corrientes 1234', description: 'Charla' }

  test('an ASTN event with no description or address takes both from Luma', () => {
    expect(detailsToFillFromLuma({}, luma)).toEqual(luma)
  })

  test('a description or address written in ASTN is kept', () => {
    expect(
      detailsToFillFromLuma(
        { venueAddress: 'Sala 2', description: 'Texto del admin' },
        luma,
      ),
    ).toEqual({})
    expect(
      detailsToFillFromLuma({ description: 'Texto del admin' }, luma),
    ).toEqual({ venueAddress: 'Av. Corrientes 1234' })
  })

  test('nothing is copied when Luma has neither', () => {
    expect(detailsToFillFromLuma({}, {})).toEqual({})
  })
})
