import { fetchConvexToken } from './convex-clerk-auth'

// Which Clerk token the site sends to Convex (src/lib/convex-clerk-auth.ts).

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

describe('fetchConvexToken', () => {
  test("asks Clerk for the 'convex' template, which carries the email", async () => {
    const calls: Array<unknown> = []
    const token = await fetchConvexToken((options) => {
      calls.push(options)
      return Promise.resolve('template-token')
    }, false)
    expect(token).toBe('template-token')
    expect(calls).toEqual([{ template: 'convex', skipCache: false }])
  })

  test('skips the cache when Convex asks for a fresh token', async () => {
    const calls: Array<unknown> = []
    await fetchConvexToken((options) => {
      calls.push(options)
      return Promise.resolve('template-token')
    }, true)
    expect(calls).toEqual([{ template: 'convex', skipCache: true }])
  })

  test('is null when Clerk fails, so Convex treats the person as signed out', async () => {
    const token = await fetchConvexToken(
      () => Promise.reject(new Error('network')),
      false,
    )
    expect(token).toBe(null)
  })
})
