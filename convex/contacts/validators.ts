import { v } from 'convex/values'
import type { Infer } from 'convex/values'

/** Validators for the configurable CRM (see docs/crm-consolidation.md). */

export const crmCollectionValidator = v.union(
  v.literal('contacts'),
  v.literal('organizations'),
)
export type CrmCollection = Infer<typeof crmCollectionValidator>

export const crmFieldTypeValidator = v.union(
  v.literal('text'),
  v.literal('longText'),
  v.literal('singleSelect'),
  v.literal('multiSelect'),
  v.literal('checkbox'),
  v.literal('date'),
  v.literal('number'),
  v.literal('url'),
  v.literal('email'),
  v.literal('phone'),
)
export type CrmFieldType = Infer<typeof crmFieldTypeValidator>

export const crmFieldOptionValidator = v.object({
  value: v.string(),
  color: v.optional(v.string()),
})

export const crmFieldSourceValidator = v.union(
  v.literal('builtin'),
  v.literal('airtable'),
  v.literal('admin'),
)

export const crmActivityKindValidator = v.union(
  v.literal('program'),
  v.literal('session'),
  v.literal('form'),
  v.literal('event'),
  v.literal('note'),
  v.literal('application'),
)

export const crmActivitySourceValidator = v.union(
  v.literal('airtable'),
  v.literal('luma'),
  v.literal('app'),
  v.literal('manual'),
)

export const crmViewFilterValidator = v.object({
  field: v.string(),
  op: v.union(
    v.literal('is'),
    v.literal('isNot'),
    v.literal('contains'),
    v.literal('hasAny'),
    v.literal('hasAll'),
    v.literal('isEmpty'),
    v.literal('isNotEmpty'),
    v.literal('before'),
    v.literal('after'),
  ),
  value: v.optional(v.any()),
})

export const crmViewSortValidator = v.object({
  field: v.string(),
  dir: v.union(v.literal('asc'), v.literal('desc')),
})

/** A value stored in a record's `fields` bag. */
export const crmFieldValueValidator = v.union(
  v.string(),
  v.array(v.string()),
  v.boolean(),
  v.number(),
  v.null(),
)
