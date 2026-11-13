import { ConvexError, v } from 'convex/values'
import { internalMutation, mutation, query } from '../_generated/server'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { getUserId, requireOrgAdminFor } from '../lib/auth'
import { requireOpportunityAccess } from '../lib/courseAccess'
import type { AccessLevel } from '../lib/courseAccess'
import { coursePlaceholderValues, fillText } from '../canonicalForms'
import type { FormSource } from '../canonicalForms'
import {
  assertOnlyKnownVariables,
  discardPendingDraftsForKind,
  enqueueMissingDraftsForKind,
  refreshPendingDraftsForTemplate,
  usesOwnEmails,
} from './outbox'

// Each opportunity owns its six emails: rows in emailTemplates keyed by
// opportunityId, one per kind, copied from the org's canonical emails when the
// opportunity is created, with {{course}} and {{area}} filled from its course
// tag. From then on the copy is the opportunity's, like its form: editing it
// never touches the canonical, editing the canonical never reaches it, and
// "Revert to canonical" brings the canonical's current text back. A kind that
// sends no email is `enabled: false`, an explicit choice, never a missing row.
// The canonical itself lives in the org's one emailTemplateSets row (rows
// keyed by setId) and is edited only in Canonicals.

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

type EmailContent = {
  kind: EmailKind
  enabled: boolean
  subject: string
  markdownBody: string
  includePollLink: boolean
  includeSurveyLink: boolean
}

const emailContentValidator = v.object({
  kind: emailKindValidator,
  enabled: v.boolean(),
  subject: v.string(),
  markdownBody: v.string(),
  includePollLink: v.boolean(),
  includeSurveyLink: v.boolean(),
})

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

async function ownTemplate(
  ctx: QueryCtx | MutationCtx,
  opportunityId: Id<'orgOpportunities'>,
  kind: EmailKind,
): Promise<Doc<'emailTemplates'> | null> {
  return await ctx.db
    .query('emailTemplates')
    .withIndex('by_opportunity_and_kind', (q) =>
      q.eq('opportunityId', opportunityId).eq('kind', kind),
    )
    .first()
}

// ── Canonical emails ────────────────────────────────────────────────────────

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

/** The canonical emails, one per kind: the org's rows, or the defaults. */
async function canonicalEmailsOf(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
): Promise<Array<EmailContent>> {
  const set = await canonicalSetOf(ctx, orgId)
  const rows = set
    ? await ctx.db
        .query('emailTemplates')
        .withIndex('by_set_and_kind', (q) => q.eq('setId', set._id))
        .collect()
    : []
  return EMAIL_KINDS.map((kind) => {
    const row = rows.find((t) => t.kind === kind)
    return {
      kind,
      enabled: row ? (row.enabled ?? true) : !DISABLED_BY_DEFAULT.has(kind),
      subject: row?.subject ?? DEFAULT_TEMPLATES[kind].subject,
      markdownBody: row?.markdownBody ?? DEFAULT_TEMPLATES[kind].markdownBody,
      includePollLink: row?.includePollLink ?? false,
      includeSurveyLink: row?.includeSurveyLink ?? false,
    }
  })
}

/** The canonical emails as an opportunity receives them: its course filled in. */
async function canonicalEmailsFor(
  ctx: QueryCtx | MutationCtx,
  opportunity: {
    orgId: Id<'organizations'>
    tags?: ReadonlyArray<string> | undefined
  },
): Promise<Array<EmailContent>> {
  const values = coursePlaceholderValues(opportunity.tags)
  return (await canonicalEmailsOf(ctx, opportunity.orgId)).map((email) => ({
    ...email,
    subject: fillText(email.subject, values),
    markdownBody: fillText(email.markdownBody, values),
  }))
}

/**
 * Give a new opportunity its six emails: a copy of the canonical with its
 * course filled in. A course edition starts with the canonical's switches; an
 * expression of interest or a custom form starts with every email off, so it
 * announces nothing until someone turns an email on. Kinds that already have a
 * row are left alone.
 */
export async function copyCanonicalEmails(
  ctx: MutationCtx,
  opts: {
    opportunityId: Id<'orgOpportunities'>
    orgId: Id<'organizations'>
    tags: ReadonlyArray<string> | undefined
    formSource: FormSource
  },
): Promise<void> {
  const emails = await canonicalEmailsFor(ctx, {
    orgId: opts.orgId,
    tags: opts.tags,
  })
  const now = Date.now()
  for (const email of emails) {
    if (await ownTemplate(ctx, opts.opportunityId, email.kind)) continue
    await ctx.db.insert('emailTemplates', {
      orgId: opts.orgId,
      opportunityId: opts.opportunityId,
      kind: email.kind,
      enabled: opts.formSource === 'course' ? email.enabled : false,
      subject: email.subject,
      markdownBody: email.markdownBody,
      includePollLink: email.includePollLink,
      includeSurveyLink: email.includeSurveyLink,
      updatedAt: now,
    })
  }
}

/** The canonical emails, one per kind, and the footer. */
export const getCanonical = query({
  args: { orgId: v.id('organizations') },
  returns: v.object({
    footer: v.string(),
    emails: v.array(emailContentValidator),
  }),
  handler: async (ctx, { orgId }) => {
    await requireAdmin(ctx, orgId)
    const org = await ctx.db.get('organizations', orgId)
    return {
      footer: org?.emailFooter ?? '',
      emails: await canonicalEmailsOf(ctx, orgId),
    }
  },
})

/**
 * Save one canonical email. The org's canonical set is created on the first
 * save. Opportunities keep the copy they already have; a new one copies the
 * saved text, and an existing one takes it with "Revert to canonical".
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
  returns: v.null(),
  handler: async (ctx, { orgId, kind, ...content }) => {
    const userId = await requireAdmin(ctx, orgId)
    if (!content.subject.trim())
      throw new ConvexError('Subject cannot be empty')
    // A typo'd {{variable}} is rejected here — it can never reach an applicant.
    assertOnlyKnownVariables(content.subject)
    assertOnlyKnownVariables(content.markdownBody)

    const now = Date.now()
    let setId = (await canonicalSetOf(ctx, orgId))?._id
    if (!setId) {
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
    await ctx.db.patch('emailTemplates', template._id, {
      ...content,
      updatedAt: now,
    })
    await ctx.db.patch('emailTemplateSets', setId, { updatedAt: now })
    return null
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

// ── An opportunity's emails (Emails tab) ────────────────────────────────────

const queueEffectValidator = v.object({
  queued: v.number(),
  discarded: v.number(),
  keptEdited: v.number(),
})

/**
 * The six emails of an opportunity. `differsFromCanonical` says whether its
 * text or links moved away from what the canonical says today, so the tab
 * can offer to bring the canonical back.
 */
export const getOpportunityEmails = query({
  args: { opportunityId: v.id('orgOpportunities') },
  returns: v.array(
    v.object({
      ...emailContentValidator.fields,
      differsFromCanonical: v.boolean(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, { opportunityId }) => {
    const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
    if (!opportunity) throw new ConvexError('Opportunity not found')
    await requireAccess(ctx, opportunity._id, 'read')

    const canonical = await canonicalEmailsFor(ctx, opportunity)
    const out = []
    for (const base of canonical) {
      const own = await ownTemplate(ctx, opportunityId, base.kind)
      // Until the one-off below runs, an opportunity may still read its emails
      // from the canonical set it linked.
      const linked = opportunity.emailTemplateSetId
      const legacy =
        !own && !usesOwnEmails(opportunity) && linked
          ? await ctx.db
              .query('emailTemplates')
              .withIndex('by_set_and_kind', (q) =>
                q.eq('setId', linked).eq('kind', base.kind),
              )
              .first()
          : null
      const row = own ?? legacy
      const email: EmailContent = row
        ? {
            kind: base.kind,
            enabled: row.enabled ?? true,
            subject: row.subject,
            markdownBody: row.markdownBody,
            includePollLink: row.includePollLink ?? false,
            includeSurveyLink: row.includeSurveyLink ?? false,
          }
        : { ...base, enabled: false }
      out.push({
        ...email,
        differsFromCanonical: !sameText(email, base),
        updatedAt: row?.updatedAt ?? 0,
      })
    }
    return out
  },
})

function sameText(a: EmailContent, b: EmailContent): boolean {
  return (
    a.subject === b.subject &&
    a.markdownBody === b.markdownBody &&
    a.includePollLink === b.includePollLink &&
    a.includeSurveyLink === b.includeSurveyLink
  )
}

/**
 * Write one of the opportunity's emails and keep its Outbox in step: untouched
 * pending drafts of that kind follow the new wording, turning the email on
 * queues a draft for every decision of that kind already made, turning it off
 * drops the untouched drafts. Says what it did to the queue so the tab can say
 * it out loud. Nothing is sent.
 */
async function writeOpportunityEmail(
  ctx: MutationCtx,
  opportunity: Doc<'orgOpportunities'>,
  content: EmailContent,
): Promise<{ queued: number; discarded: number; keptEdited: number }> {
  if (!content.subject.trim()) throw new ConvexError('Subject cannot be empty')
  assertOnlyKnownVariables(content.subject)
  assertOnlyKnownVariables(content.markdownBody)

  // An opportunity still on the canonical set takes all six as its own first,
  // so this write never leaves the other five without an email.
  if (!usesOwnEmails(opportunity)) {
    await adoptOwnEmails(ctx, opportunity, {
      canonical: await canonicalEmailsOf(ctx, opportunity.orgId),
      dryRun: false,
    })
  }
  const existing = await ownTemplate(ctx, opportunity._id, content.kind)
  const wasOn = existing ? existing.enabled !== false : false
  const { kind, ...fields } = content
  const now = Date.now()
  if (existing) {
    await ctx.db.patch('emailTemplates', existing._id, {
      ...fields,
      updatedAt: now,
    })
  } else {
    await ctx.db.insert('emailTemplates', {
      orgId: opportunity.orgId,
      opportunityId: opportunity._id,
      kind,
      ...fields,
      updatedAt: now,
    })
  }

  await refreshPendingDraftsForTemplate(ctx, {
    kind,
    opportunityId: opportunity._id,
  })
  let queued = 0
  if (content.enabled && !wasOn) {
    queued = await enqueueMissingDraftsForKind(ctx, {
      kind,
      opportunityId: opportunity._id,
    })
  }
  const { discarded, keptEdited } = await discardPendingDraftsForKind(ctx, {
    kind,
    opportunityId: opportunity._id,
  })
  return { queued, discarded, keptEdited }
}

/** Save one of the opportunity's emails as written in its Emails tab. */
export const saveOpportunityEmail = mutation({
  args: {
    opportunityId: v.id('orgOpportunities'),
    ...emailContentValidator.fields,
  },
  returns: queueEffectValidator,
  handler: async (ctx, { opportunityId, ...content }) => {
    const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
    if (!opportunity) throw new ConvexError('Opportunity not found')
    await requireAccess(ctx, opportunity._id, 'edit')
    return await writeOpportunityEmail(ctx, opportunity, content)
  },
})

/**
 * Bring the canonical's current text and links back into one of the
 * opportunity's emails. Whether that email sends stays as the opportunity
 * had it: reverting the wording never turns an email on.
 */
export const revertOpportunityEmail = mutation({
  args: {
    opportunityId: v.id('orgOpportunities'),
    kind: emailKindValidator,
  },
  returns: queueEffectValidator,
  handler: async (ctx, { opportunityId, kind }) => {
    const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
    if (!opportunity) throw new ConvexError('Opportunity not found')
    await requireAccess(ctx, opportunity._id, 'edit')

    const base = (await canonicalEmailsFor(ctx, opportunity)).find(
      (e) => e.kind === kind,
    )
    if (!base) throw new ConvexError('Unknown email')
    const own = await ownTemplate(ctx, opportunityId, kind)
    return await writeOpportunityEmail(ctx, opportunity, {
      ...base,
      enabled: own ? own.enabled !== false : false,
    })
  },
})

/**
 * Make an opportunity's emails its own rows. One that linked the canonical
 * set keeps exactly the emails it sent (its own rows, else the set's, with
 * its course filled in), and its on-apply switch folds into the "Application
 * received" email. One that sent no emails gets its six with every email off,
 * so it keeps sending nothing until someone turns an email on. Untouched
 * pending drafts take the copied wording; nothing is queued or sent.
 */
async function adoptOwnEmails(
  ctx: MutationCtx,
  opportunity: Doc<'orgOpportunities'>,
  opts: { canonical: Array<EmailContent>; dryRun: boolean },
): Promise<{
  from: 'own and canonical set' | 'canonical set' | 'nothing'
  copied: number
  switchedOff: number
}> {
  const { canonical, dryRun } = opts
  const linked = opportunity.emailTemplateSetId
  const sentEmails = linked != null
  const confirmationOn =
    sentEmails &&
    (opportunity.sendApplicationReceivedEmail ?? !(opportunity.isEOI ?? false))
  const values = coursePlaceholderValues(opportunity.tags)
  const now = Date.now()
  let copied = 0
  let switchedOff = 0
  let hadOwn = false

  for (const base of canonical) {
    const own = await ownTemplate(ctx, opportunity._id, base.kind)
    if (own) {
      hadOwn = true
      const wasOn = own.enabled !== false
      const on =
        wasOn &&
        sentEmails &&
        (base.kind !== 'application_received' || confirmationOn)
      if (wasOn && !on) {
        switchedOff++
        if (!dryRun) {
          await ctx.db.patch('emailTemplates', own._id, {
            enabled: false,
            updatedAt: now,
          })
        }
      }
      continue
    }
    const setRow = linked
      ? await ctx.db
          .query('emailTemplates')
          .withIndex('by_set_and_kind', (q) =>
            q.eq('setId', linked).eq('kind', base.kind),
          )
          .first()
      : null
    const source: EmailContent = setRow
      ? {
          kind: base.kind,
          enabled: setRow.enabled ?? true,
          subject: setRow.subject,
          markdownBody: setRow.markdownBody,
          includePollLink: setRow.includePollLink ?? false,
          includeSurveyLink: setRow.includeSurveyLink ?? false,
        }
      : base
    const enabled =
      sentEmails &&
      source.enabled &&
      (base.kind !== 'application_received' || confirmationOn)
    copied++
    if (dryRun) continue
    await ctx.db.insert('emailTemplates', {
      orgId: opportunity.orgId,
      opportunityId: opportunity._id,
      kind: base.kind,
      enabled,
      subject: fillText(source.subject, values),
      markdownBody: fillText(source.markdownBody, values),
      includePollLink: source.includePollLink,
      includeSurveyLink: source.includeSurveyLink,
      updatedAt: now,
    })
  }
  if (!dryRun) {
    await ctx.db.patch('orgOpportunities', opportunity._id, {
      emailsCopiedAt: now,
      emailTemplateSetId: undefined,
      sendApplicationReceivedEmail: undefined,
    })
    for (const kind of EMAIL_KINDS) {
      await refreshPendingDraftsForTemplate(ctx, {
        kind,
        opportunityId: opportunity._id,
      })
    }
  }
  return {
    from: sentEmails
      ? hadOwn
        ? 'own and canonical set'
        : 'canonical set'
      : 'nothing',
    copied,
    switchedOff,
  }
}

/**
 * One-off: give every opportunity of the org its own six emails, so none
 * reads the canonical set any more. Idempotent; with `dryRun`, only reports.
 */
export const giveOpportunitiesTheirEmails = internalMutation({
  args: { orgId: v.id('organizations'), dryRun: v.boolean() },
  returns: v.any(),
  handler: async (ctx, { orgId, dryRun }) => {
    const canonical = await canonicalEmailsOf(ctx, orgId)
    const opportunities = await ctx.db
      .query('orgOpportunities')
      .withIndex('by_org_and_status', (q) => q.eq('orgId', orgId))
      .collect()
    const report = []
    for (const opportunity of opportunities) {
      if (usesOwnEmails(opportunity)) continue
      const result = await adoptOwnEmails(ctx, opportunity, {
        canonical,
        dryRun,
      })
      report.push({ title: opportunity.title, ...result })
    }
    return { dryRun, opportunities: report }
  },
})
