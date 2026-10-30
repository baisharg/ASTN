// Public URL of the ASTN web app (the Vercel frontend), for absolute links and
// asset URLs in emails, unsubscribe pages and poll links.
//
// Not to be confused with CONVEX_SITE_URL (the *.convex.site host that serves
// Convex HTTP actions such as /unsubscribe, /mcp and /.well-known metadata).
// Those URLs must keep using CONVEX_SITE_URL.

export const DEFAULT_APP_URL = 'https://app.baish.com.ar'

/** `SITE_URL` without a trailing slash, falling back to the production app. */
export function appUrl(): string {
  const raw = process.env.SITE_URL?.trim()
  return (raw || DEFAULT_APP_URL).replace(/\/+$/, '')
}

/** Host of the public app, e.g. `app.baish.com.ar`, for display text. */
export function appHost(): string {
  return new URL(appUrl()).host
}

// Sender for all ASTN email. Stays on safetytalent.org until the new domain is
// verified in Resend; override with the EMAIL_FROM env var.
export const DEFAULT_EMAIL_FROM = 'ASTN <notifications@safetytalent.org>'

export function emailFrom(): string {
  return process.env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM
}
