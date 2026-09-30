import { mergeGuest, type Attendee } from '../../../convex/mcp/people'

// Tests for event_attendance's merge of Luma history with ASTN guests
// (convex/mcp/people.ts). Kept under src/ so the Convex bundler never sees
// a test file.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

const lumaRow = (over: Partial<Attendee> = {}): Attendee => ({
  contactId: 'c1' as Attendee['contactId'],
  name: 'Ana',
  email: 'ana@example.org',
  status: 'approved',
  checkedIn: false,
  checkedInAt: null,
  checkInSource: null,
  source: 'luma',
  astnStatus: null,
  ...over,
})

const guest = (over: Record<string, unknown> = {}) =>
  ({
    email: 'ana@example.org',
    name: 'Ana G',
    status: 'approved',
    ...over,
  }) as Parameters<typeof mergeGuest>[1]

describe('mergeGuest', () => {
  test('an unchecked ASTN row keeps a Luma check-in', () => {
    const luma = lumaRow({
      status: 'checked_in',
      checkedIn: true,
      checkedInAt: 100,
      checkInSource: 'luma',
    })
    const m = mergeGuest(luma, guest(), null)
    expect(m.checkedIn).toBe(true)
    expect(m.status).toBe('checked_in')
    expect(m.checkedInAt).toBe(100)
    expect(m.checkInSource).toBe('luma')
    expect(m.source).toBe('both')
  })

  test('an ASTN door check-in wins with its own time and source', () => {
    const m = mergeGuest(
      lumaRow(),
      guest({ checkedInAt: 200, checkInSource: 'astn' }),
      null,
    )
    expect(m.checkedIn).toBe(true)
    expect(m.status).toBe('checked_in')
    expect(m.checkedInAt).toBe(200)
    expect(m.checkInSource).toBe('astn')
  })

  test('no check-in anywhere: ASTN status, pending_approval → pending', () => {
    const m = mergeGuest(lumaRow(), guest({ status: 'pending_approval' }), null)
    expect(m.checkedIn).toBe(false)
    expect(m.status).toBe('pending')
    expect(m.astnStatus).toBe('pending_approval')
    expect(m.checkInSource).toBe(null)
  })

  test('ASTN-only guest takes the matched contact', () => {
    const m = mergeGuest(undefined, guest(), {
      _id: 'c9' as Attendee['contactId'] & string,
      name: 'Ana Contact',
    } as Parameters<typeof mergeGuest>[2])
    expect(m.source).toBe('astn')
    expect(m.contactId).toBe('c9')
    expect(m.name).toBe('Ana Contact')
  })
})
