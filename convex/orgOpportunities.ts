import { ConvexError, v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import {
  BAISH_ORG_SLUG,
  selectBaishCourseOpportunities,
  toBaishCourseOpportunityContract,
  type BaishCourseOpportunityContract,
} from './lib/baishCourseOpportunities'
import { getUserId, requireOrgAdmin } from './lib/auth'
import {
  assertFormFieldsShape,
  sanitizeFormFieldKeys,
} from './lib/formFields'
import type { FormField } from './lib/formFields'
import { describeImpact, impactOnApplications } from './lib/formFieldChanges'
import { createDefaultPollForOpportunity } from './availabilityPolls'

/**
 * Turn a title into a URL-safe slug: lowercase, accents stripped, spaces and
 * punctuation collapsed to single hyphens.
 * "Gobernanza de IA de Frontera" -> "gobernanza-de-ia-de-frontera"
 */
const MAX_SLUG_LEN = 60
export function slugifyTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LEN)
    .replace(/-+$/g, '')
}

/**
 * A slug free to use in this org, suffixing `-2`, `-3`… on collision. Returns
 * undefined when the title yields nothing sluggable (e.g. all punctuation);
 * the opportunity then simply has no alias and its id keeps working.
 */
async function uniqueSlug(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  desired: string,
  selfId?: Id<'orgOpportunities'>,
): Promise<string | undefined> {
  const base = slugifyTitle(desired)
  if (!base) return undefined

  const taken = new Set(
    (
      await ctx.db
        .query('orgOpportunities')
        .withIndex('by_org_and_status', (q) => q.eq('orgId', orgId))
        .collect()
    )
      .filter((o) => o._id !== selfId && typeof o.slug === 'string')
      .map((o) => o.slug as string),
  )

  if (!taken.has(base)) return base
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }
  return undefined
}

// Normalize freeform tags: trim, drop empties, dedupe (case-insensitive,
// keeping the first-seen casing), cap length. Returns undefined for an empty
// result so we don't store empty arrays.
const MAX_TAG_LEN = 40
function normalizeTags(tags: Array<string>): Array<string> | undefined {
  const seen = new Set<string>()
  const out: Array<string> = []
  for (const raw of tags) {
    const t = raw.trim().slice(0, MAX_TAG_LEN)
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out.length > 0 ? out : undefined
}

// Validate an opportunity cross-reference (redirect target / pre-fill source).
// Discriminates "caller didn't pass this field" (`set: false` — skip the
// patch) from "caller passed null to clear" (`set: true, value: undefined`)
// and "caller passed a valid id" (`set: true, value: id`). Throws on any
// invalid id (self-reference, missing target, cross-org).
async function resolveOpportunityRef(
  ctx: QueryCtx,
  opts: {
    value: Id<'orgOpportunities'> | null | undefined
    selfId: Id<'orgOpportunities'>
    selfOrgId: Id<'organizations'>
    label: string
  },
): Promise<
  { set: true; value: Id<'orgOpportunities'> | undefined } | { set: false }
> {
  if (opts.value === undefined) return { set: false }
  if (opts.value === null) return { set: true, value: undefined }
  if (opts.value === opts.selfId) {
    throw new ConvexError(`Cannot set an opportunity as its own ${opts.label}`)
  }
  const target = await ctx.db.get('orgOpportunities', opts.value)
  if (!target) throw new ConvexError(`${opts.label} not found`)
  if (target.orgId !== opts.selfOrgId) {
    throw new ConvexError(`${opts.label} must be in the same organization`)
  }
  return { set: true, value: opts.value }
}

const opportunityReturnValidator = v.object({
  _id: v.id('orgOpportunities'),
  _creationTime: v.number(),
  orgId: v.id('organizations'),
  title: v.string(),
  description: v.string(),
  type: v.union(
    v.literal('course'),
    v.literal('fellowship'),
    v.literal('job'),
    v.literal('other'),
  ),
  status: v.union(v.literal('active'), v.literal('closed'), v.literal('draft')),
  deadline: v.optional(v.number()),
  externalUrl: v.optional(v.string()),
  featured: v.boolean(),
  formFields: v.optional(v.any()),
  // Every field added to the orgOpportunities schema must also be listed here:
  // this validator is strict, so a missing one makes `get` throw at runtime.
  // That is what took /admin/opportunities down on 3-jul.
  slug: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  isEOI: v.optional(v.boolean()),
  emailTemplateSetId: v.optional(v.id('emailTemplateSets')),
  sendApplicationReceivedEmail: v.optional(v.boolean()),
  redirectOpportunityId: v.optional(v.id('orgOpportunities')),
  sourceOpportunityId: v.optional(v.id('orgOpportunities')),
  archivedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})

const baishCourseKeyValidator = v.union(
  v.literal('technical_ai_safety_course'),
  v.literal('technical_ai_safety_project'),
  v.literal('frontier_ai_governance'),
)

const baishCourseOpportunityReturnValidator = v.object({
  opportunityId: v.id('orgOpportunities'),
  courseKey: baishCourseKeyValidator,
  title: v.string(),
  description: v.string(),
  state: v.union(v.literal('eoi_open'), v.literal('applications_open')),
  applyUrlPath: v.string(),
  externalUrl: v.optional(v.string()),
  deadline: v.optional(v.number()),
  featured: v.boolean(),
})

// Get an opportunity by ID
export const get = query({
  args: { id: v.id('orgOpportunities') },
  returns: v.union(opportunityReturnValidator, v.null()),
  handler: async (ctx, { id }) => {
    const opp = await ctx.db.get('orgOpportunities', id)
    if (!opp) return null

    // Active opportunities are public
    if (opp.status === 'active') return opp

    // Draft/closed require org admin
    const userId = await getUserId(ctx)
    if (!userId) return null

    const membership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('orgId'), opp.orgId))
      .first()

    if (!membership || membership.role !== 'admin') return null
    return opp
  },
})

/**
 * Same access rules as `get`, but keyed by the readable slug or the raw id, so
 * the admin URL can carry a name instead of a hash. Ids keep working: bookmarks
 * and links pasted in Slack must not break.
 */
export const getByKey = query({
  args: { orgSlug: v.string(), key: v.string() },
  returns: v.union(opportunityReturnValidator, v.null()),
  handler: async (ctx, { orgSlug, key }) => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', orgSlug))
      .unique()
    if (!org) return null

    const asId = ctx.db.normalizeId('orgOpportunities', key)
    const opp = asId
      ? await ctx.db.get('orgOpportunities', asId)
      : await ctx.db
          .query('orgOpportunities')
          .withIndex('by_org_and_slug', (q) =>
            q.eq('orgId', org._id).eq('slug', key),
          )
          .first()

    if (!opp || opp.orgId !== org._id) return null
    if (opp.status === 'active') return opp

    const userId = await getUserId(ctx)
    if (!userId) return null
    const membership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('orgId'), opp.orgId))
      .first()
    if (!membership || membership.role !== 'admin') return null
    return opp
  },
})

const withRedirectReturnValidator = v.union(
  v.object({
    kind: v.literal('direct'),
    opportunity: opportunityReturnValidator,
  }),
  v.object({
    kind: v.literal('redirect'),
    originalTitle: v.string(),
    originalDescription: v.string(),
    opportunity: opportunityReturnValidator,
  }),
  v.null(),
)

/**
 * The apply page's resolver, keyed by either the readable slug or the raw id.
 *
 * Both work, permanently. Links already handed out point at the id, and a
 * closed EOI can be reopened at any time, so an old link must never 404 — but
 * everything ASTN generates from now on uses the slug.
 */
export const getWithRedirectByKey = query({
  args: { orgSlug: v.string(), key: v.string() },
  returns: withRedirectReturnValidator,
  handler: async (ctx, { orgSlug, key }) => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', orgSlug))
      .unique()
    if (!org) return null

    // An id is unambiguous, so try it first; anything else is a slug.
    const asId = ctx.db.normalizeId('orgOpportunities', key)
    const opp = asId
      ? await ctx.db.get('orgOpportunities', asId)
      : await ctx.db
          .query('orgOpportunities')
          .withIndex('by_org_and_slug', (q) =>
            q.eq('orgId', org._id).eq('slug', key),
          )
          .first()

    if (!opp || opp.orgId !== org._id) return null
    return await resolveRedirect(ctx, opp)
  },
})

// Get opportunity with redirect resolution (used by the public apply page)
export const getWithRedirect = query({
  args: { id: v.id('orgOpportunities') },
  returns: v.union(
    v.object({
      kind: v.literal('direct'),
      opportunity: opportunityReturnValidator,
    }),
    v.object({
      kind: v.literal('redirect'),
      originalTitle: v.string(),
      originalDescription: v.string(),
      opportunity: opportunityReturnValidator,
    }),
    v.null(),
  ),
  handler: async (ctx, { id }) => {
    const opp = await ctx.db.get('orgOpportunities', id)
    if (!opp) return null
    return await resolveRedirect(ctx, opp)
  },
})

/**
 * Shared body of the apply-page resolvers: serve an active opportunity, follow
 * one level of EOI redirect from a closed one, and otherwise fall through to
 * admin-only access so an admin can preview a draft.
 */
async function resolveRedirect(
  ctx: QueryCtx,
  opp: Doc<'orgOpportunities'>,
): Promise<
  | { kind: 'direct'; opportunity: Doc<'orgOpportunities'> }
  | {
      kind: 'redirect'
      originalTitle: string
      originalDescription: string
      opportunity: Doc<'orgOpportunities'>
    }
  | null
> {
  if (opp.status === 'active') {
    return { kind: 'direct' as const, opportunity: opp }
  }

  if (opp.redirectOpportunityId) {
    const target = await ctx.db.get(
      'orgOpportunities',
      opp.redirectOpportunityId,
    )
    if (target && target.status === 'active' && target.orgId === opp.orgId) {
      return {
        kind: 'redirect' as const,
        originalTitle: opp.title,
        originalDescription: opp.description,
        opportunity: target,
      }
    }
  }

  const userId = await getUserId(ctx)
  if (!userId) return null

  const membership = await ctx.db
    .query('orgMemberships')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .filter((q) => q.eq(q.field('orgId'), opp.orgId))
    .first()

  if (!membership || membership.role !== 'admin') return null
  return { kind: 'direct' as const, opportunity: opp }
}

// List active opportunities for an org
export const listByOrg = query({
  args: { orgId: v.id('organizations') },
  returns: v.array(opportunityReturnValidator),
  handler: async (ctx, { orgId }) => {
    return await ctx.db
      .query('orgOpportunities')
      .withIndex('by_org_and_status', (q) =>
        q.eq('orgId', orgId).eq('status', 'active'),
      )
      .collect()
  },
})

// Public: list BAISH course opportunities in the stable next-baish contract.
export const listBaishCourses = query({
  args: {},
  returns: v.array(baishCourseOpportunityReturnValidator),
  handler: async (ctx) => {
    const baishOrg = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', BAISH_ORG_SLUG))
      .unique()

    if (!baishOrg) return []

    const opportunities = await ctx.db
      .query('orgOpportunities')
      .withIndex('by_org_and_status', (q) =>
        q.eq('orgId', baishOrg._id).eq('status', 'active'),
      )
      .take(50)

    const courses: Array<
      BaishCourseOpportunityContract<Id<'orgOpportunities'>>
    > = []
    for (const opportunity of opportunities) {
      const course = toBaishCourseOpportunityContract(opportunity)
      if (course) courses.push(course)
    }

    return selectBaishCourseOpportunities(courses)
  },
})

// Get featured opportunity for an org (only active ones)
export const getFeatured = query({
  args: { orgId: v.id('organizations') },
  returns: v.union(opportunityReturnValidator, v.null()),
  handler: async (ctx, { orgId }) => {
    return await ctx.db
      .query('orgOpportunities')
      .withIndex('by_org_and_featured_and_status', (q) =>
        q.eq('orgId', orgId).eq('featured', true).eq('status', 'active'),
      )
      .first()
  },
})

// Admin: list all opportunities for an org (all statuses)
export const listAllByOrg = query({
  args: {
    orgId: v.id('organizations'),
    includeArchived: v.optional(v.boolean()),
  },
  returns: v.array(opportunityReturnValidator),
  handler: async (ctx, { orgId, includeArchived }) => {
    const userId = await getUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')

    const membership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('orgId'), orgId))
      .first()

    if (!membership || membership.role !== 'admin') {
      throw new ConvexError('Admin access required')
    }

    // Fetch all statuses by querying without the status filter
    const active = await ctx.db
      .query('orgOpportunities')
      .withIndex('by_org_and_status', (q) =>
        q.eq('orgId', orgId).eq('status', 'active'),
      )
      .collect()
    const closed = await ctx.db
      .query('orgOpportunities')
      .withIndex('by_org_and_status', (q) =>
        q.eq('orgId', orgId).eq('status', 'closed'),
      )
      .collect()
    const draft = await ctx.db
      .query('orgOpportunities')
      .withIndex('by_org_and_status', (q) =>
        q.eq('orgId', orgId).eq('status', 'draft'),
      )
      .collect()

    const all = [...active, ...closed, ...draft]
    return includeArchived ? all : all.filter((o) => o.archivedAt === undefined)
  },
})

// Internal: get opportunity by ID (for use by export action etc.)
export const getInternal = internalQuery({
  args: { id: v.id('orgOpportunities') },
  returns: v.union(opportunityReturnValidator, v.null()),
  handler: async (ctx, { id }) => {
    return await ctx.db.get('orgOpportunities', id)
  },
})

/**
 * What is attached to an opportunity, so a caller can be told what deleting it
 * would take with it. Shared by the web and the MCP so both refuse for the
 * same reasons.
 */
export async function opportunityAttachments(
  ctx: QueryCtx,
  id: Id<'orgOpportunities'>,
): Promise<{ applications: number; polls: number; surveys: number; emailsSent: number }> {
  const [applications, polls, surveys, emailsSent] = await Promise.all([
    ctx.db
      .query('opportunityApplications')
      .withIndex('by_opportunity_and_status', (q) => q.eq('opportunityId', id))
      .collect(),
    ctx.db
      .query('availabilityPolls')
      .withIndex('by_opportunity', (q) => q.eq('opportunityId', id))
      .collect(),
    ctx.db
      .query('feedbackSurveys')
      .withIndex('by_opportunity', (q) => q.eq('opportunityId', id))
      .collect(),
    ctx.db
      .query('emailLog')
      .withIndex('by_opportunity', (q) => q.eq('opportunityId', id))
      .collect(),
  ])
  return {
    applications: applications.length,
    // The default poll every opportunity ships with does not count as content:
    // it is ours, empty, and created automatically.
    polls: polls.filter((p) => p.status !== 'open' || p.title !== 'Availability')
      .length,
    surveys: surveys.length,
    emailsSent: emailsSent.length,
  }
}

/**
 * Archive or unarchive. Takes the opportunity out of the admin list without
 * touching anything that references it — the honest answer to "this is over,
 * stop showing it to me", which is what people reach for the delete button for.
 */
export const setArchived = mutation({
  args: { id: v.id('orgOpportunities'), archived: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { id, archived }) => {
    const opportunity = await ctx.db.get('orgOpportunities', id)
    if (!opportunity) throw new ConvexError('Opportunity not found')
    await requireOrgAdmin(ctx, opportunity.orgId)

    await ctx.db.patch('orgOpportunities', id, {
      archivedAt: archived ? Date.now() : undefined,
      updatedAt: Date.now(),
    })
    return null
  },
})

/**
 * Delete an opportunity — only when there is nothing to lose.
 *
 * There was never a delete for these: the table was created in Feb 2026 to let
 * people apply to the TAIS course, and polls, surveys, the email system and EOI
 * redirects were hung off it afterwards, until nine columns across five tables
 * pointed at it and nobody wanted to own the cascade.
 *
 * Writing that cascade would be the wrong fix anyway: it would destroy other
 * people's applications and survey answers, and orphan or erase emailLog rows —
 * the record of mail actually sent to real people. So this refuses whenever
 * anything is attached, names what is attached, and points at archiving. What it
 * does allow is deleting the duplicates and typos that should never have
 * existed, which is the other half of what people actually want.
 */
export const remove = mutation({
  args: { id: v.id('orgOpportunities') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const opportunity = await ctx.db.get('orgOpportunities', id)
    if (!opportunity) throw new ConvexError('Opportunity not found')
    await requireOrgAdmin(ctx, opportunity.orgId)

    const attached = await opportunityAttachments(ctx, id)
    const blocking = Object.entries(attached).filter(([, n]) => n > 0)
    if (blocking.length > 0) {
      throw new ConvexError(
        `Cannot delete: this opportunity has ${blocking
          .map(([k, n]) => `${n} ${k}`)
          .join(', ')}. Archive it instead — nothing is lost and it leaves the list.`,
      )
    }

    // Nothing references it, so the only rows to clean are the auto-created
    // default poll and its (empty) respondent list.
    const polls = await ctx.db
      .query('availabilityPolls')
      .withIndex('by_opportunity', (q) => q.eq('opportunityId', id))
      .collect()
    for (const poll of polls) {
      const respondents = await ctx.db
        .query('pollRespondents')
        .withIndex('by_poll', (q) => q.eq('pollId', poll._id))
        .collect()
      for (const r of respondents) {
        await ctx.db.delete('pollRespondents', r._id)
      }
      await ctx.db.delete('availabilityPolls', poll._id)
    }

    // Another opportunity may point here as its redirect target or pre-fill
    // source; clear those so nothing is left pointing at a hole.
    const siblings = await ctx.db
      .query('orgOpportunities')
      .withIndex('by_org_and_status', (q) => q.eq('orgId', opportunity.orgId))
      .collect()
    for (const s of siblings) {
      const patch: Record<string, unknown> = {}
      if (s.redirectOpportunityId === id) patch.redirectOpportunityId = undefined
      if (s.sourceOpportunityId === id) patch.sourceOpportunityId = undefined
      if (Object.keys(patch).length > 0)
        await ctx.db.patch('orgOpportunities', s._id, patch)
    }

    await ctx.db.delete('orgOpportunities', id)
    return null
  },
})

/**
 * Duplicate an opportunity (org admin only). Asked for by Koren on 15-ago:
 * opening next term's cohort meant rebuilding the whole application form by
 * hand, because tags only group opportunities and `sourceOpportunityId` only
 * pre-fills a returning applicant's answers — neither copies the setup.
 *
 * What carries over is the configuration: title (suffixed), description, type,
 * tags, form fields, the EOI flag and the linked email template set. What does
 * not is everything tied to the run that just happened — applications, polls,
 * surveys, the deadline, the featured flag and the redirect target. The copy is
 * born as a `draft` so nothing can go live by accident, and it records the
 * original in `sourceOpportunityId`, which is also what pre-fills answers for
 * applicants who already applied to the previous edition.
 */
export const duplicate = mutation({
  args: { id: v.id('orgOpportunities') },
  returns: v.id('orgOpportunities'),
  handler: async (ctx, { id }) => {
    const source = await ctx.db.get('orgOpportunities', id)
    if (!source) throw new ConvexError('Opportunity not found')

    await requireOrgAdmin(ctx, source.orgId)

    const now = Date.now()
    const title = `${source.title} (copy)`
    return await ctx.db.insert('orgOpportunities', {
      orgId: source.orgId,
      title,
      slug: await uniqueSlug(ctx, source.orgId, title),
      description: source.description,
      type: source.type,
      status: 'draft',
      featured: false,
      formFields: source.formFields,
      tags: source.tags,
      isEOI: source.isEOI,
      emailTemplateSetId: source.emailTemplateSetId,
      // Inherit the on-apply kill switch so a duplicated EOI does not start
      // emailing people the original deliberately kept quiet.
      sendApplicationReceivedEmail: source.sendApplicationReceivedEmail,
      externalUrl: source.externalUrl,
      sourceOpportunityId: source._id,
      createdAt: now,
      updatedAt: now,
    })
  },
})

/**
 * One-off: give every existing opportunity a slug derived from its title.
 * Idempotent — opportunities that already have one are skipped, so the same
 * slug is never reassigned and no live link changes meaning.
 */
export const backfillSlugs = internalMutation({
  args: {},
  returns: v.array(v.object({ title: v.string(), slug: v.string() })),
  handler: async (ctx) => {
    const all = await ctx.db.query('orgOpportunities').collect()
    const assigned: Array<{ title: string; slug: string }> = []
    for (const opp of all) {
      if (typeof opp.slug === 'string' && opp.slug) continue
      const slug = await uniqueSlug(ctx, opp.orgId, opp.title, opp._id)
      if (!slug) continue
      await ctx.db.patch('orgOpportunities', opp._id, { slug })
      assigned.push({ title: opp.title, slug })
    }
    return assigned
  },
})

/**
 * Create an opportunity with the invariants the web form enforces: sanitised
 * question keys, normalised tags, a unique readable slug, and the default
 * availability poll every opportunity ships with.
 *
 * Extracted so the MCP creates opportunities through exactly this code — a
 * generic insert would leave one with no slug and no poll.
 */
export async function createOpportunityFor(
  ctx: MutationCtx,
  args: {
    orgId: Id<'organizations'>
    createdBy: string
    title: string
    description: string
    type: 'course' | 'fellowship' | 'job' | 'other'
    status: 'active' | 'closed' | 'draft'
    deadline?: number
    externalUrl?: string
    featured: boolean
    formFields?: unknown
    tags?: Array<string>
    isEOI?: boolean
  },
): Promise<Id<'orgOpportunities'>> {
  const now = Date.now()
  const opportunityId = await ctx.db.insert('orgOpportunities', {
    orgId: args.orgId,
    title: args.title,
    description: args.description,
    type: args.type,
    status: args.status,
    deadline: args.deadline,
    externalUrl: args.externalUrl,
    featured: args.featured,
    ...(args.formFields !== undefined && {
      formFields: sanitizeFormFieldKeys(assertFormFieldsShape(args.formFields)),
    }),
    ...(args.tags !== undefined && { tags: normalizeTags(args.tags) }),
    isEOI: args.isEOI,
    slug: await uniqueSlug(ctx, args.orgId, args.title),
    createdAt: now,
    updatedAt: now,
  })

  // Auto-provision a default availability poll so every opportunity ships
  // with one (admins can reconfigure by deleting + recreating).
  await createDefaultPollForOpportunity(ctx, {
    opportunityId,
    orgId: args.orgId,
    createdBy: args.createdBy,
  })

  return opportunityId
}

/**
 * One-off: convert form fields imported from BlueDot to ASTN's own shape.
 *
 * Two "Facilitator Feedback" opportunities came in with `id`/`type` instead of
 * `key`/`kind` — the shape BlueDot used. Nothing reads them today because both
 * are drafts, but `DynamicFormRenderer` switches on `kind`, so publishing one
 * would render a form with no inputs. Idempotent: fields already in the modern
 * shape are untouched.
 */
export const migrateLegacyFormFieldShape = internalMutation({
  args: {},
  returns: v.array(
    v.object({ title: v.string(), converted: v.number() }),
  ),
  handler: async (ctx) => {
    const all = await ctx.db.query('orgOpportunities').collect()
    const out: Array<{ title: string; converted: number }> = []

    for (const opp of all) {
      const fields = opp.formFields
      if (!Array.isArray(fields)) continue

      let converted = 0
      const next = fields.map((f: Record<string, unknown>) => {
        if (!f || typeof f !== 'object' || Array.isArray(f)) return f
        const legacyKey = f.key === undefined && typeof f.id === 'string'
        const legacyKind = f.kind === undefined && typeof f.type === 'string'
        if (!legacyKey && !legacyKind) return f
        converted++
        const { id, type, ...rest } = f
        return {
          ...rest,
          key: legacyKey ? (id as string) : (f.key as string),
          kind: legacyKind ? (type as string) : (f.kind as string),
        }
      })

      if (converted > 0) {
        await ctx.db.patch('orgOpportunities', opp._id, {
          formFields: sanitizeFormFieldKeys(next),
          updatedAt: Date.now(),
        })
        out.push({ title: opp.title, converted })
      }
    }
    return out
  },
})

// Create an opportunity (org admin only)
export const create = mutation({
  args: {
    orgId: v.id('organizations'),
    title: v.string(),
    description: v.string(),
    type: v.union(
      v.literal('course'),
      v.literal('fellowship'),
      v.literal('job'),
      v.literal('other'),
    ),
    status: v.union(
      v.literal('active'),
      v.literal('closed'),
      v.literal('draft'),
    ),
    deadline: v.optional(v.number()),
    externalUrl: v.optional(v.string()),
    featured: v.boolean(),
    formFields: v.optional(v.any()),
    tags: v.optional(v.array(v.string())),
  },
  returns: v.id('orgOpportunities'),
  handler: async (ctx, args) => {
    const userId = await requireOrgAdmin(ctx, args.orgId)
    return await createOpportunityFor(ctx, { ...args, createdBy: userId })
  },
})

// Update an opportunity (org admin only)
export const update = mutation({
  args: {
    id: v.id('orgOpportunities'),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    type: v.optional(
      v.union(
        v.literal('course'),
        v.literal('fellowship'),
        v.literal('job'),
        v.literal('other'),
      ),
    ),
    status: v.optional(
      v.union(v.literal('active'), v.literal('closed'), v.literal('draft')),
    ),
    deadline: v.optional(v.number()),
    externalUrl: v.optional(v.string()),
    featured: v.optional(v.boolean()),
    formFields: v.optional(v.any()),
    // Required only when the new form drops questions people already answered.
    confirmDiscardsAnswers: v.optional(v.boolean()),
    slug: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
      isEOI: v.optional(v.boolean()),
    redirectOpportunityId: v.optional(
      v.union(v.id('orgOpportunities'), v.null()),
    ),
    sourceOpportunityId: v.optional(
      v.union(v.id('orgOpportunities'), v.null()),
    ),
  },
  returns: v.null(),
  handler: async (
    ctx,
    {
      id,
      redirectOpportunityId,
      sourceOpportunityId,
      confirmDiscardsAnswers,
      ...updates
    },
  ) => {
    const userId = await getUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')

    const opportunity = await ctx.db.get('orgOpportunities', id)
    if (!opportunity) throw new ConvexError('Opportunity not found')

    // Verify admin role
    const membership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('orgId'), opportunity.orgId))
      .first()

    if (!membership || membership.role !== 'admin') {
      throw new ConvexError('Admin access required')
    }

    const [redirect, source] = await Promise.all([
      resolveOpportunityRef(ctx, {
        value: redirectOpportunityId,
        selfId: id,
        selfOrgId: opportunity.orgId,
        label: 'Redirect target',
      }),
      resolveOpportunityRef(ctx, {
        value: sourceOpportunityId,
        selfId: id,
        selfOrgId: opportunity.orgId,
        label: 'Pre-fill source',
      }),
    ])

    const patch: Record<string, unknown> = {
      ...updates,
      updatedAt: Date.now(),
    }
    if (updates.formFields !== undefined) {
      const sanitized = sanitizeFormFieldKeys(
        assertFormFieldsShape(updates.formFields),
      )
      // Same rule the MCP applies: growing a form is free, shrinking it strands
      // answers already submitted. Say how many rather than either refusing
      // structural edits outright or dropping the data in silence.
      const impact = await impactOnApplications(
        ctx,
        id,
        (opportunity.formFields ?? []) as Array<FormField>,
        (Array.isArray(sanitized) ? sanitized : []) as Array<FormField>,
      )
      if (impact.affectedResponses > 0 && !confirmDiscardsAnswers) {
        throw new ConvexError(describeImpact(impact))
      }
      patch.formFields = sanitized
    }
    if (updates.tags !== undefined) patch.tags = normalizeTags(updates.tags)
    if (updates.slug !== undefined) {
      // Blank clears the alias; the id keeps working either way. A collision
      // gets suffixed rather than rejected — the admin is renaming a link, not
      // filling in a form field they can be scolded about.
      patch.slug = updates.slug.trim()
        ? await uniqueSlug(ctx, opportunity.orgId, updates.slug, id)
        : undefined
    }
    if (redirect.set) patch.redirectOpportunityId = redirect.value
    if (source.set) patch.sourceOpportunityId = source.value

    await ctx.db.patch('orgOpportunities', id, patch)
    return null
  },
})
