import { detailsToFillFromLuma, lumaStateReset } from '../../convex/social/lib'

// What linking an ASTN event to a Luma event copies from Luma
// (convex/social/lumaSync.ts importLumaEvent), and what its guests forget
// when the link changes or goes away (convex/social/events.ts linkLumaEvent,
// unlinkLumaEvent). Kept under src/ so the Convex bundler never sees a test
// file.

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

// A patch value of undefined removes the field, so the tests check which
// keys the patch has, not only their values.
describe('lumaStateReset', () => {
  const synced = {
    lumaGuestId: 'gst-old',
    lumaCheckInCode: 'https://luma.com/check-in/evt-old?pk=g-1',
    lumaSync: 'synced' as const,
  }
  const keys = (patch: object | null) =>
    patch ? Object.keys(patch).sort() : []

  test('forgets the Luma guest id, the ticket code and the sync state', () => {
    const patch = lumaStateReset(synced, { clearLumaCheckIns: true })
    expect(keys(patch)).toEqual(['lumaCheckInCode', 'lumaGuestId', 'lumaSync'])
    expect(patch?.lumaSync).toBe('not_linked')
    expect(patch?.lumaGuestId).toBe(undefined)
    expect(patch?.lumaCheckInCode).toBe(undefined)
  })

  test('a failed push is forgotten too, error included', () => {
    const patch = lumaStateReset(
      { lumaSync: 'error', lumaSyncError: 'Luma POST failed (500)' },
      { clearLumaCheckIns: false },
    )
    expect(keys(patch)).toEqual(['lumaSync', 'lumaSyncError'])
    expect(patch?.lumaSync).toBe('not_linked')
  })

  test('linking another Luma event removes check-ins made in Luma', () => {
    const patch = lumaStateReset(
      { ...synced, checkedInAt: 1000, checkInSource: 'luma' },
      { clearLumaCheckIns: true },
    )
    expect(keys(patch)).toEqual([
      'checkInSource',
      'checkedInAt',
      'lumaCheckInCode',
      'lumaGuestId',
      'lumaSync',
    ])
    expect(patch?.checkedInAt).toBe(undefined)
  })

  test('a check-in with no recorded source counts as made in Luma', () => {
    const patch = lumaStateReset(
      { lumaSync: 'not_linked', checkedInAt: 1000 },
      { clearLumaCheckIns: true },
    )
    expect(keys(patch)).toEqual(['checkInSource', 'checkedInAt'])
  })

  test('a check-in made at the ASTN door always stays', () => {
    const patch = lumaStateReset(
      { ...synced, checkedInAt: 1000, checkInSource: 'astn' },
      { clearLumaCheckIns: true },
    )
    expect(keys(patch)).toEqual(['lumaCheckInCode', 'lumaGuestId', 'lumaSync'])
  })

  test('unlinking keeps check-ins made in Luma', () => {
    const patch = lumaStateReset(
      { ...synced, checkedInAt: 1000, checkInSource: 'luma' },
      { clearLumaCheckIns: false },
    )
    expect(keys(patch)).toEqual(['lumaCheckInCode', 'lumaGuestId', 'lumaSync'])
  })

  test('a row with nothing from Luma needs no patch', () => {
    expect(
      lumaStateReset({ lumaSync: 'not_linked' }, { clearLumaCheckIns: true }),
    ).toBe(null)
    expect(
      lumaStateReset(
        { lumaSync: 'not_linked', checkedInAt: 1000, checkInSource: 'astn' },
        { clearLumaCheckIns: true },
      ),
    ).toBe(null)
  })
})
