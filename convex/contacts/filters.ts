import type { CrmCollection, CrmFieldType } from './validators'

/**
 * Pure value and filter helpers for CRM records, shared by the CRM screens
 * (src/components/crm/fieldValues.ts) and the MCP data layer, so a saved
 * view's filters mean the same thing in both. No Convex server imports.
 */

export type FieldValue = string | Array<string> | boolean | number | null

export type FilterOp =
  | 'is'
  | 'isNot'
  | 'contains'
  | 'hasAny'
  | 'hasAll'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'before'
  | 'after'

export type ViewFilter = { field: string; op: FilterOp; value?: unknown }

/** What filtering needs to know about a column. */
export type FilterColumn = { key: string; type: CrmFieldType; core: boolean }

/** Anything with core columns and a `fields` bag (contacts, organizations). */
export type FilterRecord = { fields?: Record<string, FieldValue> }

export const CORE_COLUMN_DEFS: Record<
  CrmCollection,
  ReadonlyArray<{ key: string; label: string; type: CrmFieldType }>
> = {
  contacts: [
    { key: 'name', label: 'Nombre', type: 'text' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'phone', label: 'Teléfono', type: 'phone' },
    { key: 'linkedin', label: 'LinkedIn', type: 'url' },
    { key: 'website', label: 'Sitio web', type: 'url' },
    { key: 'location', label: 'Ubicación', type: 'text' },
    { key: 'notes', label: 'Notas', type: 'longText' },
  ],
  organizations: [
    { key: 'name', label: 'Nombre', type: 'text' },
    { key: 'description', label: 'Descripción', type: 'longText' },
    { key: 'notes', label: 'Notas', type: 'longText' },
  ],
}

export const OPS_BY_TYPE: Record<CrmFieldType, Array<FilterOp>> = {
  text: ['contains', 'is', 'isNot', 'isEmpty', 'isNotEmpty'],
  longText: ['contains', 'isEmpty', 'isNotEmpty'],
  url: ['contains', 'isEmpty', 'isNotEmpty'],
  email: ['contains', 'is', 'isEmpty', 'isNotEmpty'],
  phone: ['contains', 'isEmpty', 'isNotEmpty'],
  singleSelect: ['is', 'isNot', 'isEmpty', 'isNotEmpty'],
  multiSelect: ['hasAny', 'hasAll', 'isNot', 'isEmpty', 'isNotEmpty'],
  checkbox: ['is'],
  date: ['is', 'before', 'after', 'isEmpty', 'isNotEmpty'],
  number: ['is', 'isNot', 'before', 'after', 'isEmpty', 'isNotEmpty'],
}

export function readValue(
  record: FilterRecord,
  column: FilterColumn,
): FieldValue {
  if (column.core) {
    const raw = (record as Record<string, unknown>)[column.key]
    return typeof raw === 'string' && raw !== '' ? raw : null
  }
  const raw = record.fields?.[column.key]
  return raw === undefined ? null : raw
}

export function isEmptyValue(value: FieldValue | undefined): boolean {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

/** Plain text for a value (CSV, search, tooltips). */
export function valueToText(value: FieldValue | undefined): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  return String(value)
}

/** Lowercase without accents, for search and text filters. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** Ops that take no value. */
export function opNeedsValue(op: FilterOp): boolean {
  return op !== 'isEmpty' && op !== 'isNotEmpty'
}

/**
 * Whether a filter is complete enough to apply. Half-filled filters (no
 * value typed yet) are ignored instead of hiding every record.
 */
export function filterIsActive(filter: ViewFilter): boolean {
  if (!opNeedsValue(filter.op)) return true
  const v = filter.value
  if (v === undefined || v === null) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (Array.isArray(v)) return v.length > 0
  return true
}

function filterText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : ''
}

function asList(value: unknown): Array<string> {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string' && value !== '') return [value]
  return []
}

export function matchesFilter(
  record: FilterRecord,
  column: FilterColumn,
  filter: ViewFilter,
): boolean {
  const value = readValue(record, column)
  const { op } = filter
  if (op === 'isEmpty') return isEmptyValue(value)
  if (op === 'isNotEmpty') return !isEmptyValue(value)

  switch (column.type) {
    case 'checkbox': {
      const want = filter.value === true
      return (value === true) === want
    }
    case 'singleSelect': {
      const list = asList(filter.value)
      const hit = typeof value === 'string' && list.includes(value)
      return op === 'isNot' ? !hit : hit
    }
    case 'multiSelect': {
      const list = asList(filter.value)
      const have = Array.isArray(value) ? value : []
      if (op === 'hasAll') return list.every((x) => have.includes(x))
      const any = list.some((x) => have.includes(x))
      return op === 'isNot' ? !any : any
    }
    case 'number': {
      const target = Number(filter.value)
      if (typeof value !== 'number') return op === 'isNot'
      if (op === 'is') return value === target
      if (op === 'isNot') return value !== target
      if (op === 'before') return value < target
      if (op === 'after') return value > target
      return true
    }
    case 'date': {
      const target = filterText(filter.value)
      if (typeof value !== 'string') return false
      if (op === 'is') return value === target
      if (op === 'before') return value < target
      if (op === 'after') return value > target
      return true
    }
    default: {
      const hay = normalizeText(valueToText(value))
      const needle = normalizeText(filterText(filter.value).trim())
      if (op === 'contains') return hay.includes(needle)
      if (op === 'is') return hay === needle
      if (op === 'isNot') return hay !== needle
      return true
    }
  }
}

/** Whether a record passes every filter (AND). */
export function matchesAll(
  record: FilterRecord,
  filters: ReadonlyArray<{ filter: ViewFilter; column: FilterColumn }>,
): boolean {
  return filters.every(({ filter, column }) =>
    matchesFilter(record, column, filter),
  )
}
