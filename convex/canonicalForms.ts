import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { requireOrgAdmin } from './lib/auth'
import {
  COURSE_PLACEHOLDER,
  assertFormFieldsShape,
  canonicalFormProblems,
  fillFormPlaceholders,
  sanitizeFormFieldKeys,
} from './lib/formFields'
import type { FormField } from './lib/formFields'

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
    const fields = sanitizeFormFieldKeys(
      assertFormFieldsShape(formFields).filter((f) => f.label.trim()),
    )
    const problems = canonicalFormProblems(fields)
    if (problems.length > 0) throw new ConvexError(problems.join(' '))

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
 * The form a new opportunity starts with: a copy of the canonical for its
 * kind with {{course}} filled in. Refuses, saying what to do, when that
 * canonical does not exist yet or needs a course name nobody gave.
 */
export async function copyCanonicalForm(
  ctx: MutationCtx,
  opts: {
    orgId: Id<'organizations'>
    isEOI: boolean | undefined
    courseName: string | undefined
  },
): Promise<Array<FormField>> {
  const kind: CanonicalKind = opts.isEOI ? 'eoi' : 'course'
  const canonical = await ctx.db
    .query('canonicalForms')
    .withIndex('by_org_and_kind', (q) =>
      q.eq('orgId', opts.orgId).eq('kind', kind),
    )
    .unique()
  if (!canonical) {
    throw new ConvexError(
      `There is no canonical ${kind === 'eoi' ? 'expression of interest' : 'course'} form yet. ` +
        'Set it up in Admin → Canonical forms first.',
    )
  }
  const fields = canonical.formFields as Array<FormField>
  const course = opts.courseName?.trim() ?? ''
  if (!course && JSON.stringify(fields).includes(COURSE_PLACEHOLDER)) {
    throw new ConvexError(
      `The canonical form uses ${COURSE_PLACEHOLDER}: fill in the course name.`,
    )
  }
  return fillFormPlaceholders(fields, { course })
}
