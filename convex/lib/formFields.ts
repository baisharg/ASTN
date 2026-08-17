import { v } from 'convex/values'

// --- Types ---

export type FormFieldKind =
  | 'text'
  | 'textarea'
  | 'email'
  | 'url'
  | 'select'
  | 'multi_select'
  | 'checkbox'
  | 'radio'
  | 'section_header'
  | 'rating'
  | 'nps'
  // Uploaded image. The stored response value is the Convex `_storage` id as a
  // plain string; resolve it to a URL with `feedbackSurveys.getFormImageUrls`.
  | 'image'

export interface FormField {
  key: string
  kind: FormFieldKind
  label: string
  description?: string
  required?: boolean
  placeholder?: string
  options?: Array<string>
  maxSelections?: number
  rows?: number
}

// --- Convex Validators ---

export const formFieldValidator = v.object({
  key: v.string(),
  kind: v.union(
    v.literal('text'),
    v.literal('textarea'),
    v.literal('email'),
    v.literal('url'),
    v.literal('select'),
    v.literal('multi_select'),
    v.literal('checkbox'),
    v.literal('radio'),
    v.literal('section_header'),
    v.literal('rating'),
    v.literal('nps'),
    v.literal('image'),
  ),
  label: v.string(),
  description: v.optional(v.string()),
  required: v.optional(v.boolean()),
  placeholder: v.optional(v.string()),
  options: v.optional(v.array(v.string())),
  maxSelections: v.optional(v.number()),
  rows: v.optional(v.number()),
})

export const formFieldsValidator = v.array(formFieldValidator)

// Identity fields pre-filled from the live ASTN profile. Stripped from any
// other pre-fill source so the profile stays the canonical identity record.
export const PROFILE_PREFILL_KEYS = [
  'firstName',
  'lastName',
  'email',
  'location',
  'profileUrl',
] as const

// --- Helpers ---

/**
 * Convex object field names must be identifier-like. Form-field `key`s become
 * keys of the stored `responses` object, so an invalid key (e.g. one with `?`,
 * spaces, or a leading digit) makes the response write throw an opaque
 * "Server Error". Keep this in sync with Convex's field-name rules.
 */
const VALID_FIELD_KEY = /^[a-zA-Z][a-zA-Z0-9_]*$/

/** Coerce an arbitrary string into a valid Convex field key. Idempotent. */
export function sanitizeFieldKey(key: string): string {
  let k = (key ?? '').replace(/[^a-zA-Z0-9_]/g, '')
  if (!k || !/^[a-zA-Z]/.test(k)) k = `field_${k}`
  return k
}

/**
 * Accept form fields from outside and refuse anything that is not an array of
 * field objects.
 *
 * Two opportunities in prod have `formFields` stored as a *string* — the JSON
 * text of the array, pasted straight into the Convex dashboard on 16-aug. The
 * apply page cannot render that, and nothing caught it, because `v.any()` takes
 * a string happily and `sanitizeFormFieldKeys` passes non-arrays through
 * untouched.
 *
 * So every write path calls this first. The message names the likely mistake,
 * because "invalid formFields" tells an agent nothing it can act on.
 */
export function assertFormFieldsShape(fields: unknown): Array<FormField> {
  if (typeof fields === 'string') {
    throw new Error(
      'formFields must be an array of field objects, not a JSON string. ' +
        'Parse it first and pass the array.',
    )
  }
  if (!Array.isArray(fields)) {
    throw new Error(
      `formFields must be an array of field objects (got ${typeof fields}).`,
    )
  }
  const bad = fields.findIndex(
    (f) =>
      !f ||
      typeof f !== 'object' ||
      Array.isArray(f) ||
      typeof (f as FormField).kind !== 'string' ||
      typeof (f as FormField).label !== 'string',
  )
  if (bad !== -1) {
    throw new Error(
      `formFields[${bad}] is not a field object — each one needs at least ` +
        `\`kind\` and \`label\`.`,
    )
  }
  return fields as Array<FormField>
}

/**
 * Return `fields` with every `key` coerced to a valid Convex field name,
 * deduping any collisions introduced by sanitization. Already-valid keys are
 * left untouched (so this is safe to run on existing data). Non-array input is
 * returned unchanged. Apply at every site that persists form fields.
 */
export function sanitizeFormFieldKeys<T>(fields: T): T {
  if (!Array.isArray(fields)) return fields
  const used = new Set<string>()
  const out = fields.map((f) => {
    if (!f || typeof f !== 'object' || typeof f.key !== 'string') return f
    let key = sanitizeFieldKey(f.key)
    if (used.has(key)) {
      let i = 2
      while (used.has(`${key}_${i}`)) i++
      key = `${key}_${i}`
    }
    used.add(key)
    return key === f.key ? f : { ...f, key }
  })
  return out as T
}

/**
 * Map the keys of a `responses` object through the same sanitization, so a
 * client that loaded a stale (pre-sanitization) form still saves under the
 * canonical key. First write wins on collision.
 */
export function sanitizeResponseKeys(
  responses: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(responses)) {
    if (VALID_FIELD_KEY.test(k)) {
      if (!(k in out)) out[k] = v
      continue
    }
    const sk = sanitizeFieldKey(k)
    if (!(sk in out)) out[sk] = v
  }
  return out
}

/** Return only fields that collect input (excludes section_header) */
export function getInputFields(fields: Array<FormField>): Array<FormField> {
  return (Array.isArray(fields) ? fields : []).filter(
    (f) => f && f.kind !== 'section_header',
  )
}

/** Return fields marked as required */
export function getRequiredFields(fields: Array<FormField>): Array<FormField> {
  return getInputFields(fields).filter((f) => f.required)
}

/**
 * Validate responses against formFields.
 * Returns an array of error strings (empty = valid).
 */
export function validateResponses(
  fields: Array<FormField>,
  responses: Record<string, unknown>,
): Array<string> {
  const errors: Array<string> = []
  for (const field of getRequiredFields(fields)) {
    const val = responses[field.key]
    if (val === undefined || val === null || val === '') {
      errors.push(`${field.label} is required`)
    } else if (Array.isArray(val) && val.length === 0) {
      errors.push(`${field.label} is required`)
    }
  }
  return errors
}

/**
 * Filter a prior-application `responses` map down to values that can be
 * safely re-used as pre-fill for a new form. Drops keys not present in
 * `fields`, values whose shape doesn't match the current field's kind, and
 * enum values that are no longer in the current `options` list.
 */
export function sanitizeResponsesForForm(
  fields: Array<FormField>,
  responses: Record<string, unknown>,
  stripKeys: ReadonlyArray<string> = [],
): Record<string, unknown> {
  const stripped = new Set(stripKeys)
  const out: Record<string, unknown> = {}
  const byKey = new Map(fields.map((f) => [f.key, f] as const))

  for (const [key, value] of Object.entries(responses ?? {})) {
    if (stripped.has(key)) continue
    const field = byKey.get(key)
    if (!field || field.kind === 'section_header') continue
    // `image` has no case in the switch below, so an uploaded photo is never
    // carried into a new form. That is deliberate: a picture someone attached
    // to one submission should not silently reappear attached to another.
    // Defensive: never carry storage-id-shaped blobs either.
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      '_storage' in (value as Record<string, unknown>)
    ) {
      continue
    }

    switch (field.kind) {
      case 'text':
      case 'textarea':
      case 'email':
      case 'url': {
        if (typeof value === 'string') out[key] = value
        break
      }
      case 'rating': {
        // DynamicFormRenderer emits 1..5 regardless of custom labels.
        if (
          typeof value === 'number' &&
          Number.isInteger(value) &&
          value >= 1 &&
          value <= 5
        ) {
          out[key] = value
        }
        break
      }
      case 'nps': {
        if (
          typeof value === 'number' &&
          Number.isInteger(value) &&
          value >= 0 &&
          value <= 10
        ) {
          out[key] = value
        }
        break
      }
      case 'checkbox': {
        if (typeof value === 'boolean') out[key] = value
        break
      }
      case 'select': {
        const options = field.options ?? []
        if (typeof value === 'string' && options.includes(value)) {
          out[key] = value
        }
        break
      }
      case 'radio': {
        // DynamicFormRenderer stores Yes/No radios as booleans; custom
        // options store the selected string.
        const options = field.options ?? ['Yes', 'No']
        if (typeof value === 'boolean') {
          if (options.includes('Yes') && options.includes('No')) {
            out[key] = value
          }
        } else if (typeof value === 'string' && options.includes(value)) {
          out[key] = value
        }
        break
      }
      case 'multi_select': {
        const options = new Set(field.options ?? [])
        if (Array.isArray(value)) {
          const kept = value.filter(
            (v): v is string => typeof v === 'string' && options.has(v),
          )
          const max = field.maxSelections ?? Infinity
          const truncated = kept.slice(0, max)
          if (truncated.length > 0) out[key] = truncated
        }
        break
      }
    }
  }

  return out
}

/**
 * Convert a label string to a camelCase key.
 * "First name" -> "firstName", "How course helps" -> "howCourseHelps",
 * "Año de graduación" -> "anoDeGraduacion".
 *
 * NFD-strips accents so accent-only headers (`Período`, `Pregunta`) produce
 * clean keys. Returns `''` if the result wouldn't start with a letter —
 * Convex rejects field names starting with `_` or a digit, so callers should
 * skip empty results rather than try to insert them.
 */
export function labelToKey(label: string): string {
  const camel = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) =>
      i === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join('')
  return /^[a-z]/.test(camel) ? camel : ''
}
