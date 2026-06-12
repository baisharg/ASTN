import { v } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { requireOrgAdminFor, requireOrgRecord } from '../lib/auth'
import {
  CONTACT_EDITABLE,
  OPPORTUNITY_EDITABLE,
  ORGANIZATION_EDITABLE,
  SAFE_RECORD_KEY,
  bumpCount,
  liveCount,
  parseBoolish,
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

async function resolveOrgForAdmin(
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

// Split `fields` into a patch of allowlisted keys; throw on unknown keys so
// the calling agent gets a corrective error instead of silent data loss.
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
    patch[key] = key === 'inBuenosAires' ? parseBoolish(value) : value
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

export const listRecords = internalQuery({
  args: {
    userId: v.string(),
    orgSlug: v.string(),
    collection: collectionValidator,
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
      // Cast: `meta.table` is a union over four tables, so the inferred
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
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    const meta = COLLECTIONS[args.collection]
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
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    const meta = COLLECTIONS[args.collection]
    const id = ctx.db.normalizeId(meta.table, args.id)
    if (!id) throw new Error('Record not found')
    await requireOrgRecord(ctx, id as Id<any>, org._id, 'Record not found')

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
    return {
      id,
      collection: args.collection,
      deleted: true,
      name: meta.nameField ? ((record as any)[meta.nameField] ?? null) : null,
    }
  },
})
