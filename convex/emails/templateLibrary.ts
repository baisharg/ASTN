import { ConvexError, v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { getUserId, requireOrgAdminFor } from '../lib/auth'
import {
  assertOnlyKnownVariables,
  refreshPendingDraftsForTemplate,
  syncOutboxOnStatusChange,
} from './outbox'

// Org-level library of email template sets (issue #20). A set (e.g. "TAIS",
// "Governance") holds exactly one template per kind — the five rows are
// created together with the set, so a linked opportunity can never hit a
// *missing* template: a decision that should send no email is expressed by
// `enabled: false`, an explicit choice (waitlisted starts disabled).
// Opportunities link a set via emailTemplateSetId and inherit everything;
// per-opportunity overrides live in the same table keyed by opportunityId
// (phase 2 UI).

export const EMAIL_KINDS = [
  'application_received',
  'accepted',
  'rejected',
  'redirected',
  'waitlisted',
] as const
export type EmailKind = (typeof EMAIL_KINDS)[number]

const emailKindValidator = v.union(
  v.literal('application_received'),
  v.literal('accepted'),
  v.literal('rejected'),
  v.literal('redirected'),
  v.literal('waitlisted'),
)

// Skeleton content for a new set. Orgs edit these; they are valid (only
// {{applicant_name}}) so a set is usable from the moment it exists.
const DEFAULT_TEMPLATES: Record<
  EmailKind,
  { subject: string; markdownBody: string }
> = {
  application_received: {
    subject: 'We received your application',
    markdownBody:
      'Hi {{applicant_name}},\n\nThanks for applying! We received your application and will get back to you soon.',
  },
  accepted: {
    subject: 'Welcome — you have been accepted!',
    markdownBody:
      'Hi {{applicant_name}},\n\nCongratulations! You have been accepted. We will follow up shortly with next steps.',
  },
  rejected: {
    subject: 'Update on your application',
    markdownBody:
      'Hi {{applicant_name}},\n\nThank you for applying. Unfortunately we cannot offer you a place this time. We encourage you to apply to future cohorts.',
  },
  redirected: {
    subject: 'A better fit for you',
    markdownBody:
      'Hi {{applicant_name}},\n\nThank you for applying. Based on your application, we think a different course would be a better starting point for you — we will share the details with you.',
  },
  waitlisted: {
    subject: 'You are on the waitlist',
    markdownBody:
      'Hi {{applicant_name}},\n\nThank you for applying. You are currently on the waitlist — we will let you know as soon as a spot opens up.',
  },
}

async function requireAdmin(
  ctx: QueryCtx | MutationCtx,
  orgId: Doc<'organizations'>['_id'],
): Promise<string> {
  const userId = await getUserId(ctx)
  if (!userId) throw new ConvexError('Not authenticated')
  await requireOrgAdminFor(ctx, userId, orgId)
  return userId
}

// ── Library ─────────────────────────────────────────────────────────────────

export const listSets = query({
  args: { orgId: v.id('organizations') },
  returns: v.array(
    v.object({
      _id: v.id('emailTemplateSets'),
      name: v.string(),
      updatedAt: v.number(),
      templates: v.array(
        v.object({
          _id: v.id('emailTemplates'),
          kind: emailKindValidator,
          enabled: v.boolean(),
          subject: v.string(),
          markdownBody: v.string(),
          includePollLink: v.boolean(),
          includeSurveyLink: v.boolean(),
          updatedAt: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx, { orgId }) => {
    await requireAdmin(ctx, orgId)
    const sets = await ctx.db
      .query('emailTemplateSets')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()

    const out = []
    for (const set of sets) {
      const templates = await ctx.db
        .query('emailTemplates')
        .withIndex('by_set_and_kind', (q) => q.eq('setId', set._id))
        .collect()
      out.push({
        _id: set._id,
        name: set.name,
        updatedAt: set.updatedAt,
        templates: templates.map((t) => ({
          _id: t._id,
          kind: t.kind,
          enabled: t.enabled ?? true,
          subject: t.subject,
          markdownBody: t.markdownBody,
          includePollLink: t.includePollLink ?? false,
          includeSurveyLink: t.includeSurveyLink ?? false,
          updatedAt: t.updatedAt,
        })),
      })
    }
    return out
  },
})

// Creates the set together with all five kind templates — a set with missing
// templates is unrepresentable.
export const createSet = mutation({
  args: { orgId: v.id('organizations'), name: v.string() },
  returns: v.id('emailTemplateSets'),
  handler: async (ctx, { orgId, name }) => {
    const userId = await requireAdmin(ctx, orgId)
    if (!name.trim()) throw new ConvexError('Name cannot be empty')

    const now = Date.now()
    const setId = await ctx.db.insert('emailTemplateSets', {
      orgId,
      name: name.trim(),
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    for (const kind of EMAIL_KINDS) {
      await ctx.db.insert('emailTemplates', {
        orgId,
        setId,
        kind,
        // Waitlist is rarely used — starts disabled (an explicit off, not a
        // missing template). Enable it from the set editor when needed.
        enabled: kind !== 'waitlisted',
        subject: DEFAULT_TEMPLATES[kind].subject,
        markdownBody: DEFAULT_TEMPLATES[kind].markdownBody,
        includePollLink: false,
        includeSurveyLink: false,
        updatedAt: now,
      })
    }
    return setId
  },
})

export const renameSet = mutation({
  args: { setId: v.id('emailTemplateSets'), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { setId, name }) => {
    const set = await ctx.db.get('emailTemplateSets', setId)
    if (!set) throw new ConvexError('Set not found')
    await requireAdmin(ctx, set.orgId)
    if (!name.trim()) throw new ConvexError('Name cannot be empty')
    await ctx.db.patch('emailTemplateSets', setId, {
      name: name.trim(),
      updatedAt: Date.now(),
    })
    return null
  },
})

// Deleting a set that opportunities still link to is not allowed — the system
// refuses rather than leaving opportunities silently template-less.
export const deleteSet = mutation({
  args: { setId: v.id('emailTemplateSets') },
  returns: v.null(),
  handler: async (ctx, { setId }) => {
    const set = await ctx.db.get('emailTemplateSets', setId)
    if (!set) return null
    await requireAdmin(ctx, set.orgId)

    const opportunities = await ctx.db
      .query('orgOpportunities')
      .withIndex('by_org_and_status', (q) => q.eq('orgId', set.orgId))
      .collect()
    const linked = opportunities.filter((o) => o.emailTemplateSetId === setId)
    if (linked.length > 0) {
      throw new ConvexError(
        `This set is linked to ${linked.length} opportunit${
          linked.length === 1 ? 'y' : 'ies'
        } (e.g. "${linked[0].title}"). Unlink them first.`,
      )
    }

    const templates = await ctx.db
      .query('emailTemplates')
      .withIndex('by_set_and_kind', (q) => q.eq('setId', setId))
      .collect()
    for (const t of templates) {
      await ctx.db.delete('emailTemplates', t._id)
    }
    await ctx.db.delete('emailTemplateSets', setId)
    return null
  },
})

export const updateTemplate = mutation({
  args: {
    templateId: v.id('emailTemplates'),
    subject: v.string(),
    markdownBody: v.string(),
    enabled: v.optional(v.boolean()),
    includePollLink: v.optional(v.boolean()),
    includeSurveyLink: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (
    ctx,
    {
      templateId,
      subject,
      markdownBody,
      enabled,
      includePollLink,
      includeSurveyLink,
    },
  ) => {
    const template = await ctx.db.get('emailTemplates', templateId)
    if (!template) throw new ConvexError('Template not found')
    await requireAdmin(ctx, template.orgId)

    if (!subject.trim()) throw new ConvexError('Subject cannot be empty')
    // A typo'd {{variable}} is rejected here — it can never reach an applicant.
    assertOnlyKnownVariables(subject)
    assertOnlyKnownVariables(markdownBody)

    const now = Date.now()
    await ctx.db.patch('emailTemplates', templateId, {
      subject,
      markdownBody,
      ...(enabled !== undefined ? { enabled } : {}),
      ...(includePollLink !== undefined ? { includePollLink } : {}),
      ...(includeSurveyLink !== undefined ? { includeSurveyLink } : {}),
      updatedAt: now,
    })
    if (template.setId) {
      await ctx.db.patch('emailTemplateSets', template.setId, {
        updatedAt: now,
      })
      // Bring already-queued drafts up to the new wording. Hand-edited ones are
      // left alone; nothing is sent.
      await refreshPendingDraftsForTemplate(ctx, {
        kind: template.kind,
        setId: template.setId,
      })
    } else if (template.opportunityId) {
      await refreshPendingDraftsForTemplate(ctx, {
        kind: template.kind,
        opportunityId: template.opportunityId,
      })
    }
    return null
  },
})

// ── Per-opportunity view (Emails tab) ───────────────────────────────────────

// The five effective templates for an opportunity: override → set template.
// Returns null when no set is linked (outbox system inactive).
export const getEffectiveTemplates = query({
  args: { opportunityId: v.id('orgOpportunities') },
  returns: v.union(
    v.null(),
    v.object({
      setId: v.id('emailTemplateSets'),
      setName: v.string(),
      templates: v.array(
        v.object({
          kind: emailKindValidator,
          enabled: v.boolean(),
          subject: v.string(),
          markdownBody: v.string(),
          includePollLink: v.boolean(),
          includeSurveyLink: v.boolean(),
          overridden: v.boolean(),
        }),
      ),
    }),
  ),
  handler: async (ctx, { opportunityId }) => {
    const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
    if (!opportunity) throw new ConvexError('Opportunity not found')
    await requireAdmin(ctx, opportunity.orgId)

    const setId = opportunity.emailTemplateSetId
    if (!setId) return null
    const set = await ctx.db.get('emailTemplateSets', setId)
    if (!set) return null

    const templates = []
    for (const kind of EMAIL_KINDS) {
      const override = await ctx.db
        .query('emailTemplates')
        .withIndex('by_opportunity_and_kind', (q) =>
          q.eq('opportunityId', opportunityId).eq('kind', kind),
        )
        .first()
      const base = override
        ? null
        : await ctx.db
            .query('emailTemplates')
            .withIndex('by_set_and_kind', (q) =>
              q.eq('setId', setId).eq('kind', kind),
            )
            .first()
      const t = override ?? base
      if (!t) continue
      templates.push({
        kind,
        enabled: t.enabled ?? true,
        subject: t.subject,
        markdownBody: t.markdownBody,
        includePollLink: t.includePollLink ?? false,
        includeSurveyLink: t.includeSurveyLink ?? false,
        overridden: override != null,
      })
    }
    return { setId, setName: set.name, templates }
  },
})

// Customize one template for this opportunity without touching the set.
export const upsertOpportunityTemplate = mutation({
  args: {
    opportunityId: v.id('orgOpportunities'),
    kind: emailKindValidator,
    subject: v.string(),
    markdownBody: v.string(),
    enabled: v.boolean(),
    includePollLink: v.boolean(),
    includeSurveyLink: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const opportunity = await ctx.db.get('orgOpportunities', args.opportunityId)
    if (!opportunity) throw new ConvexError('Opportunity not found')
    await requireAdmin(ctx, opportunity.orgId)

    if (!args.subject.trim()) throw new ConvexError('Subject cannot be empty')
    assertOnlyKnownVariables(args.subject)
    assertOnlyKnownVariables(args.markdownBody)

    const now = Date.now()
    const existing = await ctx.db
      .query('emailTemplates')
      .withIndex('by_opportunity_and_kind', (q) =>
        q.eq('opportunityId', args.opportunityId).eq('kind', args.kind),
      )
      .first()
    const fields = {
      enabled: args.enabled,
      subject: args.subject,
      markdownBody: args.markdownBody,
      includePollLink: args.includePollLink,
      includeSurveyLink: args.includeSurveyLink,
      updatedAt: now,
    }
    if (existing) {
      await ctx.db.patch('emailTemplates', existing._id, fields)
    } else {
      await ctx.db.insert('emailTemplates', {
        orgId: opportunity.orgId,
        opportunityId: args.opportunityId,
        kind: args.kind,
        ...fields,
      })
    }
    await refreshPendingDraftsForTemplate(ctx, {
      kind: args.kind,
      opportunityId: args.opportunityId,
    })
    return null
  },
})

// Remove this opportunity's customization for a kind (revert to the set).
export const clearOpportunityTemplate = mutation({
  args: {
    opportunityId: v.id('orgOpportunities'),
    kind: emailKindValidator,
  },
  returns: v.null(),
  handler: async (ctx, { opportunityId, kind }) => {
    const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
    if (!opportunity) throw new ConvexError('Opportunity not found')
    await requireAdmin(ctx, opportunity.orgId)

    const existing = await ctx.db
      .query('emailTemplates')
      .withIndex('by_opportunity_and_kind', (q) =>
        q.eq('opportunityId', opportunityId).eq('kind', kind),
      )
      .first()
    if (existing) await ctx.db.delete('emailTemplates', existing._id)
    // Reverting to the set changes the effective wording, so the drafts that
    // were tracking the override need to follow it back.
    await refreshPendingDraftsForTemplate(ctx, { kind, opportunityId })
    return null
  },
})

// On-apply confirmation kill switch. Never sends retroactively — the email
// only ever fires at submission time, so toggling has no effect on existing
// applications by construction.
export const setSendApplicationReceivedEmail = mutation({
  args: {
    opportunityId: v.id('orgOpportunities'),
    enabled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, { opportunityId, enabled }) => {
    const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
    if (!opportunity) throw new ConvexError('Opportunity not found')
    await requireAdmin(ctx, opportunity.orgId)
    await ctx.db.patch('orgOpportunities', opportunityId, {
      sendApplicationReceivedEmail: enabled,
      updatedAt: Date.now(),
    })
    return null
  },
})

// Link (or unlink, with setId omitted) an opportunity to a template set.
// Linking activates the outbox system for that opportunity and backfills
// drafts for decisions that were made before the set existed — idempotency
// (one sent email per application+kind) makes this safe to repeat, and
// nothing is ever sent without an explicit Send from the outbox.
export const setOpportunityTemplateSet = mutation({
  args: {
    opportunityId: v.id('orgOpportunities'),
    setId: v.optional(v.id('emailTemplateSets')),
  },
  returns: v.null(),
  handler: async (ctx, { opportunityId, setId }) => {
    const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
    if (!opportunity) throw new ConvexError('Opportunity not found')
    await requireAdmin(ctx, opportunity.orgId)

    if (setId) {
      const set = await ctx.db.get('emailTemplateSets', setId)
      if (!set || set.orgId !== opportunity.orgId) {
        throw new ConvexError('Template set not found')
      }
    }
    await ctx.db.patch('orgOpportunities', opportunityId, {
      emailTemplateSetId: setId,
      updatedAt: Date.now(),
    })

    if (setId) {
      const updated = await ctx.db.get('orgOpportunities', opportunityId)
      if (updated) {
        const applications = await ctx.db
          .query('opportunityApplications')
          .withIndex('by_opportunity_and_status', (q) =>
            q.eq('opportunityId', opportunityId),
          )
          .collect()
        for (const application of applications) {
          await syncOutboxOnStatusChange(ctx, {
            application,
            status: application.status,
            opportunity: updated,
          })
        }
      }
    }
    return null
  },
})
