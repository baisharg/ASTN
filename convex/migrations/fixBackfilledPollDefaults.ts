import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'
import { DEFAULT_POLL } from '../availabilityPolls'

// One-off: re-apply the current DEFAULT_POLL window (Mon–Sat, 9:00–21:00) to the
// polls created by the backfill migration, which were seeded with the earlier
// Mon–Fri 9:00–18:00 default. Only touches createdBy === 'system:backfill' polls
// that have no responses yet, so no submitted availability is invalidated.
export const fixBackfilledPollDefaults = internalMutation({
  args: {},
  returns: v.object({ updated: v.number(), skipped: v.number() }),
  handler: async (ctx) => {
    const polls = await ctx.db
      .query('availabilityPolls')
      .collect()
    let updated = 0
    let skipped = 0
    for (const p of polls) {
      if (p.createdBy !== 'system:backfill') continue
      const aResponse = await ctx.db
        .query('availabilityResponses')
        .withIndex('by_poll', (q) => q.eq('pollId', p._id))
        .first()
      if (aResponse) {
        skipped++
        continue
      }
      await ctx.db.patch('availabilityPolls', p._id, {
        days: [...DEFAULT_POLL.days],
        startMinutes: DEFAULT_POLL.startMinutes,
        endMinutes: DEFAULT_POLL.endMinutes,
        slotDurationMinutes: DEFAULT_POLL.slotDurationMinutes,
        updatedAt: Date.now(),
      })
      updated++
    }
    return { updated, skipped }
  },
})
