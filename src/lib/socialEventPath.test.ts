import { isSocialEventPath } from './socialEventPath'

// Which pages count as in-person event pages, where the assistant never
// opens on its own (src/components/agent-sidebar/AgentSidebarProvider.tsx).

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
}

describe('isSocialEventPath', () => {
  test('the event page and the pages under it are event pages', () => {
    expect(isSocialEventPath('/org/baish/e/meetup')).toBe(true)
    expect(isSocialEventPath('/org/baish/e/meetup/')).toBe(true)
    expect(isSocialEventPath('/org/baish/e/meetup/profile')).toBe(true)
    expect(isSocialEventPath('/org/baish/e/meetup/people/user_123')).toBe(true)
  })

  test('other org pages are not', () => {
    expect(isSocialEventPath('/org/baish')).toBe(false)
    expect(isSocialEventPath('/org/baish/events')).toBe(false)
    expect(isSocialEventPath('/org/baish/e')).toBe(false)
    expect(isSocialEventPath('/org/baish/e/')).toBe(false)
    expect(isSocialEventPath('/org/baish/admin/events')).toBe(false)
    expect(isSocialEventPath('/org/baish/program/e/x')).toBe(false)
  })

  test('pages outside an org are not', () => {
    expect(isSocialEventPath('/')).toBe(false)
    expect(isSocialEventPath('/profile')).toBe(false)
    expect(isSocialEventPath('/e/meetup')).toBe(false)
  })
})
