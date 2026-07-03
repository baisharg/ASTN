import { v } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { requireOrgAdminFor } from '../lib/auth'
import { isOutboxActive, syncOutboxOnStatusChange } from '../emails/outbox'

// Platform data layer for the MCP endpoint (convex/mcp/server.ts). Like
// convex/mcp/data.ts (the CRM layer), these are internal functions: the HTTP
// action verifies the Clerk OAuth JWT itself and passes the subject down as
// `userId`. Every handler re-checks org-admin membership via
// resolveOrgForAdmin — Clerk has no custom OAuth scopes, so this layer IS the
// authorization boundary. Scope is always a single org the caller administers.

// ── Resource registry ──────────────────────────────────────────────────────

// Resources readable through astn_list / astn_get.
export const readResourceValidator = v.union(
  v.literal('members'),
  v.literal('opportunities'),
  v.literal('applications'),
  v.literal('programs'),
  v.literal('program_modules'),
  v.literal('program_sessions'),
  v.literal('program_participants'),
  v.literal('surveys'),
  v.literal('polls'),
  v.literal('spaces'),
  v.literal('bookings'),
  v.literal('guest_applications'),
  v.literal('events'),
  v.literal('engagement'),
  v.literal('outbox'),
  v.literal('email_log'),
)

// Resources patchable through astn_update (safe, non-outward scalar fields).
export const updateResourceValidator = v.union(
  v.literal('programs'),
  v.literal('program_modules'),
  v.literal('program_sessions'),
  v.literal('opportunities'),
  v.literal('surveys'),
  v.literal('polls'),
  v.literal('spaces'),
  v.literal('applications'),
)

// Application status is an internal decision marker (accepted/rejected/…). The
// app's own updateStatus mutation also schedules applicant-facing auto-emails;
// this MCP path deliberately does NOT — see the note in the `update` handler.
export const APPLICATION_STATUSES = [
  'submitted',
  'under_review',
  'accepted',
  'rejected',
  'redirected', // "Fit for another course"
  'waitlisted',
  'participated',
] as const

// Table backing each resource, for astn_get / astn_update id resolution.
const RESOURCE_TABLE: Record<string, string> = {
  members: 'orgMemberships',
  opportunities: 'orgOpportunities',
  applications: 'opportunityApplications',
  programs: 'programs',
  program_modules: 'programModules',
  program_sessions: 'programSessions',
  program_participants: 'programParticipation',
  surveys: 'feedbackSurveys',
  polls: 'availabilityPolls',
  spaces: 'coworkingSpaces',
  bookings: 'spaceBookings',
  guest_applications: 'spaceBookings',
  events: 'events',
  engagement: 'memberEngagement',
  outbox: 'emailOutbox',
  email_log: 'emailLog',
}

// Allowlist of safe scalar fields patchable per resource. Outward-facing or
// structural fields (formFields, accessToken, status transitions that notify,
// materials/storage) are deliberately excluded — those belong to v2 actions.
export const UPDATE_FIELDS: Record<string, Set<string>> = {
  programs: new Set([
    'name',
    'description',
    'type',
    'status',
    'startDate',
    'endDate',
    'enrollmentMethod',
    'maxParticipants',
  ]),
  program_modules: new Set([
    'title',
    'description',
    'weekNumber',
    'orderIndex',
    'status',
  ]),
  program_sessions: new Set([
    'dayNumber',
    'title',
    'date',
    'morningStartTime',
    'afternoonStartTime',
    'lumaUrl',
  ]),
  opportunities: new Set([
    'title',
    'description',
    'type',
    'status',
    'deadline',
    'externalUrl',
    'featured',
    'tags',
  ]),
  surveys: new Set(['title', 'description']),
  polls: new Set(['title']),
  // Application decision + review notes. Non-notifying (see `update` handler).
  applications: new Set(['status', 'reviewNotes']),
  spaces: new Set([
    'name',
    'description',
    'address',
    'addressNote',
    'houseRules',
    'amenities',
    'guestAccessEnabled',
    'capacity',
    'timezone',
  ]),
}

// ── Auth + scoping helpers ──────────────────────────────────────────────────

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

async function adminMembership(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  orgId: Id<'organizations'>,
): Promise<Doc<'orgMemberships'>> {
  const m = await ctx.db
    .query('orgMemberships')
    .withIndex('by_user_and_org', (q) =>
      q.eq('userId', userId).eq('orgId', orgId),
    )
    .first()
  if (!m || m.role !== 'admin') throw new Error('Admin access required')
  return m
}

// Verify a document belongs to the given org. Most platform tables carry orgId
// directly; modules/sessions reach it through their program, bookings through
// their space.
async function assertInOrg(
  ctx: QueryCtx | MutationCtx,
  resource: string,
  doc: any,
  orgId: Id<'organizations'>,
): Promise<void> {
  if (resource === 'program_modules' || resource === 'program_sessions') {
    const program = await ctx.db.get('programs', doc.programId)
    if (!program || program.orgId !== orgId) throw new Error('Record not found')
    return
  }
  if (resource === 'bookings' || resource === 'guest_applications') {
    const space = await ctx.db.get('coworkingSpaces', doc.spaceId)
    if (!space || space.orgId !== orgId) throw new Error('Record not found')
    return
  }
  if (doc.orgId !== orgId) throw new Error('Record not found')
}

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(Math.floor(limit ?? 100), 1), 500)
}

// Batch-resolve Clerk userIds → display name/email via the profiles table.
async function profileMap(
  ctx: QueryCtx,
  userIds: Array<string>,
): Promise<Map<string, { name: string | null; email: string | null }>> {
  const unique = [...new Set(userIds)]
  const profiles = await Promise.all(
    unique.map((userId) =>
      ctx.db
        .query('profiles')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .first(),
    ),
  )
  const map = new Map<string, { name: string | null; email: string | null }>()
  for (let i = 0; i < unique.length; i++) {
    const p = profiles[i]
    map.set(unique[i], { name: p?.name ?? null, email: p?.email ?? null })
  }
  return map
}

function normalizeFor(
  ctx: QueryCtx | MutationCtx,
  resource: string,
  idStr: string,
): Id<any> | null {
  const table = RESOURCE_TABLE[resource]
  return ctx.db.normalizeId(table as any, idStr)
}

// ── astn_list ───────────────────────────────────────────────────────────────

export const list = internalQuery({
  args: {
    userId: v.string(),
    orgSlug: v.string(),
    resource: readResourceValidator,
    opportunityId: v.optional(v.string()),
    programId: v.optional(v.string()),
    spaceId: v.optional(v.string()),
    status: v.optional(v.string()),
    level: v.optional(v.string()),
    date: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    const limit = clampLimit(args.limit)
    const orgId = org._id

    switch (args.resource) {
      case 'members': {
        const rows = await ctx.db
          .query('orgMemberships')
          .withIndex('by_org', (q) => q.eq('orgId', orgId))
          .take(limit)
        const names = await profileMap(
          ctx,
          rows.map((r) => r.userId),
        )
        return rows.map((r) => ({
          _id: r._id,
          userId: r.userId,
          role: r.role,
          directoryVisibility: r.directoryVisibility,
          joinedAt: r.joinedAt,
          name: names.get(r.userId)?.name ?? null,
          email: names.get(r.userId)?.email ?? null,
        }))
      }

      case 'opportunities': {
        const q = ctx.db
          .query('orgOpportunities')
          .withIndex('by_org_and_status', (qq) =>
            args.status
              ? qq.eq('orgId', orgId).eq('status', args.status as any)
              : qq.eq('orgId', orgId),
          )
        return await q.take(limit)
      }

      case 'applications': {
        if (args.opportunityId) {
          const oppId = ctx.db.normalizeId(
            'orgOpportunities',
            args.opportunityId,
          )
          if (!oppId) throw new Error('opportunityId not found')
          const opp = await ctx.db.get(oppId)
          if (!opp || opp.orgId !== orgId)
            throw new Error('opportunityId not found')
          const rows = await ctx.db
            .query('opportunityApplications')
            .withIndex('by_opportunity_and_status', (qq) =>
              args.status
                ? qq.eq('opportunityId', oppId).eq('status', args.status as any)
                : qq.eq('opportunityId', oppId),
            )
            .take(limit)
          return rows
        }
        const rows = await ctx.db
          .query('opportunityApplications')
          .withIndex('by_org', (qq) => qq.eq('orgId', orgId))
          .take(limit)
        return args.status ? rows.filter((r) => r.status === args.status) : rows
      }

      case 'programs': {
        const rows = args.status
          ? await ctx.db
              .query('programs')
              .withIndex('by_org_status', (qq) =>
                qq.eq('orgId', orgId).eq('status', args.status as any),
              )
              .take(limit)
          : await ctx.db
              .query('programs')
              .withIndex('by_org', (qq) => qq.eq('orgId', orgId))
              .take(limit)
        return rows
      }

      case 'program_modules':
      case 'program_sessions':
      case 'program_participants': {
        if (!args.programId) throw new Error('programId is required')
        const programId = ctx.db.normalizeId('programs', args.programId)
        if (!programId) throw new Error('programId not found')
        const program = await ctx.db.get(programId)
        if (!program || program.orgId !== orgId)
          throw new Error('programId not found')
        if (args.resource === 'program_modules') {
          return await ctx.db
            .query('programModules')
            .withIndex('by_program_and_order', (qq) =>
              qq.eq('programId', programId),
            )
            .take(limit)
        }
        if (args.resource === 'program_sessions') {
          return await ctx.db
            .query('programSessions')
            .withIndex('by_program', (qq) => qq.eq('programId', programId))
            .take(limit)
        }
        // program_participants
        const parts = args.status
          ? await ctx.db
              .query('programParticipation')
              .withIndex('by_program_status', (qq) =>
                qq.eq('programId', programId).eq('status', args.status as any),
              )
              .take(limit)
          : await ctx.db
              .query('programParticipation')
              .withIndex('by_program', (qq) => qq.eq('programId', programId))
              .take(limit)
        const names = await profileMap(
          ctx,
          parts.map((p) => p.userId),
        )
        return parts.map((p) => ({
          _id: p._id,
          userId: p.userId,
          status: p.status,
          enrolledAt: p.enrolledAt,
          completedAt: p.completedAt,
          manualAttendanceCount: p.manualAttendanceCount,
          name: names.get(p.userId)?.name ?? null,
        }))
      }

      case 'surveys': {
        return await ctx.db
          .query('feedbackSurveys')
          .withIndex('by_org', (qq) => qq.eq('orgId', orgId))
          .take(limit)
      }

      case 'polls': {
        if (args.opportunityId) {
          const oppId = ctx.db.normalizeId(
            'orgOpportunities',
            args.opportunityId,
          )
          if (!oppId) throw new Error('opportunityId not found')
          const opp = await ctx.db.get(oppId)
          if (!opp || opp.orgId !== orgId)
            throw new Error('opportunityId not found')
          return await ctx.db
            .query('availabilityPolls')
            .withIndex('by_opportunity', (qq) => qq.eq('opportunityId', oppId))
            .take(limit)
        }
        // No opportunity filter: gather across this org's opportunities.
        const opps = await ctx.db
          .query('orgOpportunities')
          .withIndex('by_org_and_status', (qq) => qq.eq('orgId', orgId))
          .collect()
        const polls: Array<Doc<'availabilityPolls'>> = []
        for (const opp of opps) {
          const p = await ctx.db
            .query('availabilityPolls')
            .withIndex('by_opportunity', (qq) =>
              qq.eq('opportunityId', opp._id),
            )
            .collect()
          polls.push(...p)
          if (polls.length >= limit) break
        }
        return polls.slice(0, limit)
      }

      case 'spaces': {
        return await ctx.db
          .query('coworkingSpaces')
          .withIndex('by_org', (qq) => qq.eq('orgId', orgId))
          .take(limit)
      }

      case 'bookings':
      case 'guest_applications': {
        // Resolve the org's space ids (usually one), then bookings per space.
        let spaceIds: Array<Id<'coworkingSpaces'>>
        if (args.spaceId) {
          const sid = ctx.db.normalizeId('coworkingSpaces', args.spaceId)
          if (!sid) throw new Error('spaceId not found')
          const space = await ctx.db.get(sid)
          if (!space || space.orgId !== orgId)
            throw new Error('spaceId not found')
          spaceIds = [sid]
        } else {
          const spaces = await ctx.db
            .query('coworkingSpaces')
            .withIndex('by_org', (qq) => qq.eq('orgId', orgId))
            .collect()
          spaceIds = spaces.map((s) => s._id)
        }
        const out: Array<Doc<'spaceBookings'>> = []
        for (const sid of spaceIds) {
          const rows = args.date
            ? await ctx.db
                .query('spaceBookings')
                .withIndex('by_space_date', (qq) =>
                  qq.eq('spaceId', sid).eq('date', args.date as string),
                )
                .collect()
            : await ctx.db
                .query('spaceBookings')
                .withIndex('by_space_date', (qq) => qq.eq('spaceId', sid))
                .collect()
          out.push(...rows)
          if (out.length >= limit) break
        }
        let filtered = out
        if (args.resource === 'guest_applications') {
          filtered = filtered.filter((b) => b.bookingType === 'guest')
        }
        if (args.status) {
          filtered = filtered.filter((b) => b.status === args.status)
        }
        return filtered.slice(0, limit)
      }

      case 'events': {
        return await ctx.db
          .query('events')
          .withIndex('by_org', (qq) => qq.eq('orgId', orgId))
          .take(limit)
      }

      case 'outbox':
      case 'email_log': {
        if (!args.opportunityId) throw new Error('opportunityId is required')
        const oppId = ctx.db.normalizeId('orgOpportunities', args.opportunityId)
        if (!oppId) throw new Error('opportunityId not found')
        const opp = await ctx.db.get(oppId)
        if (!opp || opp.orgId !== orgId)
          throw new Error('opportunityId not found')
        if (args.resource === 'outbox') {
          return await ctx.db
            .query('emailOutbox')
            .withIndex('by_opportunity', (qq) => qq.eq('opportunityId', oppId))
            .take(limit)
        }
        return await ctx.db
          .query('emailLog')
          .withIndex('by_opportunity', (qq) => qq.eq('opportunityId', oppId))
          .take(limit)
      }

      case 'engagement': {
        const rows = args.level
          ? await ctx.db
              .query('memberEngagement')
              .withIndex('by_org_level', (qq) =>
                qq.eq('orgId', orgId).eq('level', args.level as any),
              )
              .take(limit)
          : await ctx.db
              .query('memberEngagement')
              .withIndex('by_org', (qq) => qq.eq('orgId', orgId))
              .take(limit)
        const names = await profileMap(
          ctx,
          rows.map((r) => r.userId),
        )
        return rows.map((r) => ({
          _id: r._id,
          userId: r.userId,
          level: r.override?.level ?? r.level,
          baseLevel: r.level,
          overridden: !!r.override,
          adminExplanation: r.adminExplanation,
          signals: r.signals,
          computedAt: r.computedAt,
          name: names.get(r.userId)?.name ?? null,
        }))
      }

      default:
        throw new Error(`Unknown resource: ${String(args.resource)}`)
    }
  },
})

// ── astn_get ──────────────────────────────────────────────────────────────

export const getOne = internalQuery({
  args: {
    userId: v.string(),
    orgSlug: v.string(),
    resource: readResourceValidator,
    id: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    const id = normalizeFor(ctx, args.resource, args.id)
    if (!id) return null
    const doc = await ctx.db.get(id)
    if (!doc) return null
    await assertInOrg(ctx, args.resource, doc, org._id)
    return doc
  },
})

// ── astn_update (allowlisted scalar patch) ──────────────────────────────────

export const update = internalMutation({
  args: {
    userId: v.string(),
    orgSlug: v.string(),
    resource: updateResourceValidator,
    id: v.string(),
    fields: v.any(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    const id = normalizeFor(ctx, args.resource, args.id)
    if (!id) throw new Error('Record not found')
    const doc = await ctx.db.get(id)
    if (!doc) throw new Error('Record not found')
    await assertInOrg(ctx, args.resource, doc, org._id)

    const allowed = UPDATE_FIELDS[args.resource]
    const f = (
      args.fields && typeof args.fields === 'object' ? args.fields : {}
    ) as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    const invalid: Array<string> = []
    for (const [key, value] of Object.entries(f)) {
      if (!allowed.has(key)) {
        invalid.push(key)
        continue
      }
      patch[key] = value
    }
    if (invalid.length > 0) {
      throw new Error(
        `Unknown/locked field(s) for ${args.resource}: ${invalid.join(', ')}. ` +
          `Editable fields: ${[...allowed].join(', ')}`,
      )
    }
    if (Object.keys(patch).length === 0) throw new Error('No fields to update')

    // Applications: validate the status enum and stamp review metadata. This
    // records the decision *inside ASTN only* — unlike the app's updateStatus
    // mutation, it intentionally does NOT schedule the applicant-facing
    // auto-email. Outbound mail (e.g. the submit-time availability email)
    // stays out of the MCP surface by design.
    if (args.resource === 'applications') {
      if (
        'status' in patch &&
        !APPLICATION_STATUSES.includes(patch.status as any)
      ) {
        throw new Error(
          `Invalid status. Must be one of: ${APPLICATION_STATUSES.join(', ')}`,
        )
      }
      patch.reviewedAt = Date.now()
      patch.reviewedBy = args.userId
    }

    // programModules/Sessions/Programs/Opportunities/Spaces track updatedAt;
    // every table in UPDATE_FIELDS has the column.
    await ctx.db.patch(id, { ...patch, updatedAt: Date.now() } as any)

    // Outbox (issue #20): a status change on an opportunity with a linked
    // template set replaces/enqueues the pending decision-email draft. Still
    // no email is ever sent from this path.
    if (args.resource === 'applications' && 'status' in patch) {
      const updated: any = await ctx.db.get(id)
      const opportunity: any = updated
        ? await ctx.db.get(updated.opportunityId)
        : null
      if (updated && opportunity && isOutboxActive(opportunity)) {
        await syncOutboxOnStatusChange(ctx, {
          application: updated,
          status: patch.status as string,
          opportunity,
        })
      }
    }

    return { id, resource: args.resource, updated: Object.keys(patch) }
  },
})

// ── Creates (programs / modules / sessions only — invariants mirrored from
//    convex/programs.ts) ─────────────────────────────────────────────────────

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

export const createProgram = internalMutation({
  args: {
    userId: v.string(),
    orgSlug: v.string(),
    fields: v.any(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    const membership = await adminMembership(ctx, args.userId, org._id)
    const f = (args.fields ?? {}) as Record<string, any>
    if (!f.name || typeof f.name !== 'string')
      throw new Error('`name` is required')
    const validTypes = [
      'reading_group',
      'fellowship',
      'mentorship',
      'cohort',
      'workshop_series',
      'custom',
    ]
    if (!validTypes.includes(f.type))
      throw new Error(`\`type\` must be one of: ${validTypes.join(', ')}`)
    const validEnroll = ['admin_only', 'self_enroll', 'approval_required']
    const enrollmentMethod = f.enrollmentMethod ?? 'admin_only'
    if (!validEnroll.includes(enrollmentMethod))
      throw new Error(
        `\`enrollmentMethod\` must be one of: ${validEnroll.join(', ')}`,
      )

    let slug = generateSlug(f.name)
    const existing = await ctx.db
      .query('programs')
      .withIndex('by_org_slug', (q) => q.eq('orgId', org._id).eq('slug', slug))
      .first()
    if (existing) slug = `${slug}-${Date.now()}`

    const now = Date.now()
    const programId = await ctx.db.insert('programs', {
      orgId: org._id,
      name: f.name,
      slug,
      description: f.description,
      type: f.type,
      startDate: f.startDate,
      endDate: f.endDate,
      status: 'planning',
      enrollmentMethod,
      maxParticipants: f.maxParticipants,
      linkedEventIds: [],
      createdBy: membership._id,
      createdAt: now,
      updatedAt: now,
    } as any)
    return { id: programId, slug, created: true }
  },
})

export const createModule = internalMutation({
  args: {
    userId: v.string(),
    orgSlug: v.string(),
    programId: v.string(),
    fields: v.any(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    const programId = ctx.db.normalizeId('programs', args.programId)
    if (!programId) throw new Error('programId not found')
    const program = await ctx.db.get(programId)
    if (!program || program.orgId !== org._id)
      throw new Error('programId not found')

    const f = (args.fields ?? {}) as Record<string, any>
    if (!f.title || typeof f.title !== 'string')
      throw new Error('`title` is required')
    if (typeof f.weekNumber !== 'number')
      throw new Error('`weekNumber` (number) is required')

    const existing = await ctx.db
      .query('programModules')
      .withIndex('by_program', (q) => q.eq('programId', programId))
      .collect()
    const maxOrder = existing.reduce((m, x) => Math.max(m, x.orderIndex), -1)

    const now = Date.now()
    const id = await ctx.db.insert('programModules', {
      programId,
      title: f.title,
      description: f.description,
      weekNumber: f.weekNumber,
      orderIndex: maxOrder + 1,
      status: f.status ?? 'locked',
      createdAt: now,
      updatedAt: now,
    } as any)
    return { id, created: true }
  },
})

export const createSession = internalMutation({
  args: {
    userId: v.string(),
    orgSlug: v.string(),
    programId: v.string(),
    fields: v.any(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    const programId = ctx.db.normalizeId('programs', args.programId)
    if (!programId) throw new Error('programId not found')
    const program = await ctx.db.get(programId)
    if (!program || program.orgId !== org._id)
      throw new Error('programId not found')

    const f = (args.fields ?? {}) as Record<string, any>
    for (const req of ['dayNumber', 'title', 'date']) {
      if (f[req] == null) throw new Error(`\`${req}\` is required`)
    }
    const now = Date.now()
    const id = await ctx.db.insert('programSessions', {
      programId,
      dayNumber: f.dayNumber,
      title: f.title,
      date: f.date,
      morningStartTime: f.morningStartTime ?? '',
      afternoonStartTime: f.afternoonStartTime ?? '',
      lumaUrl: f.lumaUrl,
      createdAt: now,
      updatedAt: now,
    } as any)
    return { id, created: true }
  },
})

// ── Special-shape reads ──────────────────────────────────────────────────────

export const orgStats = internalQuery({
  args: { userId: v.string(), orgSlug: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    const orgId = org._id

    const members = await ctx.db
      .query('orgMemberships')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const opportunities = await ctx.db
      .query('orgOpportunities')
      .withIndex('by_org_and_status', (q) => q.eq('orgId', orgId))
      .collect()
    const applications = await ctx.db
      .query('opportunityApplications')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const programs = await ctx.db
      .query('programs')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const engagement = await ctx.db
      .query('memberEngagement')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const crmRows = await ctx.db
      .query('crmCounts')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .collect()

    const tally = (items: Array<{ [k: string]: any }>, key: string) => {
      const out: Record<string, number> = {}
      for (const it of items) {
        const k = String(it[key])
        out[k] = (out[k] ?? 0) + 1
      }
      return out
    }

    const crm = {
      contacts: 0,
      organizations: 0,
      opportunities: 0,
      submissions: 0,
    }
    for (const r of crmRows) {
      crm.contacts += r.contacts
      crm.organizations += r.organizations
      crm.opportunities += r.opportunities
      crm.submissions += r.submissions
    }

    return {
      members: { total: members.length, byRole: tally(members, 'role') },
      opportunities: {
        total: opportunities.length,
        byStatus: tally(opportunities, 'status'),
      },
      applications: {
        total: applications.length,
        byStatus: tally(applications, 'status'),
      },
      programs: { total: programs.length, byStatus: tally(programs, 'status') },
      engagement: {
        total: engagement.length,
        byLevel: tally(
          engagement.map((e) => ({ level: e.override?.level ?? e.level })),
          'level',
        ),
      },
      crm,
    }
  },
})

export const surveyResults = internalQuery({
  args: { userId: v.string(), orgSlug: v.string(), surveyId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    const surveyId = ctx.db.normalizeId('feedbackSurveys', args.surveyId)
    if (!surveyId) throw new Error('surveyId not found')
    const survey = await ctx.db.get(surveyId)
    if (!survey || survey.orgId !== org._id)
      throw new Error('surveyId not found')

    const respondents = await ctx.db
      .query('surveyRespondents')
      .withIndex('by_survey', (q) => q.eq('surveyId', surveyId))
      .collect()
    const responses = await ctx.db
      .query('surveyResponses')
      .withIndex('by_survey', (q) => q.eq('surveyId', surveyId))
      .collect()

    return {
      survey: {
        _id: survey._id,
        title: survey.title,
        description: survey.description,
        status: survey.status,
        formFields: survey.formFields,
      },
      respondentCount: respondents.length,
      responseCount: responses.length,
      responses: responses.map((r) => ({
        respondentName: r.respondentName,
        submittedAt: r.submittedAt,
        responses: r.responses,
      })),
    }
  },
})

export const availabilityHeatmap = internalQuery({
  args: { userId: v.string(), orgSlug: v.string(), pollId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    const pollId = ctx.db.normalizeId('availabilityPolls', args.pollId)
    if (!pollId) throw new Error('pollId not found')
    const poll = await ctx.db.get(pollId)
    if (!poll || poll.orgId !== org._id) throw new Error('pollId not found')

    const responses = await ctx.db
      .query('availabilityResponses')
      .withIndex('by_poll', (q) => q.eq('pollId', pollId))
      .collect()

    // Aggregate each "<weekday>|minutes" slot into available/maybe counts.
    const slots: Record<string, { available: number; maybe: number }> = {}
    for (const resp of responses) {
      for (const [key, val] of Object.entries(resp.slots ?? {})) {
        if (!slots[key]) slots[key] = { available: 0, maybe: 0 }
        if (val === 'available') slots[key].available += 1
        else if (val === 'maybe') slots[key].maybe += 1
      }
    }

    return {
      poll: {
        _id: poll._id,
        title: poll.title,
        timezone: poll.timezone,
        days: poll.days,
        startMinutes: poll.startMinutes,
        endMinutes: poll.endMinutes,
        slotDurationMinutes: poll.slotDurationMinutes,
        status: poll.status,
        finalizedSlot: poll.finalizedSlot,
      },
      respondentCount: responses.length,
      slots,
    }
  },
})
