import { convexQuery } from '@convex-dev/react-query'
import { api } from '../../convex/_generated/api'
import type { QueryClient } from '@tanstack/react-query'
import type { OrgLookup } from '~/lib/orgPageHead'

/** How long a page waits for the lookup before rendering without it. */
export const ORG_LOOKUP_TIMEOUT_MS = 3000

/**
 * Looks an org up for the head of its public pages. Runs in the route
 * loader, so on a first request it runs on the server and the tags are in
 * the HTML.
 *
 * The page itself does not depend on the lookup, so this never throws and
 * never waits longer than `timeoutMs`: a lookup that fails or takes too long
 * is `unavailable`, and the page keeps the site's default tags.
 */
export async function lookUpOrgForHead(
  queryClient: Pick<QueryClient, 'ensureQueryData' | 'removeQueries'>,
  slug: string,
  timeoutMs: number = ORG_LOOKUP_TIMEOUT_MS,
): Promise<OrgLookup> {
  const query = convexQuery(api.orgs.directory.getOrgPublicProfile, { slug })
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<'timedOut'>((resolve) => {
    timer = setTimeout(() => resolve('timedOut'), timeoutMs)
  })
  try {
    const org = await Promise.race([
      queryClient.ensureQueryData(query),
      timedOut,
    ])
    if (org === 'timedOut') {
      // Drop the unanswered query. Left in the cache, the server would keep
      // the response open until it answers, to send its result to the
      // browser.
      queryClient.removeQueries({ queryKey: query.queryKey, exact: true })
      return { status: 'unavailable' }
    }
    return org ? { status: 'found', org } : { status: 'notFound' }
  } catch {
    return { status: 'unavailable' }
  } finally {
    clearTimeout(timer)
  }
}
