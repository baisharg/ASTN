// Canonical public URL of the app, for og:url/og:image and other absolute
// links rendered during SSR. Same-site links built in the browser should use
// window.location.origin (or relative paths) instead.
const DEFAULT_SITE_URL = 'https://app.baish.com.ar'

export const SITE_URL: string = (
  (import.meta.env.VITE_SITE_URL as string | undefined)?.trim() ||
  DEFAULT_SITE_URL
).replace(/\/+$/, '')

/** Host of the public app, e.g. `app.baish.com.ar`, for display text. */
export const SITE_HOST: string = new URL(SITE_URL).host
