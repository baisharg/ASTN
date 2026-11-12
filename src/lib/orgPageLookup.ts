import { convexQuery } from '@convex-dev/react-query'
import { api } from '../../convex/_generated/api'
import type { QueryClient } from '@tanstack/react-query'
import type { OrgLookup } from '~/lib/orgPageHead'

/**
 * Looks an org up for the head of its public pages. Runs in the route
 * loader, so on a first request it runs on the server and the tags are in
 * the HTML. It never throws: the page itself does not depend on it, so a
 * failed lookup only means the page keeps the site's default tags.
 */
export async function lookUpOrgForHead(
  queryClient: QueryClient,
  slug: string,
): Promise<OrgLookup> {
  try {
    const org = await queryClient.ensureQueryData(
      convexQuery(api.orgs.directory.getOrgPublicProfile, { slug }),
    )
    return org ? { status: 'found', org } : { status: 'notFound' }
  } catch {
    return { status: 'unavailable' }
  }
}
