import {
  MAX_MEETING_NOTE_LENGTH,
  MAX_NOTE_LENGTH,
  meetingNoteToStore,
} from '../../convex/social/constants'

// The rules for the private notes attendees keep about the people they meet
// (convex/social/constants.ts). Kept under src/ so the Convex bundler never
// sees a test file.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

describe('meetingNoteToStore: what is kept of a private note', () => {
  test('the text is stored without surrounding whitespace', () => {
    expect(meetingNoteToStore('  Trabaja en evals.\n')).toBe(
      'Trabaja en evals.',
    )
  })

  test('line breaks inside the note are kept', () => {
    expect(meetingNoteToStore('Evals.\n\nEscribirle el lunes.')).toBe(
      'Evals.\n\nEscribirle el lunes.',
    )
  })

  test('an empty or blank text means the note is deleted', () => {
    expect(meetingNoteToStore('')).toBe(null)
    expect(meetingNoteToStore('   \n\t ')).toBe(null)
  })

  test('a note can be 2000 characters long and a longer one is cut there', () => {
    expect(MAX_MEETING_NOTE_LENGTH).toBe(2000)
    const full = 'a'.repeat(MAX_MEETING_NOTE_LENGTH)
    expect(meetingNoteToStore(full)).toBe(full)
    expect(meetingNoteToStore(`${full}bcd`)).toBe(full)
  })

  test('a cut that lands on whitespace leaves none at the end', () => {
    const text = `${'a'.repeat(MAX_MEETING_NOTE_LENGTH - 1)} b`
    expect(meetingNoteToStore(text)).toBe(
      'a'.repeat(MAX_MEETING_NOTE_LENGTH - 1),
    )
  })

  test('the note on a 1:1 request keeps its own, shorter limit', () => {
    expect(MAX_NOTE_LENGTH).toBe(280)
  })
})
