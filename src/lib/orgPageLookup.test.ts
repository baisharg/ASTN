import { lookUpOrgForHead } from './orgPageLookup'
import type { OrgPublicProfile } from './orgPageHead'

// The lookup behind the head of an org's public pages. The pages render
// without it, so it must never fail them or hold them up.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toEqual(expected: unknown): void
}

const baish: OrgPublicProfile = {
  name: 'BAISH',
  slug: 'baish',
  description: null,
  logoUrl: null,
  website: null,
  city: null,
  country: null,
  socialUrls: [],
}

/**
 * A query client whose lookup ends the way `answer` does. `removed` counts
 * the queries dropped from its cache.
 */
function clientThat(answer: () => Promise<OrgPublicProfile | null>) {
  const client = {
    removed: 0,
    ensureQueryData: () => answer() as Promise<never>,
    removeQueries: () => {
      client.removed += 1
    },
  }
  return client
}

describe('lookUpOrgForHead', () => {
  test('an org with that slug is found', async () => {
    const lookup = await lookUpOrgForHead(
      clientThat(() => Promise.resolve(baish)),
      'baish',
    )
    expect(lookup).toEqual({ status: 'found', org: baish })
  })

  test('a slug with no org is not found', async () => {
    const lookup = await lookUpOrgForHead(
      clientThat(() => Promise.resolve(null)),
      'nope',
    )
    expect(lookup).toEqual({ status: 'notFound' })
  })

  test('a lookup that fails is unavailable, not an error', async () => {
    const lookup = await lookUpOrgForHead(
      clientThat(() => Promise.reject(new Error('backend unreachable'))),
      'baish',
    )
    expect(lookup).toEqual({ status: 'unavailable' })
  })

  test('a lookup that never answers is unavailable after the timeout, and its query is dropped', async () => {
    const client = clientThat(() => new Promise(() => {}))
    const lookup = await lookUpOrgForHead(client, 'baish', 20)
    expect(lookup).toEqual({ status: 'unavailable' })
    expect(client.removed).toEqual(1)
  })

  test('a lookup that answers leaves its query in the cache', async () => {
    const client = clientThat(() => Promise.resolve(baish))
    await lookUpOrgForHead(client, 'baish')
    expect(client.removed).toEqual(0)
  })
})
