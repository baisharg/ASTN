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

function captureFromAddress(): void {
  const { ticket, hash } = splitSignInTicket(window.location.hash)
  if (hash === window.location.hash) return
  window.history.replaceState(
    window.history.state,
    '',
    window.location.pathname + window.location.search + hash,
  )
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
 * page: its listeners are registered first, so they run first.
 */
export function captureSignInTicket(): void {
  if (typeof window === 'undefined') return
  captureFromAddress()
  if (watching) return
  watching = true
  window.addEventListener('popstate', captureFromAddress)
  window.addEventListener('hashchange', captureFromAddress)
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
