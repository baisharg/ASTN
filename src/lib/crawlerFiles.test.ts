// What public/sitemap.xml and public/robots.txt tell crawlers.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
  toContain(expected: unknown): void
}
declare const Bun: { file(path: URL): { text(): Promise<string> } }

function publicFile(name: string): Promise<string> {
  return Bun.file(new URL(`../../public/${name}`, import.meta.url)).text()
}

describe('what crawlers are told in public/', () => {
  // Paths that need an account, or that are personal links.
  const NEEDS_SIGN_IN =
    /\/(admin|profile|settings|matches|opportunities|apply|poll|survey|join|programs|space|visit)(\/|$)/

  test('the sitemap lists the public pages of baish', async () => {
    const sitemap = await publicFile('sitemap.xml')
    expect(sitemap).toContain('<loc>https://safetytalent.org/org/baish</loc>')
    expect(sitemap).toContain(
      '<loc>https://safetytalent.org/org/baish/events</loc>',
    )
  })

  test('the sitemap lists no page that needs sign-in and no in-person event page', async () => {
    const sitemap = await publicFile('sitemap.xml')
    const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => new URL(match[1]).pathname,
    )
    expect(paths.length > 0).toBe(true)
    for (const path of paths) {
      expect(NEEDS_SIGN_IN.test(path)).toBe(false)
      expect(/\/org\/[^/]+\/e(\/|$)/.test(path)).toBe(false)
    }
  })

  test('robots.txt keeps org pages crawlable, leaves event pages as they were and blocks org admin', async () => {
    const robots = await publicFile('robots.txt')
    const disallowed = robots
      .split('\n')
      .filter((line) => line.startsWith('Disallow:'))
      .map((line) => line.slice('Disallow:'.length).trim())
    expect(disallowed).toEqual([
      '/profile/',
      '/opportunities/',
      '/matches/',
      '/admin/',
      '/org/*/admin',
    ])
    expect(robots).toContain('Allow: /')
    expect(robots).toContain('Sitemap: https://safetytalent.org/sitemap.xml')
  })
})
