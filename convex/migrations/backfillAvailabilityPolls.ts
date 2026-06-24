import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'
import { createDefaultPollForOpportunity } from '../availabilityPolls'

// One-off: give every existing opportunity a default availability poll (those
// that already have an active poll are skipped). Idempotent — safe to re-run.
export const backfillAvailabilityPolls = internalMutation({
  args: {},
  returns: v.object({ scanned: v.number(), created: v.number() }),
  handler: async (ctx) => {
    const opps = await ctx.db.query('orgOpportunities').collect()
    let created = 0
    for (const opp of opps) {
      const pollId = await createDefaultPollForOpportunity(ctx, {
        opportunityId: opp._id,
        orgId: opp.orgId,
        createdBy: 'system:backfill',
      })
      if (pollId) created++
    }
    return { scanned: opps.length, created }
  },
})
