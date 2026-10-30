import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'

/**
 * Where replies to an org's emails go. Emails leave from
 * notifications@safetytalent.org, which nobody reads, so a reply would be
 * lost without this: the org's reply-to address, else its contact email.
 */
export async function replyToFor(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
): Promise<Array<string> | undefined> {
  const org = await ctx.db.get('organizations', orgId)
  const address = org?.replyToEmail?.trim() || org?.contactEmail?.trim()
  return address ? [address] : undefined
}
