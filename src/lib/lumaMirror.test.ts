import {
  guestReadFailure,
  hasOtherEmail,
  mirrorChanges,
  mirrorFromLuma,
  newMirrorFields,
} from '../../convex/luma/shared'
import { LumaApiError } from '../../convex/social/luma'
import type { MirroredEvent } from '../../convex/luma/shared'
import type { LumaEvent } from '../../convex/social/luma'

// How the Luma calendar mirror turns a Luma payload into changes to an
// `events` row (convex/luma/mirror.ts upsertEvent), and how it treats a
// failed read of a guest list. Kept under src/ so the Convex bundler never
// sees a test file.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

const lumaEvent: LumaEvent = {
  id: 'evt-1',
  name: 'Charla',
  url: 'https://luma.com/charla',
  start_at: '2026-11-20T22:00:00.000Z',
  end_at: '2026-11-21T00:00:00.000Z',
  timezone: 'America/Argentina/Buenos_Aires',
  description_md: 'Una charla.',
  cover_url: 'https://images.example/cover.png',
  geo_address_json: { full_address: 'Av. Corrientes 1234, CABA' },
  max_capacity: 40,
  require_approval: true,
  access: 'manage',
}

describe('mirrorFromLuma', () => {
  test('copies the values Luma reports', () => {
    const mirrored = mirrorFromLuma(lumaEvent)
    expect(mirrored.description).toBe('Una charla.')
    expect(mirrored.endAt).toBe(Date.parse('2026-11-21T00:00:00.000Z'))
    expect(mirrored.coverUrl).toBe('https://images.example/cover.png')
    expect(mirrored.location).toBe('Av. Corrientes 1234, CABA')
    expect(mirrored.maxCapacity).toBe(40)
  })

  test('a field Luma reports as empty is null', () => {
    const mirrored = mirrorFromLuma({
      ...lumaEvent,
      end_at: null,
      description_md: '',
      cover_url: null,
      geo_address_json: null,
      max_capacity: null,
      meeting_url: 'https://meet.example/abc',
    })
    expect(mirrored.endAt).toBe(null)
    expect(mirrored.description).toBe(null)
    expect(mirrored.coverUrl).toBe(null)
    expect(mirrored.location).toBe(null)
    expect(mirrored.maxCapacity).toBe(null)
    expect(mirrored.isVirtual).toBe(true)
  })

  test('a field missing from the payload is not reported', () => {
    const mirrored = mirrorFromLuma({
      id: 'evt-1',
      name: 'Charla',
      url: 'https://luma.com/charla',
      start_at: '2026-11-20T22:00:00.000Z',
      timezone: 'America/Argentina/Buenos_Aires',
    } as LumaEvent)
    expect(mirrored.endAt).toBe(undefined)
    expect(mirrored.description).toBe(undefined)
    expect(mirrored.coverUrl).toBe(undefined)
    expect(mirrored.location).toBe(undefined)
    expect(mirrored.maxCapacity).toBe(undefined)
  })

  test('a calendar listing never reports the description as empty', () => {
    const listed = { listed: true }
    expect(
      mirrorFromLuma({ ...lumaEvent, description_md: '' }, listed).description,
    ).toBe(undefined)
    expect(
      mirrorFromLuma(
        { ...lumaEvent, description_md: null } as unknown as LumaEvent,
        listed,
      ).description,
    ).toBe(undefined)
    // It still clears the fields a listing does carry.
    expect(
      mirrorFromLuma({ ...lumaEvent, geo_address_json: null }, listed).location,
    ).toBe(null)
  })
})

describe('mirrorChanges', () => {
  const reportedEvent: MirroredEvent = {
    lumaEventId: 'evt-1',
    title: 'Charla',
    description: 'Una charla.',
    startAt: 1000,
    endAt: 2000,
    timezone: 'America/Argentina/Buenos_Aires',
    coverUrl: 'https://images.example/cover.png',
    url: 'https://luma.com/charla',
    location: 'Av. Corrientes 1234, CABA',
    isVirtual: false,
    visibility: 'public',
    lumaAccess: 'manage',
    requireApproval: true,
    maxCapacity: 40,
  }
  const row = newMirrorFields(reportedEvent)

  test('a row that matches needs no patch', () => {
    expect(Object.keys(mirrorChanges(row, reportedEvent))).toEqual([])
  })

  test('a changed value is set', () => {
    expect(mirrorChanges(row, { ...reportedEvent, title: 'Taller' })).toEqual({
      title: 'Taller',
    })
  })

  test('an event that moved online loses its address', () => {
    const patch = mirrorChanges(row, {
      ...reportedEvent,
      location: null,
      isVirtual: true,
    })
    expect(Object.keys(patch).sort()).toEqual(['isVirtual', 'location'])
    expect(patch.location).toBe(undefined)
    expect(patch.isVirtual).toBe(true)
  })

  test('capacity, cover and end time removed in Luma are removed', () => {
    const patch = mirrorChanges(row, {
      ...reportedEvent,
      endAt: null,
      coverUrl: null,
      maxCapacity: null,
    })
    expect(Object.keys(patch).sort()).toEqual([
      'coverUrl',
      'endAt',
      'maxCapacity',
    ])
  })

  test('a listing without a description keeps the row’s description', () => {
    const { description: _notListed, ...listed } = reportedEvent
    expect(Object.keys(mirrorChanges(row, listed))).toEqual([])
  })

  test('a description emptied in Luma is removed when the event itself is read', () => {
    const patch = mirrorChanges(row, { ...reportedEvent, description: null })
    expect(Object.keys(patch)).toEqual(['description'])
    expect(patch.description).toBe(undefined)
  })

  test('a field reported empty that the row doesn’t have is not a change', () => {
    const online = newMirrorFields({
      ...reportedEvent,
      location: null,
      maxCapacity: null,
    })
    expect(
      Object.keys(
        mirrorChanges(online, {
          ...reportedEvent,
          location: null,
          maxCapacity: null,
        }),
      ),
    ).toEqual([])
  })
})

// A transient failure keeps the event flagged for the next guest-sync chain;
// a permanent one clears the flag (convex/luma/sync.ts guestChain).
describe('guestReadFailure', () => {
  test('a Luma 5xx is transient', () => {
    expect(guestReadFailure(new LumaApiError('failed (500)', 500))).toBe(
      'transient',
    )
    expect(guestReadFailure(new LumaApiError('failed (503)', 503))).toBe(
      'transient',
    )
  })

  test('no answer from Luma (a network error) is transient', () => {
    expect(guestReadFailure(new TypeError('fetch failed'))).toBe('transient')
  })

  test('a 429 is a rate limit, handled by waiting', () => {
    expect(guestReadFailure(new LumaApiError('failed (429)', 429))).toBe(
      'rate_limited',
    )
  })

  test('any other 4xx is permanent, e.g. an event Luma no longer has', () => {
    expect(guestReadFailure(new LumaApiError('failed (404)', 404))).toBe(
      'permanent',
    )
    expect(guestReadFailure(new LumaApiError('failed (403)', 403))).toBe(
      'permanent',
    )
  })

  test('a list this client refuses to read (status 0) is permanent', () => {
    expect(
      guestReadFailure(
        new LumaApiError('Luma guest list has more than 50 pages', 0),
      ),
    ).toBe('permanent')
  })
})

describe('newMirrorFields', () => {
  test('fields reported empty are left out of a new row', () => {
    const fields = newMirrorFields({
      lumaEventId: 'evt-1',
      title: 'Charla',
      description: null,
      startAt: 1000,
      endAt: null,
      timezone: 'America/Argentina/Buenos_Aires',
      coverUrl: null,
      url: 'https://luma.com/charla',
      location: null,
      isVirtual: true,
      visibility: 'public',
      lumaAccess: 'manage',
      maxCapacity: null,
    })
    expect(fields.description).toBe(undefined)
    expect(fields.endAt).toBe(undefined)
    expect(fields.coverUrl).toBe(undefined)
    expect(fields.location).toBe(undefined)
    expect(fields.maxCapacity).toBe(undefined)
  })
})

describe('hasOtherEmail: whether a guest belongs to a contact found by other email', () => {
  test('matches one of the other emails, whatever its case or spacing', () => {
    const contact = { otherEmails: ['Ana@Example.org ', 'ana@work.org'] }
    expect(hasOtherEmail(contact, 'ana@example.org')).toBe(true)
    expect(hasOtherEmail(contact, 'ana@work.org')).toBe(true)
  })

  test('does not match once the address was removed from the contact', () => {
    expect(
      hasOtherEmail({ otherEmails: ['ana@work.org'] }, 'ana@old.org'),
    ).toBe(false)
    expect(hasOtherEmail({}, 'ana@old.org')).toBe(false)
  })
})
