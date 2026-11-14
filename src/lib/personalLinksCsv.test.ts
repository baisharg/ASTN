import { csvCell, personalLinksCsv } from './personalLinksCsv'

// The CSV of personal links an admin downloads for a mail merge.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

describe('csvCell', () => {
  test('quotes the value and doubles its quotes', () => {
    expect(csvCell('Ana')).toBe('"Ana"')
    expect(csvCell('Ana "la" Pérez, hija')).toBe('"Ana ""la"" Pérez, hija"')
  })

  test('a value a spreadsheet would run as a formula is made plain text', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(
      '"\'=HYPERLINK(""http://x"")"',
    )
    expect(csvCell('+54 11')).toBe('"\'+54 11"')
    expect(csvCell('-1')).toBe('"\'-1"')
    expect(csvCell('@ana')).toBe('"\'@ana"')
  })
})

describe('personalLinksCsv', () => {
  test('one row per guest with name, email, link and whether it signs in', () => {
    const csv = personalLinksCsv([
      {
        name: 'Ana Pérez',
        email: 'ana@example.com',
        link: 'https://safetytalent.org/org/baish/e/social#ticket=abc',
        signsIn: true,
      },
      {
        name: null,
        email: 'bruno@example.com',
        link: 'https://safetytalent.org/org/baish/e/social',
        signsIn: false,
      },
    ])
    expect(csv).toBe(
      '﻿' +
        '"nombre","email","link","sesion_iniciada"\r\n' +
        '"Ana Pérez","ana@example.com","https://safetytalent.org/org/baish/e/social#ticket=abc","si"\r\n' +
        '"","bruno@example.com","https://safetytalent.org/org/baish/e/social","no"\r\n',
    )
  })

  test('no guests gives the header alone', () => {
    expect(personalLinksCsv([])).toBe(
      '﻿"nombre","email","link","sesion_iniciada"\r\n',
    )
  })
})
