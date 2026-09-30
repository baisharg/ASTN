import { ConvexError, v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalMutation, mutation } from '../_generated/server'
import { requireOrgAdmin } from '../lib/auth'
import { bumpCount } from '../crm'
import { crmCollectionValidator } from './validators'

const TABLE = {
  contacts: 'crmContacts',
  organizations: 'crmOrganizations',
} as const

const ACTIVITY_BATCH = 200

/**
 * Delete many contacts or organizations at once (the CRM's bulk action).
 * A contact's history (crmActivities) is removed afterwards in scheduled
 * batches. Returns how many were deleted; ids from other orgs or already
 * gone are skipped.
 */
export const deleteRecords = mutation({
  args: {
    orgId: v.id('organizations'),
    collection: crmCollectionValidator,
    ids: v.array(v.string()),
  },
  returns: v.number(),
  handler: async (ctx, { orgId, collection, ids }) => {
    await requireOrgAdmin(ctx, orgId)
    if (ids.length > 200) throw new ConvexError('Delete at most 200 at once')
    const table = TABLE[collection]
    let deleted = 0
    for (const raw of ids) {
      const id = ctx.db.normalizeId(table, raw)
      if (!id) continue
      const record = await ctx.db.get(id)
      if (!record || record.orgId !== orgId) continue
      await ctx.db.delete(id)
      deleted++
      const contactId =
        collection === 'contacts'
          ? ctx.db.normalizeId('crmContacts', raw)
          : null
      if (contactId) {
        await ctx.scheduler.runAfter(
          0,
          internal.contacts.bulk.deleteContactActivities,
          { contactId },
        )
      }
    }
    if (deleted > 0) await bumpCount(ctx, orgId, collection, -deleted)
    return deleted
  },
})

/** Delete a deleted contact's history, a batch at a time. */
export const deleteContactActivities = internalMutation({
  args: { contactId: v.id('crmContacts') },
  returns: v.null(),
  handler: async (ctx, { contactId }) => {
    const activities = await ctx.db
      .query('crmActivities')
      .withIndex('by_contactId_and_occurredAt', (q) =>
        q.eq('contactId', contactId),
      )
      .take(ACTIVITY_BATCH)
    for (const a of activities) await ctx.db.delete('crmActivities', a._id)
    if (activities.length === ACTIVITY_BATCH) {
      await ctx.scheduler.runAfter(
        0,
        internal.contacts.bulk.deleteContactActivities,
        { contactId },
      )
    }
    return null
  },
})
