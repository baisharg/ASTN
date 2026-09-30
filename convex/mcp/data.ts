import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalMutation, internalQuery } from '../_generated/server'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { requireOrgAdminFor, requireOrgRecord } from '../lib/auth'
import {
  BUILTIN_FIELDS,
  CORE_COLUMNS,
  addMissingOptions,
  ensureBuiltinFieldDefs,
  listFieldDefs,
} from '../contacts/fields'
import type { FieldValue } from '../contacts/fields'
import {
  CORE_COLUMN_DEFS,
  OPS_BY_TYPE,
  filterIsActive,
  matchesAll,
  normalizeText,
} from '../contacts/filters'
import type { FilterColumn, FilterOp, ViewFilter } from '../contacts/filters'
import { findContactByEmail } from '../contacts/people'
import { crmCollectionValidator } from '../contacts/validators'
import type { CrmCollection, CrmFieldType } from '../contacts/validators'
import {
  CONTACT_EDITABLE,
  OPPORTUNITY_EDITABLE,
  ORGANIZATION_EDITABLE,
  SAFE_RECORD_KEY,
  bumpCount,
  liveCount,
} from '../crm'

// Data layer for the MCP endpoint (convex/mcp/server.ts). These are internal
// functions because the caller authenticates outside Convex's `ctx.auth`:
// the HTTP action verifies the Clerk OAuth JWT itself and passes the subject
// down as `userId`. Every handler re-checks org admin membership — Clerk has
// no custom OAuth scopes yet, so this layer IS the authorization boundary.

// Submissions have no UI inline-edit allowlist in convex/crm.ts; expose the
// three typed columns (the flexible `data` bag is set on create only).
const SUBMISSION_EDITABLE = new Set<string>(['participant', 'period', 'source'])

export const collectionValidator = v.union(
  v.literal('contacts'),
  v.literal('organizations'),
  v.literal('opportunities'),
  v.literal('submissions'),
)
type CollectionKey =
  | 'contacts'
  | 'organizations'
  | 'opportunities'
  | 'submissions'

const COLLECTIONS: Record<
  CollectionKey,
  {
    table:
      | 'crmContacts'
      | 'crmOrganizations'
      | 'crmOpportunities'
      | 'crmSubmissions'
    countField: CollectionKey
    editable: Set<string>
    searchIndex: string | null
    searchField: string | null
    nameField: string | null
    nameDefault: string | null
  }
> = {
  contacts: {
    table: 'crmContacts',
    countField: 'contacts',
    editable: CONTACT_EDITABLE,
    searchIndex: 'search_name',
    searchField: 'name',
    nameField: 'name',
    nameDefault: 'No name',
  },
  organizations: {
    table: 'crmOrganizations',
    countField: 'organizations',
    editable: ORGANIZATION_EDITABLE,
    searchIndex: 'search_name',
    searchField: 'name',
    nameField: 'name',
    nameDefault: 'No name',
  },
  opportunities: {
    table: 'crmOpportunities',
    countField: 'opportunities',
    editable: OPPORTUNITY_EDITABLE,
    searchIndex: 'search_title',
    searchField: 'title',
    nameField: 'title',
    nameDefault: 'No title',
  },
  submissions: {
    table: 'crmSubmissions',
    countField: 'submissions',
    editable: SUBMISSION_EDITABLE,
    searchIndex: null,
    searchField: null,
    nameField: null,
    nameDefault: null,
  },
}

const TABLE = {
  contacts: 'crmContacts',
  organizations: 'crmOrganizations',
} as const

type CrmRecordDoc = Doc<'crmContacts'> | Doc<'crmOrganizations'>

export async function resolveOrgForAdmin(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  orgSlug: string,
): Promise<Doc<'organizations'>> {
  const org = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', orgSlug))
    .first()
  if (!org) throw new Error(`Organization '${orgSlug}' not found`)
  await requireOrgAdminFor(ctx, userId, org._id)
  return org
}

// ── Configurable fields (contacts, organizations) ─────────────────────────

type ColumnInfo = {
  key: string
  label: string
  type: CrmFieldType
  core: boolean
  options: Array<string>
  hidden: boolean
  source: 'core' | 'builtin' | 'airtable' | 'admin'
}

/**
 * Core columns plus the org's field definitions. A query can't create the
 * builtin definitions, so builtins an org never materialized are listed
 * with no options (the first write creates them).
 */
async function crmColumns(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
  collection: CrmCollection,
): Promise<Array<ColumnInfo>> {
  const defs = await listFieldDefs(ctx, orgId, collection)
  const have = new Set(defs.map((d) => d.key))
  const fields: Array<ColumnInfo> = [...defs]
    .sort((a, b) => a.order - b.order)
    .map((d) => ({
      key: d.key,
      label: d.label,
      type: d.type,
      core: false,
      options: (d.options ?? []).map((o) => o.value),
      hidden: d.hidden ?? false,
      source: d.source,
    }))
  for (const b of BUILTIN_FIELDS[collection]) {
    if (have.has(b.key)) continue
    fields.push({
      key: b.key,
      label: b.label,
      type: b.type,
      core: false,
      options: [],
      hidden: false,
      source: 'builtin',
    })
  }
  const core: Array<ColumnInfo> = CORE_COLUMN_DEFS[collection].map((c) => ({
    ...c,
    core: true,
    options: [],
    hidden: false,
    source: 'core',
  }))
  return [...core, ...fields]
}

const VALUE_SHAPES: Record<CrmFieldType, string> = {
  text: 'string',
  longText: 'string',
  url: 'string',
  email: 'string',
  phone: 'string',
  singleSelect: 'string (one of the options)',
  multiSelect: 'string[] (each one of the options)',
  checkbox: 'boolean',
  number: 'number',
  date: "'YYYY-MM-DD' string",
}

/** Field discovery for astn_resources on crm_contacts / crm_organizations. */
export const describeFields = internalQuery({
  args: {
    userId: v.string(),
    orgSlug: v.string(),
    collection: crmCollectionValidator,
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    const columns = await crmColumns(ctx, org._id, args.collection)
    return {
      resource: `crm_${args.collection}`,
      org: args.orgSlug,
      coreColumns: columns
        .filter((c) => c.core)
        .map((c) => ({ key: c.key, label: c.label, type: c.type })),
      fields: columns
        .filter((c) => !c.core)
        .map((c) => ({
          key: c.key,
          label: c.label,
          type: c.type,
          ...(c.type === 'singleSelect' || c.type === 'multiSelect'
            ? { options: c.options }
            : {}),
          hidden: c.hidden,
          source: c.source,
        })),
      valueShapes: VALUE_SHAPES,
      filterOps: OPS_BY_TYPE,
      notes:
        'Records store core columns at the top level and every other field in `fields`, keyed by ' +
        'field key. Writes (astn_create/astn_update) take a flat `fields` object of core column ' +
        'and field keys; null clears a field. Values must have the shape above; select values ' +
        'must be existing options unless you pass addOptions: true, which adds the new ones. ' +
        (args.collection === 'contacts'
          ? 'Email is stored lowercased; `otherEmails` is read-only here. lumaApproved, ' +
            'lumaCheckedIn and lumaTags are kept in sync from Luma. '
          : '') +
        'astn_list accepts `filters` [{field, op, value}] with the ops above per type.',
    }
  },
})

/**
 * Contacts and organizations accept core columns plus any configurable field
 * key (builtin or custom). Throws listing the valid keys on unknown ones.
 */
async function checkFieldKeys(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  collection: CrmCollection,
  fields: unknown,
): Promise<{
  f: Record<string, unknown>
  defs: Map<string, Doc<'crmFieldDefs'>>
}> {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new Error('`fields` must be an object of field key → value')
  }
  const f = fields as Record<string, unknown>
  const defs = await ensureBuiltinFieldDefs(ctx, orgId, collection)
  const valid = new Set([
    ...CORE_COLUMNS[collection],
    ...defs.map((d) => d.key),
  ])
  const invalid = Object.keys(f).filter((k) => !valid.has(k))
  if (invalid.length > 0) {
    throw new Error(
      `Unknown field(s) for ${collection}: ${invalid.join(', ')}. ` +
        `Valid fields: ${[...valid].join(', ')}. ` +
        'Call astn_resources with this resource and org for types and options.',
    )
  }
  return { f, defs: new Map(defs.map((d) => [d.key, d])) }
}

/**
 * Strict check of one field value for MCP writes, with messages an agent
 * can act on. Select values outside the options are refused unless
 * `addOptions`, in which case they are returned in `newOptions`.
 */
function strictFieldValue(
  def: Doc<'crmFieldDefs'>,
  raw: unknown,
  addOptions: boolean,
): { value: FieldValue; newOptions: Array<string> } {
  const name = `'${def.key}' (${def.label}, ${def.type})`
  const shapeError = () =>
    new Error(
      `Invalid value for ${name}: expected ${VALUE_SHAPES[def.type]} or null, ` +
        `got ${JSON.stringify(raw)}`,
    )
  if (raw === null || raw === undefined) return { value: null, newOptions: [] }
  switch (def.type) {
    case 'singleSelect':
    case 'multiSelect': {
      let values: Array<string>
      if (def.type === 'singleSelect') {
        if (typeof raw !== 'string') throw shapeError()
        values = raw.trim() ? [raw.trim()] : []
      } else {
        if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string')) {
          throw shapeError()
        }
        values = [
          ...new Set((raw as Array<string>).map((x) => x.trim())),
        ].filter(Boolean)
      }
      const options = (def.options ?? []).map((o) => o.value)
      const known = new Set(options)
      const unknown = values.filter((x) => !known.has(x))
      if (unknown.length > 0 && !addOptions) {
        const hints = unknown
          .map((u) => {
            const near = options.find(
              (o) => normalizeText(o) === normalizeText(u),
            )
            return near ? ` ('${u}' → did you mean '${near}'?)` : ''
          })
          .join('')
        throw new Error(
          `Unknown option(s) for ${name}: ${unknown.map((u) => `'${u}'`).join(', ')}.${hints} ` +
            `Valid options: ${options.length ? options.map((o) => `'${o}'`).join(', ') : '(none yet)'}. ` +
            'Pass addOptions: true to add new options.',
        )
      }
      const value =
        def.type === 'singleSelect'
          ? (values[0] ?? null)
          : values.length
            ? values
            : null
      return { value, newOptions: unknown }
    }
    case 'checkbox':
      if (typeof raw !== 'boolean') throw shapeError()
      return { value: raw, newOptions: [] }
    case 'number':
      if (typeof raw !== 'number' || !Number.isFinite(raw)) throw shapeError()
      return { value: raw, newOptions: [] }
    case 'date': {
      if (typeof raw !== 'string') throw shapeError()
      const s = raw.trim()
      if (!s) return { value: null, newOptions: [] }
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
        Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ||
        new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s
      ) {
        throw shapeError()
      }
      return { value: s, newOptions: [] }
    }
    default:
      if (typeof raw !== 'string') throw shapeError()
      return { value: raw.trim() || null, newOptions: [] }
  }
}

/**
 * Validate a flat MCP `fields` object for a contact or organization and
 * split it into core column values and field values (null = clear). Adds
 * select options only after every value has passed.
 */
async function checkWrite(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  collection: CrmCollection,
  fields: unknown,
  addOptions: boolean,
): Promise<{
  core: Record<string, string | undefined>
  values: Record<string, FieldValue>
}> {
  const { f, defs } = await checkFieldKeys(ctx, orgId, collection, fields)
  const core: Record<string, string | undefined> = {}
  const values: Record<string, FieldValue> = {}
  const toAdd: Array<{ def: Doc<'crmFieldDefs'>; value: FieldValue }> = []
  for (const [key, raw] of Object.entries(f)) {
    if (CORE_COLUMNS[collection].includes(key)) {
      if (raw === null || raw === undefined) {
        if (key === 'name') throw new Error("'name' can't be cleared")
        core[key] = undefined
        continue
      }
      if (typeof raw !== 'string') {
        throw new Error(
          `Invalid value for core column '${key}': expected a string or null, got ${JSON.stringify(raw)}`,
        )
      }
      const text = raw.trim()
      core[key] = !text
        ? undefined
        : key === 'email'
          ? text.toLowerCase()
          : text
      if (key === 'name' && !text) throw new Error("'name' can't be empty")
      continue
    }
    const def = defs.get(key)!
    const { value, newOptions } = strictFieldValue(def, raw, addOptions)
    values[key] = value
    if (newOptions.length > 0) toAdd.push({ def, value })
  }
  for (const { def, value } of toAdd) {
    // Re-read so two values for the same def don't overwrite each other.
    const fresh = (await ctx.db.get('crmFieldDefs', def._id)) ?? def
    await addMissingOptions(ctx, fresh, value)
  }
  return { core, values }
}

function buildPatch(
  collection: CollectionKey,
  fields: unknown,
  { skipKeys = [] as Array<string> } = {},
): Record<string, unknown> {
  const meta = COLLECTIONS[collection]
  const f = (fields && typeof fields === 'object' ? fields : {}) as Record<
    string,
    unknown
  >
  const patch: Record<string, unknown> = {}
  const invalid: Array<string> = []
  for (const [key, value] of Object.entries(f)) {
    if (skipKeys.includes(key)) continue
    if (!meta.editable.has(key)) {
      invalid.push(key)
      continue
    }
    patch[key] = value
  }
  if (invalid.length > 0) {
    throw new Error(
      `Unknown field(s) for ${collection}: ${invalid.join(', ')}. ` +
        `Valid fields: ${[...meta.editable].join(', ')}`,
    )
  }
  return patch
}

export const myAdminOrgs = internalQuery({
  args: { userId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .collect()
    const orgs = await Promise.all(
      memberships
        .filter((m) => m.role === 'admin')
        .map((m) => ctx.db.get(m.orgId)),
    )
    return orgs
      .filter((o): o is Doc<'organizations'> => o !== null)
      .map((o) => ({ id: o._id, name: o.name, slug: o.slug ?? null }))
  },
})

export const stats = internalQuery({
  args: { userId: v.string(), orgSlug: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    // Mirrors crm.getStats: sum the crmCounts aggregate (tolerating dup rows
    // from OCC races), fall back to a capped live count pre-backfill.
    const rows = await ctx.db
      .query('crmCounts')
      .withIndex('by_orgId', (q) => q.eq('orgId', org._id))
      .collect()
    if (rows.length === 0) return liveCount(ctx, org._id)
    const totals = {
      contacts: 0,
      organizations: 0,
      opportunities: 0,
      submissions: 0,
    }
    for (const row of rows) {
      totals.contacts += row.contacts
      totals.organizations += row.organizations
      totals.opportunities += row.opportunities
      totals.submissions += row.submissions
    }
    return totals
  },
})

// Most bytes one listing page reads; the rows cap is the page size.
const PAGE_BYTES = 4 * 1024 * 1024

type Compiled = { filter: ViewFilter; column: FilterColumn }

/** Check filters against the org's columns; throw with the valid choices. */
function compileFilters(
  raw: Array<{ field: string; op: string; value?: unknown }>,
  columns: Array<ColumnInfo>,
): Array<Compiled> {
  const byKey = new Map(columns.map((c) => [c.key, c]))
  const byLabel = new Map(columns.map((c) => [normalizeText(c.label), c]))
  return raw.map((f) => {
    const column =
      byKey.get(f.field) ?? byLabel.get(normalizeText(String(f.field)))
    if (!column) {
      throw new Error(
        `Unknown filter field '${f.field}'. Use a core column or field key: ` +
          `${columns.map((c) => c.key).join(', ')}`,
      )
    }
    const ops = OPS_BY_TYPE[column.type]
    if (!ops.includes(f.op as FilterOp)) {
      throw new Error(
        `Op '${f.op}' doesn't apply to '${column.key}' (${column.type}). ` +
          `Valid ops: ${ops.join(', ')}`,
      )
    }
    const filter: ViewFilter = {
      field: column.key,
      op: f.op as FilterOp,
      value: f.value,
    }
    if (!filterIsActive(filter)) {
      throw new Error(
        `Filter on '${column.key}' with op '${f.op}' needs a value`,
      )
    }
    if (column.type === 'checkbox' && typeof f.value !== 'boolean') {
      throw new Error(
        `Filter on checkbox '${column.key}' needs value true or false`,
      )
    }
    return { filter, column }
  })
}

/**
 * Field key → label, for `labels: true`. The relabeling itself happens in
 * the action (tools.ts): Convex values can't have non-ASCII keys, and
 * labels like "Participó en" have them. Clashing labels get "(key)".
 */
function fieldLabels(columns: Array<ColumnInfo>): Record<string, string> {
  const count = new Map<string, number>()
  for (const c of columns) count.set(c.label, (count.get(c.label) ?? 0) + 1)
  const out: Record<string, string> = {}
  for (const c of columns) {
    if (c.core) continue
    out[c.key] =
      (count.get(c.label) ?? 0) > 1 ? `${c.label} (${c.key})` : c.label
  }
  return out
}

const filterArg = v.object({
  field: v.string(),
  op: v.string(),
  value: v.optional(v.any()),
})

/** astn_list for crm_opportunities and crm_submissions (fixed columns). */
export const listRecords = internalQuery({
  args: {
    userId: v.string(),
    orgSlug: v.string(),
    collection: v.union(v.literal('opportunities'), v.literal('submissions')),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    const meta = COLLECTIONS[args.collection]
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 100), 1), 500)
    const search = args.search?.trim()
    if (search && meta.searchIndex) {
      // Cast: `meta.table` is a union over tables, so the inferred
      // search-index name collapses to `never`. The per-collection metadata
      // pins index/field pairs that exist in schema.ts.
      return await (ctx.db.query(meta.table) as any)
        .withSearchIndex(meta.searchIndex, (q: any) =>
          q.search(meta.searchField!, search).eq('orgId', org._id),
        )
        .take(limit)
    }
    return await ctx.db
      .query(meta.table)
      .withIndex('by_orgId', (q: any) => q.eq('orgId', org._id))
      .take(limit)
  },
})

/**
 * One page of crm_contacts / crm_organizations for astn_list: a single
 * native `.paginate()` (Convex allows one per query) over the org index, or
 * over the name search index with `search`, with the filters applied to the
 * page. The action (tools.ts listCrm) chains pages up to the caller's limit
 * and scan budget. `positions` are the matches' indexes within the page, so
 * the action can re-read a shorter page ending exactly at a match.
 */
export const listCrmPage = internalQuery({
  args: {
    userId: v.string(),
    orgSlug: v.string(),
    collection: crmCollectionValidator,
    filters: v.optional(v.array(filterArg)),
    email: v.optional(v.string()),
    search: v.optional(v.string()),
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
    labels: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    const collection = args.collection
    const table = TABLE[collection]
    const columns = await crmColumns(ctx, org._id, collection)
    const filters = compileFilters(args.filters ?? [], columns)
    const labels = args.labels ? { fieldLabels: fieldLabels(columns) } : {}
    const pass = (r: CrmRecordDoc) => matchesAll(r, filters)

    if (args.email) {
      if (collection !== 'contacts') {
        throw new Error('email applies to crm_contacts only')
      }
      if (args.cursor) throw new Error("email lookups aren't paginated")
      const contact = await findContactByEmail(ctx, org._id, args.email)
      const matches = contact && pass(contact) ? [contact] : []
      return {
        matches,
        positions: matches.map(() => 0),
        scanned: contact ? 1 : 0,
        continueCursor: null,
        isDone: true,
        ...labels,
      }
    }

    const numItems = Math.min(Math.max(Math.floor(args.numItems), 1), 500)
    const opts = {
      numItems,
      cursor: args.cursor,
      maximumRowsRead: numItems,
      maximumBytesRead: PAGE_BYTES,
    }
    const search = args.search?.trim()
    let result
    try {
      result = search
        ? await ctx.db
            .query(table)
            .withSearchIndex('search_name', (q) =>
              q.search('name', search).eq('orgId', org._id),
            )
            .paginate(opts)
        : await ctx.db
            .query(table)
            .withIndex('by_orgId', (q) => q.eq('orgId', org._id))
            .paginate(opts)
    } catch (err) {
      if (args.cursor && /cursor/i.test(String(err))) {
        throw new Error(
          'Invalid cursor: pass the nextCursor of a previous call with the same resource and search',
        )
      }
      throw err
    }
    const page = result.page as Array<CrmRecordDoc>
    const matches: Array<CrmRecordDoc> = []
    const positions: Array<number> = []
    page.forEach((row, i) => {
      if (pass(row)) {
        matches.push(row)
        positions.push(i)
      }
    })
    return {
      matches,
      positions,
      scanned: page.length,
      continueCursor: result.continueCursor,
      isDone: result.isDone,
      ...labels,
    }
  },
})

export const getRecord = internalQuery({
  args: {
    userId: v.string(),
    orgSlug: v.string(),
    collection: collectionValidator,
    id: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    const meta = COLLECTIONS[args.collection]
    const id = ctx.db.normalizeId(meta.table, args.id)
    if (!id) return null
    const doc = await ctx.db.get(id)
    if (!doc || doc.orgId !== org._id) return null
    return doc
  },
})

export const createRecord = internalMutation({
  args: {
    userId: v.string(),
    orgSlug: v.string(),
    collection: collectionValidator,
    fields: v.any(),
    addOptions: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    const meta = COLLECTIONS[args.collection]
    if (args.collection === 'contacts' || args.collection === 'organizations') {
      const { core, values } = await checkWrite(
        ctx,
        org._id,
        args.collection,
        args.fields,
        args.addOptions ?? false,
      )
      const fields: Record<string, FieldValue> = {}
      for (const [key, value] of Object.entries(values)) {
        if (value !== null) fields[key] = value
      }
      const now = Date.now()
      const id = await ctx.db.insert(meta.table, {
        orgId: org._id,
        ...core,
        name: core.name ?? 'No name',
        fields,
        createdAt: now,
        updatedAt: now,
      } as any)
      await bumpCount(ctx, org._id, meta.countField, 1)
      return { id, collection: args.collection, created: true }
    }
    const doc = buildPatch(args.collection, args.fields, {
      skipKeys: ['data'],
    })

    if (args.collection === 'submissions') {
      // Same defensive key filter as crm.insertSubmissions — Convex rejects
      // field names that don't start with a letter.
      const f = (args.fields ?? {}) as Record<string, unknown>
      const rawData =
        f.data && typeof f.data === 'object'
          ? (f.data as Record<string, unknown>)
          : {}
      const data: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(rawData)) {
        if (SAFE_RECORD_KEY.test(k)) data[k] = val
      }
      doc.data = data
    } else if (meta.nameField && doc[meta.nameField] == null) {
      doc[meta.nameField] = meta.nameDefault
    }

    const now = Date.now()
    const id = await ctx.db.insert(meta.table, {
      orgId: org._id,
      ...doc,
      createdAt: now,
      updatedAt: now,
    } as any)
    await bumpCount(ctx, org._id, meta.countField, 1)
    return { id, collection: args.collection, created: true }
  },
})

export const updateRecord = internalMutation({
  args: {
    userId: v.string(),
    orgSlug: v.string(),
    collection: collectionValidator,
    id: v.string(),
    fields: v.any(),
    addOptions: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    const meta = COLLECTIONS[args.collection]
    const id = ctx.db.normalizeId(meta.table, args.id)
    if (!id) throw new Error('Record not found')
    const record = await requireOrgRecord(
      ctx,
      id as Id<any>,
      org._id,
      'Record not found',
    )

    if (args.collection === 'contacts' || args.collection === 'organizations') {
      const { core, values } = await checkWrite(
        ctx,
        org._id,
        args.collection,
        args.fields,
        args.addOptions ?? false,
      )
      const keys = [...Object.keys(core), ...Object.keys(values)]
      if (keys.length === 0) throw new Error('No fields to update')
      const fields = { ...(record as CrmRecordDoc).fields }
      for (const [key, value] of Object.entries(values)) {
        if (value === null) delete fields[key]
        else fields[key] = value
      }
      await ctx.db.patch(id, {
        ...core,
        fields,
        updatedAt: Date.now(),
      } as any)
      return { id, collection: args.collection, updated: keys }
    }

    const patch = buildPatch(args.collection, args.fields)
    if (Object.keys(patch).length === 0) {
      throw new Error('No fields to update')
    }
    await ctx.db.patch(id, { ...patch, updatedAt: Date.now() } as any)
    return { id, collection: args.collection, updated: Object.keys(patch) }
  },
})

export const deleteRecord = internalMutation({
  args: {
    userId: v.string(),
    orgSlug: v.string(),
    collection: collectionValidator,
    id: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    const meta = COLLECTIONS[args.collection]
    const id = ctx.db.normalizeId(meta.table, args.id)
    if (!id) throw new Error('Record not found')
    const record = await requireOrgRecord(
      ctx,
      id as Id<any>,
      org._id,
      'Record not found',
    )
    await ctx.db.delete(id)
    await bumpCount(ctx, org._id, meta.countField, -1)
    // A contact's history goes with it, in scheduled batches (as bulk delete).
    const contactId =
      args.collection === 'contacts'
        ? ctx.db.normalizeId('crmContacts', args.id)
        : null
    if (contactId) {
      await ctx.scheduler.runAfter(
        0,
        internal.contacts.bulk.deleteContactActivities,
        { contactId },
      )
    }
    return {
      id,
      collection: args.collection,
      deleted: true,
      name: meta.nameField ? ((record as any)[meta.nameField] ?? null) : null,
    }
  },
})
