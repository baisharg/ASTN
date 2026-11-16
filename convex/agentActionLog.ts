import { ConvexError, v } from 'convex/values'
import { mutation } from './_generated/server'
import { getUserId, requireOrgAdmin } from './lib/auth'

// Public mutation (not internalMutation) because the admin agent runs as an
// external Node.js process that connects via ConvexClient. External clients
// can only call public functions. The agent's client carries the signed-in
// admin's Clerk token, so the caller must be an admin of the org and the
// logged `userId` is that caller.
export const logAgentAction = mutation({
  args: {
    userId: v.string(),
    orgId: v.id('organizations'),
    toolName: v.string(),
    params: v.string(),
    result: v.string(),
    approvalStatus: v.union(
      v.literal('auto'),
      v.literal('approved'),
      v.literal('rejected'),
      v.literal('n/a'),
    ),
  },
  handler: async (ctx, args) => {
    const callerId = await getUserId(ctx)
    if (!callerId) throw new ConvexError('Not authenticated')
    await requireOrgAdmin(ctx, args.orgId)
    if (args.userId !== callerId) {
      throw new ConvexError('Not authorized: userId must be the caller')
    }
    await ctx.db.insert('agentActionLog', {
      ...args,
      timestamp: Date.now(),
    })
  },
})
