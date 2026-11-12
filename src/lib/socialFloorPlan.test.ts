import { isFreshImageUpload } from '../../convex/social/lib'

// Which stored files an admin may attach as an event's floor plan
// (convex/social/events.ts setFloorPlan). Kept under src/ so the Convex
// bundler never sees a test file.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
}

describe('isFreshImageUpload', () => {
  const now = 1_800_000_000_000
  const minutes = (n: number) => n * 60 * 1000

  test('an image uploaded a moment ago is accepted', () => {
    expect(
      isFreshImageUpload(
        { _creationTime: now - 2000, contentType: 'image/png' },
        now,
      ),
    ).toBe(true)
    expect(
      isFreshImageUpload(
        { _creationTime: now - minutes(14), contentType: 'IMAGE/JPEG' },
        now,
      ),
    ).toBe(true)
  })

  test('an image uploaded more than 15 minutes ago is rejected', () => {
    expect(
      isFreshImageUpload(
        { _creationTime: now - minutes(16), contentType: 'image/png' },
        now,
      ),
    ).toBe(false)
  })

  test('a file that is not an image is rejected, however recent', () => {
    expect(
      isFreshImageUpload(
        { _creationTime: now - 2000, contentType: 'application/pdf' },
        now,
      ),
    ).toBe(false)
    expect(isFreshImageUpload({ _creationTime: now - 2000 }, now)).toBe(false)
  })

  test('an id with no stored file is rejected', () => {
    expect(isFreshImageUpload(null, now)).toBe(false)
  })
})
