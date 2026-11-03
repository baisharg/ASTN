import { ConvexError, v } from 'convex/values'
import { internalMutation, mutation, query } from '../_generated/server'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { getUserId, requireOrgAdminFor } from '../lib/auth'
import { requireOpportunityAccess } from '../lib/courseAccess'
import { courseOf } from '../lib/courses'
import type { AccessLevel } from '../lib/courseAccess'
import {
  assertOnlyKnownVariables,
  discardPendingDraftsForKind,
  usesCourseVariables,
  enqueueMissingDraftsForKind,
  refreshPendingDraftsForTemplate,
  syncOutboxOnStatusChange,
} from './outbox'

// Decision emails. Each opportunity that sends them links the org's canonical
// set (emailTemplateSetId), which holds exactly one template per kind, so a
// decision never hits a *missing* template: one that should send no email is
// `enabled: false`, an explicit choice. An opportunity customizes a kind for
// itself with an override, a row in the same table keyed by opportunityId.

export const EMAIL_KINDS = [
  'application_received',
  'accepted',
  'next_edition',
  'rejected',
  'redirected',
  'waitlisted',
] as const
export type EmailKind = (typeof EMAIL_KINDS)[number]

const emailKindValidator = v.union(
  v.literal('application_received'),
  v.literal('accepted'),
  v.literal('next_edition'),
  v.literal('rejected'),
  v.literal('redirected'),
  v.literal('waitlisted'),
)

// What the canonical holds until someone edits it in Canonicals. Valid (only
// {{applicant_name}}), so the emails are usable from the moment they exist.
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
  next_edition: {
    subject: 'A place for you in the next edition',
    markdownBody:
      'Hi {{applicant_name}},\n\nThank you for applying. We cannot fit you into this edition, but we have saved you a place in the next one — we will write to you when it opens.',
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

const DISABLED_BY_DEFAULT: ReadonlySet<EmailKind> = new Set([
  'waitlisted',
  'next_edition',
])

async function requireAdmin(
  ctx: QueryCtx | MutationCtx,
  orgId: Doc<'organizations'>['_id'],
): Promise<string> {
  const userId = await getUserId(ctx)
  if (!userId) throw new ConvexError('Not authenticated')
  await requireOrgAdminFor(ctx, userId, orgId)
  return userId
}

// Admins, or members with access to the opportunity's course.
async function requireAccess(
  ctx: QueryCtx | MutationCtx,
  opportunityId: Id<'orgOpportunities'>,
  level: AccessLevel,
): Promise<string> {
  const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
  if (!opportunity) throw new ConvexError('Opportunity not found')
  return await requireOpportunityAccess(ctx, opportunity, level)
}

const updateResultValidator = v.object({
  queued: v.number(),
  discarded: v.number(),
  keptEdited: v.number(),
})

type TemplateUpdate = {
  subject: string
  markdownBody: string
  enabled?: boolean
  includePollLink?: boolean
  includeSurveyLink?: boolean
}

// Saves a template and keeps the outbox in step. Returns what the change did
// to the pending queue, so the UI can say it out loud instead of silently
// adding or removing a dozen drafts.
async function applyTemplateUpdate(
  ctx: MutationCtx,
  template: Doc<'emailTemplates'>,
  {
    subject,
    markdownBody,
    enabled,
    includePollLink,
    includeSurveyLink,
  }: TemplateUpdate,
): Promise<{ queued: number; discarded: number; keptEdited: number }> {
  if (!subject.trim()) throw new ConvexError('Subject cannot be empty')
  // A typo'd {{variable}} is rejected here — it can never reach an applicant.
  assertOnlyKnownVariables(subject)
  assertOnlyKnownVariables(markdownBody)

  // A template that was off and is now on has a backlog: every decision of
  // this kind made while it was off queued nothing. Enabling it looks back.
  const turnedOn = template.enabled === false && enabled === true
  let queued = 0
  let discarded = 0
  let keptEdited = 0

  const now = Date.now()
  await ctx.db.patch('emailTemplates', template._id, {
    subject,
    markdownBody,
    ...(enabled !== undefined ? { enabled } : {}),
    ...(includePollLink !== undefined ? { includePollLink } : {}),
    ...(includeSurveyLink !== undefined ? { includeSurveyLink } : {}),
    updatedAt: now,
  })
  const scope = template.setId
    ? { setId: template.setId }
    : template.opportunityId
      ? { opportunityId: template.opportunityId }
      : null
  if (!scope) return { queued, discarded, keptEdited }
  if (template.setId) {
    await ctx.db.patch('emailTemplateSets', template.setId, { updatedAt: now })
  }
  // Bring already-queued drafts up to the new wording. Hand-edited ones are
  // left alone; nothing is sent.
  await refreshPendingDraftsForTemplate(ctx, { kind: template.kind, ...scope })
  if (turnedOn) {
    queued = await enqueueMissingDraftsForKind(ctx, {
      kind: template.kind,
      ...scope,
    })
  }
  // And the reverse: a kind that is off must not leave queued drafts behind.
  ;({ discarded, keptEdited } = await discardPendingDraftsForKind(ctx, {
    kind: template.kind,
    ...scope,
  }))
  return { queued, discarded, keptEdited }
}

// ── Per-opportunity view (Emails tab) ───────────────────────────────────────

// The effective templates (one per kind) for an opportunity: its override, else
// the canonical. Null when it does not use the canonical emails.
export const getEffectiveTemplates = query({
  args: { opportunityId: v.id('orgOpportunities') },
  returns: v.union(
    v.null(),
    v.object({
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
    await requireAccess(ctx, opportunity._id, 'read')

    const setId = opportunity.emailTemplateSetId
    if (!setId) return null

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
    return { templates }
  },
})

// Customize one template for this opportunity without touching the canonical.
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
  // What the toggle did to the pending queue, so the UI can say it out loud
  // instead of silently adding or removing a dozen drafts.
  returns: v.object({
    queued: v.number(),
    discarded: v.number(),
    keptEdited: v.number(),
  }),
  handler: async (ctx, args) => {
    const opportunity = await ctx.db.get('orgOpportunities', args.opportunityId)
    if (!opportunity) throw new ConvexError('Opportunity not found')
    await requireAccess(ctx, opportunity._id, 'edit')

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
    // Same look-back when an override goes from off to on. `existing` being
    // absent counts as off only if the set template it inherited was off too,
    // which resolveTemplate inside the helper takes care of.
    let queued = 0
    if (args.enabled && existing?.enabled === false)
      queued = await enqueueMissingDraftsForKind(ctx, {
        kind: args.kind,
        opportunityId: args.opportunityId,
      })
    const { discarded, keptEdited } = await discardPendingDraftsForKind(ctx, {
      kind: args.kind,
      opportunityId: args.opportunityId,
    })
    return { queued, discarded, keptEdited }
  },
})

// Remove this opportunity's customization for a kind (revert to the canonical).
export const clearOpportunityTemplate = mutation({
  args: {
    opportunityId: v.id('orgOpportunities'),
    kind: emailKindValidator,
  },
  returns: v.null(),
  handler: async (ctx, { opportunityId, kind }) => {
    const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
    if (!opportunity) throw new ConvexError('Opportunity not found')
    await requireAccess(ctx, opportunity._id, 'edit')

    const existing = await ctx.db
      .query('emailTemplates')
      .withIndex('by_opportunity_and_kind', (q) =>
        q.eq('opportunityId', opportunityId).eq('kind', kind),
      )
      .first()
    if (existing) await ctx.db.delete('emailTemplates', existing._id)
    // Reverting to the canonical changes the effective wording, so the drafts
    // that were tracking the override need to follow it back.
    await refreshPendingDraftsForTemplate(ctx, { kind, opportunityId })
    // Dropping an enabled override for a disabled canonical template flips the
    // effective answer to off, which the drafts have to follow.
    await discardPendingDraftsForKind(ctx, { kind, opportunityId })
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
    await requireAccess(ctx, opportunity._id, 'edit')
    await ctx.db.patch('orgOpportunities', opportunityId, {
      sendApplicationReceivedEmail: enabled,
      updatedAt: Date.now(),
    })
    return null
  },
})

// Turn the canonical emails on or off for an opportunity. Turning them on
// backfills drafts for decisions already made; idempotency (one sent email
// per application and kind) makes that safe to repeat, and nothing is sent
// without an explicit Send from the Outbox.
export const setUseCanonicalEmails = mutation({
  args: { opportunityId: v.id('orgOpportunities'), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { opportunityId, enabled }) => {
    const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
    if (!opportunity) throw new ConvexError('Opportunity not found')
    await requireAccess(ctx, opportunity._id, 'edit')

    let setId: Id<'emailTemplateSets'> | undefined
    if (enabled) {
      const set = await canonicalSetOf(ctx, opportunity.orgId)
      if (!set) {
        throw new ConvexError(
          'There are no canonical emails yet. Save them in Canonicals first.',
        )
      }
      if (
        !courseOf(opportunity.tags) &&
        (await setUsesCourseVariables(ctx, set._id))
      ) {
        throw new ConvexError(
          'These emails name the course ({{course}}). Choose the opportunity’s course first.',
        )
      }
      setId = set._id
    }
    await ctx.db.patch('orgOpportunities', opportunityId, {
      emailTemplateSetId: setId,
      updatedAt: Date.now(),
    })
    if (setId) await syncAllApplications(ctx, opportunityId)
    return null
  },
})

async function syncAllApplications(
  ctx: MutationCtx,
  opportunityId: Id<'orgOpportunities'>,
): Promise<void> {
  const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
  if (!opportunity) return
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
      opportunity,
    })
  }
}

/**
 * One-off: retire every set that is not the canonical. Each opportunity that
 * linked one keeps its emails as its own overrides (kinds it had already
 * customized stay as they were) and links the canonical instead; those in
 * `fromCanonical` take the canonical as is, with no overrides. Then the
 * retired sets and their templates are deleted. Idempotent. With `dryRun`,
 * only reports.
 */
export const retireLibrarySets = internalMutation({
  args: {
    orgId: v.id('organizations'),
    fromCanonical: v.array(v.id('orgOpportunities')),
    dryRun: v.boolean(),
  },
  returns: v.any(),
  handler: async (ctx, { orgId, fromCanonical, dryRun }) => {
    const canonical = await canonicalSetOf(ctx, orgId)
    if (!canonical) throw new ConvexError('The org has no canonical emails')
    const sets = await ctx.db
      .query('emailTemplateSets')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()
    const retired = sets.filter((s) => s._id !== canonical._id)
    const retiredIds = new Set<string>(retired.map((s) => s._id))
    const opportunities = await ctx.db
      .query('orgOpportunities')
      .withIndex('by_org_and_status', (q) => q.eq('orgId', orgId))
      .collect()
    const fresh = new Set<string>(fromCanonical)
    const report: Array<{ title: string; from: string; copied: number }> = []

    for (const opportunity of opportunities) {
      const setId = opportunity.emailTemplateSetId
      if (!setId || !retiredIds.has(setId)) continue
      let copied = 0
      if (!fresh.has(opportunity._id)) {
        const templates = await ctx.db
          .query('emailTemplates')
          .withIndex('by_set_and_kind', (q) => q.eq('setId', setId))
          .collect()
        for (const t of templates) {
          const override = await ctx.db
            .query('emailTemplates')
            .withIndex('by_opportunity_and_kind', (q) =>
              q.eq('opportunityId', opportunity._id).eq('kind', t.kind),
            )
            .first()
          if (override) continue
          copied++
          if (dryRun) continue
          await ctx.db.insert('emailTemplates', {
            orgId,
            opportunityId: opportunity._id,
            kind: t.kind,
            enabled: t.enabled,
            subject: t.subject,
            markdownBody: t.markdownBody,
            includePollLink: t.includePollLink,
            includeSurveyLink: t.includeSurveyLink,
            updatedAt: Date.now(),
          })
        }
      }
      report.push({
        title: opportunity.title,
        from: retired.find((s) => s._id === setId)?.name ?? '',
        copied,
      })
      if (dryRun) continue
      await ctx.db.patch('orgOpportunities', opportunity._id, {
        emailTemplateSetId: canonical._id,
      })
      if (fresh.has(opportunity._id)) {
        // Its pending drafts follow the new wording, and kinds the old set
        // had off get drafts for decisions already made.
        for (const kind of EMAIL_KINDS) {
          await refreshPendingDraftsForTemplate(ctx, {
            kind,
            opportunityId: opportunity._id,
          })
        }
        await syncAllApplications(ctx, opportunity._id)
      }
    }

    let templatesDeleted = 0
    for (const set of retired) {
      const templates = await ctx.db
        .query('emailTemplates')
        .withIndex('by_set_and_kind', (q) => q.eq('setId', set._id))
        .collect()
      templatesDeleted += templates.length
      if (dryRun) continue
      for (const t of templates) await ctx.db.delete('emailTemplates', t._id)
      await ctx.db.delete('emailTemplateSets', set._id)
    }

    const savedForms = await ctx.db
      .query('formTemplates')
      .withIndex('by_org_and_kind', (q) => q.eq('orgId', orgId))
      .collect()
    if (!dryRun) {
      for (const f of savedForms) await ctx.db.delete('formTemplates', f._id)
    }

    return {
      dryRun,
      opportunities: report,
      setsDeleted: retired.map((s) => s.name),
      templatesDeleted,
      savedFormsDeleted: savedForms.length,
    }
  },
})

async function setUsesCourseVariables(
  ctx: QueryCtx | MutationCtx,
  setId: Id<'emailTemplateSets'>,
): Promise<boolean> {
  const templates = await ctx.db
    .query('emailTemplates')
    .withIndex('by_set_and_kind', (q) => q.eq('setId', setId))
    .collect()
  return templates.some(
    (t) =>
      t.enabled !== false &&
      (usesCourseVariables(t.subject) || usesCourseVariables(t.markdownBody)),
  )
}

// ── Canonical emails ────────────────────────────────────────────────────────
//
// One set per org is the canonical: Canonicals → Emails edits it, and every
// new course edition links it (createOpportunityFor), with {{course}} and
// {{area}} filled from its course tag. An edition still customizes a single
// email for itself from its Emails tab. The org's footer, appended to every
// email it sends, is edited on the same page.

export async function canonicalSetOf(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
): Promise<Doc<'emailTemplateSets'> | null> {
  const sets = await ctx.db
    .query('emailTemplateSets')
    .withIndex('by_org', (q) => q.eq('orgId', orgId))
    .collect()
  return sets.find((s) => s.isCanonical === true) ?? null
}

/**
 * The set a new opportunity links: the canonical, for course editions whose
 * course fills its variables. Nothing for EOIs and custom forms, which have no
 * decisions to announce.
 */
export async function canonicalSetFor(
  ctx: QueryCtx | MutationCtx,
  opts: {
    orgId: Id<'organizations'>
    formSource: 'course' | 'eoi' | 'custom'
    tags: ReadonlyArray<string> | undefined
  },
): Promise<Id<'emailTemplateSets'> | undefined> {
  if (opts.formSource !== 'course') return undefined
  const set = await canonicalSetOf(ctx, opts.orgId)
  if (!set) return undefined
  if (!courseOf(opts.tags) && (await setUsesCourseVariables(ctx, set._id))) {
    return undefined
  }
  return set._id
}

const canonicalEmailValidator = v.object({
  kind: emailKindValidator,
  enabled: v.boolean(),
  subject: v.string(),
  markdownBody: v.string(),
  includePollLink: v.boolean(),
  includeSurveyLink: v.boolean(),
})

/** The canonical emails, one per kind, and the footer. */
export const getCanonical = query({
  args: { orgId: v.id('organizations') },
  returns: v.object({
    footer: v.string(),
    emails: v.array(canonicalEmailValidator),
  }),
  handler: async (ctx, { orgId }) => {
    await requireAdmin(ctx, orgId)
    const set = await canonicalSetOf(ctx, orgId)
    const rows = set
      ? await ctx.db
          .query('emailTemplates')
          .withIndex('by_set_and_kind', (q) => q.eq('setId', set._id))
          .collect()
      : []
    const org = await ctx.db.get('organizations', orgId)
    return {
      footer: org?.emailFooter ?? '',
      emails: EMAIL_KINDS.map((kind) => {
        const row = rows.find((t) => t.kind === kind)
        return {
          kind,
          enabled: row ? (row.enabled ?? true) : !DISABLED_BY_DEFAULT.has(kind),
          subject: row?.subject ?? DEFAULT_TEMPLATES[kind].subject,
          markdownBody:
            row?.markdownBody ?? DEFAULT_TEMPLATES[kind].markdownBody,
          includePollLink: row?.includePollLink ?? false,
          includeSurveyLink: row?.includeSurveyLink ?? false,
        }
      }),
    }
  },
})

/**
 * Save one canonical email. The org's canonical set is created on the first
 * save, so new course editions only start linking it once someone wrote it.
 */
export const saveCanonicalEmail = mutation({
  args: {
    orgId: v.id('organizations'),
    kind: emailKindValidator,
    subject: v.string(),
    markdownBody: v.string(),
    enabled: v.boolean(),
    includePollLink: v.boolean(),
    includeSurveyLink: v.boolean(),
  },
  returns: updateResultValidator,
  handler: async (ctx, { orgId, kind, ...update }) => {
    const userId = await requireAdmin(ctx, orgId)
    let setId = (await canonicalSetOf(ctx, orgId))?._id
    if (!setId) {
      const now = Date.now()
      setId = await ctx.db.insert('emailTemplateSets', {
        orgId,
        name: 'Canonical',
        isCanonical: true,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      })
      for (const k of EMAIL_KINDS) {
        await ctx.db.insert('emailTemplates', {
          orgId,
          setId,
          kind: k,
          enabled: !DISABLED_BY_DEFAULT.has(k),
          subject: DEFAULT_TEMPLATES[k].subject,
          markdownBody: DEFAULT_TEMPLATES[k].markdownBody,
          includePollLink: false,
          includeSurveyLink: false,
          updatedAt: now,
        })
      }
    }
    const template = await ctx.db
      .query('emailTemplates')
      .withIndex('by_set_and_kind', (q) =>
        q.eq('setId', setId).eq('kind', kind),
      )
      .first()
    if (!template) throw new ConvexError('Template not found')
    return await applyTemplateUpdate(ctx, template, update)
  },
})

export const saveFooter = mutation({
  args: { orgId: v.id('organizations'), footer: v.string() },
  returns: v.null(),
  handler: async (ctx, { orgId, footer }) => {
    await requireAdmin(ctx, orgId)
    if (footer.length > 2000) {
      throw new ConvexError('Keep the footer under 2000 characters.')
    }
    await ctx.db.patch('organizations', orgId, {
      emailFooter: footer.trim() || undefined,
    })
    return null
  },
})
