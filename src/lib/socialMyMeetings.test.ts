import {
  MAX_MY_MEETINGS,
  latestMeetingsFirst,
  meetingLengthMs,
  showsMyMeetings,
} from '../../convex/social/constants'
import { withNoteSlots } from './social-live'

// The rules behind "Mis reuniones", the list of the 1:1s an attendee had at
// an event (convex/social/constants.ts and social-live.ts). Kept under src/
// so the Convex bundler never sees a test file.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

describe('showsMyMeetings: an event nobody switched it on for is unchanged', () => {
  // The people page and the "Reunión terminada" card only add their link to
  // "Mis reuniones" when this is true, and the page itself only lists
  // meetings then.
  test('an event without the setting does not show "Mis reuniones"', () => {
    expect(showsMyMeetings({})).toBe(false)
    expect(showsMyMeetings({ myMeetingsEnabled: undefined })).toBe(false)
  })

  test('a backend that does not send the setting counts as off', () => {
    expect(showsMyMeetings({ myMeetingsEnabled: null })).toBe(false)
  })

  test('an admin switching it off hides it again', () => {
    expect(showsMyMeetings({ myMeetingsEnabled: false })).toBe(false)
  })

  test('only an admin switching it on shows it', () => {
    expect(showsMyMeetings({ myMeetingsEnabled: true })).toBe(true)
  })
})

describe('latestMeetingsFirst', () => {
  const meeting = (id: string, startedAt: number) => ({ id, startedAt })

  test('meetings the person asked for and ones they accepted are merged, most recent first', () => {
    const asked = [meeting('asked-late', 4_000), meeting('asked-early', 1_000)]
    const accepted = [
      meeting('accepted-late', 3_000),
      meeting('accepted-early', 2_000),
    ]
    expect(latestMeetingsFirst(asked, accepted).map((m) => m.id)).toEqual([
      'asked-late',
      'accepted-late',
      'accepted-early',
      'asked-early',
    ])
  })

  test('someone with no finished meetings gets an empty list', () => {
    expect(latestMeetingsFirst([], [])).toEqual([])
  })

  test('the list keeps the most recent meetings up to its limit', () => {
    const asked = Array.from({ length: MAX_MY_MEETINGS }, (_, i) =>
      meeting(`asked-${i}`, 10_000 + i),
    )
    const accepted = [meeting('oldest', 1), meeting('newest', 99_999)]
    const list = latestMeetingsFirst(asked, accepted)
    expect(list.length).toBe(MAX_MY_MEETINGS)
    expect(list[0]?.id).toBe('newest')
    expect(list.some((m) => m.id === 'oldest')).toBe(false)
  })

  test('the lists it was given are left as they were', () => {
    const asked = [meeting('a', 1_000), meeting('b', 2_000)]
    latestMeetingsFirst(asked, [])
    expect(asked.map((m) => m.id)).toEqual(['a', 'b'])
  })
})

describe('meetingLengthMs', () => {
  test('a meeting lasted from its start to its end', () => {
    expect(meetingLengthMs({ startedAt: 1_000, endedAt: 13 * 60_000 })).toBe(
      13 * 60_000 - 1_000,
    )
  })

  test('an end recorded before the start counts as no time', () => {
    expect(meetingLengthMs({ startedAt: 5_000, endedAt: 4_000 })).toBe(0)
  })
})

describe('withNoteSlots: one note box per person', () => {
  const meeting = (id: string, userId: string) => ({ id, partner: { userId } })

  test('each person met once gets a note box on their meeting', () => {
    const slots = withNoteSlots([meeting('m2', 'ana'), meeting('m1', 'bruno')])
    expect(slots.map((s) => s.showsNote)).toEqual([true, true])
  })

  test('someone met twice gets the note box on the most recent meeting only', () => {
    const slots = withNoteSlots([
      meeting('m3', 'ana'),
      meeting('m2', 'bruno'),
      meeting('m1', 'ana'),
    ])
    expect(slots.map((s) => [s.meeting.id, s.showsNote])).toEqual([
      ['m3', true],
      ['m2', true],
      ['m1', false],
    ])
  })

  test('an empty list stays empty', () => {
    expect(withNoteSlots([])).toEqual([])
  })
})
