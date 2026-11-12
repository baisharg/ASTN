import {
  STILL_UPCOMING_MS,
  eventPlace,
  mergeAdminEvents,
} from './admin-events-list'

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

const HOUR = 3600 * 1000
const DAY = 24 * HOUR
const now = Date.UTC(2026, 9, 10, 12, 0, 0)
const TZ = 'America/Argentina/Buenos_Aires'

const luma = (
  lumaEventId: string,
  startAt: number,
  socialEventId: string | null = null,
) => ({
  lumaEventId,
  title: `Luma ${lumaEventId}`,
  startAt,
  timezone: TZ,
  socialEventId,
})

const astn = (_id: string, startAt: number) => ({
  _id,
  title: `ASTN ${_id}`,
  startAt,
  timezone: TZ,
})

describe('mergeAdminEvents', () => {
  test('a Luma event managed in ASTN and its ASTN event are one row', () => {
    const { upcoming, past } = mergeAdminEvents({
      luma: [luma('evt-1', now + DAY, 'a1')],
      astn: [astn('a1', now + DAY)],
      now,
    })
    expect(past.length).toBe(0)
    expect(upcoming.length).toBe(1)
    expect(upcoming[0].luma?.lumaEventId).toBe('evt-1')
    expect(upcoming[0].astn?._id).toBe('a1')
    expect(upcoming[0].astnEventId).toBe('a1')
  })

  test('a joined row shows the ASTN title and time', () => {
    const { upcoming } = mergeAdminEvents({
      luma: [luma('evt-1', now + DAY, 'a1')],
      astn: [astn('a1', now + 2 * DAY)],
      now,
    })
    expect(upcoming[0].title).toBe('ASTN a1')
    expect(upcoming[0].startAt).toBe(now + 2 * DAY)
  })

  test('Luma-only and ASTN-only events each get a row', () => {
    const { upcoming } = mergeAdminEvents({
      luma: [luma('evt-1', now + 3 * DAY)],
      astn: [astn('a2', now + DAY)],
      now,
    })
    expect(upcoming.map((row) => row.key)).toEqual(['astn:a2', 'luma:evt-1'])
    expect(upcoming[0].luma).toBe(null)
    expect(upcoming[0].astnEventId).toBe('a2')
    expect(upcoming[1].astn).toBe(null)
    expect(upcoming[1].astnEventId).toBe(null)
  })

  test('a managed Luma event whose ASTN event is not loaded keeps its link to it', () => {
    const { upcoming } = mergeAdminEvents({
      luma: [luma('evt-1', now + DAY, 'a-old')],
      astn: [],
      now,
    })
    expect(upcoming.length).toBe(1)
    expect(upcoming[0].astn).toBe(null)
    expect(upcoming[0].astnEventId).toBe('a-old')
    expect(upcoming[0].title).toBe('Luma evt-1')
  })

  test('an ASTN event linked to a Luma event that is not on the list stays', () => {
    const { upcoming } = mergeAdminEvents({
      luma: [luma('evt-1', now + DAY)],
      astn: [astn('a1', now + 2 * DAY)],
      now,
    })
    expect(upcoming.map((row) => row.key)).toEqual(['luma:evt-1', 'astn:a1'])
  })

  test('upcoming events are soonest first, past events most recent first', () => {
    const { upcoming, past } = mergeAdminEvents({
      luma: [
        luma('evt-future-2', now + 5 * DAY),
        luma('evt-past-1', now - 2 * DAY),
      ],
      astn: [astn('a-future-1', now + DAY), astn('a-past-2', now - 9 * DAY)],
      now,
    })
    expect(upcoming.map((row) => row.key)).toEqual([
      'astn:a-future-1',
      'luma:evt-future-2',
    ])
    expect(past.map((row) => row.key)).toEqual([
      'luma:evt-past-1',
      'astn:a-past-2',
    ])
  })

  test('an event that started a few hours ago still counts as upcoming', () => {
    const { upcoming, past } = mergeAdminEvents({
      luma: [luma('evt-running', now - 3 * HOUR)],
      astn: [astn('a-over', now - STILL_UPCOMING_MS - HOUR)],
      now,
    })
    expect(upcoming.map((row) => row.key)).toEqual(['luma:evt-running'])
    expect(past.map((row) => row.key)).toEqual(['astn:a-over'])
  })
})

describe('eventPlace', () => {
  const lumaRow = { lumaEventId: 'evt-1' }

  test('a Luma event nobody manages in ASTN is only in Luma', () => {
    expect(eventPlace({ luma: lumaRow, astn: null, astnEventId: null })).toBe(
      'luma',
    )
  })

  test('an ASTN event without a Luma link is only in ASTN', () => {
    expect(
      eventPlace({
        luma: null,
        astn: { lumaLinked: false },
        astnEventId: 'a1',
      }),
    ).toBe('astn')
  })

  test('a managed Luma event is in both, also when its ASTN event is not loaded', () => {
    expect(
      eventPlace({
        luma: lumaRow,
        astn: { lumaLinked: true },
        astnEventId: 'a1',
      }),
    ).toBe('luma_and_astn')
    expect(eventPlace({ luma: lumaRow, astn: null, astnEventId: 'a1' })).toBe(
      'luma_and_astn',
    )
  })

  test('a linked ASTN event whose Luma event is not on the list is still in both', () => {
    expect(
      eventPlace({ luma: null, astn: { lumaLinked: true }, astnEventId: 'a1' }),
    ).toBe('luma_and_astn')
  })
})
