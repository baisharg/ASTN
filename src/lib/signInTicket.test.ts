import { personalEventLink } from '../../convex/social/constants'
import {
  captureSignInTicket,
  hasSignInTicket,
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
const listeners: Record<string, Array<() => void>> = {}

/** A stand-in for the browser's window, recording address replacements. */
function fakeWindow(path: string, hash: string) {
  const replaced: Array<{ state: unknown; url: string }> = []
  const fake = {
    location: { pathname: path, search: '?x=1', hash },
    history: {
      state: { key: 'router-state' },
      replaceState(state: unknown, _title: string, url: string) {
        replaced.push({ state, url })
        fake.location.hash = url.includes('#')
          ? url.slice(url.indexOf('#'))
          : ''
      },
    },
    addEventListener(type: string, listener: () => void) {
      ;(listeners[type] ??= []).push(listener)
    },
  }
  return { fake, replaced }
}

describe('captureSignInTicket', () => {
  const globals = globalThis as { window?: unknown }

  test('an address without a token is not touched and nothing is kept', () => {
    const { fake, replaced } = fakeWindow('/org/baish/e/social', '#faq')
    globals.window = fake
    captureSignInTicket()
    expect(replaced).toEqual([])
    expect(hasSignInTicket()).toBe(false)
    expect(takeSignInTicket()).toBe(null)
    delete globals.window
  })

  test('the token leaves the address in place and is handed over once', () => {
    const { fake, replaced } = fakeWindow('/org/baish/e/social', '#ticket=abc')
    globals.window = fake
    captureSignInTicket()
    // Same history entry (its state is kept), address without the token.
    expect(replaced).toEqual([
      { state: { key: 'router-state' }, url: '/org/baish/e/social?x=1' },
    ])
    expect(hasSignInTicket()).toBe(true)
    expect(takeSignInTicket()).toBe('abc')
    expect(hasSignInTicket()).toBe(false)
    expect(takeSignInTicket()).toBe(null)
    delete globals.window
  })

  test('a personal link opened in a tab already on the site is captured too', () => {
    const { fake, replaced } = fakeWindow(
      '/org/baish/e/social',
      '#ticket=first',
    )
    globals.window = fake
    captureSignInTicket()
    expect(takeSignInTicket()).toBe('first')
    // The address changes without a page load.
    fake.location.hash = '#ticket=second'
    expect(listeners.popstate.length).toBe(1)
    expect(listeners.hashchange.length).toBe(1)
    listeners.popstate[0]()
    listeners.hashchange[0]()
    expect(replaced.length).toBe(2)
    expect(fake.location.hash).toBe('')
    expect(takeSignInTicket()).toBe('second')
    delete globals.window
  })

  test('on the server there is no address and nothing happens', () => {
    delete globals.window
    captureSignInTicket()
    expect(hasSignInTicket()).toBe(false)
  })
})
