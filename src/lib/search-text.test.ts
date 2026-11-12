import { matchesSearch, searchable } from './search-text'

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
}

describe('searchable', () => {
  test('drops accents, case and surrounding spaces', () => {
    expect(searchable('  José Ñandú ')).toBe('jose nandu')
    expect(searchable('MARÍA')).toBe('maria')
  })
})

describe('matchesSearch', () => {
  test('finds a name typed without its accent, and the other way round', () => {
    expect(matchesSearch('jose', ['José Pérez', 'jp@example.com'])).toBe(true)
    expect(matchesSearch('José', ['Jose Perez'])).toBe(true)
    expect(matchesSearch('PEREZ', ['José Pérez'])).toBe(true)
  })

  test('matches any of the fields, by part of the text', () => {
    expect(matchesSearch('example.com', ['José', 'jp@example.com'])).toBe(true)
    expect(matchesSearch('ana', ['José', 'jp@example.com'])).toBe(false)
  })

  test('an empty search matches everything; missing fields match nothing', () => {
    expect(matchesSearch('  ', [null])).toBe(true)
    expect(matchesSearch('ana', [null, undefined, ''])).toBe(false)
  })
})
