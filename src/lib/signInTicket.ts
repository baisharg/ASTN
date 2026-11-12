import { SIGN_IN_TICKET_PARAM } from '../../convex/social/constants'

/**
 * The sign-in token of a personal event link, on the browser's side.
 *
 * The token arrives in the address's fragment (`#ticket=...`). It is a
 * credential, so `captureSignInTicket` takes it out of the address before
 * anything else reads the address, and from then on it lives only in this
 * module's memory until the event page signs in with it.
 */

/**
 * Split a fragment (`location.hash`) into the sign-in token it carries and
 * the fragment without it. A fragment without a token comes back unchanged.
 */
export function splitSignInTicket(hash: string): {
  ticket: string | null
  hash: string
} {
  const body = hash.startsWith('#') ? hash.slice(1) : hash
  // Only a fragment made of `key=value` pairs can carry a token; anything
  // else (an anchor like `#faq`) is left exactly as it is.
  if (!body.includes(`${SIGN_IN_TICKET_PARAM}=`)) return { ticket: null, hash }
  const parts = body.split('&')
  const isTicket = (part: string) => part.startsWith(`${SIGN_IN_TICKET_PARAM}=`)
  const ticketPart = parts.find(isTicket)
  if (ticketPart === undefined) return { ticket: null, hash }
  const rest = parts.filter((part) => !isTicket(part)).join('&')
  let ticket: string
  try {
    ticket = decodeURIComponent(
      ticketPart.slice(SIGN_IN_TICKET_PARAM.length + 1),
    )
  } catch {
    ticket = ''
  }
  return { ticket: ticket || null, hash: rest ? `#${rest}` : '' }
}

let pendingTicket: string | null = null
let watching = false
const listeners = new Set<() => void>()

// Replaces the current history entry's address, keeping its state. It calls
// the browser's own `History.prototype.replaceState`, not
// `window.history.replaceState`: Sentry, PostHog and the router put wrappers
// on the latter that read the address before it changes, with the token
// still in it.
let replaceAddress: ((url: string) => void) | null = null

function captureFromAddress(): void {
  const { ticket, hash } = splitSignInTicket(window.location.hash)
  if (hash === window.location.hash) return
  replaceAddress?.(window.location.pathname + window.location.search + hash)
  if (!ticket) return
  pendingTicket = ticket
  for (const listener of listeners) listener()
}

/**
 * Take the sign-in token out of the page's address, if it has one, and keep
 * it in memory. The address is replaced in place, so the token is in neither
 * the address bar nor the browser history afterwards.
 *
 * Call it once, before anything that reads the address (the router, Sentry,
 * analytics). It also watches for a personal link opened in a tab that
 * already shows the site, which changes the address without loading the
 * page: its listeners are registered first and in the capture phase, so
 * they run before anyone else's.
 */
export function captureSignInTicket(): void {
  if (typeof window === 'undefined') return
  if (replaceAddress === null) {
    const browserHistory = History.prototype
    replaceAddress = (url) =>
      browserHistory.replaceState.call(
        window.history,
        window.history.state,
        '',
        url,
      )
  }
  captureFromAddress()
  if (watching) return
  watching = true
  window.addEventListener('popstate', captureFromAddress, { capture: true })
  window.addEventListener('hashchange', captureFromAddress, { capture: true })
}

/** Whether a captured sign-in token is waiting to be used. */
export function hasSignInTicket(): boolean {
  return pendingTicket !== null
}

/** Be told when a token is captured or taken. Returns the unsubscribe. */
export function subscribeSignInTicket(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * The captured sign-in token, handed over once: a second call gets null, so
 * a token is never used twice.
 */
export function takeSignInTicket(): string | null {
  const ticket = pendingTicket
  pendingTicket = null
  if (ticket !== null) for (const listener of listeners) listener()
  return ticket
}

/**
 * What the event page does with a personal link's token once Clerk has
 * loaded:
 * - `nothing`: there is no token; the page behaves as it always does.
 * - `sign_in`: nobody is signed in, so the token signs the visitor in.
 * - `keep_session`: someone is already signed in. Their session stays and the
 *   token is left unused (it still works if the link is opened again after
 *   signing out).
 */
export type SignInTicketPlan = 'nothing' | 'sign_in' | 'keep_session'

export function signInTicketPlan(input: {
  ticket: string | null
  isSignedIn: boolean
}): SignInTicketPlan {
  if (!input.ticket) return 'nothing'
  return input.isSignedIn ? 'keep_session' : 'sign_in'
}

// A sign-in token wherever it could appear in text: after `#`, `&` or `?`
// (plain or percent-encoded), up to the next delimiter.
const TICKET_IN_TEXT = new RegExp(
  `(^|[#&?]|%23|%26|%3F)(${SIGN_IN_TICKET_PARAM})(=|%3D)[^&#\\s"'<>]*`,
  'gi',
)

/** `text` with any sign-in token in it replaced by "[redacted]". */
export function redactSignInTicket(text: string): string {
  if (!text.toLowerCase().includes(SIGN_IN_TICKET_PARAM)) return text
  return text.replace(TICKET_IN_TEXT, '$1$2$3[redacted]')
}

const REDACT_MAX_DEPTH = 12

/**
 * Redact sign-in tokens in every string inside `value` (objects and arrays
 * are changed in place) and return it. The second line of defence for what
 * leaves the browser in error reports and analytics: the token should never
 * be in an address by then, and if it is, it does not travel.
 */
export function redactSignInTicketDeep<T>(value: T, depth = 0): T {
  if (typeof value === 'string') return redactSignInTicket(value) as T
  if (value === null || typeof value !== 'object') return value
  if (depth >= REDACT_MAX_DEPTH) return value
  const container = value as Record<string, unknown>
  for (const key of Object.keys(container)) {
    const item = container[key]
    if (typeof item === 'string') {
      const redacted = redactSignInTicket(item)
      if (redacted !== item) container[key] = redacted
    } else if (item !== null && typeof item === 'object') {
      redactSignInTicketDeep(item, depth + 1)
    }
  }
  return value
}
