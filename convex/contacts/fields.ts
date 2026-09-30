import { ConvexError } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { CrmCollection, CrmFieldType } from './validators'

/**
 * Configurable CRM fields (see docs/crm-consolidation.md).
 *
 * Core columns stay on the record; everything else lives in `fields`, keyed
 * by a field definition. Builtin definitions replace the old flat columns and
 * keep their names as keys, so existing callers that send e.g. `skills` keep
 * working: `splitRecord` routes them into `fields`.
 */

export type FieldValue = string | Array<string> | boolean | number | null

export const CORE_COLUMNS: Record<CrmCollection, ReadonlyArray<string>> = {
  contacts: [
    'name',
    'email',
    'phone',
    'linkedin',
    'website',
    'location',
    'notes',
  ],
  organizations: ['name', 'description', 'notes'],
}

type BuiltinField = { key: string; label: string; type: CrmFieldType }

export const BUILTIN_FIELDS: Record<
  CrmCollection,
  ReadonlyArray<BuiltinField>
> = {
  contacts: [
    { key: 'relationship', label: 'Vínculo', type: 'singleSelect' },
    { key: 'role', label: 'Rol', type: 'singleSelect' },
    { key: 'title', label: 'Cargo', type: 'text' },
    { key: 'professionalField', label: 'Campo', type: 'multiSelect' },
    { key: 'careerStage', label: 'Etapa profesional', type: 'multiSelect' },
    {
      key: 'aiSafetyExperience',
      label: 'Experiencia en AI Safety',
      type: 'singleSelect',
    },
    { key: 'skills', label: 'Habilidades', type: 'multiSelect' },
    { key: 'interests', label: 'Intereses', type: 'multiSelect' },
    { key: 'availability', label: 'Disponibilidad', type: 'singleSelect' },
    { key: 'inBuenosAires', label: 'En Buenos Aires', type: 'checkbox' },
    {
      key: 'contactSource',
      label: 'Fuente de contacto',
      type: 'singleSelect',
    },
    { key: 'contactPerson', label: 'Persona de contacto', type: 'text' },
    { key: 'firstContact', label: 'Primer contacto', type: 'date' },
    {
      key: 'associatedOrganizations',
      label: 'Organizaciones',
      type: 'text',
    },
    { key: 'participatedIn', label: 'Participó en', type: 'multiSelect' },
    // Filled from Luma (convex/social/lumaCrm.ts)
    { key: 'lumaApproved', label: 'Eventos Luma (aprobado)', type: 'number' },
    {
      key: 'lumaCheckedIn',
      label: 'Eventos Luma (check-in)',
      type: 'number',
    },
    { key: 'lumaTags', label: 'Etiquetas en Luma', type: 'multiSelect' },
  ],
  organizations: [
    { key: 'type', label: 'Tipo', type: 'singleSelect' },
    { key: 'keyPeople', label: 'Personas clave', type: 'text' },
    { key: 'aiStance', label: 'Postura sobre IA', type: 'text' },
    { key: 'mainTopic', label: 'Tema principal', type: 'text' },
    { key: 'autoSummary', label: 'Resumen', type: 'longText' },
  ],
}

export const FIELD_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/

/** Turn a label into a field key: ASCII, camelCase-ish, starts with a letter. */
export function keyFromLabel(label: string): string {
  const words = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const key = words
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join('')
    .slice(0, 64)
  return /^[a-zA-Z]/.test(key) ? key : `f${key}`.slice(0, 64)
}

export async function listFieldDefs(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
  collection: CrmCollection,
): Promise<Array<Doc<'crmFieldDefs'>>> {
  return await ctx.db
    .query('crmFieldDefs')
    .withIndex('by_orgId_and_collection_and_order', (q) =>
      q.eq('orgId', orgId).eq('collection', collection),
    )
    .take(500)
}

/** Create any missing builtin field definitions for the org. Idempotent. */
export async function ensureBuiltinFieldDefs(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  collection: CrmCollection,
): Promise<Array<Doc<'crmFieldDefs'>>> {
  const existing = await listFieldDefs(ctx, orgId, collection)
  const byKey = new Set(existing.map((d) => d.key))
  let order = existing.reduce((max, d) => Math.max(max, d.order), -1) + 1
  const now = Date.now()
  for (const field of BUILTIN_FIELDS[collection]) {
    if (byKey.has(field.key)) continue
    await ctx.db.insert('crmFieldDefs', {
      orgId,
      collection,
      key: field.key,
      label: field.label,
      type: field.type,
      options: isSelect(field.type) ? [] : undefined,
      order: order++,
      source: 'builtin',
      createdAt: now,
      updatedAt: now,
    })
  }
  return await listFieldDefs(ctx, orgId, collection)
}

export function isSelect(type: CrmFieldType): boolean {
  return type === 'singleSelect' || type === 'multiSelect'
}

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  )
}

function parseBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number')
    return value === 1 ? true : value === 0 ? false : undefined
  if (typeof value !== 'string') return undefined
  const s = value.trim().toLowerCase()
  if (['si', 'sí', 'yes', 'y', 'true', '1', 'x', '✓', 'checked'].includes(s)) {
    return true
  }
  if (['no', 'n', 'false', '0', ''].includes(s)) return false
  return undefined
}

/** YYYY-MM-DD from a date-ish value, or undefined. */
function parseDate(value: unknown): string | undefined {
  if (typeof value === 'number') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10)
  }
  if (typeof value !== 'string') return undefined
  const s = value.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  }
  const parsed = Date.parse(s)
  return Number.isNaN(parsed)
    ? undefined
    : new Date(parsed).toISOString().slice(0, 10)
}

function splitList(value: unknown): Array<string> {
  const items = Array.isArray(value)
    ? value.map((x) => String(x))
    : String(value).split(/[,;\n]/)
  const seen = new Set<string>()
  const out: Array<string> = []
  for (const item of items) {
    const t = item.trim()
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase())
      out.push(t)
    }
  }
  return out
}

/**
 * Lenient conversion for imports and migrated data: splits lists, parses
 * yes/no and dates. Returns undefined for empty or unusable values.
 */
export function normalizeValue(
  type: CrmFieldType,
  raw: unknown,
): FieldValue | undefined {
  if (isEmpty(raw)) return undefined
  switch (type) {
    case 'multiSelect': {
      const list = splitList(raw)
      return list.length ? list : undefined
    }
    case 'checkbox':
      return parseBool(raw)
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
      return Number.isFinite(n) ? n : undefined
    }
    case 'date':
      return parseDate(raw)
    case 'singleSelect':
      return Array.isArray(raw)
        ? String(raw[0] ?? '').trim() || undefined
        : String(raw).trim()
    default:
      return Array.isArray(raw) ? raw.join(', ') : String(raw).trim()
  }
}

/**
 * Strict check for edits: the value must already have the field's shape and
 * select values must be known options. Null clears the field.
 */
export function validateValue(
  def: Doc<'crmFieldDefs'>,
  value: unknown,
): FieldValue {
  if (value === null || value === undefined) return null
  const fail = (): never => {
    throw new ConvexError(`Invalid value for field '${def.label}'`)
  }
  const options = new Set((def.options ?? []).map((o) => o.value))
  switch (def.type) {
    case 'multiSelect': {
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
        fail()
      }
      const list = value as Array<string>
      if (list.some((v) => !options.has(v))) fail()
      return list.length ? list : null
    }
    case 'singleSelect':
      if (typeof value !== 'string' || (value && !options.has(value))) fail()
      return (value as string) || null
    case 'checkbox':
      if (typeof value !== 'boolean') fail()
      return value as boolean
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) fail()
      return value as number
    case 'date':
      if (
        typeof value !== 'string' ||
        (value && !/^\d{4}-\d{2}-\d{2}$/.test(value))
      ) {
        fail()
      }
      return (value as string) || null
    default:
      if (typeof value !== 'string') fail()
      return (value as string).trim() || null
  }
}

/** Add any select values not yet in the definition's options. */
export async function addMissingOptions(
  ctx: MutationCtx,
  def: Doc<'crmFieldDefs'>,
  value: FieldValue | undefined,
): Promise<Doc<'crmFieldDefs'>> {
  if (!isSelect(def.type) || value === undefined || value === null) return def
  const values = Array.isArray(value) ? value : [String(value)]
  const known = new Set((def.options ?? []).map((o) => o.value))
  const missing = values.filter((v) => !known.has(v))
  if (missing.length === 0) return def
  const options = [
    ...(def.options ?? []),
    ...missing.map((value) => ({ value })),
  ]
  await ctx.db.patch('crmFieldDefs', def._id, {
    options,
    updatedAt: Date.now(),
  })
  return { ...def, options }
}

/**
 * Split an incoming flat record (core columns, builtin keys, custom keys)
 * into core columns and a `fields` bag, adding unseen select options to the
 * definitions. Unknown keys are ignored.
 */
export async function splitRecord(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  collection: CrmCollection,
  record: Record<string, unknown>,
): Promise<{
  core: Record<string, string>
  fields: Record<string, FieldValue>
}> {
  const defs = await ensureBuiltinFieldDefs(ctx, orgId, collection)
  const byKey = new Map(defs.map((d) => [d.key, d]))
  const core: Record<string, string> = {}
  const fields: Record<string, FieldValue> = {}
  for (const [key, raw] of Object.entries(record)) {
    if (CORE_COLUMNS[collection].includes(key)) {
      if (!isEmpty(raw)) core[key] = String(raw).trim()
      continue
    }
    const def = byKey.get(key)
    if (!def) continue
    const value = normalizeValue(def.type, raw)
    if (value === undefined) continue
    const updated = await addMissingOptions(ctx, def, value)
    byKey.set(key, updated)
    fields[key] = value
  }
  return { core, fields }
}
