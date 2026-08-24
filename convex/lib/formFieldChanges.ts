import type { QueryCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import type { FormField } from './formFields'

/**
 * What editing a form's questions would cost.
 *
 * Answers are stored as an object keyed by `field.key`, so removing a question —
 * or renaming its key, which is the same thing to the database — does not delete
 * the answer. It strands it: the value stays in the document with no question to
 * display it under. Adding questions is free; old answers simply lack the key.
 *
 * This exists so callers can say "this discards 12 answers, continue?" instead of
 * the two bad alternatives: refusing every structural edit (which is what pushed
 * the team to edit the Convex dashboard by hand) or silently orphaning data.
 *
 * Used by both write paths — the admin UI and the MCP — so the rule cannot drift
 * between them.
 */
export interface FormFieldChangeImpact {
  /** Keys that collect input today and would not exist afterwards. */
  strandedKeys: Array<string>
  /** Stored responses holding a value under at least one stranded key. */
  affectedResponses: number
}

const inputKeys = (fields: Array<FormField>): Set<string> =>
  new Set(
    (Array.isArray(fields) ? fields : [])
      .filter((f) => f && f.kind !== 'section_header' && typeof f.key === 'string')
      .map((f) => f.key),
  )

/** Keys present in `before` that `after` no longer collects. */
export function strandedKeys(
  before: Array<FormField>,
  after: Array<FormField>,
): Array<string> {
  const kept = inputKeys(after)
  return [...inputKeys(before)].filter((k) => !kept.has(k))
}

/** How many of `responses` hold a non-empty value under one of `keys`. */
export function countAffected(
  keys: Array<string>,
  responses: Array<unknown>,
): number {
  if (keys.length === 0) return 0
  let n = 0
  for (const raw of responses) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const values = raw as Record<string, unknown>
    const hit = keys.some((k) => {
      const v = values[k]
      if (v === undefined || v === null || v === '') return false
      if (Array.isArray(v) && v.length === 0) return false
      return true
    })
    if (hit) n++
  }
  return n
}

/**
 * Impact of replacing an opportunity's application form with `after`.
 * Reads the opportunity's submitted applications, so it is only meaningful
 * inside a query or mutation.
 */
export async function impactOnApplications(
  ctx: QueryCtx,
  opportunityId: Id<'orgOpportunities'>,
  before: Array<FormField>,
  after: Array<FormField>,
): Promise<FormFieldChangeImpact> {
  const keys = strandedKeys(before, after)
  if (keys.length === 0) return { strandedKeys: [], affectedResponses: 0 }

  const applications = await ctx.db
    .query('opportunityApplications')
    .withIndex('by_opportunity_and_status', (q) =>
      q.eq('opportunityId', opportunityId),
    )
    .collect()

  return {
    strandedKeys: keys,
    affectedResponses: countAffected(
      keys,
      applications.map((a) => a.responses),
    ),
  }
}

/**
 * Impact of replacing a feedback survey's questions with `after`.
 *
 * Reads both response tables. The anonymous one has no identity column by
 * design, but its answers are keyed the same way, so a removed question strands
 * them exactly like an identified one — the count has to include them or the
 * warning understates what is being discarded.
 */
export async function impactOnSurveyResponses(
  ctx: QueryCtx,
  surveyId: Id<'feedbackSurveys'>,
  before: Array<FormField>,
  after: Array<FormField>,
): Promise<FormFieldChangeImpact> {
  const keys = strandedKeys(before, after)
  if (keys.length === 0) return { strandedKeys: [], affectedResponses: 0 }

  const identified = await ctx.db
    .query('surveyResponses')
    .withIndex('by_survey', (q) => q.eq('surveyId', surveyId))
    .collect()
  const anonymous = await ctx.db
    .query('anonymousSurveyResponses')
    .withIndex('by_survey', (q) => q.eq('surveyId', surveyId))
    .collect()

  return {
    strandedKeys: keys,
    affectedResponses: countAffected(keys, [
      ...identified.map((r) => r.responses),
      ...anonymous.map((r) => r.responses),
    ]),
  }
}

/**
 * A sentence an admin or an agent can act on. Names the questions and the
 * number of answers, because "this is not allowed" teaches nobody anything.
 */
export function describeImpact(impact: FormFieldChangeImpact): string {
  const { strandedKeys: keys, affectedResponses } = impact
  const questions = keys.length === 1 ? 'question' : 'questions'
  const answers = affectedResponses === 1 ? 'answer' : 'answers'
  return (
    `Removing ${keys.length} ${questions} (${keys.join(', ')}) would strand ` +
    `${affectedResponses} already-submitted ${answers}: the values stay in the ` +
    `database but nothing displays them.`
  )
}
