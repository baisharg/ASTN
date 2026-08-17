import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireOrgAdmin } from './lib/auth'
import {
  assertFormFieldsShape,
  sanitizeFormFieldKeys,
} from './lib/formFields'

/**
 * Org-level library of reusable question sets, for both application forms and
 * feedback surveys.
 *
 * This replaces "copy the form from last term's course": instead of hunting
 * through old opportunities, you save a form once and load it wherever you
 * need it. Loading copies the questions — the template and the form it seeded
 * are independent from that moment on, so editing a course's questions never
 * quietly rewrites the library, and vice versa.
 */

const templateKindValidator = v.union(
  v.literal('application'),
  v.literal('feedback'),
)

const templateReturnValidator = v.object({
  _id: v.id('formTemplates'),
  _creationTime: v.number(),
  orgId: v.id('organizations'),
  name: v.string(),
  kind: templateKindValidator,
  formFields: v.any(),
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})

export const listForOrg = query({
  args: { orgId: v.id('organizations'), kind: templateKindValidator },
  returns: v.array(templateReturnValidator),
  handler: async (ctx, { orgId, kind }) => {
    await requireOrgAdmin(ctx, orgId)

    const templates = await ctx.db
      .query('formTemplates')
      .withIndex('by_org_and_kind', (q) =>
        q.eq('orgId', orgId).eq('kind', kind),
      )
      .collect()

    return [...templates].sort((a, b) => b.updatedAt - a.updatedAt)
  },
})

/** Save the questions currently in the editor as a new template. */
export const create = mutation({
  args: {
    orgId: v.id('organizations'),
    name: v.string(),
    kind: templateKindValidator,
    formFields: v.any(),
  },
  returns: v.id('formTemplates'),
  handler: async (ctx, { orgId, name, kind, formFields }) => {
    const userId = await requireOrgAdmin(ctx, orgId)

    const trimmed = name.trim()
    if (!trimmed) throw new ConvexError('Give the template a name')
    if (!Array.isArray(formFields) || formFields.length === 0)
      throw new ConvexError('There are no questions to save')

    // A duplicate name makes the picker ambiguous, which is worse than a
    // rejected save the admin can immediately fix.
    const existing = await ctx.db
      .query('formTemplates')
      .withIndex('by_org_and_kind', (q) =>
        q.eq('orgId', orgId).eq('kind', kind),
      )
      .collect()
    if (existing.some((t) => t.name.toLowerCase() === trimmed.toLowerCase()))
      throw new ConvexError(`A template called "${trimmed}" already exists`)

    const now = Date.now()
    return await ctx.db.insert('formTemplates', {
      orgId,
      name: trimmed,
      kind,
      formFields: sanitizeFormFieldKeys(assertFormFieldsShape(formFields)),
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })
  },
})

/** Overwrite an existing template with the questions now in the editor. */
export const update = mutation({
  args: {
    templateId: v.id('formTemplates'),
    name: v.optional(v.string()),
    formFields: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, { templateId, name, formFields }) => {
    const template = await ctx.db.get('formTemplates', templateId)
    if (!template) throw new ConvexError('Template not found')

    await requireOrgAdmin(ctx, template.orgId)

    const patch: Record<string, unknown> = { updatedAt: Date.now() }
    if (name !== undefined) {
      const trimmed = name.trim()
      if (!trimmed) throw new ConvexError('Give the template a name')
      patch.name = trimmed
    }
    if (formFields !== undefined) {
      if (!Array.isArray(formFields) || formFields.length === 0)
        throw new ConvexError('There are no questions to save')
      patch.formFields = sanitizeFormFieldKeys(assertFormFieldsShape(formFields))
    }

    await ctx.db.patch('formTemplates', templateId, patch)
    return null
  },
})

export const remove = mutation({
  args: { templateId: v.id('formTemplates') },
  returns: v.null(),
  handler: async (ctx, { templateId }) => {
    const template = await ctx.db.get('formTemplates', templateId)
    if (!template) throw new ConvexError('Template not found')

    await requireOrgAdmin(ctx, template.orgId)

    // Forms seeded from this template keep their questions: loading copied
    // them, so deleting the library entry takes nothing away from a live form.
    await ctx.db.delete('formTemplates', templateId)
    return null
  },
})
