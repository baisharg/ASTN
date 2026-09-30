import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalMutation } from '../_generated/server'
import {
  BUILTIN_FIELDS,
  addMissingOptions,
  ensureBuiltinFieldDefs,
  normalizeValue,
} from './fields'
import type { FieldValue } from './fields'
import type { CrmCollection } from './validators'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

/**
 * One-off migration: move the old flat CRM columns into `fields` (see
 * docs/crm-consolidation.md). Batched and idempotent; values already in
 * `fields` win. Run with:
 *   bunx convex run contacts/migrate:run '{"collection":"contacts"}'
 * and again with "organizations".
 */

const TABLE = {
  contacts: 'crmContacts',
  organizations: 'crmOrganizations',
} as const
const BATCH = 100

/**
 * The first Luma contacts import wrote "Luma: aprobado en N eventos, check-in
 * en M" into participatedIn. Move those numbers into lumaApproved and
 * lumaCheckedIn and drop the text. Returns whether anything changed.
 */
const LUMA_APPROVED = /^Luma: aprobado en (\d+) eventos?$/
const LUMA_CHECKED_IN = /^check-in en (\d+)$/

function cleanLumaLine(fields: Record<string, FieldValue>): boolean {
  const list = fields.participatedIn
  if (!Array.isArray(list)) return false
  let changed = false
  const keep: Array<string> = []
  for (const item of list) {
    const approved = item.match(LUMA_APPROVED)
    const checkedIn = item.match(LUMA_CHECKED_IN)
    if (approved) {
      fields.lumaApproved ??= Number(approved[1])
      changed = true
    } else if (checkedIn) {
      fields.lumaCheckedIn ??= Number(checkedIn[1])
      changed = true
    } else {
      keep.push(item)
    }
  }
  if (!changed) return false
  if (keep.length) fields.participatedIn = keep
  else delete fields.participatedIn
  return true
}

/** Drop the Luma-line options that cleanLumaLine made obsolete. */
async function cleanLumaOptions(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
): Promise<void> {
  const def = await ctx.db
    .query('crmFieldDefs')
    .withIndex('by_orgId_and_collection_and_key', (q) =>
      q
        .eq('orgId', orgId)
        .eq('collection', 'contacts')
        .eq('key', 'participatedIn'),
    )
    .first()
  if (!def?.options) return
  const options = def.options.filter(
    (o) => !LUMA_APPROVED.test(o.value) && !LUMA_CHECKED_IN.test(o.value),
  )
  if (options.length !== def.options.length) {
    await ctx.db.patch('crmFieldDefs', def._id, {
      options,
      updatedAt: Date.now(),
    })
  }
}

async function migrateRecord(
  ctx: MutationCtx,
  collection: CrmCollection,
  record: Doc<'crmContacts'> | Doc<'crmOrganizations'>,
  defsByOrg: Map<Id<'organizations'>, Map<string, Doc<'crmFieldDefs'>>>,
): Promise<boolean> {
  let defs = defsByOrg.get(record.orgId)
  if (!defs) {
    const list = await ensureBuiltinFieldDefs(ctx, record.orgId, collection)
    defs = new Map(list.map((d) => [d.key, d]))
    defsByOrg.set(record.orgId, defs)
  }
  const flat = record as unknown as Record<string, unknown>
  const fields: Record<string, FieldValue> = { ...record.fields }
  const unset: Record<string, undefined> = {}
  let touched = false
  for (const { key } of BUILTIN_FIELDS[collection]) {
    if (!(key in flat) || flat[key] === undefined) continue
    unset[key] = undefined
    touched = true
    const def = defs.get(key)
    if (!def || fields[key] !== undefined) continue
    const value = normalizeValue(def.type, flat[key])
    if (value === undefined) continue
    defs.set(key, await addMissingOptions(ctx, def, value))
    fields[key] = value
  }
  if (collection === 'contacts' && cleanLumaLine(fields)) touched = true
  const email =
    collection === 'contacts' ? (record as Doc<'crmContacts'>).email : undefined
  const lowerEmail = email?.trim().toLowerCase()
  if (!touched && lowerEmail === email) return false
  await ctx.db.patch(TABLE[collection], record._id, {
    ...unset,
    fields,
    ...(collection === 'contacts' && email ? { email: lowerEmail } : {}),
  } as never)
  return true
}

export const run = internalMutation({
  args: {
    collection: v.union(v.literal('contacts'), v.literal('organizations')),
    cursor: v.optional(v.union(v.string(), v.null())),
    migrated: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, { collection, cursor, migrated }) => {
    const page = await ctx.db
      .query(TABLE[collection])
      .paginate({ numItems: BATCH, cursor: cursor ?? null })
    const defsByOrg = new Map<
      Id<'organizations'>,
      Map<string, Doc<'crmFieldDefs'>>
    >()
    let count = migrated ?? 0
    for (const record of page.page) {
      if (await migrateRecord(ctx, collection, record, defsByOrg)) count++
    }
    if (page.isDone) {
      if (collection === 'contacts') {
        const orgs = await ctx.db.query('organizations').take(1000)
        for (const org of orgs) await cleanLumaOptions(ctx, org._id)
      }
      console.log(`CRM migration (${collection}) done: ${count} records moved`)
      return null
    }
    await ctx.scheduler.runAfter(0, internal.contacts.migrate.run, {
      collection,
      cursor: page.continueCursor,
      migrated: count,
    })
    return null
  },
})
