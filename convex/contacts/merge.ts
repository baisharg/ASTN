import { ConvexError, v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { requireOrgAdmin } from '../lib/auth'
import { bumpCount } from '../crm'
import { recomputeLumaCounts } from '../luma/shared'
import { addDismissal, dismissedPairs, moveDismissals } from './dismissals'
import { addMissingOptions, isSelect, listFieldDefs } from './fields'
import {
  filledCount,
  findDuplicateGroups,
  legacyFlatKeys,
  planMerge,
} from './mergeLogic'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/**
 * Merging duplicate contacts, and finding them. The same person often came
 * in twice (Airtable under one email, Luma under another); a merge keeps one
 * contact, gives it every email, fills its gaps from the others, moves
 * their history to it and deletes them. Irreversible.
 *
 * Syncs stay stable afterwards: the Luma mirror and contact import match
 * on other emails, so a moved email keeps landing on the kept contact, and
 * its history rows (keyed per email) already point there. Two rows for one
 * event (the person registered with both emails) both stay, because the
 * sync would recreate a deleted one; counts and the person page take the
 * best status per event. The Airtable import matches `mergedAirtableIds`.
 */

// Contacts in one merge (the kept one included), and history rows of all
// of them together, so one transaction stays well inside Convex's limits.
export const MAX_MERGE_CONTACTS = 5
export const MAX_MERGE_HISTORY = 1000
// The org's contacts are read in one query to find duplicates.
const MAX_CONTACTS = 5000

async function orgContact(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
  raw: string,
): Promise<Doc<'crmContacts'>> {
  const id = ctx.db.normalizeId('crmContacts', raw)
  const contact = id ? await ctx.db.get('crmContacts', id) : null
  if (!contact || contact.orgId !== orgId) {
    throw new ConvexError('No encontramos uno de los contactos')
  }
  return contact
}

function describe(c: Doc<'crmContacts'>): string {
  return c.email ? `${c.name} <${c.email}>` : c.name
}

export type MergeOutcome = {
  keepId: Id<'crmContacts'>
  merged: number
  activitiesMoved: number
  emails: Array<string>
}

/**
 * Merge `mergeIds` into `keepId` (all in the org). Shared by the CRM
 * screens and the MCP; callers check org admin first.
 */
export async function mergeContactsInOrg(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  keepRaw: string,
  mergeRaw: Array<string>,
): Promise<MergeOutcome> {
  const mergeIds = [...new Set(mergeRaw)]
  if (mergeIds.length === 0) {
    throw new ConvexError('Elegí al menos otro contacto para fusionar')
  }
  if (mergeIds.length + 1 > MAX_MERGE_CONTACTS) {
    throw new ConvexError(
      `Se pueden fusionar hasta ${MAX_MERGE_CONTACTS} contactos a la vez`,
    )
  }
  const keep = await orgContact(ctx, orgId, keepRaw)
  const others: Array<Doc<'crmContacts'>> = []
  for (const raw of mergeIds) {
    const c = await orgContact(ctx, orgId, raw)
    if (c._id === keep._id) {
      throw new ConvexError(
        'El contacto que se conserva no puede estar entre los que se fusionan',
      )
    }
    others.push(c)
  }
  for (const c of [keep, ...others]) {
    const legacy = legacyFlatKeys(c)
    if (legacy.length > 0) {
      throw new ConvexError(
        `${c.name} todavía tiene campos en el formato viejo (${legacy.join(', ')}); hay que migrarlos antes de fusionar`,
      )
    }
  }

  const defs = await listFieldDefs(ctx, orgId, 'contacts')
  const plan = planMerge(keep, others, defs)
  if (!plan.ok) throw new ConvexError(plan.error)

  // History of every contact involved, the kept one's included (the Luma
  // recount reads it all afterwards).
  let budget = MAX_MERGE_HISTORY
  const moving: Array<Doc<'crmActivities'>> = []
  for (const c of [keep, ...others]) {
    const rows = await ctx.db
      .query('crmActivities')
      .withIndex('by_contactId_and_occurredAt', (q) => q.eq('contactId', c._id))
      .take(budget + 1)
    if (rows.length > budget) {
      throw new ConvexError(
        `Entre todos tienen más de ${MAX_MERGE_HISTORY} registros de historial; no se pueden fusionar desde acá`,
      )
    }
    budget -= rows.length
    if (c._id !== keep._id) moving.push(...rows)
  }
  for (const a of moving) {
    await ctx.db.patch('crmActivities', a._id, { contactId: keep._id })
  }

  // Select values come from existing records, so their options exist;
  // this only guards against definitions edited in the meantime.
  for (const def of defs) {
    const value = plan.patch.fields[def.key]
    if (isSelect(def.type) && value !== undefined) {
      await addMissingOptions(ctx, def, value)
    }
  }

  const now = Date.now()
  await ctx.db.patch('crmContacts', keep._id, {
    ...plan.patch,
    updatedAt: now,
  })
  await moveDismissals(
    ctx,
    orgId,
    keep._id,
    others.map((c) => c._id),
  )
  for (const c of others) await ctx.db.delete('crmContacts', c._id)
  await recomputeLumaCounts(ctx, keep._id)
  await ctx.db.insert('crmActivities', {
    orgId,
    contactId: keep._id,
    kind: 'note',
    title: `Fusionado con: ${others.map(describe).join(', ')}`,
    occurredAt: now,
    source: 'app',
    createdAt: now,
  })
  await bumpCount(ctx, orgId, 'contacts', -others.length)

  return {
    keepId: keep._id,
    merged: others.length,
    activitiesMoved: moving.length,
    emails: [plan.patch.email, ...(plan.patch.otherEmails ?? [])].filter(
      (e): e is string => !!e,
    ),
  }
}

export const mergeContacts = mutation({
  args: {
    orgId: v.id('organizations'),
    keepId: v.id('crmContacts'),
    mergeIds: v.array(v.id('crmContacts')),
  },
  returns: v.object({
    keepId: v.id('crmContacts'),
    merged: v.number(),
    activitiesMoved: v.number(),
    emails: v.array(v.string()),
  }),
  handler: async (ctx, { orgId, keepId, mergeIds }) => {
    await requireOrgAdmin(ctx, orgId)
    return await mergeContactsInOrg(ctx, orgId, keepId, mergeIds)
  },
})

// ── Side-by-side summaries ───────────────────────────────────────────────

/** What the duplicates list shows per contact: the contact alone. */
export const contactBriefValidator = v.object({
  _id: v.id('crmContacts'),
  name: v.string(),
  email: v.union(v.string(), v.null()),
  otherEmails: v.array(v.string()),
  phone: v.union(v.string(), v.null()),
  linkedin: v.union(v.string(), v.null()),
  location: v.union(v.string(), v.null()),
  source: v.union(v.string(), v.null()),
  relationship: v.union(v.string(), v.null()),
  firstContact: v.union(v.string(), v.null()),
  hasAccount: v.boolean(),
  fromAirtable: v.boolean(),
  filled: v.number(),
  createdAt: v.number(),
})

/** The merge dialog's view: plus how much history each one has. */
export const contactSummaryValidator = contactBriefValidator.extend({
  // Capped at MAX_MERGE_HISTORY + 1.
  activityCount: v.number(),
})

type ContactBrief = typeof contactBriefValidator.type
type ContactSummary = typeof contactSummaryValidator.type

const str = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null

function brief(c: Doc<'crmContacts'>): ContactBrief {
  return {
    _id: c._id,
    name: c.name,
    email: c.email ?? null,
    otherEmails: c.otherEmails ?? [],
    phone: c.phone ?? null,
    linkedin: c.linkedin ?? null,
    location: c.location ?? null,
    source: str(c.fields?.contactSource),
    relationship: str(c.fields?.relationship),
    firstContact: str(c.fields?.firstContact),
    hasAccount: !!c.userId,
    fromAirtable: !!c.airtableId,
    filled: filledCount(c),
    createdAt: c._creationTime,
  }
}

/** Key facts of a few contacts, for the merge dialog. */
export const contactSummaries = query({
  args: {
    orgId: v.id('organizations'),
    ids: v.array(v.id('crmContacts')),
  },
  returns: v.array(contactSummaryValidator),
  handler: async (ctx, { orgId, ids }) => {
    await requireOrgAdmin(ctx, orgId)
    const out: Array<ContactSummary> = []
    // One more than a merge allows, so the dialog can say it's too many.
    for (const id of [...new Set(ids)].slice(0, MAX_MERGE_CONTACTS + 1)) {
      const c = await ctx.db.get('crmContacts', id)
      if (!c || c.orgId !== orgId) continue
      const activities = await ctx.db
        .query('crmActivities')
        .withIndex('by_contactId_and_occurredAt', (q) =>
          q.eq('contactId', c._id),
        )
        .take(MAX_MERGE_HISTORY + 1)
      out.push({ ...brief(c), activityCount: activities.length })
    }
    return out
  },
})

// ── Duplicates ───────────────────────────────────────────────────────────

const reasonValidator = v.union(
  v.literal('sameEmail'),
  v.literal('sameLinkedin'),
  v.literal('samePhone'),
  v.literal('sameName'),
  v.literal('similarName'),
)

export const duplicateGroupValidator = v.object({
  ids: v.array(v.id('crmContacts')),
  reasons: v.array(reasonValidator),
  score: v.number(),
  suggestedKeepId: v.id('crmContacts'),
  blocked: v.boolean(),
  members: v.array(contactBriefValidator),
})

/**
 * Candidate duplicate groups for the org, strongest first. Reads only the
 * org's contacts and dismissals; history counts load per group, when the
 * admin opens it (contactSummaries).
 */
export async function duplicateGroups(
  ctx: QueryCtx,
  orgId: Id<'organizations'>,
): Promise<Array<typeof duplicateGroupValidator.type>> {
  const contacts = await ctx.db
    .query('crmContacts')
    .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
    .take(MAX_CONTACTS + 1)
  if (contacts.length > MAX_CONTACTS) {
    throw new ConvexError(
      `Buscar duplicados lee hasta ${MAX_CONTACTS} contactos; esta organización tiene más`,
    )
  }
  const dismissed = await dismissedPairs(ctx, orgId)
  const byId = new Map(contacts.map((c) => [c._id as string, c]))
  return findDuplicateGroups(contacts, dismissed).map((g) => ({
    ids: g.ids as Array<Id<'crmContacts'>>,
    reasons: g.reasons,
    score: g.score,
    suggestedKeepId: g.suggestedKeepId as Id<'crmContacts'>,
    blocked: g.blocked,
    members: g.ids.map((id) => brief(byId.get(id) as Doc<'crmContacts'>)),
  }))
}

export const findDuplicates = query({
  args: { orgId: v.id('organizations') },
  returns: v.array(duplicateGroupValidator),
  handler: async (ctx, { orgId }) => {
    await requireOrgAdmin(ctx, orgId)
    return await duplicateGroups(ctx, orgId)
  },
})

/** Mark contacts as different people: findDuplicates stops pairing them. */
export async function dismissPairs(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  rawIds: Array<string>,
  userId: string,
): Promise<number> {
  const ids = [...new Set(rawIds)]
  if (ids.length < 2) {
    throw new ConvexError('Hacen falta al menos dos contactos')
  }
  if (ids.length > 20) throw new ConvexError('Hasta 20 contactos a la vez')
  const contacts = []
  for (const raw of ids) contacts.push(await orgContact(ctx, orgId, raw))
  let added = 0
  for (let i = 0; i < contacts.length; i++) {
    for (let j = i + 1; j < contacts.length; j++) {
      const inserted = await addDismissal(
        ctx,
        orgId,
        contacts[i]._id,
        contacts[j]._id,
        userId,
      )
      if (inserted) added++
    }
  }
  return added
}

export const dismissDuplicate = mutation({
  args: {
    orgId: v.id('organizations'),
    ids: v.array(v.id('crmContacts')),
  },
  returns: v.number(),
  handler: async (ctx, { orgId, ids }) => {
    const userId = await requireOrgAdmin(ctx, orgId)
    return await dismissPairs(ctx, orgId, ids, userId)
  },
})
