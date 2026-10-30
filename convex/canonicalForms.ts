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
import type { FormField } from './lib/formFields'
import { COURSE_PLACEHOLDERS, courseOf } from './lib/courses'

/**
 * The org's canonical application forms. Every new opportunity copies one —
 * the course form, or the expression-of-interest form for EOIs — and fills
 * its placeholders. Editions no longer build or copy forms of their own, so
 * a question removed here is gone from every edition created afterwards,
 * while an edition already taking applications keeps the form people are
 * answering.
 *
 * Deliberately not reachable from the MCP: the canonical is edited by hand,
 * from the admin, at any time (also while no edition is open).
 */

const kindValidator = v.union(v.literal('course'), v.literal('eoi'))
type CanonicalKind = 'course' | 'eoi'

export const get = query({
  args: { orgId: v.id('organizations'), kind: kindValidator },
  returns: v.union(
    v.object({ formFields: v.any(), updatedAt: v.number() }),
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
      ? { formFields: form.formFields, updatedAt: form.updatedAt }
      : null
  },
})

export const save = mutation({
  args: {
    orgId: v.id('organizations'),
    kind: kindValidator,
    formFields: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, { orgId, kind, formFields }) => {
    const userId = await requireOrgAdmin(ctx, orgId)
    const fields = cleanAdminForm(formFields)

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
        updatedBy: userId,
        updatedAt: now,
      })
    } else {
      await ctx.db.insert('canonicalForms', {
        orgId,
        kind,
        formFields: fields,
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
  const kind: CanonicalKind = opts.source
  const canonical = await ctx.db
    .query('canonicalForms')
    .withIndex('by_org_and_kind', (q) =>
      q.eq('orgId', opts.orgId).eq('kind', kind),
    )
    .unique()
  if (!canonical) {
    throw new ConvexError(
      `There is no canonical ${kind === 'eoi' ? 'expression of interest' : 'course'} form yet. ` +
        'Set it up in Admin → Canonical forms first, or create the opportunity with a custom form.',
    )
  }
  const fields = canonical.formFields as Array<FormField>
  const course = courseOf(opts.tags)
  const values = course
    ? {
        course: COURSE_PLACEHOLDERS[course].name,
        area: COURSE_PLACEHOLDERS[course].area,
      }
    : {}
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
