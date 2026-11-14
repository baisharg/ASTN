import { requestEmailContent } from '../../convex/social/requestEmail'

// The email about a 1:1 request nobody's page showed
// (convex/social/requestEmail.ts). Kept under src/ so the Convex bundler
// never sees a test file.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toContain(expected: string): void
  not: { toContain(expected: string): void }
}

const BASE = {
  recipientName: 'Camila Torres',
  requesterName: 'Tomás Ruiz',
  eventTitle: 'BAISH Connect',
  note: undefined,
  requestsUrl: 'https://safetytalent.org/org/baish/e/baish-connect/requests',
}

describe('requestEmailContent', () => {
  test('says who asked, greets by first name and links to the requests page', () => {
    const { subject, html } = requestEmailContent(BASE)
    expect(subject).toBe('Tomás Ruiz quiere un 1:1 con vos ahora')
    expect(html).toContain('Hola Camila:')
    expect(html).toContain('<strong>Tomás Ruiz</strong>')
    expect(html).toContain('BAISH Connect')
    expect(html).toContain(`href="${BASE.requestsUrl}"`)
  })

  test('a recipient without a name is greeted without one', () => {
    expect(requestEmailContent({ ...BASE, recipientName: '' }).html).toContain(
      'Hola:',
    )
  })

  test("the requester's note is included, and text attendees wrote is escaped", () => {
    const { html } = requestEmailContent({
      ...BASE,
      requesterName: 'Tomás <b>Ruiz</b>',
      note: 'Hablemos de <script>alert(1)</script> & evals',
    })
    expect(html).toContain('Tomás &lt;b&gt;Ruiz&lt;/b&gt;')
    expect(html).toContain(
      'Hablemos de &lt;script&gt;alert(1)&lt;/script&gt; &amp; evals',
    )
    expect(html).not.toContain('<script>')
  })
})
