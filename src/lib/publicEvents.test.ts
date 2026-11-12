import { toPublicEvent } from '../../convex/events/queries'
import type { Doc, Id } from '../../convex/_generated/dataModel'

// What the public events queries return of a mirrored Luma event
// (convex/events/queries.ts getOrgEvents, getDashboardEvents). Kept under
// src/ so the Convex bundler never sees a test file.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toEqual(expected: unknown): void
}

describe('toPublicEvent', () => {
  const row: Doc<'events'> = {
    _id: 'event1' as Id<'events'>,
    _creationTime: 1,
    orgId: 'org1' as Id<'organizations'>,
    lumaEventId: 'evt-1',
    title: 'Charla',
    description: 'Texto',
    startAt: 1000,
    endAt: 2000,
    timezone: 'America/Argentina/Buenos_Aires',
    coverUrl: 'https://images.example/cover.png',
    url: 'https://luma.com/charla',
    location: 'Av. Corrientes 1234',
    isVirtual: false,
    syncedAt: 5,
    visibility: 'public',
    lumaAccess: 'manage',
    canceled: false,
    requireApproval: true,
    maxCapacity: 40,
    guestCount: 31,
    approvedCount: 20,
    pendingCount: 9,
    checkedInCount: 12,
    guestSyncNeeded: true,
    lastGuestSyncAt: 6,
    guestSyncError: 'Luma GET /v1/events/guests/list failed (500)',
  }

  test('returns the fields the pages show and nothing about guests or the sync', () => {
    expect(toPublicEvent(row)).toEqual({
      _id: row._id,
      title: 'Charla',
      startAt: 1000,
      endAt: 2000,
      timezone: 'America/Argentina/Buenos_Aires',
      coverUrl: 'https://images.example/cover.png',
      url: 'https://luma.com/charla',
      location: 'Av. Corrientes 1234',
      isVirtual: false,
    })
  })
})
