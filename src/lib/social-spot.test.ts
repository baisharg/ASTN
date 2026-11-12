import { atSpot, spotName, spotPinText } from './social-spot'

// How a 1:1 spot is named to attendees (src/lib/social-spot.ts).

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
}

const unnamed = { number: 3, label: null }
const named = { number: 5, label: 'B1 · Salón' }

describe('spotName', () => {
  test('a spot without a name is shown by its number', () => {
    expect(spotName(unnamed, 'es')).toBe('Lugar 3')
    expect(spotName(unnamed, 'en')).toBe('Spot 3')
  })

  test('a named spot is shown by its name, the text on its sign', () => {
    expect(spotName(named, 'es')).toBe('B1 · Salón')
    expect(spotName(named, 'en')).toBe('B1 · Salón')
  })

  test('a name of only spaces counts as no name', () => {
    expect(spotName({ number: 2, label: '  ' }, 'es')).toBe('Lugar 2')
  })
})

describe('atSpot', () => {
  test('ends a sentence with the number when the spot has no name', () => {
    expect(atSpot(unnamed, 'es')).toBe('en el lugar 3')
    expect(atSpot(unnamed, 'en')).toBe('at spot 3')
  })

  test('ends a sentence with the name when the spot has one', () => {
    expect(atSpot(named, 'es')).toBe('en B1 · Salón')
    expect(atSpot(named, 'en')).toBe('at B1 · Salón')
  })
})

describe('spotPinText', () => {
  test('the pin of an unnamed spot carries its number', () => {
    expect(spotPinText(unnamed)).toBe('3')
  })

  test('the pin of a named spot carries no text', () => {
    expect(spotPinText(named)).toBe(null)
  })
})
