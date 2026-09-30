import { ConvexError, v } from 'convex/values'
import { internal } from '../_generated/api'
import { action, internalMutation, internalQuery } from '../_generated/server'
import { bumpCount } from '../crm'
import { requireOrgAdmin } from '../lib/auth'
import {
  addMissingOptions,
  ensureBuiltinFieldDefs,
  normalizeValue,
} from '../contacts/fields'
import { contactsByEmail } from '../contacts/people'
import { addToAllowlist, normalizeEmail } from './lib'
import type { FieldValue } from '../contacts/fields'
import { hasLumaApiKey, listAllLumaContacts } from './luma'

/**
 * Import the org's Luma contacts (everyone who registered for or subscribed
 * to its calendar) into the CRM, and optionally pre-approve everyone Luma
 * says was approved for a past event.
 */

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
    const defs = new Map(
      (await ensureBuiltinFieldDefs(ctx, orgId, 'contacts')).map((d) => [
        d.key,
        d,
      ]),
    )
    // Normalize a value for a builtin field, adding unseen select options.
    const value = async (key: string, raw: unknown) => {
      const def = defs.get(key)
      if (!def) return undefined
      const normalized = normalizeValue(def.type, raw)
      if (normalized !== undefined) {
        defs.set(key, await addMissingOptions(ctx, def, normalized))
      }
      return normalized
    }

    // Primary and other emails, so a contact merged into another (its email
    // now among the other's otherEmails) isn't created again. New and
    // updated contacts go back into the map as the chunk goes.
    const byEmail = await contactsByEmail(ctx, orgId)

    for (const c of contacts) {
      const email = normalizeEmail(c.email)
      // Tags are Luma's to report, so they are always refreshed.
      const fromLuma: Record<string, FieldValue> = {}
      const tags = await value('lumaTags', c.tags)
      if (tags !== undefined) fromLuma.lumaTags = tags
      // These only fill gaps; never overwrite what someone wrote in the CRM.
      // Attendance counts are kept by the per-event attendance sync
      // (convex/luma/), which recomputes them from each person's history;
      // Luma's contact totals only seed contacts it hasn't reached yet.
      const gaps: Record<string, FieldValue> = {
        lumaApproved: c.approved,
        lumaCheckedIn: c.checkedIn,
      }
      const source = await value('contactSource', 'Luma')
      if (source !== undefined) gaps.contactSource = source
      const firstSeen = await value('firstContact', c.firstSeen)
      if (firstSeen !== undefined) gaps.firstContact = firstSeen

      const existing = byEmail.get(email)
      if (existing) {
        const current = existing.fields ?? {}
        const fields = { ...gaps, ...current, ...fromLuma }
        for (const key of Object.keys(gaps)) {
          if (current[key] !== undefined && current[key] !== null) {
            fields[key] = current[key]
          }
        }
        if (JSON.stringify(fields) !== JSON.stringify(current)) {
          await ctx.db.patch('crmContacts', existing._id, {
            fields,
            updatedAt: now,
          })
          const patched = { ...existing, fields, updatedAt: now }
          for (const [key, doc] of byEmail) {
            if (doc._id === existing._id) byEmail.set(key, patched)
          }
          updated++
        }
      } else {
        const id = await ctx.db.insert('crmContacts', {
          orgId,
          name: c.name,
          email,
          fields: { ...gaps, ...fromLuma },
          createdAt: now,
          updatedAt: now,
        })
        const inserted = await ctx.db.get('crmContacts', id)
        if (inserted) byEmail.set(email, inserted)
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
