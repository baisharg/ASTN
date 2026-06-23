import { ConvexError, v } from 'convex/values'
import type { Id } from './_generated/dataModel'
import { internalQuery, mutation, query } from './_generated/server'
import type { QueryCtx } from './_generated/server'
import {
  BAISH_ORG_SLUG,
  selectBaishCourseOpportunities,
  toBaishCourseOpportunityContract,
  type BaishCourseOpportunityContract,
} from './lib/baishCourseOpportunities'
import { getUserId } from './lib/auth'
import { sanitizeFormFieldKeys } from './lib/formFields'

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
  tags: v.optional(v.array(v.string())),
  redirectOpportunityId: v.optional(v.id('orgOpportunities')),
  sourceOpportunityId: v.optional(v.id('orgOpportunities')),
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

    // Active opportunities are served directly
    if (opp.status === 'active') {
      return { kind: 'direct' as const, opportunity: opp }
    }

    // Closed/draft with redirect — resolve one level
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

    // Fall through: admin-only access
    const userId = await getUserId(ctx)
    if (!userId) return null

    const membership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('orgId'), opp.orgId))
      .first()

    if (!membership || membership.role !== 'admin') return null
    return { kind: 'direct' as const, opportunity: opp }
  },
})

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
  args: { orgId: v.id('organizations') },
  returns: v.array(opportunityReturnValidator),
  handler: async (ctx, { orgId }) => {
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

    return [...active, ...closed, ...draft]
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
    const userId = await getUserId(ctx)
    if (!userId) throw new ConvexError('Not authenticated')

    // Verify admin role
    const membership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('orgId'), args.orgId))
      .first()

    if (!membership || membership.role !== 'admin') {
      throw new ConvexError('Admin access required')
    }

    const now = Date.now()
    return await ctx.db.insert('orgOpportunities', {
      ...args,
      ...(args.formFields !== undefined && {
        formFields: sanitizeFormFieldKeys(args.formFields),
      }),
      ...(args.tags !== undefined && { tags: normalizeTags(args.tags) }),
      createdAt: now,
      updatedAt: now,
    })
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
    tags: v.optional(v.array(v.string())),
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
    { id, redirectOpportunityId, sourceOpportunityId, ...updates },
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
    if (updates.formFields !== undefined)
      patch.formFields = sanitizeFormFieldKeys(updates.formFields)
    if (updates.tags !== undefined) patch.tags = normalizeTags(updates.tags)
    if (redirect.set) patch.redirectOpportunityId = redirect.value
    if (source.set) patch.sourceOpportunityId = source.value

    await ctx.db.patch('orgOpportunities', id, patch)
    return null
  },
})
