import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { requireOrgAdmin } from './lib/auth'
import {
  assertFormFieldsShape,
  canonicalFormProblems,
  fillFormPlaceholders,
  missingPlaceholders,
  sanitizeFormFieldKeys,
} from './lib/formFields'
import type { FormField, PlaceholderValues } from './lib/formFields'
import { COURSE_PLACEHOLDERS, courseOf } from './lib/courses'

/**
 * The org's canonical forms. Every new opportunity copies one of the
 * application forms — the course form, or the expression-of-interest form for
 * EOIs — and fills its placeholders. A new feedback survey starts from one of
 * the two feedback forms (the course feedback, or the anonymous one), with
 * its title and intro. Editions no longer build or copy forms of their own, so
 * a question removed here is gone from every edition created afterwards,
 * while an edition already taking applications keeps the form people are
 * answering.
 *
 * Deliberately not reachable from the MCP: the canonical is edited by hand,
 * from the admin, at any time (also while no edition is open).
 */

const kindValidator = v.union(
  v.literal('course'),
  v.literal('eoi'),
  v.literal('feedback'),
  v.literal('feedback_anonymous'),
)
type CanonicalKind = 'course' | 'eoi' | 'feedback' | 'feedback_anonymous'

const isFeedback = (kind: CanonicalKind) =>
  kind === 'feedback' || kind === 'feedback_anonymous'

export const get = query({
  args: { orgId: v.id('organizations'), kind: kindValidator },
  returns: v.union(
    v.object({
      formFields: v.any(),
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, { orgId, kind }) => {
    await requireOrgAdmin(ctx, orgId)
    const form = await ctx.db
      .query('canonicalForms')
      .withIndex('by_org_and_kind', (q) =>
        q.eq('orgId', orgId).eq('kind', kind),
      )
      .unique()
    return form
      ? {
          formFields: form.formFields,
          title: form.title,
          description: form.description,
          updatedAt: form.updatedAt,
        }
      : null
  },
})

export const save = mutation({
  args: {
    orgId: v.id('organizations'),
    kind: kindValidator,
    formFields: v.any(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { orgId, kind, formFields, title, description }) => {
    const userId = await requireOrgAdmin(ctx, orgId)
    // A survey asks no identity questions: its personal link says who answered.
    const fields = isFeedback(kind)
      ? cleanSurveyForm(formFields)
      : cleanAdminForm(formFields)
    const intro = isFeedback(kind)
      ? {
          title: title?.trim() || undefined,
          description: description?.trim() || undefined,
        }
      : {}

    const existing = await ctx.db
      .query('canonicalForms')
      .withIndex('by_org_and_kind', (q) =>
        q.eq('orgId', orgId).eq('kind', kind),
      )
      .unique()
    const now = Date.now()
    if (existing) {
      await ctx.db.patch('canonicalForms', existing._id, {
        formFields: fields,
        ...intro,
        updatedBy: userId,
        updatedAt: now,
      })
    } else {
      await ctx.db.insert('canonicalForms', {
        orgId,
        kind,
        formFields: fields,
        ...intro,
        updatedBy: userId,
        updatedAt: now,
      })
    }
    return null
  },
})

/**
 * Where an opportunity's form comes from: the course canonical, the
 * expression-of-interest canonical, or nowhere ("custom") for the exceptions
 * that are not course editions, such as a facilitator feedback form or a job.
 * Only a custom form is edited on the opportunity itself.
 */
export const formSourceValidator = v.union(
  v.literal('course'),
  v.literal('eoi'),
  v.literal('custom'),
)
export type FormSource = 'course' | 'eoi' | 'custom'

/** Opportunities created before formSource existed follow their EOI flag. */
export function formSourceOf(opportunity: {
  formSource?: FormSource
  isEOI?: boolean
}): FormSource {
  return opportunity.formSource ?? (opportunity.isEOI ? 'eoi' : 'course')
}

// What a custom form starts with: the questions every form needs.
const CUSTOM_FORM_START: Array<FormField> = [
  { key: 'firstName', kind: 'text', label: 'Nombre', required: true },
  { key: 'lastName', kind: 'text', label: 'Apellido', required: true },
  { key: 'email', kind: 'email', label: 'Email', required: true },
]

/**
 * The form a new opportunity starts with: a copy of the canonical for its
 * source with {{course}} and {{area}} filled in from its course tag, or the
 * bare start of a custom form. Refuses, saying what to do, when that canonical does not exist
 * yet or uses a placeholder nobody filled.
 */
export async function copyCanonicalForm(
  ctx: MutationCtx,
  opts: {
    orgId: Id<'organizations'>
    source: FormSource
    // The course tag fills {{course}} and {{area}} (convex/lib/courses.ts).
    tags: ReadonlyArray<string> | undefined
  },
): Promise<Array<FormField>> {
  if (opts.source === 'custom') return CUSTOM_FORM_START
  const kind = opts.source
  const canonical = await ctx.db
    .query('canonicalForms')
    .withIndex('by_org_and_kind', (q) =>
      q.eq('orgId', opts.orgId).eq('kind', kind),
    )
    .unique()
  if (!canonical) {
    throw new ConvexError(
      `There is no canonical ${kind === 'eoi' ? 'expression of interest' : 'course'} form yet. ` +
        'Set it up in Admin → Canonicals first, or create the opportunity with a custom form.',
    )
  }
  const fields = canonical.formFields as Array<FormField>
  const values = coursePlaceholderValues(opts.tags)
  if (missingPlaceholders(fields, values).length > 0) {
    throw new ConvexError(
      'Choose the course: the canonical form names it in its questions.',
    )
  }
  return fillFormPlaceholders(fields, values)
}

/**
 * Validate and clean a form an admin wrote: the shape is checked, keys are
 * sanitized, blank questions dropped, and the identity questions required.
 */
export function cleanAdminForm(formFields: unknown): Array<FormField> {
  const fields = sanitizeFormFieldKeys(
    assertFormFieldsShape(formFields).filter((f) => f.label.trim()),
  )
  const problems = canonicalFormProblems(fields)
  if (problems.length > 0) throw new ConvexError(problems.join(' '))
  return fields
}

/** A survey's questions, checked and with sanitized keys and no blanks. */
function cleanSurveyForm(formFields: unknown): Array<FormField> {
  return sanitizeFormFieldKeys(
    assertFormFieldsShape(formFields).filter((f) => f.label.trim()),
  )
}

/** {{course}} and {{area}} for an opportunity, from its course tag. */
export function coursePlaceholderValues(
  tags: ReadonlyArray<string> | undefined,
): PlaceholderValues {
  const course = courseOf(tags)
  return course
    ? {
        course: COURSE_PLACEHOLDERS[course].name,
        area: COURSE_PLACEHOLDERS[course].area,
      }
    : {}
}

/**
 * What a new feedback survey for this opportunity starts with: the canonical
 * feedback form (course or anonymous) with {{course}} and {{area}} filled from
 * the opportunity's course tag. The team still edits it before creating the
 * survey. Placeholders that cannot be filled are listed so the page can say so.
 */
export const surveyStart = query({
  args: {
    opportunityId: v.id('orgOpportunities'),
    anonymous: v.boolean(),
  },
  returns: v.union(
    v.null(),
    v.object({
      title: v.string(),
      description: v.string(),
      formFields: v.any(),
      missing: v.array(v.string()),
    }),
  ),
  handler: async (ctx, { opportunityId, anonymous }) => {
    const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
    if (!opportunity) return null
    await requireOrgAdmin(ctx, opportunity.orgId)
    const canonical = await ctx.db
      .query('canonicalForms')
      .withIndex('by_org_and_kind', (q) =>
        q
          .eq('orgId', opportunity.orgId)
          .eq('kind', anonymous ? 'feedback_anonymous' : 'feedback'),
      )
      .unique()
    if (!canonical) return null
    const values = coursePlaceholderValues(opportunity.tags)
    const fields = canonical.formFields as Array<FormField>
    const title = canonical.title ?? ''
    const description = canonical.description ?? ''
    // The title and intro count too: label them as one more question.
    const probe: Array<FormField> = [
      ...fields,
      { key: '_intro', kind: 'text', label: `${title} ${description}` },
    ]
    return {
      title: fillText(title, values),
      description: fillText(description, values),
      formFields: fillFormPlaceholders(fields, values),
      missing: missingPlaceholders(probe, values),
    }
  },
})

/** Fill {{course}} and {{area}} in free text, leaving unknown ones as they are. */
export function fillText(text: string, values: PlaceholderValues): string {
  return fillFormPlaceholders(
    [{ key: 'x', kind: 'text', label: text }],
    values,
  )[0].label
}
