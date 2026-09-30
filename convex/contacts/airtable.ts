import { ConvexError, v } from 'convex/values'
import { internal } from '../_generated/api'
import { action, internalMutation, internalQuery } from '../_generated/server'
import { bumpCount } from '../crm'
import { requireOrgAdmin } from '../lib/auth'
import {
  SOURCES,
  addEmails,
  fetchAirtable,
  indexByEmail,
  indexByMergedAirtableId,
  mergeRecord,
  nameMatchable,
  orgNameKey,
  planImport,
  sameActivity,
} from './airtableMap'
import {
  BUILTIN_FIELDS,
  ensureBuiltinFieldDefs,
  isSelect,
  listFieldDefs,
} from './fields'
import {
  crmCollectionValidator,
  crmFieldOptionValidator,
  crmFieldTypeValidator,
  crmFieldValueValidator,
} from './validators'
import type {
  AirtableData,
  Conflict,
  ContactIn,
  Plan,
  State,
} from './airtableMap'
import type { Doc, Id } from '../_generated/dataModel'
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server'
import type { CrmCollection } from './validators'

/**
 * One-time, re-runnable import of BAISH's Airtable ("BAISH CRM" and the TAIS
 * applications base) into the CRM. See docs/crm-consolidation.md, phase 3.
 *
 *   previewAirtableImport: fetch everything and report what would change.
 *   runAirtableImport:     write it (field defs → contacts → organizations →
 *                          activities), in batches, idempotently.
 *
 * Mapping and merge rules live in ./airtableMap.ts.
 */

const BATCH = 50
const MAX_CONFLICTS = 500
// The import reads whole tables for one org in a single transaction. BAISH
// has ~630 contacts; past this, fail loudly instead of matching against a
// truncated list.
const MAX_ROWS = 5000

async function takeAll<T>(
  query: { take: (n: number) => Promise<Array<T>> },
  table: string,
): Promise<Array<T>> {
  const rows = await query.take(MAX_ROWS + 1)
  if (rows.length > MAX_ROWS) {
    throw new ConvexError(
      `The Airtable import reads at most ${MAX_ROWS} ${table} per org; this org has more.`,
    )
  }
  return rows
}

async function orgContacts(ctx: QueryCtx, orgId: Id<'organizations'>) {
  return await takeAll(
    ctx.db
      .query('crmContacts')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId)),
    'contacts',
  )
}

async function orgOrganizations(ctx: QueryCtx, orgId: Id<'organizations'>) {
  return await takeAll(
    ctx.db
      .query('crmOrganizations')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId)),
    'organizations',
  )
}

const CORE_LABELS: Record<string, string> = {
  name: 'Nombre',
  phone: 'Teléfono',
  linkedin: 'LinkedIn',
  website: 'Página web',
  location: 'Ubicación',
  notes: 'Notas',
  description: 'Descripción',
}

// ── Validators ──────────────────────────────────────────────────────────

const optionalString = v.optional(v.string())
const fieldsValidator = v.record(v.string(), crmFieldValueValidator)

const contactInValidator = v.object({
  ref: v.string(),
  source: v.string(),
  targetId: v.optional(v.id('crmContacts')),
  airtableId: optionalString,
  name: optionalString,
  emails: v.array(v.string()),
  core: v.object({
    phone: optionalString,
    linkedin: optionalString,
    website: optionalString,
    location: optionalString,
    notes: optionalString,
  }),
  fields: fieldsValidator,
})

const orgInValidator = v.object({
  ref: v.string(),
  targetId: v.optional(v.id('crmOrganizations')),
  airtableId: v.string(),
  name: v.string(),
  core: v.object({ description: optionalString, notes: optionalString }),
  fields: fieldsValidator,
})

const specValidator = v.object({
  collection: crmCollectionValidator,
  key: v.string(),
  label: v.string(),
  type: crmFieldTypeValidator,
  source: v.union(v.literal('builtin'), v.literal('airtable')),
  options: v.array(crmFieldOptionValidator),
})

const activityInValidator = v.object({
  externalId: v.string(),
  contactId: v.id('crmContacts'),
  // How to find the contact again if it was merged into another one
  // between the contacts step and this one.
  locator: v.object({
    airtableId: optionalString,
    emails: v.array(v.string()),
  }),
  kind: v.union(
    v.literal('program'),
    v.literal('session'),
    v.literal('form'),
    v.literal('application'),
  ),
  title: v.string(),
  occurredAt: v.optional(v.number()),
  status: optionalString,
  data: v.record(v.string(), v.any()),
})

const statusValidator = v.union(
  v.literal('created'),
  v.literal('updated'),
  v.literal('unchanged'),
)
type Status = 'created' | 'updated' | 'unchanged'
const activityStatusValidator = v.union(statusValidator, v.literal('skipped'))

const conflictValidator = v.object({
  collection: crmCollectionValidator,
  record: v.string(),
  key: v.string(),
  label: v.string(),
  current: v.string(),
  incoming: v.string(),
  duplicate: v.optional(v.boolean()),
})

const reportValidator = v.object({
  rows: v.array(
    v.object({
      source: v.string(), // Airtable table
      target: v.union(
        v.literal('contacts'),
        v.literal('organizations'),
        v.literal('activities'),
      ),
      created: v.number(),
      updated: v.number(),
      unchanged: v.number(),
      skipped: v.number(),
    }),
  ),
  fields: v.object({ created: v.number(), updated: v.number() }),
  conflicts: v.array(conflictValidator), // first MAX_CONFLICTS
  conflictCount: v.number(),
  duplicatePersonas: v.number(),
})

type Report = {
  rows: Array<{
    source: string
    target: 'contacts' | 'organizations' | 'activities'
    created: number
    updated: number
    unchanged: number
    skipped: number
  }>
  fields: { created: number; updated: number }
  conflicts: Array<Conflict>
  conflictCount: number
  duplicatePersonas: number
}

// ── Reads ───────────────────────────────────────────────────────────────

export const assertOrgAdmin = internalQuery({
  args: { orgId: v.id('organizations') },
  returns: v.null(),
  handler: async (ctx, { orgId }) => {
    await requireOrgAdmin(ctx, orgId)
    return null
  },
})

/** Everything the planner compares against, trimmed to what it needs. */
export const loadState = internalQuery({
  args: { orgId: v.id('organizations') },
  returns: v.object({
    contacts: v.array(
      v.object({
        _id: v.id('crmContacts'),
        name: v.string(),
        email: optionalString,
        otherEmails: v.optional(v.array(v.string())),
        airtableId: optionalString,
        mergedAirtableIds: v.optional(v.array(v.string())),
        phone: optionalString,
        linkedin: optionalString,
        website: optionalString,
        location: optionalString,
        notes: optionalString,
        fields: v.optional(fieldsValidator),
      }),
    ),
    organizations: v.array(
      v.object({
        _id: v.id('crmOrganizations'),
        name: v.string(),
        description: optionalString,
        notes: optionalString,
        airtableId: optionalString,
        fields: v.optional(fieldsValidator),
      }),
    ),
    defs: v.array(
      v.object({
        collection: crmCollectionValidator,
        key: v.string(),
        label: v.string(),
        type: crmFieldTypeValidator,
        options: v.array(v.string()),
      }),
    ),
    activities: v.array(
      v.object({
        externalId: v.string(),
        contactId: v.id('crmContacts'),
        title: v.string(),
        occurredAt: v.optional(v.number()),
        status: optionalString,
        data: v.optional(v.record(v.string(), v.any())),
      }),
    ),
  }),
  handler: async (ctx, { orgId }) => {
    const contacts = await orgContacts(ctx, orgId)
    const organizations = await orgOrganizations(ctx, orgId)
    const defs = [
      ...(await listFieldDefs(ctx, orgId, 'contacts')),
      ...(await listFieldDefs(ctx, orgId, 'organizations')),
    ]
    const activities = await takeAll(
      ctx.db
        .query('crmActivities')
        .withIndex('by_orgId_and_externalId', (q) =>
          q
            .eq('orgId', orgId)
            .gte('externalId', 'airtable:')
            .lt('externalId', 'airtable;'),
        ),
      'Airtable activities',
    )
    return {
      contacts: contacts.map((c) => ({
        _id: c._id,
        name: c.name,
        email: c.email,
        otherEmails: c.otherEmails,
        airtableId: c.airtableId,
        mergedAirtableIds: c.mergedAirtableIds,
        phone: c.phone,
        linkedin: c.linkedin,
        website: c.website,
        location: c.location,
        notes: c.notes,
        fields: c.fields,
      })),
      organizations: organizations.map((o) => ({
        _id: o._id,
        name: o.name,
        description: o.description,
        notes: o.notes,
        airtableId: o.airtableId,
        fields: o.fields,
      })),
      defs: defs.map((d) => ({
        collection: d.collection,
        key: d.key,
        label: d.label,
        type: d.type,
        options: (d.options ?? []).map((o) => o.value),
      })),
      activities: activities.flatMap((a) =>
        a.externalId
          ? [
              {
                externalId: a.externalId,
                contactId: a.contactId,
                title: a.title,
                occurredAt: a.occurredAt,
                status: a.status,
                data: a.data,
              },
            ]
          : [],
      ),
    }
  },
})

// ── Writes ──────────────────────────────────────────────────────────────

async function labelsFor(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  collection: CrmCollection,
): Promise<Map<string, string>> {
  const defs = await listFieldDefs(ctx, orgId, collection)
  return new Map([
    ...Object.entries(CORE_LABELS),
    ...defs.map((d) => [d.key, d.label] as [string, string]),
  ])
}

/** Create missing field definitions and add missing select options. */
export const ensureFieldDefs = internalMutation({
  args: { orgId: v.id('organizations'), specs: v.array(specValidator) },
  returns: v.object({ created: v.number(), updated: v.number() }),
  handler: async (ctx, { orgId, specs }) => {
    let created = 0
    let updated = 0
    const now = Date.now()
    for (const collection of ['contacts', 'organizations'] as const) {
      const before = (await listFieldDefs(ctx, orgId, collection)).length
      const defs = await ensureBuiltinFieldDefs(ctx, orgId, collection)
      created += defs.length - before
      const byKey = new Map(defs.map((d) => [d.key, d]))
      let order = defs.reduce((max, d) => Math.max(max, d.order), -1) + 1
      for (const spec of specs) {
        if (spec.collection !== collection) continue
        const def = byKey.get(spec.key)
        if (!def) {
          await ctx.db.insert('crmFieldDefs', {
            orgId,
            collection,
            key: spec.key,
            label: spec.label,
            type: spec.type,
            options: isSelect(spec.type) ? spec.options : undefined,
            order: order++,
            source: spec.source,
            createdAt: now,
            updatedAt: now,
          })
          created++
          continue
        }
        if (!isSelect(def.type)) continue
        const known = new Set((def.options ?? []).map((o) => o.value))
        const missing = spec.options.filter((o) => !known.has(o.value))
        if (missing.length === 0) continue
        await ctx.db.patch('crmFieldDefs', def._id, {
          options: [...(def.options ?? []), ...missing],
          updatedAt: now,
        })
        updated++
      }
    }
    return { created, updated }
  },
})

export const upsertContacts = internalMutation({
  args: {
    orgId: v.id('organizations'),
    contacts: v.array(contactInValidator),
    overwrite: v.boolean(),
  },
  returns: v.object({
    results: v.array(
      v.object({
        ref: v.string(),
        id: v.id('crmContacts'),
        status: statusValidator,
      }),
    ),
    conflicts: v.array(conflictValidator),
  }),
  handler: async (ctx, { orgId, contacts, overwrite }) => {
    const labels = await labelsFor(ctx, orgId, 'contacts')
    const results: Array<{
      ref: string
      id: Id<'crmContacts'>
      status: Status
    }> = []
    const conflicts: Array<Conflict> = []
    const now = Date.now()
    let created = 0
    // Same rules as the plan (Airtable id, then ids of contacts merged into
    // one, then primary and other emails), on live data.
    const live = await orgContacts(ctx, orgId)
    const byEmail = indexByEmail(live)
    const byMergedAirtableId = indexByMergedAirtableId(live)
    for (const c of contacts) {
      // Re-resolve on the live data so a stale plan can't duplicate anyone.
      let doc = c.targetId ? await ctx.db.get('crmContacts', c.targetId) : null
      if (doc && doc.orgId !== orgId) doc = null
      if (!doc && c.airtableId) {
        doc = await ctx.db
          .query('crmContacts')
          .withIndex('by_orgId_and_airtableId', (q) =>
            q.eq('orgId', orgId).eq('airtableId', c.airtableId),
          )
          .first()
        if (!doc) {
          const merged = byMergedAirtableId.get(c.airtableId)
          if (merged) doc = await ctx.db.get('crmContacts', merged._id)
        }
      }
      if (!doc) {
        const email = c.emails.find((e) => byEmail.has(e))
        if (email)
          doc = await ctx.db.get('crmContacts', byEmail.get(email)!._id)
      }
      if (doc) {
        const merged = mergeRecord('contacts', doc, c, labels, overwrite)
        conflicts.push(...merged.conflicts)
        const changed = Object.keys(merged.patch).length > 0
        if (changed) {
          const patch = merged.patch as Partial<Doc<'crmContacts'>>
          await ctx.db.patch('crmContacts', doc._id, {
            ...patch,
            updatedAt: now,
          })
          addEmails(byEmail, { ...doc, ...patch })
        }
        results.push({
          ref: c.ref,
          id: doc._id,
          status: changed ? 'updated' : 'unchanged',
        })
        continue
      }
      const [email, ...otherEmails] = c.emails
      const id = await ctx.db.insert('crmContacts', {
        orgId,
        name: c.name ?? email?.split('@')[0] ?? 'Sin nombre',
        email,
        otherEmails: otherEmails.length ? otherEmails : undefined,
        ...c.core,
        fields: c.fields,
        airtableId: c.airtableId,
        createdAt: now,
        updatedAt: now,
      })
      created++
      const inserted = await ctx.db.get('crmContacts', id)
      if (inserted) addEmails(byEmail, inserted)
      results.push({ ref: c.ref, id, status: 'created' })
    }
    if (created > 0) await bumpCount(ctx, orgId, 'contacts', created)
    return { results, conflicts }
  },
})

export const upsertOrganizations = internalMutation({
  args: {
    orgId: v.id('organizations'),
    organizations: v.array(orgInValidator),
    overwrite: v.boolean(),
  },
  returns: v.object({
    statuses: v.array(statusValidator),
    conflicts: v.array(conflictValidator),
  }),
  handler: async (ctx, { orgId, organizations, overwrite }) => {
    const labels = await labelsFor(ctx, orgId, 'organizations')
    const statuses: Array<Status> = []
    const conflicts: Array<Conflict> = []
    const now = Date.now()
    let created = 0
    // Same rules as the plan: Airtable id, then a name no other row claimed.
    const byName = new Map<
      string,
      Array<{ _id: Id<'crmOrganizations'>; airtableId?: string }>
    >()
    for (const org of await orgOrganizations(ctx, orgId)) {
      const key = orgNameKey(org.name)
      byName.set(key, [...(byName.get(key) ?? []), org])
    }
    for (const o of organizations) {
      let doc = o.targetId
        ? await ctx.db.get('crmOrganizations', o.targetId)
        : null
      if (doc && doc.orgId !== orgId) doc = null
      doc ??= await ctx.db
        .query('crmOrganizations')
        .withIndex('by_orgId_and_airtableId', (q) =>
          q.eq('orgId', orgId).eq('airtableId', o.airtableId),
        )
        .first()
      if (!doc) {
        const match = byName
          .get(orgNameKey(o.name))
          ?.find((org) => nameMatchable(org, o.airtableId))
        if (match) doc = await ctx.db.get('crmOrganizations', match._id)
      }
      if (doc) {
        const merged = mergeRecord('organizations', doc, o, labels, overwrite)
        // Claim it, so a second row with the same name doesn't merge too.
        const claimed = byName
          .get(orgNameKey(doc.name))
          ?.find((org) => org._id === doc._id)
        if (claimed) claimed.airtableId ??= o.airtableId
        conflicts.push(...merged.conflicts)
        const changed = Object.keys(merged.patch).length > 0
        if (changed) {
          await ctx.db.patch('crmOrganizations', doc._id, {
            ...(merged.patch as Partial<Doc<'crmOrganizations'>>),
            updatedAt: now,
          })
        }
        statuses.push(changed ? 'updated' : 'unchanged')
        continue
      }
      const orgDocId = await ctx.db.insert('crmOrganizations', {
        orgId,
        name: o.name,
        ...o.core,
        fields: o.fields,
        airtableId: o.airtableId,
        createdAt: now,
        updatedAt: now,
      })
      created++
      const key = orgNameKey(o.name)
      byName.set(key, [
        ...(byName.get(key) ?? []),
        { _id: orgDocId, airtableId: o.airtableId },
      ])
      statuses.push('created')
    }
    if (created > 0) await bumpCount(ctx, orgId, 'organizations', created)
    return { statuses, conflicts }
  },
})

/** Activities are keyed by `externalId`; an existing one keeps its contact. */
export const upsertActivities = internalMutation({
  args: {
    orgId: v.id('organizations'),
    activities: v.array(activityInValidator),
  },
  returns: v.array(activityStatusValidator),
  handler: async (ctx, { orgId, activities }) => {
    const statuses: Array<Status | 'skipped'> = []
    const now = Date.now()
    const live = new Map<Id<'crmContacts'>, boolean>()
    const isLive = async (id: Id<'crmContacts'>) => {
      let ok = live.get(id)
      if (ok === undefined) {
        const doc = await ctx.db.get('crmContacts', id)
        ok = !!doc && doc.orgId === orgId
        live.set(id, ok)
      }
      return ok
    }
    // Contacts merged away since the contacts step: found again by
    // Airtable id, then ids merged into another contact, then email.
    let maps: {
      byMerged: Map<string, Doc<'crmContacts'>>
      byEmail: Map<string, Doc<'crmContacts'>>
    } | null = null
    const relocate = async (
      locator: (typeof activities)[number]['locator'],
    ): Promise<Id<'crmContacts'> | null> => {
      if (locator.airtableId) {
        const doc = await ctx.db
          .query('crmContacts')
          .withIndex('by_orgId_and_airtableId', (q) =>
            q.eq('orgId', orgId).eq('airtableId', locator.airtableId),
          )
          .first()
        if (doc) return doc._id
      }
      if (!maps) {
        const contacts = await orgContacts(ctx, orgId)
        maps = {
          byMerged: indexByMergedAirtableId(contacts),
          byEmail: indexByEmail(contacts),
        }
      }
      if (locator.airtableId) {
        const doc = maps.byMerged.get(locator.airtableId)
        if (doc) return doc._id
      }
      for (const e of locator.emails) {
        const doc = maps.byEmail.get(e)
        if (doc) return doc._id
      }
      return null
    }

    for (const { locator, ...a } of activities) {
      const contactId = (await isLive(a.contactId))
        ? a.contactId
        : await relocate(locator)
      const existing = await ctx.db
        .query('crmActivities')
        .withIndex('by_orgId_and_externalId', (q) =>
          q.eq('orgId', orgId).eq('externalId', a.externalId),
        )
        .first()
      if (existing) {
        // An existing row keeps its contact unless that one is gone.
        const orphan = !(await isLive(existing.contactId))
        const repoint = orphan && contactId ? { contactId } : {}
        if (sameActivity(existing, a) && !repoint.contactId) {
          statuses.push('unchanged')
        } else {
          await ctx.db.patch('crmActivities', existing._id, {
            title: a.title,
            occurredAt: a.occurredAt,
            status: a.status,
            data: a.data,
            ...repoint,
          })
          statuses.push('updated')
        }
        continue
      }
      if (!contactId) {
        statuses.push('skipped')
        continue
      }
      await ctx.db.insert('crmActivities', {
        orgId,
        contactId,
        kind: a.kind,
        title: a.title,
        occurredAt: a.occurredAt,
        status: a.status,
        source: 'airtable',
        externalId: a.externalId,
        data: a.data,
        createdAt: now,
      })
      statuses.push('created')
    }
    return statuses
  },
})

// ── Actions ─────────────────────────────────────────────────────────────

async function prepare(
  ctx: ActionCtx,
  orgId: Id<'organizations'>,
): Promise<{ plan: Plan; state: State }> {
  await ctx.runQuery(internal.contacts.airtable.assertOrgAdmin, { orgId })
  const token = process.env.AIRTABLE_CRM_TOKEN
  if (!token) {
    throw new ConvexError(
      'Airtable is not connected (AIRTABLE_CRM_TOKEN is not set)',
    )
  }
  const [data, state]: [AirtableData, State] = await Promise.all([
    fetchAirtable(token),
    ctx.runQuery(internal.contacts.airtable.loadState, { orgId }),
  ])
  return { plan: planImport(data, state), state }
}

class Tally {
  private rows = new Map<string, Report['rows'][number]>()
  add(
    source: string,
    target: Report['rows'][number]['target'],
    status: Status | 'skipped',
    n = 1,
  ) {
    const key = `${source}|${target}`
    let row = this.rows.get(key)
    if (!row) {
      row = { source, target, created: 0, updated: 0, unchanged: 0, skipped: 0 }
      this.rows.set(key, row)
    }
    row[status] += n
  }
  list(): Report['rows'] {
    const order: Array<string> = Object.values(SOURCES)
    return [...this.rows.values()].sort(
      (a, b) =>
        order.indexOf(a.source) - order.indexOf(b.source) ||
        a.target.localeCompare(b.target),
    )
  }
}

function addSkipped(tally: Tally, plan: Plan) {
  for (const [source, n] of Object.entries(plan.skipped)) {
    const target =
      source === SOURCES.organizaciones ? 'organizations' : 'activities'
    tally.add(source, target, 'skipped', n)
  }
}

function labelsFromState(specs: Plan['specs'], defs: State['defs']) {
  const labels = new Map<string, string>(Object.entries(CORE_LABELS))
  for (const s of specs) labels.set(`${s.collection}:${s.key}`, s.label)
  for (const d of defs) labels.set(`${d.collection}:${d.key}`, d.label)
  return (collection: CrmCollection) =>
    new Map(
      [...labels].map(([k, label]) => [
        k.startsWith(`${collection}:`) ? k.slice(collection.length + 1) : k,
        label,
      ]),
    )
}

/** What an import would do, computed against a snapshot. Writes nothing. */
function preview(plan: Plan, state: State, overwrite: boolean): Report {
  const tally = new Tally()
  const conflicts: Array<Conflict> = [...plan.duplicateConflicts]
  const labels = labelsFromState(plan.specs, state.defs)
  const contactLabels = labels('contacts')
  const orgLabels = labels('organizations')

  const contacts = new Map(state.contacts.map((c) => [c._id, c]))
  for (const c of plan.contacts) {
    const doc = c.targetId ? contacts.get(c.targetId) : undefined
    if (!doc) {
      tally.add(c.source, 'contacts', 'created')
      continue
    }
    const merged = mergeRecord('contacts', doc, c, contactLabels, overwrite)
    conflicts.push(...merged.conflicts)
    tally.add(
      c.source,
      'contacts',
      Object.keys(merged.patch).length ? 'updated' : 'unchanged',
    )
  }

  const orgs = new Map(state.organizations.map((o) => [o._id, o]))
  const orgsByAirtableId = new Map(
    state.organizations.flatMap((o) =>
      o.airtableId ? [[o.airtableId, o]] : [],
    ),
  )
  for (const o of plan.organizations) {
    const doc =
      (o.targetId ? orgs.get(o.targetId) : undefined) ??
      orgsByAirtableId.get(o.airtableId)
    if (!doc) {
      tally.add(SOURCES.organizaciones, 'organizations', 'created')
      continue
    }
    const merged = mergeRecord('organizations', doc, o, orgLabels, overwrite)
    conflicts.push(...merged.conflicts)
    tally.add(
      SOURCES.organizaciones,
      'organizations',
      Object.keys(merged.patch).length ? 'updated' : 'unchanged',
    )
  }

  const activities = new Map(state.activities.map((a) => [a.externalId, a]))
  for (const a of plan.activities) {
    const existing = activities.get(a.externalId)
    tally.add(
      a.source,
      'activities',
      !existing
        ? 'created'
        : sameActivity(existing, a)
          ? 'unchanged'
          : 'updated',
    )
  }
  addSkipped(tally, plan)

  const fields = { created: 0, updated: 0 }
  const defs = new Map(state.defs.map((d) => [`${d.collection}:${d.key}`, d]))
  const missing = new Set<string>()
  for (const collection of ['contacts', 'organizations'] as const) {
    for (const f of BUILTIN_FIELDS[collection]) {
      if (!defs.has(`${collection}:${f.key}`))
        missing.add(`${collection}:${f.key}`)
    }
  }
  for (const spec of plan.specs) {
    const def = defs.get(`${spec.collection}:${spec.key}`)
    if (!def) missing.add(`${spec.collection}:${spec.key}`)
    else if (
      isSelect(def.type) &&
      spec.options.some((o) => !def.options.includes(o.value))
    ) {
      fields.updated++
    }
  }
  fields.created = missing.size

  return {
    rows: tally.list(),
    fields,
    conflicts: conflicts.slice(0, MAX_CONFLICTS),
    conflictCount: conflicts.length,
    duplicatePersonas: plan.duplicatePersonas,
  }
}

function chunks<T>(items: Array<T>): Array<Array<T>> {
  const out: Array<Array<T>> = []
  for (let i = 0; i < items.length; i += BATCH) {
    out.push(items.slice(i, i + BATCH))
  }
  return out
}

/** The plan's contacts in the mutation's argument shape. */
function contactArg(c: ContactIn) {
  return {
    ...c,
    targetId: c.targetId as Id<'crmContacts'> | undefined,
  }
}

export const previewAirtableImport = action({
  args: {
    orgId: v.id('organizations'),
    overwriteConflicts: v.optional(v.boolean()),
  },
  returns: reportValidator,
  handler: async (ctx, { orgId, overwriteConflicts }): Promise<Report> => {
    const { plan, state } = await prepare(ctx, orgId)
    return preview(plan, state, overwriteConflicts ?? false)
  },
})

export const runAirtableImport = action({
  args: {
    orgId: v.id('organizations'),
    overwriteConflicts: v.boolean(),
  },
  returns: reportValidator,
  handler: async (ctx, { orgId, overwriteConflicts }): Promise<Report> => {
    const { plan, state } = await prepare(ctx, orgId)
    const tally = new Tally()
    const conflicts: Array<Conflict> = [...plan.duplicateConflicts]

    const fields = await ctx.runMutation(
      internal.contacts.airtable.ensureFieldDefs,
      { orgId, specs: plan.specs },
    )

    const contactIds = new Map<string, Id<'crmContacts'>>()
    for (const batch of chunks(plan.contacts)) {
      const out = await ctx.runMutation(
        internal.contacts.airtable.upsertContacts,
        {
          orgId,
          contacts: batch.map(contactArg),
          overwrite: overwriteConflicts,
        },
      )
      conflicts.push(...out.conflicts)
      out.results.forEach((r, i) => {
        contactIds.set(r.ref, r.id)
        tally.add(batch[i].source, 'contacts', r.status)
      })
    }

    for (const batch of chunks(plan.organizations)) {
      const out = await ctx.runMutation(
        internal.contacts.airtable.upsertOrganizations,
        {
          orgId,
          organizations: batch.map((o) => ({
            ...o,
            targetId: o.targetId as Id<'crmOrganizations'> | undefined,
          })),
          overwrite: overwriteConflicts,
        },
      )
      conflicts.push(...out.conflicts)
      for (const status of out.statuses) {
        tally.add(SOURCES.organizaciones, 'organizations', status)
      }
    }

    const plannedByRef = new Map(plan.contacts.map((c) => [c.ref, c]))
    const existingById = new Map(state.contacts.map((c) => [c._id, c]))
    const resolved = plan.activities.flatMap((a) => {
      let contactId: Id<'crmContacts'> | undefined
      let locator: { airtableId?: string; emails: Array<string> }
      if ('id' in a.contact) {
        contactId = a.contact.id as Id<'crmContacts'>
        const snap = existingById.get(a.contact.id)
        locator = {
          airtableId: snap?.airtableId,
          emails: snap
            ? [snap.email, ...(snap.otherEmails ?? [])].filter(
                (e): e is string => !!e,
              )
            : [],
        }
      } else {
        contactId = contactIds.get(a.contact.ref)
        const planned = plannedByRef.get(a.contact.ref)
        locator = {
          airtableId: planned?.airtableId,
          emails: planned?.emails ?? [],
        }
      }
      if (!contactId) {
        tally.add(a.source, 'activities', 'skipped')
        return []
      }
      return [{ ...a, contactId, locator }]
    })
    for (const batch of chunks(resolved)) {
      const statuses = await ctx.runMutation(
        internal.contacts.airtable.upsertActivities,
        {
          orgId,
          activities: batch.map(({ source: _s, contact: _c, ...a }) => a),
        },
      )
      statuses.forEach((status, i) =>
        tally.add(batch[i].source, 'activities', status),
      )
    }
    addSkipped(tally, plan)

    return {
      rows: tally.list(),
      fields,
      conflicts: conflicts.slice(0, MAX_CONFLICTS),
      conflictCount: conflicts.length,
      duplicatePersonas: plan.duplicatePersonas,
    }
  },
})
