import { ConvexError, v } from 'convex/values'
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server'
import type { MutationCtx } from './_generated/server'
import { getUserId, requireOrgAdmin } from './lib/auth'
import { resolveApplicantDisplayNameFromApplication } from './lib/applicantName'
import {
  assertFormFieldsShape,
  sanitizeFormFieldKeys,
  sanitizeResponseKeys,
  validateResponses,
} from './lib/formFields'
import type { Id } from './_generated/dataModel'
import type { FormField } from './lib/formFields'

// ─── Validators ───

const surveyStatusValidator = v.union(
  v.literal('draft'),
  v.literal('open'),
  v.literal('closed'),
)

// ─── Return validators ───

const surveyReturnValidator = v.object({
  _id: v.id('feedbackSurveys'),
  _creationTime: v.number(),
  opportunityId: v.id('orgOpportunities'),
  orgId: v.id('organizations'),
  programId: v.optional(v.id('programs')),
  createdBy: v.string(),
  title: v.string(),
  description: v.optional(v.string()),
  formFields: v.any(),
  accessToken: v.string(),
  status: surveyStatusValidator,
  applicantStatuses: v.optional(v.array(v.string())),
  anonymous: v.optional(v.boolean()),
  createdAt: v.number(),
  updatedAt: v.number(),
})

// ─── Admin mutations ───

/**
 * Create a feedback survey with the invariants the web form enforces: one
 * active survey per opportunity, sanitised question keys, a fresh access token,
 * and — unless anonymous — one respondent row per applicant matching the status
 * filter, each with its own token.
 *
 * Extracted so the MCP creates surveys through exactly this code. A generic
 * insert would produce a survey with no token and nobody able to answer it.
 */
export async function createSurveyFor(
  ctx: MutationCtx,
  args: {
    opportunityId: Id<'orgOpportunities'>
    orgId: Id<'organizations'>
    createdBy: string
    title: string
    description?: string
    formFields: unknown
    programId?: Id<'programs'>
    applicantStatuses?: Array<string>
    anonymous?: boolean
  },
): Promise<Id<'feedbackSurveys'>> {
  // One active survey *per kind*, not per opportunity. A course needs both at
  // once: the identified end-of-course survey, and the anonymous one for
  // feedback about facilitators. Enforcing one per opportunity made the
  // anonymous survey impossible to use alongside the very thing it was built
  // to be separate from.
  const wantAnonymous = args.anonymous === true
  const existing = await ctx.db
    .query('feedbackSurveys')
    .withIndex('by_opportunity', (q) =>
      q.eq('opportunityId', args.opportunityId),
    )
    .collect()
  if (
    existing.some(
      (s) =>
        (s.status === 'open' || s.status === 'draft') &&
        (s.anonymous === true) === wantAnonymous,
    )
  )
    throw new ConvexError(
      wantAnonymous
        ? 'An active anonymous survey already exists for this opportunity'
        : 'An active survey already exists for this opportunity',
    )

  const now = Date.now()
  const statusFilter = args.applicantStatuses ?? []

  const surveyId = await ctx.db.insert('feedbackSurveys', {
    opportunityId: args.opportunityId,
    orgId: args.orgId,
    programId: args.programId,
    createdBy: args.createdBy,
    title: args.title,
    description: args.description,
    formFields: sanitizeFormFieldKeys(assertFormFieldsShape(args.formFields)),
    accessToken: crypto.randomUUID(),
    status: 'draft',
    applicantStatuses: statusFilter.length > 0 ? statusFilter : undefined,
    anonymous: args.anonymous === true ? true : undefined,
    createdAt: now,
    updatedAt: now,
  })

  // An anonymous survey gets no respondent rows at all. That is the whole
  // mechanism: with nobody on the list there are no personal tokens to hand
  // out and nothing to join an answer back to. It also means we cannot tell
  // who has not replied yet — an accepted trade, decided with Gaspar.
  if (args.anonymous === true) return surveyId

  const applications = await ctx.db
    .query('opportunityApplications')
    .withIndex('by_opportunity_and_status', (q) =>
      q.eq('opportunityId', args.opportunityId),
    )
    .collect()

  const filtered =
    statusFilter.length > 0
      ? applications.filter((a) => statusFilter.includes(a.status))
      : applications

  for (const app of filtered) {
    const name = await resolveApplicantDisplayNameFromApplication(
      ctx.db,
      app,
      'Applicant',
    )
    await ctx.db.insert('surveyRespondents', {
      surveyId,
      applicationId: app._id,
      respondentToken: crypto.randomUUID(),
      respondentName: name,
      userId: app.userId,
    })
  }

  return surveyId
}

export const createSurvey = mutation({
  args: {
    opportunityId: v.id('orgOpportunities'),
    title: v.string(),
    description: v.optional(v.string()),
    formFields: v.any(), // Array<FormField>
    programId: v.optional(v.id('programs')),
    applicantStatuses: v.optional(v.array(v.string())), // filter: only include these statuses
    anonymous: v.optional(v.boolean()), // no respondents, no personal links
  },
  returns: v.id('feedbackSurveys'),
  handler: async (ctx, args) => {
    const opportunity = await ctx.db.get('orgOpportunities', args.opportunityId)
    if (!opportunity) throw new ConvexError('Opportunity not found')

    const userId = await requireOrgAdmin(ctx, opportunity.orgId)

    return await createSurveyFor(ctx, {
      ...args,
      orgId: opportunity.orgId,
      createdBy: userId,
    })
  },
})

export const updateSurvey = mutation({
  args: {
    surveyId: v.id('feedbackSurveys'),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    formFields: v.optional(v.any()), // Only allowed while draft
    status: v.optional(surveyStatusValidator),
  },
  returns: v.null(),
  handler: async (ctx, { surveyId, ...updates }) => {
    const survey = await ctx.db.get('feedbackSurveys', surveyId)
    if (!survey) throw new ConvexError('Survey not found')

    await requireOrgAdmin(ctx, survey.orgId)

    // Only allow editing formFields while in draft
    if (updates.formFields !== undefined && survey.status !== 'draft') {
      throw new ConvexError('Cannot edit questions after survey is published')
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() }
    if (updates.title !== undefined) patch.title = updates.title
    if (updates.description !== undefined)
      patch.description = updates.description
    if (updates.formFields !== undefined)
      patch.formFields = sanitizeFormFieldKeys(
        assertFormFieldsShape(updates.formFields),
      )
    if (updates.status !== undefined) patch.status = updates.status

    await ctx.db.patch('feedbackSurveys', surveyId, patch)
    return null
  },
})

export const deleteSurvey = mutation({
  args: { surveyId: v.id('feedbackSurveys') },
  returns: v.null(),
  handler: async (ctx, { surveyId }) => {
    const survey = await ctx.db.get('feedbackSurveys', surveyId)
    if (!survey) throw new ConvexError('Survey not found')

    await requireOrgAdmin(ctx, survey.orgId)

    // Fetch responses and respondents in parallel
    const [responses, respondents, anonResponses] = await Promise.all([
      ctx.db
        .query('surveyResponses')
        .withIndex('by_survey', (q) => q.eq('surveyId', surveyId))
        .collect(),
      ctx.db
        .query('surveyRespondents')
        .withIndex('by_survey', (q) => q.eq('surveyId', surveyId))
        .collect(),
      ctx.db
        .query('anonymousSurveyResponses')
        .withIndex('by_survey', (q) => q.eq('surveyId', surveyId))
        .collect(),
    ])

    for (const r of responses) {
      await ctx.db.delete('surveyResponses', r._id)
    }
    for (const r of respondents) {
      await ctx.db.delete('surveyRespondents', r._id)
    }
    for (const r of anonResponses) {
      await ctx.db.delete('anonymousSurveyResponses', r._id)
    }

    await ctx.db.delete('feedbackSurveys', surveyId)
    return null
  },
})

export const backfillRespondents = mutation({
  args: { surveyId: v.id('feedbackSurveys') },
  returns: v.number(),
  handler: async (ctx, { surveyId }) => {
    const survey = await ctx.db.get('feedbackSurveys', surveyId)
    if (!survey) throw new ConvexError('Survey not found')

    await requireOrgAdmin(ctx, survey.orgId)

    // Creating respondents for an anonymous survey would hand out personal
    // tokens and break the guarantee the survey was created under.
    if (survey.anonymous)
      throw new ConvexError('An anonymous survey has no respondents')

    // Get existing respondent applicationIds
    const existingRespondents = await ctx.db
      .query('surveyRespondents')
      .withIndex('by_survey', (q) => q.eq('surveyId', surveyId))
      .collect()
    const existingAppIds = new Set(
      existingRespondents.map((r) => r.applicationId),
    )

    // Get applications, respecting the status filter used at creation
    const allApplications = await ctx.db
      .query('opportunityApplications')
      .withIndex('by_opportunity_and_status', (q) =>
        q.eq('opportunityId', survey.opportunityId),
      )
      .collect()

    const statusFilter = survey.applicantStatuses ?? []
    const applications =
      statusFilter.length > 0
        ? allApplications.filter((a) => statusFilter.includes(a.status))
        : allApplications

    let added = 0
    for (const app of applications) {
      if (existingAppIds.has(app._id)) continue

      const name = await resolveApplicantDisplayNameFromApplication(
        ctx.db,
        app,
        'Applicant',
      )

      await ctx.db.insert('surveyRespondents', {
        surveyId,
        applicationId: app._id,
        respondentToken: crypto.randomUUID(),
        respondentName: name,
        userId: app.userId,
      })
      added++
    }

    return added
  },
})

export const removeRespondent = mutation({
  args: {
    surveyId: v.id('feedbackSurveys'),
    respondentId: v.id('surveyRespondents'),
  },
  returns: v.null(),
  handler: async (ctx, { surveyId, respondentId }) => {
    const survey = await ctx.db.get('feedbackSurveys', surveyId)
    if (!survey) throw new ConvexError('Survey not found')

    await requireOrgAdmin(ctx, survey.orgId)

    const respondent = await ctx.db.get('surveyRespondents', respondentId)
    if (!respondent || respondent.surveyId !== surveyId)
      throw new ConvexError('Respondent not found')

    // Delete any response they may have submitted
    const response = await ctx.db
      .query('surveyResponses')
      .withIndex('by_survey_and_respondent', (q) =>
        q.eq('surveyId', surveyId).eq('respondentId', respondentId),
      )
      .first()
    if (response) await ctx.db.delete('surveyResponses', response._id)

    await ctx.db.delete('surveyRespondents', respondentId)
    return null
  },
})

// ─── Admin queries ───

/**
 * The identified and the anonymous survey of an opportunity, independently.
 *
 * Each side prefers its active (draft or open) survey and otherwise falls back
 * to the most recent closed one, so a finished cohort still shows its results.
 */
export const getSurveysByOpportunity = query({
  args: { opportunityId: v.id('orgOpportunities') },
  returns: v.object({
    identified: v.union(surveyReturnValidator, v.null()),
    anonymous: v.union(surveyReturnValidator, v.null()),
  }),
  handler: async (ctx, { opportunityId }) => {
    const surveys = await ctx.db
      .query('feedbackSurveys')
      .withIndex('by_opportunity', (q) => q.eq('opportunityId', opportunityId))
      .collect()

    const pick = (anonymous: boolean) => {
      const side = surveys.filter((s) => (s.anonymous === true) === anonymous)
      const active = side.find(
        (s) => s.status === 'draft' || s.status === 'open',
      )
      if (active) return active
      return side.length > 0 ? side[side.length - 1] : null
    }

    return { identified: pick(false), anonymous: pick(true) }
  },
})

// Kept for callers that only care about the identified survey.
export const getSurveyByOpportunity = query({
  args: { opportunityId: v.id('orgOpportunities') },
  returns: v.union(surveyReturnValidator, v.null()),
  handler: async (ctx, { opportunityId }) => {
    const surveys = await ctx.db
      .query('feedbackSurveys')
      .withIndex('by_opportunity', (q) => q.eq('opportunityId', opportunityId))
      .collect()
    const identified = surveys.filter((s) => s.anonymous !== true)
    const active = identified.find(
      (s) => s.status === 'draft' || s.status === 'open',
    )
    if (active) return active
    return identified.length > 0 ? identified[identified.length - 1] : null
  },
})

export const getSurveyResults = query({
  args: { surveyId: v.id('feedbackSurveys') },
  returns: v.object({
    survey: surveyReturnValidator,
    respondents: v.array(
      v.object({
        _id: v.id('surveyRespondents'),
        respondentName: v.string(),
        applicationId: v.id('opportunityApplications'),
        userId: v.optional(v.string()),
        hasResponded: v.boolean(),
        response: v.optional(
          v.object({
            _id: v.id('surveyResponses'),
            responses: v.any(),
            submittedAt: v.number(),
          }),
        ),
      }),
    ),
    // Anonymous surveys fill this instead of `respondents`: the answers with
    // no one attached to them.
    anonymousResponses: v.array(
      v.object({
        _id: v.id('anonymousSurveyResponses'),
        responses: v.any(),
        submittedAt: v.number(),
      }),
    ),
    responseCount: v.number(),
    totalRespondents: v.number(),
  }),
  handler: async (ctx, { surveyId }) => {
    const survey = await ctx.db.get('feedbackSurveys', surveyId)
    if (!survey) throw new ConvexError('Survey not found')

    await requireOrgAdmin(ctx, survey.orgId)

    if (survey.anonymous) {
      const anonResponses = await ctx.db
        .query('anonymousSurveyResponses')
        .withIndex('by_survey', (q) => q.eq('surveyId', surveyId))
        .collect()

      return {
        survey,
        respondents: [],
        anonymousResponses: anonResponses.map((r) => ({
          _id: r._id,
          responses: r.responses,
          submittedAt: r.submittedAt,
        })),
        // How many came in is just a row count — it needs no identity.
        responseCount: anonResponses.length,
        // There is no roster, so "how many were expected" is unknowable.
        totalRespondents: 0,
      }
    }

    // Batch fetch respondents and responses in parallel
    const [respondents, allResponses] = await Promise.all([
      ctx.db
        .query('surveyRespondents')
        .withIndex('by_survey', (q) => q.eq('surveyId', surveyId))
        .collect(),
      ctx.db
        .query('surveyResponses')
        .withIndex('by_survey', (q) => q.eq('surveyId', surveyId))
        .collect(),
    ])

    const responseByRespondent = new Map(
      allResponses.map((r) => [r.respondentId, r]),
    )

    // Use denormalized respondentName — no per-row name resolution needed
    const enrichedRespondents = respondents.map((r) => {
      const response = responseByRespondent.get(r._id)
      return {
        _id: r._id,
        respondentName: r.respondentName,
        applicationId: r.applicationId,
        userId: r.userId,
        hasResponded: !!response,
        response: response
          ? {
              _id: response._id,
              responses: response.responses,
              submittedAt: response.submittedAt,
            }
          : undefined,
      }
    })

    return {
      survey,
      respondents: enrichedRespondents,
      anonymousResponses: [],
      responseCount: allResponses.length,
      totalRespondents: respondents.length,
    }
  },
})

/**
 * Resolve the storage ids collected by `image` form fields into displayable
 * URLs, for a survey's results view. Admin-only and scoped to one survey:
 * the ids live inside response blobs, so without this the admin UI would have
 * an opaque string where a photo should be.
 *
 * Only ids that actually appear in this survey's responses are resolved, so an
 * arbitrary storage id passed in from elsewhere returns nothing.
 */
export const getFormImageUrls = query({
  args: { surveyId: v.id('feedbackSurveys') },
  returns: v.array(v.object({ storageId: v.string(), url: v.string() })),
  handler: async (ctx, { surveyId }) => {
    const survey = await ctx.db.get('feedbackSurveys', surveyId)
    if (!survey) throw new ConvexError('Survey not found')

    await requireOrgAdmin(ctx, survey.orgId)

    const formFields = Array.isArray(survey.formFields)
      ? (survey.formFields as Array<FormField>)
      : []
    const imageKeys = formFields
      .filter((f) => f.kind === 'image')
      .map((f) => f.key)
    if (imageKeys.length === 0) return []

    const [responses, anonResponses] = await Promise.all([
      ctx.db
        .query('surveyResponses')
        .withIndex('by_survey', (q) => q.eq('surveyId', surveyId))
        .collect(),
      ctx.db
        .query('anonymousSurveyResponses')
        .withIndex('by_survey', (q) => q.eq('surveyId', surveyId))
        .collect(),
    ])

    const storageIds = new Set<string>()
    for (const r of [...responses, ...anonResponses]) {
      const values = r.responses as Record<string, unknown>
      for (const key of imageKeys) {
        const val = values?.[key]
        if (typeof val === 'string' && val) storageIds.add(val)
      }
    }

    const resolved = await Promise.all(
      [...storageIds].map(async (storageId) => {
        try {
          const url = await ctx.storage.getUrl(storageId as Id<'_storage'>)
          return url ? { storageId, url } : null
        } catch {
          // A malformed id (stale client, hand-edited data) is a missing
          // image, not a broken results page.
          return null
        }
      }),
    )

    return resolved.filter((r): r is { storageId: string; url: string } => !!r)
  },
})

export const getRespondentLinks = query({
  args: { surveyId: v.id('feedbackSurveys') },
  returns: v.array(
    v.object({
      respondentToken: v.string(),
      respondentName: v.string(),
      applicationId: v.id('opportunityApplications'),
    }),
  ),
  handler: async (ctx, { surveyId }) => {
    // Use denormalized respondentName — no per-row name resolution
    const respondents = await ctx.db
      .query('surveyRespondents')
      .withIndex('by_survey', (q) => q.eq('surveyId', surveyId))
      .collect()

    return respondents.map((r) => ({
      respondentToken: r.respondentToken,
      respondentName: r.respondentName,
      applicationId: r.applicationId,
    }))
  },
})

export const listSurveysByOrg = internalQuery({
  args: { orgId: v.id('organizations') },
  returns: v.array(
    v.object({
      _id: v.id('feedbackSurveys'),
      opportunityId: v.id('orgOpportunities'),
      title: v.string(),
      status: surveyStatusValidator,
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, { orgId }) => {
    const surveys = await ctx.db
      .query('feedbackSurveys')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .collect()

    return surveys.map((s) => ({
      _id: s._id,
      opportunityId: s.opportunityId,
      title: s.title,
      status: s.status,
      createdAt: s.createdAt,
    }))
  },
})

// ─── Public queries (no auth required, token-based) ───

export const getSurveyByToken = query({
  args: { accessToken: v.string() },
  returns: v.union(
    v.object({
      survey: surveyReturnValidator,
      opportunity: v.object({
        _id: v.id('orgOpportunities'),
        title: v.string(),
      }),
      org: v.object({
        _id: v.id('organizations'),
        name: v.string(),
        slug: v.optional(v.string()),
      }),
    }),
    v.null(),
  ),
  handler: async (ctx, { accessToken }) => {
    const survey = await ctx.db
      .query('feedbackSurveys')
      .withIndex('by_accessToken', (q) => q.eq('accessToken', accessToken))
      .unique()

    if (!survey) return null

    // Parallelize independent fetches
    const [opportunity, org] = await Promise.all([
      ctx.db.get('orgOpportunities', survey.opportunityId),
      ctx.db.get('organizations', survey.orgId),
    ])
    if (!opportunity || !org) return null

    return {
      survey,
      opportunity: { _id: opportunity._id, title: opportunity.title },
      org: { _id: org._id, name: org.name, slug: org.slug },
    }
  },
})

export const getSurveyByRespondentToken = query({
  args: { respondentToken: v.string() },
  returns: v.union(
    v.object({
      survey: surveyReturnValidator,
      opportunity: v.object({
        _id: v.id('orgOpportunities'),
        title: v.string(),
      }),
      org: v.object({
        _id: v.id('organizations'),
        name: v.string(),
        slug: v.optional(v.string()),
      }),
      respondentId: v.id('surveyRespondents'),
      respondentName: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, { respondentToken }) => {
    const respondent = await ctx.db
      .query('surveyRespondents')
      .withIndex('by_respondentToken', (q) =>
        q.eq('respondentToken', respondentToken),
      )
      .unique()

    if (!respondent) return null

    const survey = await ctx.db.get('feedbackSurveys', respondent.surveyId)
    if (!survey) return null

    // Parallelize independent fetches
    const [opportunity, org] = await Promise.all([
      ctx.db.get('orgOpportunities', survey.opportunityId),
      ctx.db.get('organizations', survey.orgId),
    ])
    if (!opportunity || !org) return null

    return {
      survey,
      opportunity: { _id: opportunity._id, title: opportunity.title },
      org: { _id: org._id, name: org.name, slug: org.slug },
      respondentId: respondent._id,
      respondentName: respondent.respondentName,
    }
  },
})

export const getResponseByRespondent = query({
  args: {
    surveyId: v.id('feedbackSurveys'),
    respondentId: v.id('surveyRespondents'),
  },
  returns: v.union(
    v.object({
      _id: v.id('surveyResponses'),
      _creationTime: v.number(),
      surveyId: v.id('feedbackSurveys'),
      respondentId: v.id('surveyRespondents'),
      respondentName: v.string(),
      responses: v.any(),
      userId: v.optional(v.string()),
      submittedAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { surveyId, respondentId }) => {
    return await ctx.db
      .query('surveyResponses')
      .withIndex('by_survey_and_respondent', (q) =>
        q.eq('surveyId', surveyId).eq('respondentId', respondentId),
      )
      .first()
  },
})

// ─── Public mutation (token-validated) ───

export const submitResponse = mutation({
  args: {
    surveyId: v.id('feedbackSurveys'),
    respondentId: v.id('surveyRespondents'),
    responses: v.any(), // Record<string, unknown>
  },
  returns: v.id('surveyResponses'),
  handler: async (ctx, { surveyId, respondentId, responses }) => {
    // Validate respondent exists and belongs to this survey
    const respondent = await ctx.db.get('surveyRespondents', respondentId)
    if (!respondent) throw new ConvexError('Respondent not found')
    if (respondent.surveyId !== surveyId)
      throw new ConvexError('Respondent does not belong to this survey')

    const survey = await ctx.db.get('feedbackSurveys', surveyId)
    if (!survey) throw new ConvexError('Survey not found')
    if (survey.status !== 'open')
      throw new ConvexError('Survey is no longer accepting responses')

    // Coerce response keys to valid Convex field names. Protects against an
    // invalid form-field key (e.g. one containing `?`) crashing the write with
    // an opaque "Server Error", and against clients that loaded a stale form.
    const safeResponses = sanitizeResponseKeys(
      responses && typeof responses === 'object' && !Array.isArray(responses)
        ? (responses as Record<string, unknown>)
        : {},
    )

    // Validate responses against form fields
    const formFields = Array.isArray(survey.formFields)
      ? (survey.formFields as Array<FormField>)
      : []
    const errors = validateResponses(formFields, safeResponses)
    if (errors.length > 0)
      throw new ConvexError(`Validation errors: ${errors.join(', ')}`)

    const now = Date.now()

    // Upsert: check for existing response
    const existing = await ctx.db
      .query('surveyResponses')
      .withIndex('by_survey_and_respondent', (q) =>
        q.eq('surveyId', surveyId).eq('respondentId', respondentId),
      )
      .first()

    try {
      if (existing) {
        await ctx.db.patch('surveyResponses', existing._id, {
          respondentName: respondent.respondentName,
          responses: safeResponses,
          updatedAt: now,
        })
        return existing._id
      }

      return await ctx.db.insert('surveyResponses', {
        surveyId,
        respondentId,
        respondentName: respondent.respondentName,
        responses: safeResponses,
        userId: respondent.userId,
        submittedAt: now,
        updatedAt: now,
      })
    } catch (err) {
      // Surface a legible error to the respondent instead of a raw server error.
      throw new ConvexError(
        `Could not save your response: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  },
})

/**
 * Submit to an anonymous survey. Reached only through the generic access-token
 * link, because an anonymous survey never issues personal ones.
 *
 * Nothing identifying is accepted or derived here — not the caller's identity,
 * not a respondent row, not an IP. The row that gets written has three columns
 * and none of them is a person. There is deliberately no upsert: recognising a
 * returning submitter is exactly the capability this is meant not to have.
 */
export const submitAnonymousResponse = mutation({
  args: {
    accessToken: v.string(),
    responses: v.any(), // Record<string, unknown>
  },
  returns: v.id('anonymousSurveyResponses'),
  handler: async (ctx, { accessToken, responses }) => {
    const survey = await ctx.db
      .query('feedbackSurveys')
      .withIndex('by_accessToken', (q) => q.eq('accessToken', accessToken))
      .unique()

    if (!survey) throw new ConvexError('Survey not found')
    if (!survey.anonymous)
      throw new ConvexError('This survey uses individual links')
    if (survey.status !== 'open')
      throw new ConvexError('Survey is no longer accepting responses')

    // Same hardening as the identified path: coerce keys so a bad form-field
    // key cannot crash the write with an opaque server error.
    const safeResponses = sanitizeResponseKeys(
      responses && typeof responses === 'object' && !Array.isArray(responses)
        ? (responses as Record<string, unknown>)
        : {},
    )

    const formFields = Array.isArray(survey.formFields)
      ? (survey.formFields as Array<FormField>)
      : []
    const errors = validateResponses(formFields, safeResponses)
    if (errors.length > 0)
      throw new ConvexError(`Validation errors: ${errors.join(', ')}`)

    try {
      return await ctx.db.insert('anonymousSurveyResponses', {
        surveyId: survey._id,
        responses: safeResponses,
        submittedAt: Date.now(),
      })
    } catch (err) {
      throw new ConvexError(
        `Could not save your response: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  },
})

// ─── One-off migration: repair invalid form-field keys ───

/**
 * Scan every survey and coerce invalid form-field `key`s (e.g. ones containing
 * `?`) to valid Convex field names. Fixes surveys whose responses could never
 * be saved because the bad key crashed the write. Idempotent and safe to re-run
 * (already-valid keys are untouched). No stored response used an invalid key
 * (they always failed to insert), so no response-data migration is needed.
 */
export const fixInvalidSurveyFieldKeys = internalMutation({
  args: {},
  returns: v.array(
    v.object({
      surveyId: v.id('feedbackSurveys'),
      title: v.string(),
      remapped: v.array(v.object({ from: v.string(), to: v.string() })),
    }),
  ),
  handler: async (ctx) => {
    const surveys = await ctx.db.query('feedbackSurveys').collect()
    const report: Array<{
      surveyId: Id<'feedbackSurveys'>
      title: string
      remapped: Array<{ from: string; to: string }>
    }> = []

    for (const s of surveys) {
      if (!Array.isArray(s.formFields)) continue
      const sanitized = sanitizeFormFieldKeys(s.formFields) as Array<{
        key?: unknown
      }>
      const remapped: Array<{ from: string; to: string }> = []
      for (let i = 0; i < s.formFields.length; i++) {
        const oldKey = (s.formFields[i] as { key?: unknown })?.key
        const newKey = sanitized[i]?.key
        if (
          typeof oldKey === 'string' &&
          typeof newKey === 'string' &&
          oldKey !== newKey
        ) {
          remapped.push({ from: oldKey, to: newKey })
        }
      }
      if (remapped.length > 0) {
        await ctx.db.patch('feedbackSurveys', s._id, {
          formFields: sanitized,
          updatedAt: Date.now(),
        })
        report.push({ surveyId: s._id, title: s.title, remapped })
      }
    }

    return report
  },
})

// ─── Authenticated query (for admin cross-reference) ───

export const getSurveyResponsesForUser = query({
  args: { userId: v.string() },
  returns: v.array(
    v.object({
      surveyTitle: v.string(),
      opportunityTitle: v.string(),
      responses: v.any(),
      submittedAt: v.number(),
    }),
  ),
  handler: async (ctx, { userId: targetUserId }) => {
    const currentUserId = await getUserId(ctx)
    if (!currentUserId) throw new ConvexError('Not authenticated')

    const userResponses = await ctx.db
      .query('surveyResponses')
      .withIndex('by_userId', (q) => q.eq('userId', targetUserId))
      .collect()

    // Deduplicate survey/opportunity fetches across responses
    const surveyCache = new Map<
      string,
      { title: string; opportunityId: Id<'orgOpportunities'> | null }
    >()
    const oppCache = new Map<string, string>()

    return await Promise.all(
      userResponses.map(async (r) => {
        let surveyInfo = surveyCache.get(r.surveyId)
        if (!surveyInfo) {
          const survey = await ctx.db.get('feedbackSurveys', r.surveyId)
          surveyInfo = {
            title: survey?.title ?? 'Unknown Survey',
            opportunityId: survey?.opportunityId ?? null,
          }
          surveyCache.set(r.surveyId, surveyInfo)
        }

        const oppKey = surveyInfo.opportunityId ?? ''
        let oppTitle = oppCache.get(oppKey)
        if (oppTitle === undefined && surveyInfo.opportunityId) {
          const opp = await ctx.db.get(
            'orgOpportunities',
            surveyInfo.opportunityId,
          )
          oppTitle = opp?.title ?? 'Unknown Opportunity'
          oppCache.set(oppKey, oppTitle)
        }

        return {
          surveyTitle: surveyInfo.title,
          opportunityTitle: oppTitle ?? 'Unknown Opportunity',
          responses: r.responses,
          submittedAt: r.submittedAt,
        }
      }),
    )
  },
})
