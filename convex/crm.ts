import { v } from 'convex/values'
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireOrgAdmin, requireOrgRecord } from './lib/auth'

type CrmCountField =
  | 'contacts'
  | 'organizations'
  | 'opportunities'
  | 'submissions'

type OrgScopedCrmTable =
  | 'crmContacts'
  | 'crmOrganizations'
  | 'crmOpportunities'
  | 'crmSubmissions'

// Capped live count of all four CRM tables for one org. Used as the cold
// path for both `bumpCount` (to seed a correct row when none exists) and
// `getStats` (to answer reads for orgs that haven't been backfilled yet).
// Without this, a single import-of-1 on a pre-backfill org would write
// `{contacts: 1, …}` and silently undercount the actual hundreds of rows
// already in the table. STATS_CAP also matches `backfillCrmCounts`'s
// implicit limit via Convex's per-function read budget.
const STATS_CAP = 10_001
type Counts = {
  contacts: number
  organizations: number
  opportunities: number
  submissions: number
}
async function liveCount(
  ctx: { db: MutationCtx['db'] } | { db: any },
  orgId: Id<'organizations'>,
): Promise<Counts> {
  const [contacts, organizations, opportunities, submissions] =
    await Promise.all([
      ctx.db
        .query('crmContacts')
        .withIndex('by_orgId', (q: any) => q.eq('orgId', orgId))
        .take(STATS_CAP),
      ctx.db
        .query('crmOrganizations')
        .withIndex('by_orgId', (q: any) => q.eq('orgId', orgId))
        .take(STATS_CAP),
      ctx.db
        .query('crmOpportunities')
        .withIndex('by_orgId', (q: any) => q.eq('orgId', orgId))
        .take(STATS_CAP),
      ctx.db
        .query('crmSubmissions')
        .withIndex('by_orgId', (q: any) => q.eq('orgId', orgId))
        .take(STATS_CAP),
    ])
  return {
    contacts: contacts.length,
    organizations: organizations.length,
    opportunities: opportunities.length,
    submissions: submissions.length,
  }
}

// Increment or decrement the per-org CRM count aggregate. `.collect()`
// (instead of `.unique()`) tolerates OCC races on the first-ever write —
// two concurrent inserts may both see no existing row and each create one;
// the next call collapses any duplicates into the first. Math.max(0, …)
// guards against drift causing negative counts on delete-after-backfill-loss.
async function bumpCount(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  field: CrmCountField,
  delta: number,
): Promise<void> {
  const rows = await ctx.db
    .query('crmCounts')
    .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
    .collect()
  if (rows.length === 0) {
    // Seed the row from a live count of all four tables before applying the
    // delta — without this, a pre-backfill org with existing data would land
    // at `{contacts: 1, organizations: 0, …}` after the first write and
    // silently report wrong totals until the manual backfill runs.
    const seed = await liveCount(ctx, orgId)
    seed[field] = Math.max(0, seed[field] + delta)
    await ctx.db.insert('crmCounts', { orgId, ...seed })
    return
  }
  // Sum every count field across duplicates (not just the target field) so a
  // dup row holding a write to a different collection isn't silently dropped
  // when this bump deletes it.
  const [primary, ...extras] = rows
  const totals: Counts = {
    contacts: primary.contacts,
    organizations: primary.organizations,
    opportunities: primary.opportunities,
    submissions: primary.submissions,
  }
  for (const dup of extras) {
    totals.contacts += dup.contacts
    totals.organizations += dup.organizations
    totals.opportunities += dup.opportunities
    totals.submissions += dup.submissions
    await ctx.db.delete(dup._id)
  }
  totals[field] = Math.max(0, totals[field] + delta)
  await ctx.db.patch(primary._id, totals)
}

// Patching `orgId` via updateX mutations would move a record into another
// org and escape the source-org admin check — so the update mutations accept
// only fields in these allowlists.
const CONTACT_EDITABLE = new Set<string>([
  'name',
  'email',
  'phone',
  'linkedin',
  'website',
  'relationship',
  'role',
  'title',
  'professionalField',
  'careerStage',
  'aiSafetyExperience',
  'skills',
  'interests',
  'availability',
  'location',
  'inBuenosAires',
  'contactSource',
  'contactPerson',
  'firstContact',
  'associatedOrganizations',
  'participatedIn',
  'notes',
])
const ORGANIZATION_EDITABLE = new Set<string>([
  'name',
  'description',
  'keyPeople',
  'type',
  'aiStance',
  'mainTopic',
  'notes',
  'autoSummary',
])
const OPPORTUNITY_EDITABLE = new Set<string>([
  'title',
  'organization',
  'location',
  'type',
  'category',
  'date',
  'status',
  'source',
])

// Convex reserves leading `_` for system fields (e.g. `_id`,
// `_creationTime`), so record keys must start with a letter. Excel headers
// like `Período` or `Postura IA/regulación` would otherwise reject the
// insert; SheetJS auto-headers like `__EMPTY` would too.
const SAFE_RECORD_KEY = /^[a-zA-Z][a-zA-Z0-9_]*$/

// Unrecognised cells return `undefined` rather than `false` so a blank import
// doesn't silently flip a flag to a meaningful negative value.
function parseBoolish(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
    return undefined
  }
  if (typeof value !== 'string') return undefined
  const s = value.trim().toLowerCase()
  if (['si', 'sí', 'yes', 'y', 'true', '1', 'x', '✓'].includes(s)) return true
  if (['no', 'n', 'false', '0'].includes(s)) return false
  return undefined
}

// ── Queries ──

export const listContacts = query({
  args: {
    orgId: v.id('organizations'),
    searchQuery: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.orgId)

    if (args.searchQuery && args.searchQuery.trim().length > 0) {
      return await ctx.db
        .query('crmContacts')
        .withSearchIndex('search_name', (q: any) =>
          q.search('name', args.searchQuery!).eq('orgId', args.orgId),
        )
        .collect()
    }

    return await ctx.db
      .query('crmContacts')
      .withIndex('by_orgId', (q: any) => q.eq('orgId', args.orgId))
      .collect()
  },
})

export const listOrganizations = query({
  args: {
    orgId: v.id('organizations'),
    searchQuery: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.orgId)

    if (args.searchQuery && args.searchQuery.trim().length > 0) {
      return await ctx.db
        .query('crmOrganizations')
        .withSearchIndex('search_name', (q: any) =>
          q.search('name', args.searchQuery!).eq('orgId', args.orgId),
        )
        .collect()
    }

    return await ctx.db
      .query('crmOrganizations')
      .withIndex('by_orgId', (q: any) => q.eq('orgId', args.orgId))
      .collect()
  },
})

export const listOpportunities = query({
  args: {
    orgId: v.id('organizations'),
    searchQuery: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.orgId)

    if (args.searchQuery && args.searchQuery.trim().length > 0) {
      return await ctx.db
        .query('crmOpportunities')
        .withSearchIndex('search_title', (q: any) =>
          q.search('title', args.searchQuery!).eq('orgId', args.orgId),
        )
        .collect()
    }

    return await ctx.db
      .query('crmOpportunities')
      .withIndex('by_orgId', (q: any) => q.eq('orgId', args.orgId))
      .collect()
  },
})

export const listSubmissions = query({
  args: {
    orgId: v.id('organizations'),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.orgId)

    return await ctx.db
      .query('crmSubmissions')
      .withIndex('by_orgId', (q: any) => q.eq('orgId', args.orgId))
      .collect()
  },
})

// ── Mutations: Insert (batch import) ──
// Each insert accepts both the canonical camelCase key and a list of
// Spanish-header fallbacks, so BAISH's existing Airtable exports continue to
// import even though the schema is now English.

export const insertContacts = mutation({
  args: {
    orgId: v.id('organizations'),
    records: v.array(v.any()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.orgId)

    const now = Date.now()
    // Fan out the inserts inside the same transaction so a 50-row batch
    // doesn't serialize 50 round-trips. Convex handles internal ordering.
    await Promise.all(
      args.records.map((record) =>
        ctx.db.insert('crmContacts', {
          orgId: args.orgId,
          name:
            record.name ??
            record.Name ??
            record.nombre ??
            record.Nombre ??
            'No name',
          email: record.email ?? record.Email ?? undefined,
          phone:
            record.phone ??
            record.Phone ??
            record.telefono ??
            record['Teléfono'] ??
            undefined,
          linkedin: record.linkedin ?? record.LinkedIn ?? undefined,
          website:
            record.website ??
            record.Website ??
            record.paginaWeb ??
            record['Página web'] ??
            undefined,
          relationship:
            record.relationship ??
            record.Relationship ??
            record.vinculo ??
            record['Vínculo'] ??
            undefined,
          role:
            record.role ?? record.Role ?? record.rol ?? record.Rol ?? undefined,
          title:
            record.title ??
            record.Title ??
            record.cargo ??
            record.Cargo ??
            undefined,
          professionalField:
            record.professionalField ??
            record['Professional field'] ??
            record.campoProfesional ??
            record['Campo profesional'] ??
            undefined,
          careerStage:
            record.careerStage ??
            record['Career stage'] ??
            record.etapaProfesional ??
            record['Etapa profesional'] ??
            undefined,
          aiSafetyExperience:
            record.aiSafetyExperience ??
            record['AI Safety experience'] ??
            record.experienciaAiSafety ??
            record['Experiencia en AI Safety'] ??
            undefined,
          skills:
            record.skills ??
            record.Skills ??
            record.habilidades ??
            record.Habilidades ??
            undefined,
          interests:
            record.interests ??
            record.Interests ??
            record.intereses ??
            record.Intereses ??
            undefined,
          availability:
            record.availability ??
            record.Availability ??
            record.disponibilidad ??
            record.Disponibilidad ??
            undefined,
          location:
            record.location ??
            record.Location ??
            record.ubicacion ??
            record['Ubicación'] ??
            undefined,
          inBuenosAires: parseBoolish(
            record.inBuenosAires ??
              record['In Buenos Aires'] ??
              record.enBuenosAires ??
              record['En Buenos Aires'],
          ),
          contactSource:
            record.contactSource ??
            record['Contact source'] ??
            record.fuenteContacto ??
            record['Fuente de contacto'] ??
            undefined,
          contactPerson:
            record.contactPerson ??
            record['Contact person'] ??
            record.personaContacto ??
            record['Persona de contacto'] ??
            undefined,
          firstContact:
            record.firstContact ??
            record['First contact'] ??
            record.primerContacto ??
            record['Primer contacto'] ??
            undefined,
          associatedOrganizations:
            record.associatedOrganizations ??
            record['Associated organizations'] ??
            record.organizacionesAsociadas ??
            record['Organizaciones asociadas'] ??
            undefined,
          participatedIn:
            record.participatedIn ??
            record['Participated in'] ??
            record.participoEn ??
            record['Participó en'] ??
            undefined,
          notes:
            record.notes ??
            record.Notes ??
            record.notas ??
            record.Notas ??
            undefined,
          createdAt: now,
          updatedAt: now,
        }),
      ),
    )
    await bumpCount(ctx, args.orgId, 'contacts', args.records.length)
    return args.records.length
  },
})

export const insertOrganizations = mutation({
  args: {
    orgId: v.id('organizations'),
    records: v.array(v.any()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.orgId)

    const now = Date.now()
    await Promise.all(
      args.records.map((record) =>
        ctx.db.insert('crmOrganizations', {
          orgId: args.orgId,
          name:
            record.name ??
            record.Name ??
            record.nombre ??
            record.Nombre ??
            'No name',
          description:
            record.description ??
            record.Description ??
            record.descripcion ??
            record['Descripción'] ??
            undefined,
          keyPeople:
            record.keyPeople ??
            record['Key people'] ??
            record.personasClave ??
            record['Personas clave'] ??
            undefined,
          type:
            record.type ??
            record.Type ??
            record.tipo ??
            record.Tipo ??
            undefined,
          aiStance:
            record.aiStance ??
            record['AI stance'] ??
            record.posturaIA ??
            record['Postura IA/regulación'] ??
            undefined,
          mainTopic:
            record.mainTopic ??
            record['Main topic'] ??
            record.tematicaPrincipal ??
            record['Temática principal'] ??
            undefined,
          notes:
            record.notes ??
            record.Notes ??
            record.notas ??
            record.Notas ??
            undefined,
          autoSummary:
            record.autoSummary ??
            record['Auto-summary'] ??
            record.resumenAuto ??
            record['Resumen auto-generado'] ??
            undefined,
          createdAt: now,
          updatedAt: now,
        }),
      ),
    )
    await bumpCount(ctx, args.orgId, 'organizations', args.records.length)
    return args.records.length
  },
})

export const insertOpportunities = mutation({
  args: {
    orgId: v.id('organizations'),
    records: v.array(v.any()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.orgId)

    const now = Date.now()
    await Promise.all(
      args.records.map((record) =>
        ctx.db.insert('crmOpportunities', {
          orgId: args.orgId,
          title:
            record.title ??
            record.Title ??
            record.titulo ??
            record['Título'] ??
            'No title',
          organization:
            record.organization ??
            record.Organization ??
            record.organizacion ??
            record['Organización'] ??
            undefined,
          location:
            record.location ??
            record.Location ??
            record.ubicacion ??
            record['Ubicación'] ??
            undefined,
          type:
            record.type ??
            record.Type ??
            record.tipo ??
            record.Tipo ??
            undefined,
          category:
            record.category ??
            record.Category ??
            record.categoria ??
            record['Categoría'] ??
            undefined,
          date:
            record.date ??
            record.Date ??
            record.fecha ??
            record.Fecha ??
            undefined,
          status:
            record.status ??
            record.Status ??
            record.estado ??
            record.Estado ??
            undefined,
          source:
            record.source ??
            record.Source ??
            record.fuente ??
            record.Fuente ??
            undefined,
          createdAt: now,
          updatedAt: now,
        }),
      ),
    )
    await bumpCount(ctx, args.orgId, 'opportunities', args.records.length)
    return args.records.length
  },
})

export const insertSubmissions = mutation({
  args: {
    orgId: v.id('organizations'),
    records: v.array(v.any()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.orgId)

    const now = Date.now()
    await Promise.all(
      args.records.map((record) => {
        const {
          Participant,
          Period,
          Source,
          Participante,
          Periodo,
          Fuente,
          participant,
          period,
          source,
          participante,
          periodo,
          fuente,
          // Strip system keys so re-imports or agent round-trips don't pollute
          // the flexible `data` bag with orgId/_id/timestamps.
          orgId: _orgId,
          _id,
          _creationTime,
          createdAt: _createdAt,
          updatedAt: _updatedAt,
          ...rest
        } = record
        const data: Record<string, any> = {}
        for (const [k, val] of Object.entries(rest)) {
          if (SAFE_RECORD_KEY.test(k)) data[k] = val
        }
        return ctx.db.insert('crmSubmissions', {
          orgId: args.orgId,
          participant:
            participant ??
            Participant ??
            participante ??
            Participante ??
            undefined,
          period: period ?? Period ?? periodo ?? Periodo ?? undefined,
          source: source ?? Source ?? fuente ?? Fuente ?? undefined,
          data,
          createdAt: now,
          updatedAt: now,
        })
      }),
    )
    await bumpCount(ctx, args.orgId, 'submissions', args.records.length)
    return args.records.length
  },
})

// ── Mutations: Create single (manual row) ──

export const createEmptyContact = mutation({
  args: { orgId: v.id('organizations') },
  returns: v.id('crmContacts'),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.orgId)
    const now = Date.now()
    const id = await ctx.db.insert('crmContacts', {
      orgId: args.orgId,
      name: 'New contact',
      createdAt: now,
      updatedAt: now,
    })
    await bumpCount(ctx, args.orgId, 'contacts', 1)
    return id
  },
})

export const createEmptyOrganization = mutation({
  args: { orgId: v.id('organizations') },
  returns: v.id('crmOrganizations'),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.orgId)
    const now = Date.now()
    const id = await ctx.db.insert('crmOrganizations', {
      orgId: args.orgId,
      name: 'New organization',
      createdAt: now,
      updatedAt: now,
    })
    await bumpCount(ctx, args.orgId, 'organizations', 1)
    return id
  },
})

export const createEmptyOpportunity = mutation({
  args: { orgId: v.id('organizations') },
  returns: v.id('crmOpportunities'),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.orgId)
    const now = Date.now()
    const id = await ctx.db.insert('crmOpportunities', {
      orgId: args.orgId,
      title: 'New opportunity',
      createdAt: now,
      updatedAt: now,
    })
    await bumpCount(ctx, args.orgId, 'opportunities', 1)
    return id
  },
})

export const createEmptySubmission = mutation({
  args: { orgId: v.id('organizations') },
  returns: v.id('crmSubmissions'),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.orgId)
    const now = Date.now()
    const id = await ctx.db.insert('crmSubmissions', {
      orgId: args.orgId,
      data: {},
      createdAt: now,
      updatedAt: now,
    })
    await bumpCount(ctx, args.orgId, 'submissions', 1)
    return id
  },
})

export const createContactWithFields = mutation({
  args: {
    orgId: v.id('organizations'),
    fields: v.any(),
  },
  returns: v.id('crmContacts'),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.orgId)
    const now = Date.now()
    const f = args.fields || {}
    const id = await ctx.db.insert('crmContacts', {
      orgId: args.orgId,
      name: f.name ?? 'No name',
      email: f.email,
      phone: f.phone,
      linkedin: f.linkedin,
      website: f.website,
      relationship: f.relationship,
      role: f.role,
      title: f.title,
      professionalField: f.professionalField,
      careerStage: f.careerStage,
      aiSafetyExperience: f.aiSafetyExperience,
      skills: f.skills,
      interests: f.interests,
      availability: f.availability,
      location: f.location,
      inBuenosAires: parseBoolish(f.inBuenosAires),
      contactSource: f.contactSource,
      contactPerson: f.contactPerson,
      firstContact: f.firstContact,
      associatedOrganizations: f.associatedOrganizations,
      participatedIn: f.participatedIn,
      notes: f.notes,
      createdAt: now,
      updatedAt: now,
    })
    await bumpCount(ctx, args.orgId, 'contacts', 1)
    return id
  },
})

export const createOrganizationWithFields = mutation({
  args: {
    orgId: v.id('organizations'),
    fields: v.any(),
  },
  returns: v.id('crmOrganizations'),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.orgId)
    const now = Date.now()
    const f = args.fields || {}
    const id = await ctx.db.insert('crmOrganizations', {
      orgId: args.orgId,
      name: f.name ?? 'No name',
      description: f.description,
      keyPeople: f.keyPeople,
      type: f.type,
      aiStance: f.aiStance,
      mainTopic: f.mainTopic,
      notes: f.notes,
      autoSummary: f.autoSummary,
      createdAt: now,
      updatedAt: now,
    })
    await bumpCount(ctx, args.orgId, 'organizations', 1)
    return id
  },
})

export const createOpportunityWithFields = mutation({
  args: {
    orgId: v.id('organizations'),
    fields: v.any(),
  },
  returns: v.id('crmOpportunities'),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.orgId)
    const now = Date.now()
    const f = args.fields || {}
    const id = await ctx.db.insert('crmOpportunities', {
      orgId: args.orgId,
      title: f.title ?? 'No title',
      organization: f.organization,
      location: f.location,
      type: f.type,
      category: f.category,
      date: f.date,
      status: f.status,
      source: f.source,
      createdAt: now,
      updatedAt: now,
    })
    await bumpCount(ctx, args.orgId, 'opportunities', 1)
    return id
  },
})

// ── Mutations: Update (inline edit) ──

// `requireOrgRecord` re-checks `record.orgId === args.orgId`; without that, a
// multi-org admin steered by prompt injection could mutate a record outside
// the agent/UI's bound org. The factory shape lets the four collections
// share auth + allowlist plumbing without re-exporting eight near-identical
// mutation bodies.
function defineUpdateMutation<T extends OrgScopedCrmTable>(
  table: T,
  editable: Set<string>,
  notFoundMsg: string,
) {
  return mutation({
    args: {
      orgId: v.id('organizations'),
      id: v.id(table),
      field: v.string(),
      value: v.any(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
      await requireOrgAdmin(ctx, args.orgId)
      await requireOrgRecord(ctx, args.id, args.orgId, notFoundMsg)
      if (!editable.has(args.field)) {
        throw new Error(`Field '${args.field}' is not editable`)
      }
      // Cast needed because `T` is a union over four tables; the inferred
      // patch shape is the intersection of all four schemas, which the
      // dynamic `[args.field]` can't satisfy. The runtime allowlist above
      // gates `args.field` to the table's editable fields.
      await ctx.db.patch(args.id, {
        [args.field]: args.value,
        updatedAt: Date.now(),
      } as unknown as Partial<Doc<T>>)
      return null
    },
  })
}

function defineDeleteMutation<T extends OrgScopedCrmTable>(
  table: T,
  countField: CrmCountField,
  notFoundMsg: string,
) {
  return mutation({
    args: { orgId: v.id('organizations'), id: v.id(table) },
    returns: v.null(),
    handler: async (ctx, args) => {
      await requireOrgAdmin(ctx, args.orgId)
      await requireOrgRecord(ctx, args.id, args.orgId, notFoundMsg)
      await ctx.db.delete(args.id)
      await bumpCount(ctx, args.orgId, countField, -1)
      return null
    },
  })
}

export const updateContact = defineUpdateMutation(
  'crmContacts',
  CONTACT_EDITABLE,
  'Contact not found',
)
export const updateOrganization = defineUpdateMutation(
  'crmOrganizations',
  ORGANIZATION_EDITABLE,
  'Organization not found',
)
export const updateOpportunity = defineUpdateMutation(
  'crmOpportunities',
  OPPORTUNITY_EDITABLE,
  'Opportunity not found',
)

// ── Mutations: Delete single ──

export const deleteContact = defineDeleteMutation(
  'crmContacts',
  'contacts',
  'Contact not found',
)
export const deleteOrganization = defineDeleteMutation(
  'crmOrganizations',
  'organizations',
  'Organization not found',
)
export const deleteOpportunity = defineDeleteMutation(
  'crmOpportunities',
  'opportunities',
  'Opportunity not found',
)
export const deleteSubmission = defineDeleteMutation(
  'crmSubmissions',
  'submissions',
  'Submission not found',
)

// ── Mutations: Delete (clear collection for re-import) ──

// Deletes up to CLEAR_BATCH rows and returns how many were removed plus a
// `hasMore` hint. Callers should loop while `hasMore` is true — a single
// mutation can't safely delete an unbounded number of rows (Convex caps per
// transaction at ~8 MB / ~8 k writes), so batching keeps the operation below
// those limits regardless of collection size.
const CLEAR_BATCH = 500
const TABLE_TO_COUNT_FIELD: Record<OrgScopedCrmTable, CrmCountField> = {
  crmContacts: 'contacts',
  crmOrganizations: 'organizations',
  crmOpportunities: 'opportunities',
  crmSubmissions: 'submissions',
}
export const clearCollection = mutation({
  args: {
    orgId: v.id('organizations'),
    collection: v.union(
      v.literal('crmContacts'),
      v.literal('crmOrganizations'),
      v.literal('crmOpportunities'),
      v.literal('crmSubmissions'),
    ),
  },
  returns: v.object({
    deleted: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.orgId)

    const records = await ctx.db
      .query(args.collection)
      .withIndex('by_orgId', (q: any) => q.eq('orgId', args.orgId))
      .take(CLEAR_BATCH)

    await Promise.all(records.map((record) => ctx.db.delete(record._id)))
    if (records.length > 0) {
      await bumpCount(
        ctx,
        args.orgId,
        TABLE_TO_COUNT_FIELD[args.collection],
        -records.length,
      )
    }
    return {
      deleted: records.length,
      hasMore: records.length === CLEAR_BATCH,
    }
  },
})

// ── Queries: Stats ──

// Reads the `crmCounts` aggregate; sums any duplicate rows in case an OCC
// race left more than one. When no row exists yet (org never had a CRM
// write since the migration), falls back to a capped live count so
// pre-backfill dashboards show real numbers instead of zeros — the next
// mutation's `bumpCount` will materialize the row.
export const getStats = query({
  args: { orgId: v.id('organizations') },
  returns: v.object({
    contacts: v.number(),
    organizations: v.number(),
    opportunities: v.number(),
    submissions: v.number(),
  }),
  handler: async (ctx, args): Promise<Counts> => {
    await requireOrgAdmin(ctx, args.orgId)
    const rows = await ctx.db
      .query('crmCounts')
      .withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
      .collect()
    if (rows.length === 0) return liveCount(ctx, args.orgId)
    const totals: Counts = {
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

// One-shot backfill: walk every CRM row across the four tables and write a
// `crmCounts` doc per org. Run once after deploy via:
//   bunx convex run crm:backfillCrmCounts
// Idempotent — re-runs overwrite each org's row with the freshly counted
// totals, collapsing any drift from concurrent writes during the backfill.
export const backfillCrmCounts = internalMutation({
  args: {},
  returns: v.object({
    orgs: v.number(),
  }),
  handler: async (ctx) => {
    const orgs = await ctx.db.query('organizations').collect()
    const tables: { table: OrgScopedCrmTable; field: CrmCountField }[] = [
      { table: 'crmContacts', field: 'contacts' },
      { table: 'crmOrganizations', field: 'organizations' },
      { table: 'crmOpportunities', field: 'opportunities' },
      { table: 'crmSubmissions', field: 'submissions' },
    ]

    for (const org of orgs) {
      const totals = {
        contacts: 0,
        organizations: 0,
        opportunities: 0,
        submissions: 0,
      }
      for (const { table, field } of tables) {
        const rows = await ctx.db
          .query(table)
          .withIndex('by_orgId', (q) => q.eq('orgId', org._id))
          .collect()
        totals[field] = rows.length
      }
      const existing = await ctx.db
        .query('crmCounts')
        .withIndex('by_orgId', (q) => q.eq('orgId', org._id))
        .collect()
      if (existing.length === 0) {
        await ctx.db.insert('crmCounts', { orgId: org._id, ...totals })
      } else {
        const [primary, ...extras] = existing
        for (const dup of extras) await ctx.db.delete(dup._id)
        await ctx.db.patch(primary._id, totals)
      }
    }
    return { orgs: orgs.length }
  },
})

// ── Queries: Get single record by ID ──
//
// `null` (not throw) on cross-org IDs so the UI can distinguish
// not-found-or-not-yours from auth failure without a try/catch.

async function getOrgScopedDoc(ctx: any, id: any, orgId: any): Promise<any> {
  await requireOrgAdmin(ctx, orgId)
  const doc = await ctx.db.get(id)
  if (!doc || doc.orgId !== orgId) return null
  return doc
}

export const getContact = query({
  args: { orgId: v.id('organizations'), id: v.id('crmContacts') },
  returns: v.any(),
  handler: (ctx, args) => getOrgScopedDoc(ctx, args.id, args.orgId),
})

export const getOrganization = query({
  args: { orgId: v.id('organizations'), id: v.id('crmOrganizations') },
  returns: v.any(),
  handler: (ctx, args) => getOrgScopedDoc(ctx, args.id, args.orgId),
})

export const getOpportunity = query({
  args: { orgId: v.id('organizations'), id: v.id('crmOpportunities') },
  returns: v.any(),
  handler: (ctx, args) => getOrgScopedDoc(ctx, args.id, args.orgId),
})

export const getSubmission = query({
  args: { orgId: v.id('organizations'), id: v.id('crmSubmissions') },
  returns: v.any(),
  handler: (ctx, args) => getOrgScopedDoc(ctx, args.id, args.orgId),
})
