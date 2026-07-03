import { ConvexError, v } from 'convex/values'
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from '../_generated/server'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { getUserId, requireOrgAdminFor } from '../lib/auth'
import { resolveApplicantContact } from '../lib/applicantContact'
import type { FormField } from '../lib/formFields'
import { resend } from './send'

// Outbox for applicant decision emails (issue #20). Changing an application's
// status never sends anything — it enqueues a pending draft prefilled from the
// opportunity's template set. Admins review drafts and send explicitly
// (convex/emails/outboxSend.ts). Design invariants:
//   - at most one pending draft per application (a status change replaces it)
//   - hard idempotency: one 'sent' emailLog row per (application, kind)
//   - the only text variable is {{applicant_name}} (always resolvable);
//     poll/survey links are system-managed blocks, never failable variables

const FROM_ADDRESS = 'ASTN <notifications@safetytalent.org>'

export const DECISION_KINDS = [
  'accepted',
  'rejected',
  'redirected',
  'waitlisted',
] as const
export type DecisionKind = (typeof DECISION_KINDS)[number]

export const decisionKindValidator = v.union(
  v.literal('accepted'),
  v.literal('rejected'),
  v.literal('redirected'),
  v.literal('waitlisted'),
)

// Which decision email each application status maps to (null = no email).
const KIND_BY_STATUS: Record<string, DecisionKind | null> = {
  submitted: null,
  under_review: null,
  accepted: 'accepted',
  rejected: 'rejected',
  redirected: 'redirected',
  waitlisted: 'waitlisted',
  participated: null,
}

// Validate template text at save time so a typo'd {{variable}} can never reach
// an applicant. {{applicant_name}} is the only supported variable.
export function assertOnlyKnownVariables(text: string): void {
  const unknown = [...text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)]
    .map((m) => m[1])
    .filter((name) => name !== 'applicant_name')
  if (unknown.length > 0) {
    throw new ConvexError(
      `Unknown template variable(s): ${[...new Set(unknown)]
        .map((n) => `{{${n}}}`)
        .join(', ')}. Only {{applicant_name}} is supported.`,
    )
  }
}

// The outbox system is active for an opportunity iff it links a template set;
// otherwise legacy auto-email behavior is unchanged (removed in phase 3).
export function isOutboxActive(opportunity: Doc<'orgOpportunities'>): boolean {
  return opportunity.emailTemplateSetId != null
}

async function hasSentKind(
  ctx: QueryCtx | MutationCtx,
  applicationId: Doc<'opportunityApplications'>['_id'],
  kind: string,
): Promise<boolean> {
  const rows = await ctx.db
    .query('emailLog')
    .withIndex('by_application_and_kind', (q) =>
      q.eq('applicationId', applicationId).eq('kind', kind),
    )
    .collect()
  return rows.some((r) => r.status === 'sent')
}

// Per-opportunity override first, then the linked set's template.
async function resolveTemplate(
  ctx: QueryCtx | MutationCtx,
  opportunity: Doc<'orgOpportunities'>,
  kind: Doc<'emailTemplates'>['kind'],
): Promise<Doc<'emailTemplates'> | null> {
  const override = await ctx.db
    .query('emailTemplates')
    .withIndex('by_opportunity_and_kind', (q) =>
      q.eq('opportunityId', opportunity._id).eq('kind', kind),
    )
    .first()
  if (override) return override
  const setId = opportunity.emailTemplateSetId
  if (!setId) return null
  return await ctx.db
    .query('emailTemplates')
    .withIndex('by_set_and_kind', (q) => q.eq('setId', setId).eq('kind', kind))
    .first()
}

/**
 * Keep the outbox in sync after an application status change. Callable from
 * any mutation (UI updateStatus, MCP astn_update). Replaces the application's
 * pending draft; enqueues nothing for non-decision statuses or when that
 * decision email was already sent (hard idempotency).
 */
export async function syncOutboxOnStatusChange(
  ctx: MutationCtx,
  opts: {
    application: Doc<'opportunityApplications'>
    status: string
    opportunity: Doc<'orgOpportunities'>
  },
): Promise<void> {
  const { application, status, opportunity } = opts
  if (!isOutboxActive(opportunity)) return

  // A status change always supersedes the pending draft (no zombie drafts).
  const existing = await ctx.db
    .query('emailOutbox')
    .withIndex('by_application', (q) => q.eq('applicationId', application._id))
    .collect()
  for (const draft of existing) {
    await ctx.db.delete('emailOutbox', draft._id)
  }

  const kind = KIND_BY_STATUS[status] ?? null
  if (!kind) return
  if (await hasSentKind(ctx, application._id, kind)) return

  const template = await resolveTemplate(ctx, opportunity, kind)
  if (!template) {
    // Sets are created with every kind, so this is an invariant violation —
    // log loudly rather than fail the status change.
    console.error(
      `emailOutbox: no '${kind}' template for opportunity ${opportunity._id} (set ${opportunity.emailTemplateSetId})`,
    )
    return
  }
  // enabled: false is the explicit "this decision sends no email" choice.
  if (template.enabled === false) return

  const now = Date.now()
  await ctx.db.insert('emailOutbox', {
    orgId: opportunity.orgId,
    opportunityId: opportunity._id,
    applicationId: application._id,
    kind,
    subject: template.subject,
    markdownBody: template.markdownBody,
    includePollLink: template.includePollLink ?? false,
    includeSurveyLink: template.includeSurveyLink ?? false,
    createdAt: now,
    updatedAt: now,
  })
}

// ── Admin queries/mutations (Emails tab) ────────────────────────────────────

async function requireAdmin(
  ctx: QueryCtx | MutationCtx,
  orgId: Doc<'organizations'>['_id'],
): Promise<string> {
  const userId = await getUserId(ctx)
  if (!userId) throw new ConvexError('Not authenticated')
  await requireOrgAdminFor(ctx, userId, orgId)
  return userId
}

// Pending drafts of an opportunity with resolved recipients. Drafts without a
// resolvable email surface with recipientEmail=null — the UI renders them in a
// non-selectable "Needs email" group, and the send path guards them too.
export const listForOpportunity = query({
  args: { opportunityId: v.id('orgOpportunities') },
  returns: v.array(
    v.object({
      _id: v.id('emailOutbox'),
      applicationId: v.id('opportunityApplications'),
      kind: decisionKindValidator,
      subject: v.string(),
      markdownBody: v.string(),
      includePollLink: v.boolean(),
      includeSurveyLink: v.boolean(),
      recipientName: v.string(),
      recipientEmail: v.union(v.string(), v.null()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, { opportunityId }) => {
    const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
    if (!opportunity) throw new ConvexError('Opportunity not found')
    await requireAdmin(ctx, opportunity.orgId)

    const formFields = opportunity.formFields as Array<FormField> | undefined
    const drafts = await ctx.db
      .query('emailOutbox')
      .withIndex('by_opportunity', (q) => q.eq('opportunityId', opportunityId))
      .collect()

    const out = []
    for (const draft of drafts) {
      const app = await ctx.db.get(
        'opportunityApplications',
        draft.applicationId,
      )
      if (!app) continue
      const { name, email } = await resolveApplicantContact(
        ctx,
        app,
        formFields,
        'there',
      )
      out.push({
        _id: draft._id,
        applicationId: draft.applicationId,
        kind: draft.kind,
        subject: draft.subject,
        markdownBody: draft.markdownBody,
        includePollLink: draft.includePollLink ?? false,
        includeSurveyLink: draft.includeSurveyLink ?? false,
        recipientName: name,
        recipientEmail: email ?? null,
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
      })
    }
    return out
  },
})

export const updateDraft = mutation({
  args: {
    draftId: v.id('emailOutbox'),
    subject: v.optional(v.string()),
    markdownBody: v.optional(v.string()),
    includePollLink: v.optional(v.boolean()),
    includeSurveyLink: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (
    ctx,
    { draftId, subject, markdownBody, includePollLink, includeSurveyLink },
  ) => {
    const draft = await ctx.db.get('emailOutbox', draftId)
    if (!draft) throw new ConvexError('Draft not found')
    await requireAdmin(ctx, draft.orgId)

    const patch: Record<string, unknown> = { updatedAt: Date.now() }
    if (subject !== undefined) {
      if (!subject.trim()) throw new ConvexError('Subject cannot be empty')
      assertOnlyKnownVariables(subject)
      patch.subject = subject
    }
    if (markdownBody !== undefined) {
      assertOnlyKnownVariables(markdownBody)
      patch.markdownBody = markdownBody
    }
    if (includePollLink !== undefined) patch.includePollLink = includePollLink
    if (includeSurveyLink !== undefined)
      patch.includeSurveyLink = includeSurveyLink
    await ctx.db.patch('emailOutbox', draftId, patch as any)
    return null
  },
})

export const deleteDraft = mutation({
  args: { draftId: v.id('emailOutbox') },
  returns: v.null(),
  handler: async (ctx, { draftId }) => {
    const draft = await ctx.db.get('emailOutbox', draftId)
    if (!draft) return null
    await requireAdmin(ctx, draft.orgId)
    await ctx.db.delete('emailOutbox', draftId)
    return null
  },
})

// ── Internal plumbing for the send action (convex/emails/outboxSend.ts) ─────

export const getDraftsForSend = internalQuery({
  args: {
    opportunityId: v.id('orgOpportunities'),
    draftIds: v.array(v.id('emailOutbox')),
  },
  returns: v.array(
    v.object({
      draftId: v.id('emailOutbox'),
      applicationId: v.id('opportunityApplications'),
      kind: v.string(),
      subject: v.string(),
      markdownBody: v.string(),
      includePollLink: v.boolean(),
      includeSurveyLink: v.boolean(),
      recipientName: v.string(),
      recipientEmail: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { opportunityId, draftIds }) => {
    const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
    const formFields = opportunity?.formFields as Array<FormField> | undefined

    const out = []
    for (const draftId of draftIds) {
      const draft = await ctx.db.get('emailOutbox', draftId)
      // Safety: ignore ids that aren't drafts of this opportunity.
      if (!draft || draft.opportunityId !== opportunityId) continue
      const app = await ctx.db.get(
        'opportunityApplications',
        draft.applicationId,
      )
      if (!app) continue
      const { name, email } = await resolveApplicantContact(
        ctx,
        app,
        formFields,
        'there',
      )
      out.push({
        draftId: draft._id,
        applicationId: draft.applicationId,
        kind: draft.kind,
        subject: draft.subject,
        markdownBody: draft.markdownBody,
        includePollLink: draft.includePollLink ?? false,
        includeSurveyLink: draft.includeSurveyLink ?? false,
        recipientName: name,
        recipientEmail: email ?? null,
      })
    }
    return out
  },
})

// Resolve the per-recipient poll/survey links for an application, creating
// the respondent rows (with fresh tokens) when missing — a "recipient without
// a token" is unrepresentable. Returns null links when there is no open
// poll / open survey: the caller then *blocks* the send with an explicit
// outcome instead of sending a mail without the promised link.
export const ensureLinkTargets = internalMutation({
  args: {
    applicationId: v.id('opportunityApplications'),
    includePollLink: v.boolean(),
    includeSurveyLink: v.boolean(),
  },
  returns: v.object({
    pollLink: v.union(v.string(), v.null()),
    surveyLink: v.union(v.string(), v.null()),
  }),
  handler: async (
    ctx,
    { applicationId, includePollLink, includeSurveyLink },
  ) => {
    const app = await ctx.db.get('opportunityApplications', applicationId)
    if (!app) return { pollLink: null, surveyLink: null }
    const [opportunity, org] = await Promise.all([
      ctx.db.get('orgOpportunities', app.opportunityId),
      ctx.db.get('organizations', app.orgId),
    ])
    if (!opportunity || !org) {
      return { pollLink: null, surveyLink: null }
    }
    const formFields = opportunity.formFields as Array<FormField> | undefined
    const { name } = await resolveApplicantContact(
      ctx,
      app,
      formFields,
      'Applicant',
    )
    const baseUrl = process.env.SITE_URL ?? 'https://safetytalent.org'

    let pollLink: string | null = null
    if (includePollLink) {
      const openPoll = await ctx.db
        .query('availabilityPolls')
        .withIndex('by_opportunity', (q) =>
          q.eq('opportunityId', app.opportunityId),
        )
        .filter((q) => q.eq(q.field('status'), 'open'))
        .first()
      if (openPoll) {
        let respondent = await ctx.db
          .query('pollRespondents')
          .withIndex('by_poll_and_application', (q) =>
            q.eq('pollId', openPoll._id).eq('applicationId', app._id),
          )
          .first()
        if (!respondent) {
          const respondentId = await ctx.db.insert('pollRespondents', {
            pollId: openPoll._id,
            applicationId: app._id,
            respondentToken: crypto.randomUUID(),
            respondentName: name,
          })
          respondent = await ctx.db.get('pollRespondents', respondentId)
        }
        if (respondent) {
          pollLink = `${baseUrl}/org/${org.slug}/poll/${openPoll.accessToken}/${respondent.respondentToken}`
        }
      }
    }

    let surveyLink: string | null = null
    if (includeSurveyLink) {
      const openSurvey = await ctx.db
        .query('feedbackSurveys')
        .withIndex('by_opportunity', (q) =>
          q.eq('opportunityId', app.opportunityId),
        )
        .filter((q) => q.eq(q.field('status'), 'open'))
        .first()
      if (openSurvey) {
        let respondent = await ctx.db
          .query('surveyRespondents')
          .withIndex('by_survey_and_application', (q) =>
            q.eq('surveyId', openSurvey._id).eq('applicationId', app._id),
          )
          .first()
        if (!respondent) {
          const respondentId = await ctx.db.insert('surveyRespondents', {
            surveyId: openSurvey._id,
            applicationId: app._id,
            respondentToken: crypto.randomUUID(),
            respondentName: name,
            userId: app.userId,
          })
          respondent = await ctx.db.get('surveyRespondents', respondentId)
        }
        if (respondent) {
          surveyLink = `${baseUrl}/org/${org.slug}/survey/${openSurvey.accessToken}/${respondent.respondentToken}`
        }
      }
    }

    return { pollLink, surveyLink }
  },
})

// Atomic per-draft send: re-checks existence + idempotency, queues the email,
// writes the unified log, and deletes the draft — all in one transaction.
export const finalizeDraftSend = internalMutation({
  args: {
    draftId: v.id('emailOutbox'),
    to: v.string(),
    recipientName: v.string(),
    subject: v.string(),
    html: v.string(),
    sentBy: v.string(),
  },
  returns: v.union(
    v.literal('sent'),
    v.literal('already_sent'),
    v.literal('gone'),
  ),
  handler: async (
    ctx,
    { draftId, to, recipientName, subject, html, sentBy },
  ) => {
    const draft = await ctx.db.get('emailOutbox', draftId)
    if (!draft) return 'gone'

    if (await hasSentKind(ctx, draft.applicationId, draft.kind)) {
      await ctx.db.delete('emailOutbox', draftId)
      return 'already_sent'
    }

    await resend.sendEmail(ctx, {
      from: FROM_ADDRESS,
      to,
      subject,
      html,
    })
    await ctx.db.insert('emailLog', {
      orgId: draft.orgId,
      opportunityId: draft.opportunityId,
      applicationId: draft.applicationId,
      recipientEmail: to,
      recipientName,
      kind: draft.kind,
      source: 'outbox',
      subject,
      sentAt: Date.now(),
      sentBy,
      status: 'sent',
    })
    await ctx.db.delete('emailOutbox', draftId)
    return 'sent'
  },
})

// ── On-apply confirmation (application_received) ────────────────────────────

// The single truly-automatic email: sent right after a first submission when
// the opportunity uses the outbox system and the kill switch is on. The switch
// defaults ON, except EOIs (explicit isEOI flag) which default OFF. Because it
// only ever fires at submission time, toggling it can never send retroactively.
export function shouldSendApplicationReceived(
  opportunity: Doc<'orgOpportunities'>,
): boolean {
  if (!isOutboxActive(opportunity)) return false
  return (
    opportunity.sendApplicationReceivedEmail ?? !(opportunity.isEOI ?? false)
  )
}

// Everything the send action needs, or null when the email shouldn't go out
// (switch off, template disabled, no email, already sent). All checks re-run
// here so the scheduled action is race-safe.
export const getApplicationReceivedPayload = internalQuery({
  args: { applicationId: v.id('opportunityApplications') },
  returns: v.union(
    v.null(),
    v.object({
      opportunityId: v.id('orgOpportunities'),
      to: v.string(),
      recipientName: v.string(),
      subject: v.string(),
      markdownBody: v.string(),
      includePollLink: v.boolean(),
      includeSurveyLink: v.boolean(),
    }),
  ),
  handler: async (ctx, { applicationId }) => {
    const app = await ctx.db.get('opportunityApplications', applicationId)
    if (!app) return null
    const opportunity = await ctx.db.get('orgOpportunities', app.opportunityId)
    if (!opportunity || !shouldSendApplicationReceived(opportunity)) return null
    if (await hasSentKind(ctx, applicationId, 'application_received'))
      return null

    const template = await resolveTemplate(
      ctx,
      opportunity,
      'application_received',
    )
    if (!template || template.enabled === false) return null

    const formFields = opportunity.formFields as Array<FormField> | undefined
    const { name, email } = await resolveApplicantContact(
      ctx,
      app,
      formFields,
      'there',
    )
    if (!email) return null

    return {
      opportunityId: opportunity._id,
      to: email,
      recipientName: name,
      subject: template.subject,
      markdownBody: template.markdownBody,
      includePollLink: template.includePollLink ?? false,
      includeSurveyLink: template.includeSurveyLink ?? false,
    }
  },
})

// Atomic auto-send: idempotency + send + unified log in one transaction.
export const finalizeAutoSend = internalMutation({
  args: {
    applicationId: v.id('opportunityApplications'),
    kind: v.string(),
    to: v.string(),
    recipientName: v.string(),
    subject: v.string(),
    html: v.string(),
  },
  returns: v.union(
    v.literal('sent'),
    v.literal('already_sent'),
    v.literal('gone'),
  ),
  handler: async (
    ctx,
    { applicationId, kind, to, recipientName, subject, html },
  ) => {
    const app = await ctx.db.get('opportunityApplications', applicationId)
    if (!app) return 'gone'
    if (await hasSentKind(ctx, applicationId, kind)) return 'already_sent'

    await resend.sendEmail(ctx, { from: FROM_ADDRESS, to, subject, html })
    await ctx.db.insert('emailLog', {
      orgId: app.orgId,
      opportunityId: app.opportunityId,
      applicationId,
      recipientEmail: to,
      recipientName,
      kind,
      source: 'auto',
      subject,
      sentAt: Date.now(),
      sentBy: 'system',
      status: 'sent',
    })
    return 'sent'
  },
})

// Visible failure record for automatic sends (e.g. promised poll link with no
// open poll) — surfaces in History instead of vanishing silently.
export const logAutoFailure = internalMutation({
  args: {
    applicationId: v.id('opportunityApplications'),
    kind: v.string(),
    to: v.string(),
    recipientName: v.string(),
    subject: v.string(),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (
    ctx,
    { applicationId, kind, to, recipientName, subject, error },
  ) => {
    const app = await ctx.db.get('opportunityApplications', applicationId)
    if (!app) return null
    await ctx.db.insert('emailLog', {
      orgId: app.orgId,
      opportunityId: app.opportunityId,
      applicationId,
      recipientEmail: to,
      recipientName,
      kind,
      source: 'auto',
      subject,
      sentAt: Date.now(),
      sentBy: 'system',
      status: 'failed',
      error,
    })
    return null
  },
})

// Record a manual broadcast send in the unified log (kind 'broadcast' never
// participates in decision idempotency — broadcasts are repeatable by design).
export const logBroadcastSend = internalMutation({
  args: {
    opportunityId: v.id('orgOpportunities'),
    applicationId: v.id('opportunityApplications'),
    to: v.string(),
    recipientName: v.string(),
    subject: v.string(),
    sentBy: v.string(),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (
    ctx,
    { opportunityId, applicationId, to, recipientName, subject, sentBy, error },
  ) => {
    const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
    if (!opportunity) return null
    await ctx.db.insert('emailLog', {
      orgId: opportunity.orgId,
      opportunityId,
      applicationId,
      recipientEmail: to,
      recipientName,
      kind: 'broadcast',
      source: 'broadcast',
      subject,
      sentAt: Date.now(),
      sentBy,
      status: error ? 'failed' : 'sent',
      error,
    })
    return null
  },
})

// ── History (unified log) ───────────────────────────────────────────────────

export const listLogForOpportunity = query({
  args: { opportunityId: v.id('orgOpportunities') },
  returns: v.array(
    v.object({
      _id: v.id('emailLog'),
      applicationId: v.union(v.id('opportunityApplications'), v.null()),
      recipientEmail: v.string(),
      recipientName: v.string(),
      kind: v.string(),
      source: v.string(),
      subject: v.string(),
      sentAt: v.number(),
      sentBy: v.string(),
      status: v.string(),
      error: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { opportunityId }) => {
    const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
    if (!opportunity) throw new ConvexError('Opportunity not found')
    await requireAdmin(ctx, opportunity.orgId)

    const rows = await ctx.db
      .query('emailLog')
      .withIndex('by_opportunity', (q) => q.eq('opportunityId', opportunityId))
      .order('desc')
      .take(200)
    return rows.map((r) => ({
      _id: r._id,
      applicationId: r.applicationId ?? null,
      recipientEmail: r.recipientEmail,
      recipientName: r.recipientName,
      kind: r.kind,
      source: r.source,
      subject: r.subject,
      sentAt: r.sentAt,
      sentBy: r.sentBy,
      status: r.status,
      error: r.error ?? null,
    }))
  },
})

export const logFailedSend = internalMutation({
  args: {
    draftId: v.id('emailOutbox'),
    to: v.string(),
    recipientName: v.string(),
    subject: v.string(),
    sentBy: v.string(),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (
    ctx,
    { draftId, to, recipientName, subject, sentBy, error },
  ) => {
    const draft = await ctx.db.get('emailOutbox', draftId)
    if (!draft) return null
    await ctx.db.insert('emailLog', {
      orgId: draft.orgId,
      opportunityId: draft.opportunityId,
      applicationId: draft.applicationId,
      recipientEmail: to,
      recipientName,
      kind: draft.kind,
      source: 'outbox',
      subject,
      sentAt: Date.now(),
      sentBy,
      status: 'failed',
      error,
    })
    return null
  },
})
