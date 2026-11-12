/**
 * Whether a path is one of the in-person event pages
 * (`/org/<org>/e/<event>` and everything under it).
 */
export function isSocialEventPath(pathname: string): boolean {
  return /^\/org\/[^/]+\/e\/[^/]+(\/|$)/.test(pathname)
}
