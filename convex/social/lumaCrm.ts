import { ConvexError, v } from 'convex/values'
import { internal } from '../_generated/api'
import { action, internalMutation, internalQuery } from '../_generated/server'
import { bumpCount } from '../crm'
import { requireOrgAdmin } from '../lib/auth'
import { addToAllowlist, normalizeEmail } from './lib'
import { hasLumaApiKey, listAllLumaContacts } from './luma'

/**
 * Import the org's Luma contacts (everyone who registered for or subscribed
 * to its calendar) into the CRM, and optionally pre-approve everyone Luma
 * says was approved for a past event.
 */

const LUMA_LINE_PREFIX = 'Luma:'

const contactValidator = v.object({
  email: v.string(),
  name: v.string(),
  firstSeen: v.optional(v.string()), // YYYY-MM-DD
  approved: v.number(),
  checkedIn: v.number(),
  tags: v.array(v.string()),
})

const resultValidator = v.object({
  created: v.number(),
  updated: v.number(),
  allowlisted: v.number(),
})

function lumaLine(approved: number, checkedIn: number): string {
  return `${LUMA_LINE_PREFIX} aprobado en ${approved} evento${approved === 1 ? '' : 's'}, check-in en ${checkedIn}`
}

/** Replace a previous Luma line in `participatedIn`, or append one. */
function withLumaLine(existing: string | undefined, line: string): string {
  const parts = (existing ?? '')
    .split(' · ')
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith(LUMA_LINE_PREFIX))
  return [...parts, line].join(' · ')
}

export const assertOrgAdmin = internalQuery({
  args: { orgId: v.id('organizations') },
  returns: v.null(),
  handler: async (ctx, { orgId }) => {
    await requireOrgAdmin(ctx, orgId)
    return null
  },
})

export const upsertContacts = internalMutation({
  args: {
    orgId: v.id('organizations'),
    contacts: v.array(contactValidator),
    allowlistApproved: v.boolean(),
  },
  returns: resultValidator,
  handler: async (ctx, { orgId, contacts, allowlistApproved }) => {
    let created = 0
    let updated = 0
    let allowlisted = 0
    const now = Date.now()
    for (const c of contacts) {
      const email = normalizeEmail(c.email)
      const line = lumaLine(c.approved, c.checkedIn)
      const existing = await ctx.db
        .query('crmContacts')
        .withIndex('by_orgId_and_email', (q) =>
          q.eq('orgId', orgId).eq('email', email),
        )
        .first()
      if (existing) {
        // Never overwrite what someone wrote in the CRM; only fill gaps and
        // keep the Luma attendance line current.
        const participatedIn = withLumaLine(existing.participatedIn, line)
        const patch: Record<string, string | number> = {}
        if (participatedIn !== existing.participatedIn) {
          patch.participatedIn = participatedIn
        }
        if (!existing.firstContact && c.firstSeen) {
          patch.firstContact = c.firstSeen
        }
        if (!existing.contactSource) patch.contactSource = 'Luma'
        if (Object.keys(patch).length > 0) {
          await ctx.db.patch('crmContacts', existing._id, {
            ...patch,
            updatedAt: now,
          })
          updated++
        }
      } else {
        await ctx.db.insert('crmContacts', {
          orgId,
          name: c.name,
          email,
          contactSource: 'Luma',
          firstContact: c.firstSeen,
          participatedIn: line,
          notes: c.tags.length
            ? `Etiquetas en Luma: ${c.tags.join(', ')}`
            : undefined,
          createdAt: now,
          updatedAt: now,
        })
        created++
      }
      if (allowlistApproved && c.approved > 0) {
        const added = await addToAllowlist(ctx, {
          orgId,
          email,
          name: c.name,
          source: 'luma',
        })
        if (added) allowlisted++
      }
    }
    if (created > 0) await bumpCount(ctx, orgId, 'contacts', created)
    return { created, updated, allowlisted }
  },
})

export const importLumaContacts = action({
  args: {
    orgId: v.id('organizations'),
    allowlistApproved: v.boolean(),
  },
  returns: v.object({
    total: v.number(),
    created: v.number(),
    updated: v.number(),
    allowlisted: v.number(),
  }),
  handler: async (ctx, { orgId, allowlistApproved }) => {
    await ctx.runQuery(internal.social.lumaCrm.assertOrgAdmin, { orgId })
    if (!hasLumaApiKey()) {
      throw new ConvexError('Luma is not connected (LUMA_API_KEY is not set)')
    }
    const contacts = (await listAllLumaContacts())
      .filter((c) => c.email)
      .map((c) => ({
        email: c.email,
        name:
          c.name?.trim() ||
          [c.first_name, c.last_name].filter(Boolean).join(' ').trim() ||
          c.email.split('@')[0],
        firstSeen: c.created_at ? c.created_at.slice(0, 10) : undefined,
        approved: c.event_approved_count ?? 0,
        checkedIn: c.event_checked_in_count ?? 0,
        tags: (c.tags ?? []).map((t) => t.name).filter(Boolean),
      }))

    const totals = { created: 0, updated: 0, allowlisted: 0 }
    for (let i = 0; i < contacts.length; i += 100) {
      const result = await ctx.runMutation(
        internal.social.lumaCrm.upsertContacts,
        {
          orgId,
          contacts: contacts.slice(i, i + 100),
          allowlistApproved,
        },
      )
      totals.created += result.created
      totals.updated += result.updated
      totals.allowlisted += result.allowlisted
    }
    return { total: contacts.length, ...totals }
  },
})
