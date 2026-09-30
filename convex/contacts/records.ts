import { ConvexError, v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalMutation, mutation, query } from '../_generated/server'
import { requireOrgAdmin } from '../lib/auth'
import {
  FIELD_KEY,
  addMissingOptions,
  ensureBuiltinFieldDefs,
  isSelect,
  keyFromLabel,
  listFieldDefs,
  normalizeValue,
  validateValue,
} from './fields'
import {
  crmCollectionValidator,
  crmFieldOptionValidator,
  crmFieldTypeValidator,
  crmFieldValueValidator,
} from './validators'
import type { FieldValue } from './fields'
import type { CrmCollection } from './validators'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

const TABLE = {
  contacts: 'crmContacts',
  organizations: 'crmOrganizations',
} as const

// Records rewritten per scheduled batch when renaming options or deleting a
// field, and the most records the synchronous in-use check will scan.
const BATCH_SIZE = 200
const IN_USE_SCAN_LIMIT = 5000

type CrmRecord = Doc<'crmContacts'> | Doc<'crmOrganizations'>

async function getFieldDef(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  collection: CrmCollection,
  key: string,
): Promise<Doc<'crmFieldDefs'>> {
  let def = await ctx.db
    .query('crmFieldDefs')
    .withIndex('by_orgId_and_collection_and_key', (q) =>
      q.eq('orgId', orgId).eq('collection', collection).eq('key', key),
    )
    .first()
  if (!def) {
    // Builtin keys may not have definitions yet on an org that never
    // opened the new CRM.
    await ensureBuiltinFieldDefs(ctx, orgId, collection)
    def = await ctx.db
      .query('crmFieldDefs')
      .withIndex('by_orgId_and_collection_and_key', (q) =>
        q.eq('orgId', orgId).eq('collection', collection).eq('key', key),
      )
      .first()
  }
  if (!def) throw new ConvexError(`Unknown field '${key}'`)
  return def
}

/**
 * Set one field on a contact or organization. `lenient` accepts loosely
 * shaped input (comma-separated lists, "sí"/"no", unseen select options,
 * which get added) for older callers like the MCP and the admin agent; the
 * CRM screens use strict validation.
 */
export async function setFieldOnRecord(
  ctx: MutationCtx,
  args: {
    orgId: Id<'organizations'>
    collection: CrmCollection
    record: CrmRecord
    key: string
    value: unknown
    lenient?: boolean
  },
): Promise<void> {
  const def = await getFieldDef(ctx, args.orgId, args.collection, args.key)
  let value: FieldValue
  if (args.lenient) {
    value = normalizeValue(def.type, args.value) ?? null
    await addMissingOptions(ctx, def, value)
  } else {
    value = validateValue(def, args.value)
  }
  const fields = { ...args.record.fields }
  if (value === null) delete fields[args.key]
  else fields[args.key] = value
  await ctx.db.patch(TABLE[args.collection], args.record._id, {
    fields,
    updatedAt: Date.now(),
  } as never)
}

async function requireRecord(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  collection: CrmCollection,
  id: string,
): Promise<CrmRecord> {
  const normalized = ctx.db.normalizeId(TABLE[collection], id)
  const record = normalized ? await ctx.db.get(normalized) : null
  if (!record || record.orgId !== orgId) {
    throw new ConvexError('Record not found')
  }
  return record as CrmRecord
}

// ── Field definitions ────────────────────────────────────────────────────

export const listFields = query({
  args: { orgId: v.id('organizations'), collection: crmCollectionValidator },
  returns: v.array(
    v.object({
      _id: v.id('crmFieldDefs'),
      key: v.string(),
      label: v.string(),
      type: crmFieldTypeValidator,
      options: v.array(crmFieldOptionValidator),
      order: v.number(),
      hidden: v.boolean(),
      source: v.union(
        v.literal('builtin'),
        v.literal('airtable'),
        v.literal('admin'),
      ),
    }),
  ),
  handler: async (ctx, { orgId, collection }) => {
    await requireOrgAdmin(ctx, orgId)
    const defs = await listFieldDefs(ctx, orgId, collection)
    return defs.map((d) => ({
      _id: d._id,
      key: d.key,
      label: d.label,
      type: d.type,
      options: d.options ?? [],
      order: d.order,
      hidden: d.hidden ?? false,
      source: d.source,
    }))
  },
})

/** Create the builtin definitions for an org (the CRM screen calls this). */
export const setupFields = mutation({
  args: { orgId: v.id('organizations') },
  returns: v.null(),
  handler: async (ctx, { orgId }) => {
    await requireOrgAdmin(ctx, orgId)
    await ensureBuiltinFieldDefs(ctx, orgId, 'contacts')
    await ensureBuiltinFieldDefs(ctx, orgId, 'organizations')
    return null
  },
})

export const createField = mutation({
  args: {
    orgId: v.id('organizations'),
    collection: crmCollectionValidator,
    label: v.string(),
    type: crmFieldTypeValidator,
    options: v.optional(v.array(crmFieldOptionValidator)),
  },
  returns: v.string(),
  handler: async (ctx, { orgId, collection, label, type, options }) => {
    await requireOrgAdmin(ctx, orgId)
    const clean = label.trim()
    if (!clean) throw new ConvexError('The field needs a name')
    const defs = await ensureBuiltinFieldDefs(ctx, orgId, collection)
    const taken = new Set([
      ...defs.map((d) => d.key),
      'name',
      'email',
      'phone',
      'linkedin',
      'website',
      'location',
      'notes',
      'description',
    ])
    const base = keyFromLabel(clean)
    let key = base
    for (let n = 2; taken.has(key); n++) key = `${base}${n}`
    if (!FIELD_KEY.test(key)) throw new ConvexError('Invalid field name')
    const now = Date.now()
    await ctx.db.insert('crmFieldDefs', {
      orgId,
      collection,
      key,
      label: clean,
      type,
      options: isSelect(type) ? dedupeOptions(options ?? []) : undefined,
      order: defs.reduce((max, d) => Math.max(max, d.order), -1) + 1,
      source: 'admin',
      createdAt: now,
      updatedAt: now,
    })
    return key
  },
})

function dedupeOptions(
  options: Array<{ value: string; color?: string }>,
): Array<{ value: string; color?: string }> {
  const seen = new Set<string>()
  const out = []
  for (const o of options) {
    const value = o.value.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push({ value, color: o.color })
  }
  return out
}

/**
 * Rename a field, change its options, or hide it. Removing an option that is
 * in use is refused so values never point at nothing; rename it instead.
 */
export const updateField = mutation({
  args: {
    orgId: v.id('organizations'),
    fieldId: v.id('crmFieldDefs'),
    label: v.optional(v.string()),
    options: v.optional(v.array(crmFieldOptionValidator)),
    // Renames of existing options, applied to every record: old → new.
    renameOptions: v.optional(
      v.array(v.object({ from: v.string(), to: v.string() })),
    ),
    hidden: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.orgId)
    const def = await ctx.db.get('crmFieldDefs', args.fieldId)
    if (!def || def.orgId !== args.orgId) {
      throw new ConvexError('Field not found')
    }
    const patch: Partial<Doc<'crmFieldDefs'>> = { updatedAt: Date.now() }
    if (args.label !== undefined) {
      if (!args.label.trim()) throw new ConvexError('The field needs a name')
      patch.label = args.label.trim()
    }
    if (args.hidden !== undefined) patch.hidden = args.hidden

    const renames = (args.renameOptions ?? []).filter((r) => r.from !== r.to)
    if (renames.length > 0) {
      if (!isSelect(def.type)) {
        throw new ConvexError('Only select fields have options to rename')
      }
      // Every rename must start from a current option and land on one of the
      // options the field will have after this update.
      const current = new Set((def.options ?? []).map((o) => o.value))
      const final = new Set(
        (args.options !== undefined
          ? dedupeOptions(args.options)
          : (def.options ?? [])
        ).map((o) => o.value),
      )
      for (const { from, to } of renames) {
        if (!current.has(from)) {
          throw new ConvexError(`'${from}' is not an option of this field`)
        }
        if (!final.has(to)) {
          throw new ConvexError(
            `'${to}' must be one of the field's options to rename '${from}' to it`,
          )
        }
      }
      // Records are rewritten in scheduled batches (renameOptionValues).
      await ctx.scheduler.runAfter(
        0,
        internal.contacts.records.renameOptionValues,
        {
          orgId: args.orgId,
          collection: def.collection,
          key: def.key,
          renames,
          cursor: null,
        },
      )
    }

    if (args.options !== undefined && isSelect(def.type)) {
      const options = dedupeOptions(args.options)
      const keep = new Set(options.map((o) => o.value))
      const removed = (def.options ?? [])
        .map((o) => o.value)
        .filter((value) => !keep.has(value))
        .filter((value) => !renames.some((r) => r.from === value))
      if (removed.length > 0) {
        const records = await ctx.db
          .query(TABLE[def.collection])
          .withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
          .take(IN_USE_SCAN_LIMIT + 1)
        if (records.length > IN_USE_SCAN_LIMIT) {
          throw new ConvexError(
            'Too many records to check whether these options are in use',
          )
        }
        const inUse = removed.filter((value) =>
          records.some((r) => {
            const current = r.fields?.[def.key]
            return Array.isArray(current)
              ? current.includes(value)
              : current === value
          }),
        )
        if (inUse.length > 0) {
          throw new ConvexError(
            `These options are still in use: ${inUse.join(', ')}. Rename or clear them first.`,
          )
        }
      }
      patch.options = options
    }
    await ctx.db.patch('crmFieldDefs', def._id, patch)
    return null
  },
})

/** Reorder fields: `fieldIds` in the new order. */
export const reorderFields = mutation({
  args: {
    orgId: v.id('organizations'),
    fieldIds: v.array(v.id('crmFieldDefs')),
  },
  returns: v.null(),
  handler: async (ctx, { orgId, fieldIds }) => {
    await requireOrgAdmin(ctx, orgId)
    for (const [order, id] of fieldIds.entries()) {
      const def = await ctx.db.get('crmFieldDefs', id)
      if (!def || def.orgId !== orgId) continue
      if (def.order !== order) {
        await ctx.db.patch('crmFieldDefs', id, { order, updatedAt: Date.now() })
      }
    }
    return null
  },
})

/**
 * Delete a custom field and clear its values. Builtin fields can be hidden.
 * The field is hidden at once; its values are cleared in scheduled batches
 * (deleteFieldValues), and the definition goes after the last one.
 */
export const deleteField = mutation({
  args: { orgId: v.id('organizations'), fieldId: v.id('crmFieldDefs') },
  returns: v.null(),
  handler: async (ctx, { orgId, fieldId }) => {
    await requireOrgAdmin(ctx, orgId)
    const def = await ctx.db.get('crmFieldDefs', fieldId)
    if (!def || def.orgId !== orgId) throw new ConvexError('Field not found')
    if (def.source === 'builtin') {
      throw new ConvexError('Builtin fields can be hidden, not deleted')
    }
    await ctx.db.patch('crmFieldDefs', fieldId, {
      hidden: true,
      updatedAt: Date.now(),
    })
    await ctx.scheduler.runAfter(
      0,
      internal.contacts.records.deleteFieldValues,
      { fieldId, cursor: null },
    )
    return null
  },
})

/** One page of an org's contacts or organizations, by creation order. */
async function recordPage(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  collection: CrmCollection,
  cursor: string | null,
) {
  const page = { numItems: BATCH_SIZE, cursor }
  return collection === 'contacts'
    ? await ctx.db
        .query('crmContacts')
        .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
        .paginate(page)
    : await ctx.db
        .query('crmOrganizations')
        .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
        .paginate(page)
}

/** Apply option renames to one batch of records, then schedule the next. */
export const renameOptionValues = internalMutation({
  args: {
    orgId: v.id('organizations'),
    collection: crmCollectionValidator,
    key: v.string(),
    renames: v.array(v.object({ from: v.string(), to: v.string() })),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const renames = new Map(args.renames.map((r) => [r.from, r.to]))
    const { page, isDone, continueCursor } = await recordPage(
      ctx,
      args.orgId,
      args.collection,
      args.cursor,
    )
    for (const record of page) {
      const current = record.fields?.[args.key]
      if (current === undefined || current === null) continue
      const next = Array.isArray(current)
        ? [...new Set(current.map((x) => renames.get(x) ?? x))]
        : typeof current === 'string'
          ? (renames.get(current) ?? current)
          : current
      if (JSON.stringify(next) !== JSON.stringify(current)) {
        await ctx.db.patch(TABLE[args.collection], record._id, {
          fields: { ...record.fields, [args.key]: next },
        } as never)
      }
    }
    if (!isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.contacts.records.renameOptionValues,
        { ...args, cursor: continueCursor },
      )
    }
    return null
  },
})

/**
 * Clear a field's values from one batch of records; after the last batch,
 * delete the definition.
 */
export const deleteFieldValues = internalMutation({
  args: {
    fieldId: v.id('crmFieldDefs'),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, { fieldId, cursor }) => {
    const def = await ctx.db.get('crmFieldDefs', fieldId)
    if (!def) return null
    const { page, isDone, continueCursor } = await recordPage(
      ctx,
      def.orgId,
      def.collection,
      cursor,
    )
    for (const record of page) {
      if (record.fields && def.key in record.fields) {
        const { [def.key]: _removed, ...rest } = record.fields
        await ctx.db.patch(TABLE[def.collection], record._id, {
          fields: rest,
        } as never)
      }
    }
    if (isDone) {
      await ctx.db.delete('crmFieldDefs', fieldId)
    } else {
      await ctx.scheduler.runAfter(
        0,
        internal.contacts.records.deleteFieldValues,
        { fieldId, cursor: continueCursor },
      )
    }
    return null
  },
})

// ── Values ───────────────────────────────────────────────────────────────

export const setField = mutation({
  args: {
    orgId: v.id('organizations'),
    collection: crmCollectionValidator,
    id: v.string(),
    key: v.string(),
    value: crmFieldValueValidator,
  },
  returns: v.null(),
  handler: async (ctx, { orgId, collection, id, key, value }) => {
    await requireOrgAdmin(ctx, orgId)
    const record = await requireRecord(ctx, orgId, collection, id)
    await setFieldOnRecord(ctx, { orgId, collection, record, key, value })
    return null
  },
})

/**
 * Edit one field on many records at once. For multi-selects, `add` and
 * `remove` change individual tags and keep the rest.
 */
export const bulkSetField = mutation({
  args: {
    orgId: v.id('organizations'),
    collection: crmCollectionValidator,
    ids: v.array(v.string()),
    key: v.string(),
    mode: v.union(v.literal('set'), v.literal('add'), v.literal('remove')),
    value: crmFieldValueValidator,
  },
  returns: v.number(),
  handler: async (ctx, { orgId, collection, ids, key, mode, value }) => {
    await requireOrgAdmin(ctx, orgId)
    if (ids.length > 1000) throw new ConvexError('Edit at most 1000 at once')
    const def = await getFieldDef(ctx, orgId, collection, key)
    const checked = validateValue(def, value)
    let changed = 0
    for (const id of ids) {
      const record = await requireRecord(ctx, orgId, collection, id)
      const current = record.fields?.[key]
      let next: FieldValue = checked
      if (def.type === 'multiSelect' && mode !== 'set') {
        const have = Array.isArray(current) ? current : []
        const delta = Array.isArray(checked) ? checked : []
        next =
          mode === 'add'
            ? [...new Set([...have, ...delta])]
            : have.filter((x) => !delta.includes(x))
        if (next.length === 0) next = null
      }
      if (JSON.stringify(next ?? null) === JSON.stringify(current ?? null)) {
        continue
      }
      const fields = { ...record.fields }
      if (next === null) delete fields[key]
      else fields[key] = next
      await ctx.db.patch(TABLE[collection], record._id, {
        fields,
        updatedAt: Date.now(),
      } as never)
      changed++
    }
    return changed
  },
})
