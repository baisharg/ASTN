import {
  SITE_NAME,
  metaDescription,
  orgPageHead,
  orgPageUrl,
  organizationJsonLd,
} from './orgPageHead'
import type { OrgPageHead, OrgPublicProfile } from './orgPageHead'

// What search engines and link previews read on an org's public pages
// (/org/$slug and /org/$slug/events).

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
  toBeLessThanOrEqual(expected: number): void
}

const baish: OrgPublicProfile = {
  name: 'BAISH',
  slug: 'baish',
  description:
    'Buenos Aires AI Safety Hub: cursos, eventos y comunidad de seguridad en IA en Argentina.',
  logoUrl: 'https://example.convex.cloud/api/storage/logo',
  website: 'https://baish.com.ar',
  city: 'Buenos Aires',
  country: 'Argentina',
  socialUrls: ['https://www.linkedin.com/company/baish', 'https://lu.ma/baish'],
}

const bare: OrgPublicProfile = {
  name: 'Tiny Org',
  slug: 'tiny-org',
  description: null,
  logoUrl: null,
  website: null,
  city: null,
  country: null,
  socialUrls: [],
}

/** The content of the tag with that `name` or `property`, if the head has it. */
function content(head: OrgPageHead, key: string): string | undefined {
  return head.meta.find((tag) => tag.name === key || tag.property === key)
    ?.content
}

function title(head: OrgPageHead): string | undefined {
  return head.meta.find((tag) => tag.title !== undefined)?.title
}

function jsonLd(head: OrgPageHead): unknown {
  for (const tag of head.meta) {
    if ('script:ld+json' in tag) return tag['script:ld+json']
  }
  return undefined
}

describe('orgPageHead for an org that was found', () => {
  const head = orgPageHead('profile', { status: 'found', org: baish })

  test('the title is the org name followed by the site name', () => {
    expect(title(head)).toBe(`BAISH · ${SITE_NAME}`)
  })

  test("the description is the org's own description", () => {
    expect(content(head, 'description')).toBe(baish.description)
    expect(content(head, 'og:description')).toBe(baish.description)
    expect(content(head, 'twitter:description')).toBe(baish.description)
  })

  test('the canonical link and og:url are the address of the org page', () => {
    expect(head.links).toEqual([
      { rel: 'canonical', href: 'https://safetytalent.org/org/baish' },
    ])
    expect(content(head, 'og:url')).toBe('https://safetytalent.org/org/baish')
  })

  test('the preview title is the org name', () => {
    expect(content(head, 'og:title')).toBe('BAISH')
    expect(content(head, 'twitter:title')).toBe('BAISH')
  })

  test('it replaces every tag of the root route that describes the site', () => {
    // The root route (src/routes/__root.tsx) sets these for the whole site.
    // One left out here would show the site's text on the org's page.
    const replaced = [
      'description',
      'og:url',
      'og:title',
      'og:description',
      'twitter:title',
      'twitter:description',
    ]
    for (const key of replaced) {
      expect(typeof content(head, key)).toBe('string')
    }
    expect(typeof title(head)).toBe('string')
  })

  test("the preview image is the site's image, whose size the root route declares", () => {
    expect(content(head, 'og:image')).toBe(
      'https://safetytalent.org/og-image.png',
    )
    expect(content(head, 'twitter:image')).toBe(
      'https://safetytalent.org/og-image.png',
    )
  })

  test('it does not ask search engines to skip the page', () => {
    expect(content(head, 'robots')).toBe(undefined)
  })

  test('the events page has its own title, description and address', () => {
    const events = orgPageHead('events', { status: 'found', org: baish })
    expect(title(events)).toBe(`BAISH events · ${SITE_NAME}`)
    expect(content(events, 'description')).toBe(
      'Upcoming and past events of BAISH.',
    )
    expect(events.links).toEqual([
      { rel: 'canonical', href: 'https://safetytalent.org/org/baish/events' },
    ])
    expect(content(events, 'og:url')).toBe(
      'https://safetytalent.org/org/baish/events',
    )
    expect(jsonLd(events)).toEqual(organizationJsonLd(baish))
  })

  test('an org without a description gets a sentence with its name', () => {
    const bareHead = orgPageHead('profile', { status: 'found', org: bare })
    expect(content(bareHead, 'description')).toBe(
      `Tiny Org on the ${SITE_NAME}: open applications, events and members.`,
    )
  })
})

describe('orgPageHead when there is no org to describe', () => {
  test('a failed lookup adds nothing, so the page keeps the default tags of the site', () => {
    expect(orgPageHead('profile', { status: 'unavailable' })).toEqual({
      meta: [],
      links: [],
    })
    expect(orgPageHead('events', { status: 'unavailable' })).toEqual({
      meta: [],
      links: [],
    })
  })

  test('so does a page whose loader has not returned', () => {
    expect(orgPageHead('profile', undefined)).toEqual({ meta: [], links: [] })
  })

  test('a slug with no org is marked noindex, with no canonical link or org data', () => {
    const head = orgPageHead('profile', { status: 'notFound' })
    expect(content(head, 'robots')).toBe('noindex')
    expect(title(head)).toBe(`Organization not found · ${SITE_NAME}`)
    expect(head.links).toEqual([])
    expect(jsonLd(head)).toBe(undefined)
  })
})

describe('organizationJsonLd', () => {
  test('an org with a website: the website is its url and this profile is listed in sameAs', () => {
    expect(organizationJsonLd(baish)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'BAISH',
      url: 'https://baish.com.ar',
      description: baish.description,
      logo: 'https://example.convex.cloud/api/storage/logo',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Buenos Aires',
        addressCountry: 'Argentina',
      },
      sameAs: [
        'https://safetytalent.org/org/baish',
        'https://www.linkedin.com/company/baish',
        'https://lu.ma/baish',
      ],
    })
  })

  test('an org with only a name: the profile is its url and nothing else is claimed', () => {
    expect(organizationJsonLd(bare)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Tiny Org',
      url: 'https://safetytalent.org/org/tiny-org',
    })
  })

  test('links that are not http(s) URLs are left out', () => {
    const data = organizationJsonLd({
      ...bare,
      website: 'baish.com.ar',
      logoUrl: 'javascript:alert(1)',
      socialUrls: ['@baish', 'https://x.com/baish', 'https://x.com/baish'],
    })
    expect(data.url).toBe('https://safetytalent.org/org/tiny-org')
    expect(data.logo).toBe(undefined)
    expect(data.sameAs).toEqual(['https://x.com/baish'])
  })
})

describe('metaDescription', () => {
  test('line breaks and repeated spaces become single spaces', () => {
    expect(metaDescription('  Cursos\n\ny   eventos.  ')).toBe(
      'Cursos y eventos.',
    )
  })

  test('a long text is cut at a word, within 160 characters, with an ellipsis', () => {
    const long = 'seguridad en inteligencia artificial '.repeat(10)
    const cut = metaDescription(long)
    expect(cut.length).toBeLessThanOrEqual(160)
    expect(cut.endsWith('…')).toBe(true)
    expect(cut.endsWith(' …')).toBe(false)
    expect(long.startsWith(cut.slice(0, -1))).toBe(true)
  })
})

describe('orgPageUrl', () => {
  test('the slug is encoded', () => {
    expect(orgPageUrl('a b', 'profile')).toBe(
      'https://safetytalent.org/org/a%20b',
    )
  })
})
