// The <head> of an org's public pages (/org/$slug and /org/$slug/events):
// title, description, canonical URL, Open Graph and Twitter tags and JSON-LD
// `Organization` data, built from what the org says about itself. The root
// route (src/routes/__root.tsx) supplies every tag this file does not set.

export const SITE_URL = 'https://safetytalent.org'
export const SITE_NAME = 'AI Safety Talent Network'

const MAX_DESCRIPTION_LENGTH = 160

/** What `api.orgs.directory.getOrgPublicProfile` returns for an org. */
export type OrgPublicProfile = {
  name: string
  slug: string
  description: string | null
  logoUrl: string | null
  website: string | null
  city: string | null
  country: string | null
  socialUrls: Array<string>
}

/**
 * The outcome of looking an org up for its head. `unavailable` means the
 * lookup failed (backend unreachable), which says nothing about whether the
 * org exists.
 */
export type OrgLookup =
  | { status: 'found'; org: OrgPublicProfile }
  | { status: 'notFound' }
  | { status: 'unavailable' }

export type OrgPage = 'profile' | 'events'

type MetaTag = React.JSX.IntrinsicElements['meta']
type LinkTag = React.JSX.IntrinsicElements['link']

/** What a route's `head()` returns for an org's public page. */
export type OrgPageHead = {
  meta: Array<MetaTag>
  links: Array<LinkTag>
}

/**
 * A `meta` entry the router renders as an escaped
 * `<script type="application/ld+json">`. The router's types for `head()` do
 * not list this entry, hence the cast.
 */
function jsonLdTag(data: Record<string, unknown>): MetaTag {
  return { 'script:ld+json': data } as MetaTag
}

/** The address search engines should index for a page of an org. */
export function orgPageUrl(slug: string, page: OrgPage): string {
  const base = `${SITE_URL}/org/${encodeURIComponent(slug)}`
  return page === 'events' ? `${base}/events` : base
}

/**
 * One line of at most `MAX_DESCRIPTION_LENGTH` characters: whitespace is
 * collapsed and a longer text is cut at a word boundary with an ellipsis.
 */
export function metaDescription(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= MAX_DESCRIPTION_LENGTH) return oneLine
  const cut = oneLine.slice(0, MAX_DESCRIPTION_LENGTH - 1)
  const lastSpace = cut.lastIndexOf(' ')
  const atWord = lastSpace > MAX_DESCRIPTION_LENGTH / 2 ? lastSpace : cut.length
  return `${cut.slice(0, atWord).replace(/[\s.,;:]+$/, '')}…`
}

/** The text itself when it is an http(s) URL, otherwise null. */
function httpUrl(text: string | null): string | null {
  const trimmed = text?.trim() ?? ''
  return /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : null
}

function profileDescription(org: OrgPublicProfile): string {
  const own = org.description ? metaDescription(org.description) : ''
  if (own) return own
  return `${org.name} on the ${SITE_NAME}: open applications, events and members.`
}

/** schema.org `Organization` data for an org. */
export function organizationJsonLd(
  org: OrgPublicProfile,
): Record<string, unknown> {
  const profileUrl = orgPageUrl(org.slug, 'profile')
  const website = httpUrl(org.website)
  const logo = httpUrl(org.logoUrl)
  const description = org.description ? metaDescription(org.description) : ''
  // Other pages about the same org. When the org has its own website that is
  // its `url`, and this profile is one more page about it.
  const sameAs = [
    ...new Set(
      [website ? profileUrl : null, ...org.socialUrls.map(httpUrl)].filter(
        (url): url is string => url !== null && url !== website,
      ),
    ),
  ]
  const hasAddress = Boolean(org.city || org.country)

  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: org.name,
    url: website ?? profileUrl,
    ...(description ? { description } : {}),
    ...(logo ? { logo } : {}),
    ...(hasAddress
      ? {
          address: {
            '@type': 'PostalAddress',
            ...(org.city ? { addressLocality: org.city } : {}),
            ...(org.country ? { addressCountry: org.country } : {}),
          },
        }
      : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
  }
}

/**
 * The head of an org's public page.
 *
 * - `found`: the org's own title, description, canonical URL, social tags
 *   and JSON-LD.
 * - `notFound`: a "not found" title and `noindex`, so the address is not
 *   indexed.
 * - `unavailable` (or no lookup at all): nothing, so the page keeps the
 *   site's default tags. It never says `noindex`: a failed lookup must not
 *   remove an existing org from search results.
 *
 * The preview image is always the site's og-image.png: the root route
 * declares that image's size, and an org logo has another, unknown size. The
 * logo goes in the JSON-LD.
 */
export function orgPageHead(
  page: OrgPage,
  lookup: OrgLookup | undefined,
): OrgPageHead {
  if (!lookup || lookup.status === 'unavailable') {
    return { meta: [], links: [] }
  }
  if (lookup.status === 'notFound') {
    return {
      meta: [
        { title: `Organization not found · ${SITE_NAME}` },
        { name: 'robots', content: 'noindex' },
      ],
      links: [],
    }
  }

  const { org } = lookup
  const url = orgPageUrl(org.slug, page)
  const heading = page === 'events' ? `${org.name} events` : org.name
  const title = `${heading} · ${SITE_NAME}`
  const description =
    page === 'events'
      ? `Upcoming and past events of ${org.name}.`
      : profileDescription(org)
  const image = `${SITE_URL}/og-image.png`

  return {
    meta: [
      { title },
      { name: 'description', content: description },
      { property: 'og:url', content: url },
      { property: 'og:title', content: heading },
      { property: 'og:description', content: description },
      { property: 'og:image', content: image },
      { name: 'twitter:title', content: heading },
      { name: 'twitter:description', content: description },
      { name: 'twitter:image', content: image },
      jsonLdTag(organizationJsonLd(org)),
    ],
    links: [{ rel: 'canonical', href: url }],
  }
}
