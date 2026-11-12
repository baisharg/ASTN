import { personalEventLink } from '../../convex/social/constants'
import {
  captureSignInTicket,
  hasSignInTicket,
  redactSignInTicket,
  redactSignInTicketDeep,
  redactSignInTicketInBreadcrumb,
  signInTicketPlan,
  splitSignInTicket,
  takeSignInTicket,
} from './signInTicket'

// How the browser handles the sign-in token of a personal event link: it
// leaves the address before anything else reads it, and is used at most once.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

describe('splitSignInTicket', () => {
  test('an address without a token is left exactly as it is', () => {
    expect(splitSignInTicket('')).toEqual({ ticket: null, hash: '' })
    expect(splitSignInTicket('#faq')).toEqual({ ticket: null, hash: '#faq' })
    expect(splitSignInTicket('#a=1&b=2')).toEqual({
      ticket: null,
      hash: '#a=1&b=2',
    })
    // A key that only ends in "ticket" is not the token.
    expect(splitSignInTicket('#myticket=abc')).toEqual({
      ticket: null,
      hash: '#myticket=abc',
    })
  })

  test('the token comes out and nothing of it stays in the fragment', () => {
    expect(splitSignInTicket('#ticket=abc.def-ghi')).toEqual({
      ticket: 'abc.def-ghi',
      hash: '',
    })
  })

  test('the rest of the fragment is kept', () => {
    expect(splitSignInTicket('#a=1&ticket=abc&b=2')).toEqual({
      ticket: 'abc',
      hash: '#a=1&b=2',
    })
  })

  test('an empty or unreadable token is removed and counts as no token', () => {
    expect(splitSignInTicket('#ticket=')).toEqual({ ticket: null, hash: '' })
    expect(splitSignInTicket('#ticket=%E0%A4%A')).toEqual({
      ticket: null,
      hash: '',
    })
  })

  test('reads back the token of a link the backend builds', () => {
    const token = 'eyJhbGciOi.J9+/=.sig_-'
    const link = personalEventLink(
      'https://safetytalent.org/org/baish/e/social',
      token,
    )
    const hash = link.slice(link.indexOf('#'))
    expect(splitSignInTicket(hash)).toEqual({ ticket: token, hash: '' })
  })
})

describe('signInTicketPlan', () => {
  test('without a token the page does nothing new, signed in or not', () => {
    expect(signInTicketPlan({ ticket: null, isSignedIn: false })).toBe(
      'nothing',
    )
    expect(signInTicketPlan({ ticket: null, isSignedIn: true })).toBe('nothing')
  })

  test('a token signs in a visitor who is signed out', () => {
    expect(signInTicketPlan({ ticket: 'abc', isSignedIn: false })).toBe(
      'sign_in',
    )
  })

  test('a token never replaces a session that is already there', () => {
    expect(signInTicketPlan({ ticket: 'abc', isSignedIn: true })).toBe(
      'keep_session',
    )
  })
})

// The address listeners `captureSignInTicket` registers. It registers them
// once per page, so they are collected across the stand-in windows below.
const listeners: Record<
  string,
  Array<{ listener: () => void; capture: boolean }>
> = {}

type Replacement = { state: unknown; url: string }

// The page the stand-in browser is on. There is one `History` class, as in
// a browser, and it acts on whichever page is current.
let page: {
  location: { pathname: string; search: string; hash: string }
  replaced: Array<Replacement>
} | null = null

class FakeHistory {
  state = { key: 'router-state' }
  replaceState(state: unknown, _unused: string, url: string) {
    if (!page) return
    page.replaced.push({ state, url })
    page.location.hash = url.includes('#') ? url.slice(url.indexOf('#')) : ''
  }
}

/**
 * A stand-in for the browser's window. `replaced` records what the browser's
 * own replaceState (History.prototype) was asked to do; `calls.wrapper`
 * counts calls to the wrapper a library like Sentry puts on `window.history`.
 */
function fakeWindow(path: string, hash: string) {
  const replaced: Array<Replacement> = []
  const calls = { wrapper: 0 }
  const history = new FakeHistory()
  // What Sentry's `fill(window.history, 'replaceState', ...)` does: an own
  // property that reads the address (token still in it) before it changes.
  Object.defineProperty(history, 'replaceState', {
    value: () => {
      calls.wrapper++
    },
  })
  const fake = {
    location: { pathname: path, search: '?x=1', hash },
    history,
    addEventListener(
      type: string,
      listener: () => void,
      options?: { capture?: boolean },
    ) {
      ;(listeners[type] ??= []).push({
        listener,
        capture: options?.capture === true,
      })
    },
  }
  page = { location: fake.location, replaced }
  const globals = globalThis as { window?: unknown; History?: unknown }
  globals.window = fake
  globals.History = FakeHistory
  return { fake, replaced, calls }
}

describe('captureSignInTicket', () => {
  const globals = globalThis as { window?: unknown; History?: unknown }
  const leavePage = () => {
    page = null
    delete globals.window
    delete globals.History
  }

  test('an address without a token is not touched and nothing is kept', () => {
    const { replaced, calls } = fakeWindow('/org/baish/e/social', '#faq')
    captureSignInTicket()
    expect(replaced).toEqual([])
    expect(calls.wrapper).toBe(0)
    expect(hasSignInTicket()).toBe(false)
    expect(takeSignInTicket()).toBe(null)
    leavePage()
  })

  test('the token leaves the address in place and is handed over once', () => {
    const { replaced } = fakeWindow('/org/baish/e/social', '#ticket=abc')
    captureSignInTicket()
    // Same history entry (its state is kept), address without the token.
    expect(replaced).toEqual([
      { state: { key: 'router-state' }, url: '/org/baish/e/social?x=1' },
    ])
    expect(hasSignInTicket()).toBe(true)
    expect(takeSignInTicket()).toBe('abc')
    expect(hasSignInTicket()).toBe(false)
    expect(takeSignInTicket()).toBe(null)
    leavePage()
  })

  test("the address changes through the browser's own replaceState, never a library's wrapper", () => {
    const { replaced, calls } = fakeWindow('/org/baish/e/social', '#ticket=abc')
    captureSignInTicket()
    expect(replaced.length).toBe(1)
    expect(calls.wrapper).toBe(0)
    expect(takeSignInTicket()).toBe('abc')
    leavePage()
  })

  test('a personal link opened in a tab already on the site is captured too, before other listeners', () => {
    const { fake, replaced, calls } = fakeWindow(
      '/org/baish/e/social',
      '#ticket=first',
    )
    captureSignInTicket()
    expect(takeSignInTicket()).toBe('first')
    // The address changes without a page load.
    fake.location.hash = '#ticket=second'
    expect(listeners.popstate.length).toBe(1)
    expect(listeners.hashchange.length).toBe(1)
    // Capture-phase listeners run before the ones Sentry, PostHog and the
    // router add later.
    expect(listeners.popstate[0].capture).toBe(true)
    expect(listeners.hashchange[0].capture).toBe(true)
    listeners.popstate[0].listener()
    listeners.hashchange[0].listener()
    expect(replaced.length).toBe(2)
    expect(calls.wrapper).toBe(0)
    expect(fake.location.hash).toBe('')
    expect(takeSignInTicket()).toBe('second')
    leavePage()
  })

  test('on the server there is no address and nothing happens', () => {
    leavePage()
    captureSignInTicket()
    expect(hasSignInTicket()).toBe(false)
  })
})

describe('redactSignInTicket', () => {
  test('text without a token is returned as it is', () => {
    expect(redactSignInTicket('/org/baish/e/social#faq')).toBe(
      '/org/baish/e/social#faq',
    )
    expect(redactSignInTicket('Tickets are sold out')).toBe(
      'Tickets are sold out',
    )
  })

  test('a token in a fragment or a query is replaced, the rest kept', () => {
    expect(
      redactSignInTicket(
        'https://safetytalent.org/org/baish/e/social#ticket=a.b-c',
      ),
    ).toBe('https://safetytalent.org/org/baish/e/social#ticket=[redacted]')
    expect(redactSignInTicket('/e/social?x=1&ticket=abc&y=2#top')).toBe(
      '/e/social?x=1&ticket=[redacted]&y=2#top',
    )
    expect(redactSignInTicket('ticket=abc')).toBe('ticket=[redacted]')
  })

  test('a percent-encoded address is redacted too', () => {
    expect(redactSignInTicket('next=%2Fe%2Fsocial%23ticket%3Dabc')).toBe(
      'next=%2Fe%2Fsocial%23ticket%3D[redacted]',
    )
  })
})

describe('redactSignInTicketDeep', () => {
  test('every string inside an event is redacted, nothing else changes', () => {
    const event = {
      request: { url: 'https://safetytalent.org/org/baish/e/s#ticket=abc' },
      breadcrumbs: [
        {
          category: 'navigation',
          data: { from: '/e/s#ticket=abc', to: '/e/s' },
        },
      ],
      level: 'error',
      count: 3,
      nothing: null,
    }
    expect(redactSignInTicketDeep(event)).toEqual({
      request: {
        url: 'https://safetytalent.org/org/baish/e/s#ticket=[redacted]',
      },
      breadcrumbs: [
        {
          category: 'navigation',
          data: { from: '/e/s#ticket=[redacted]', to: '/e/s' },
        },
      ],
      level: 'error',
      count: 3,
      nothing: null,
    })
  })

  test('an event without a token comes back equal', () => {
    const event = { request: { url: '/org/baish/e/s' }, tags: ['a', 'b'] }
    expect(redactSignInTicketDeep(event)).toEqual({
      request: { url: '/org/baish/e/s' },
      tags: ['a', 'b'],
    })
  })
})

describe('redaction never holds up the page', () => {
  test('a value that refers to itself is walked once', () => {
    const event: { url: string; self?: unknown; list: Array<unknown> } = {
      url: '/e/s#ticket=abc',
      list: [],
    }
    event.self = event
    event.list.push(event)
    redactSignInTicketDeep(event)
    expect(event.url).toBe('/e/s#ticket=[redacted]')
    expect(event.self).toBe(event)
  })

  test('objects that are not plain data are neither walked nor changed', () => {
    class Node {
      address = '/e/s#ticket=abc'
    }
    const node = new Node()
    const event = { target: node, url: '/e/s#ticket=abc' }
    redactSignInTicketDeep(event)
    expect(event.url).toBe('/e/s#ticket=[redacted]')
    expect(node.address).toBe('/e/s#ticket=abc')
  })

  test('a breadcrumb has its message and addresses redacted, its logged values untouched', () => {
    const logged = { anything: '/e/s#ticket=abc' }
    const breadcrumb = {
      category: 'navigation',
      message: 'to /e/s#ticket=abc',
      data: { from: '/e/s#ticket=abc', to: '/e/s', arguments: [logged] },
    }
    redactSignInTicketInBreadcrumb(breadcrumb)
    expect(breadcrumb.message).toBe('to /e/s#ticket=[redacted]')
    expect(breadcrumb.data.from).toBe('/e/s#ticket=[redacted]')
    expect(breadcrumb.data.to).toBe('/e/s')
    expect(logged.anything).toBe('/e/s#ticket=abc')
  })
})
