import { linkBareUrls } from '../../convex/lib/emailLinks'

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => { toBe(expected: unknown): void }

describe('linkBareUrls', () => {
  test('adds https to an address pasted without it', () => {
    expect(
      linkBareUrls('Inscribite: safetytalent.org/org/baish/apply/tais'),
    ).toBe('Inscribite: https://safetytalent.org/org/baish/apply/tais')
  })
  test('leaves full links, markdown links and emails alone', () => {
    const text =
      'https://safetytalent.org/x [acá](https://safetytalent.org/y) baish.equipo@gmail.com www.bluedot.org/courses'
    expect(linkBareUrls(text)).toBe(text)
  })
})
