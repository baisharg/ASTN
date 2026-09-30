import type { FunctionReturnType } from 'convex/server'
import type { api } from '../../../convex/_generated/api'
import type { Doc } from '../../../convex/_generated/dataModel'
import type {
  CrmCollection,
  CrmFieldType,
} from '../../../convex/contacts/validators'
import {
  CORE_COLUMN_DEFS,
  filterIsActive,
  isEmptyValue,
  matchesFilter,
  normalizeText,
  opNeedsValue,
  readValue,
  valueToText,
} from '../../../convex/contacts/filters'
import type {
  FieldValue,
  FilterOp,
  ViewFilter,
} from '../../../convex/contacts/filters'

/**
 * Pure helpers for the configurable CRM screens: reading values, filters,
 * sort, grouping, search and CSV. See docs/crm-consolidation.md.
 */

export type { CrmCollection, CrmFieldType, FieldValue, FilterOp, ViewFilter }

// Value and filter semantics are shared with the MCP server.
export {
  OPS_BY_TYPE,
  filterIsActive,
  isEmptyValue,
  matchesFilter,
  normalizeText,
  opNeedsValue,
  readValue,
  valueToText,
} from '../../../convex/contacts/filters'

export type FieldDef = FunctionReturnType<
  typeof api.contacts.records.listFields
>[number]

export type CrmRecord = Doc<'crmContacts'> | Doc<'crmOrganizations'>

/** A table column: a core column on the record or a field definition. */
export type CrmColumn = {
  key: string
  label: string
  type: CrmFieldType
  core: boolean
  def: FieldDef | null
}

export type ViewSort = { field: string; dir: 'asc' | 'desc' }

export type ViewState = {
  filters: Array<ViewFilter>
  sort: Array<ViewSort>
  /** Visible column keys in order; null = the default set. */
  columns: Array<string> | null
  groupBy: string | null
}

export const EMPTY_VIEW: ViewState = {
  filters: [],
  sort: [],
  columns: null,
  groupBy: null,
}

// ── Core columns ─────────────────────────────────────────────────────────

export function coreColumns(collection: CrmCollection): Array<CrmColumn> {
  return CORE_COLUMN_DEFS[collection].map((c) => ({
    ...c,
    core: true,
    def: null,
  }))
}

/** Core columns first (notes last), then field definitions in order. */
export function buildColumns(
  collection: CrmCollection,
  defs: Array<FieldDef>,
): Array<CrmColumn> {
  const core = coreColumns(collection)
  const notes = core.filter((c) => c.key === 'notes')
  const rest = core.filter((c) => c.key !== 'notes')
  const fields = [...defs]
    .sort((a, b) => a.order - b.order)
    .map((d) => ({
      key: d.key,
      label: d.label,
      type: d.type,
      core: false,
      def: d,
    }))
  return [...rest, ...fields, ...notes]
}

/** Columns shown when no view picks them: everything but hidden fields. */
export function defaultVisibleKeys(columns: Array<CrmColumn>): Array<string> {
  return columns.filter((c) => !c.def?.hidden).map((c) => c.key)
}

export function isSelectType(type: CrmFieldType): boolean {
  return type === 'singleSelect' || type === 'multiSelect'
}

export function isGroupable(column: CrmColumn): boolean {
  return (
    column.type === 'singleSelect' ||
    column.type === 'multiSelect' ||
    column.type === 'checkbox'
  )
}

// ── Labels ───────────────────────────────────────────────────────────────

export const FIELD_TYPE_LABELS: Record<CrmFieldType, string> = {
  text: 'Texto',
  longText: 'Texto largo',
  singleSelect: 'Selección única',
  multiSelect: 'Selección múltiple',
  checkbox: 'Casilla',
  date: 'Fecha',
  number: 'Número',
  url: 'URL',
  email: 'Email',
  phone: 'Teléfono',
}

export const FIELD_SOURCE_LABELS: Record<FieldDef['source'], string> = {
  builtin: 'Predefinido',
  airtable: 'Airtable',
  admin: 'Personalizado',
}

// ── Option colors ────────────────────────────────────────────────────────

export const OPTION_COLORS = [
  'gray',
  'blue',
  'green',
  'yellow',
  'orange',
  'red',
  'pink',
  'purple',
  'teal',
  'cyan',
] as const
export type OptionColor = (typeof OPTION_COLORS)[number]

export const OPTION_COLOR_LABELS: Record<OptionColor, string> = {
  gray: 'Gris',
  blue: 'Azul',
  green: 'Verde',
  yellow: 'Amarillo',
  orange: 'Naranja',
  red: 'Rojo',
  pink: 'Rosa',
  purple: 'Violeta',
  teal: 'Verde azulado',
  cyan: 'Celeste',
}

// Full class strings so Tailwind picks them up.
const OPTION_COLOR_CLASSES: Record<OptionColor, string> = {
  gray: 'bg-slate-100 text-slate-700 border-slate-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  green: 'bg-green-50 text-green-700 border-green-200',
  yellow: 'bg-yellow-50 text-yellow-800 border-yellow-200',
  orange: 'bg-orange-50 text-orange-700 border-orange-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  pink: 'bg-pink-50 text-pink-700 border-pink-200',
  purple: 'bg-violet-50 text-violet-700 border-violet-200',
  teal: 'bg-teal-50 text-teal-700 border-teal-200',
  cyan: 'bg-cyan-50 text-cyan-700 border-cyan-200',
}

export const OPTION_SWATCH_CLASSES: Record<OptionColor, string> = {
  gray: 'bg-slate-300',
  blue: 'bg-blue-400',
  green: 'bg-green-400',
  yellow: 'bg-yellow-300',
  orange: 'bg-orange-400',
  red: 'bg-red-400',
  pink: 'bg-pink-400',
  purple: 'bg-violet-400',
  teal: 'bg-teal-400',
  cyan: 'bg-cyan-400',
}

export function isOptionColor(value: unknown): value is OptionColor {
  return (
    typeof value === 'string' &&
    (OPTION_COLORS as ReadonlyArray<string>).includes(value)
  )
}

/**
 * The palette color for a stored option color. Airtable imports use color
 * families (`blue`, `cyan`…) and its API also has shades like `blueLight2`
 * or `grayDark1`, which map to their family. Unknown values → gray.
 */
export function paletteColor(color: string | undefined): OptionColor {
  if (!color) return 'gray'
  const family = color.replace(/(Light|Dark|Bright)\d*$/, '').toLowerCase()
  return isOptionColor(family) ? family : 'gray'
}

/** Tag classes for an option: its color, or gray. */
export function optionClasses(color: string | undefined): string {
  return OPTION_COLOR_CLASSES[paletteColor(color)]
}

export function optionColor(
  def: FieldDef | null,
  value: string,
): string | undefined {
  return def?.options.find((o) => o.value === value)?.color
}

// ── Search ───────────────────────────────────────────────────────────────

/** Every searchable string on a record, normalized, in one haystack. */
export function searchHaystack(
  record: CrmRecord,
  columns: Array<CrmColumn>,
): string {
  const parts: Array<string> = []
  for (const column of columns) {
    if (column.type === 'checkbox' || column.type === 'number') continue
    const text = valueToText(readValue(record, column))
    if (text) parts.push(text)
  }
  if ('otherEmails' in record && record.otherEmails) {
    parts.push(...record.otherEmails)
  }
  return normalizeText(parts.join(' \u0000 '))
}

// ── Filters ──────────────────────────────────────────────────────────────

export function opLabel(op: FilterOp, type: CrmFieldType): string {
  switch (op) {
    case 'is':
      return type === 'singleSelect' ? 'es alguno de' : 'es'
    case 'isNot':
      return type === 'singleSelect' || type === 'multiSelect'
        ? 'no es ninguno de'
        : 'no es'
    case 'contains':
      return 'contiene'
    case 'hasAny':
      return 'tiene alguno de'
    case 'hasAll':
      return 'tiene todos'
    case 'isEmpty':
      return 'está vacío'
    case 'isNotEmpty':
      return 'no está vacío'
    case 'before':
      return type === 'number' ? 'menor que' : 'antes del'
    case 'after':
      return type === 'number' ? 'mayor que' : 'después del'
  }
}

/** Initial value for a new filter on this column with this op. */
export function defaultFilterValue(column: CrmColumn, op: FilterOp): unknown {
  if (!opNeedsValue(op)) return undefined
  if (column.type === 'checkbox') return true
  if (isSelectType(column.type)) return []
  return ''
}

// ── Sort ─────────────────────────────────────────────────────────────────

const COLLATOR = new Intl.Collator('es', { numeric: true, sensitivity: 'base' })

function optionIndex(column: CrmColumn, value: string): number {
  const i = column.def?.options.findIndex((o) => o.value === value) ?? -1
  return i === -1 ? Number.MAX_SAFE_INTEGER : i
}

/** Compare two values of a column, ascending. Empty values sort last. */
export function compareValues(
  column: CrmColumn,
  a: FieldValue,
  b: FieldValue,
): number {
  const ea = isEmptyValue(a)
  const eb = isEmptyValue(b)
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1
  switch (column.type) {
    case 'number':
      return Number(a) - Number(b)
    case 'checkbox':
      return a === b ? 0 : a === true ? -1 : 1
    case 'singleSelect':
      return (
        optionIndex(column, String(a)) - optionIndex(column, String(b)) ||
        COLLATOR.compare(String(a), String(b))
      )
    case 'multiSelect': {
      const la = Array.isArray(a) ? a : []
      const lb = Array.isArray(b) ? b : []
      const ia = Math.min(...la.map((x) => optionIndex(column, x)))
      const ib = Math.min(...lb.map((x) => optionIndex(column, x)))
      return ia - ib || la.length - lb.length
    }
    default:
      return COLLATOR.compare(valueToText(a), valueToText(b))
  }
}

export function sortRecords<T extends CrmRecord>(
  records: Array<T>,
  sort: Array<ViewSort>,
  columnsByKey: Map<string, CrmColumn>,
): Array<T> {
  const rules = sort
    .map((s) => ({ column: columnsByKey.get(s.field), dir: s.dir }))
    .filter((r): r is { column: CrmColumn; dir: 'asc' | 'desc' } => !!r.column)
  if (rules.length === 0) return records
  return [...records].sort((a, b) => {
    for (const { column, dir } of rules) {
      const va = readValue(a, column)
      const vb = readValue(b, column)
      // Empty values stay last in both directions.
      const ea = isEmptyValue(va)
      const eb = isEmptyValue(vb)
      if (ea !== eb) return ea ? 1 : -1
      const c = compareValues(column, va, vb)
      if (c !== 0) return dir === 'asc' ? c : -c
    }
    return 0
  })
}

// ── Grouping ─────────────────────────────────────────────────────────────

export type RecordGroup<T> = {
  key: string
  label: string
  color: string | undefined
  records: Array<T>
}

export const EMPTY_GROUP_KEY = '\u0000empty'

/**
 * Group by a select or checkbox column, keeping each group's records in the
 * given order. A multi-select record appears in each of its groups. Groups
 * follow the field's option order; unknown values after, empty last.
 */
export function groupRecords<T extends CrmRecord>(
  records: Array<T>,
  column: CrmColumn,
): Array<RecordGroup<T>> {
  const groups = new Map<string, RecordGroup<T>>()
  const add = (key: string, label: string, record: T) => {
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        label,
        color:
          key === EMPTY_GROUP_KEY ? undefined : optionColor(column.def, key),
        records: [],
      }
      groups.set(key, group)
    }
    group.records.push(record)
  }
  for (const record of records) {
    const value = readValue(record, column)
    if (column.type === 'checkbox') {
      if (value === true) add('true', 'Sí', record)
      else add('false', 'No', record)
    } else if (isEmptyValue(value)) {
      add(EMPTY_GROUP_KEY, 'Sin valor', record)
    } else if (Array.isArray(value)) {
      for (const v of value) add(v, v, record)
    } else {
      add(String(value), String(value), record)
    }
  }
  const rank = (key: string) => {
    if (key === EMPTY_GROUP_KEY) return Number.MAX_SAFE_INTEGER
    if (column.type === 'checkbox') return key === 'true' ? 0 : 1
    return optionIndex(column, key)
  }
  return [...groups.values()].sort(
    (a, b) => rank(a.key) - rank(b.key) || COLLATOR.compare(a.label, b.label),
  )
}

// ── CSV ──────────────────────────────────────────────────────────────────

/**
 * Keep spreadsheet apps from running a CSV cell as a formula: text starting
 * with =, +, -, @, a tab or a carriage return gets a leading apostrophe.
 */
export function neutralizeCsvFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
}

function csvCell(text: string): string {
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** A CSV cell from a value: numbers stay numbers, text is neutralized. */
function csvValue(value: FieldValue): string {
  if (typeof value === 'number') return String(value)
  return csvCell(neutralizeCsvFormula(valueToText(value)))
}

/** CSV (with a BOM for Excel) of the records and columns given. */
export function toCsv(
  records: Array<CrmRecord>,
  columns: Array<CrmColumn>,
): string {
  const lines = [
    columns.map((c) => csvCell(neutralizeCsvFormula(c.label))).join(','),
  ]
  for (const record of records) {
    lines.push(columns.map((c) => csvValue(readValue(record, c))).join(','))
  }
  return '﻿' + lines.join('\r\n')
}

export function downloadText(text: string, filename: string, type: string) {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ── Views ────────────────────────────────────────────────────────────────

/** Apply search, filters and sort. */
export function applyView<T extends CrmRecord>(
  records: Array<T>,
  view: ViewState,
  columnsByKey: Map<string, CrmColumn>,
  search: string,
  haystacks: Map<string, string>,
): Array<T> {
  const needle = normalizeText(search.trim())
  const filters = view.filters
    .filter(filterIsActive)
    .map((f) => ({ filter: f, column: columnsByKey.get(f.field) }))
    .filter((x): x is { filter: ViewFilter; column: CrmColumn } => !!x.column)
  const out = records.filter((record) => {
    if (needle && !(haystacks.get(record._id) ?? '').includes(needle)) {
      return false
    }
    return filters.every(({ filter, column }) =>
      matchesFilter(record, column, filter),
    )
  })
  return sortRecords(out, view.sort, columnsByKey)
}

/** Order-stable form of a view, so key order from the server doesn't matter. */
function viewKey(view: ViewState): string {
  return JSON.stringify([
    view.filters.map((f) => [f.field, f.op, f.value ?? null]),
    view.sort.map((r) => [r.field, r.dir]),
    view.columns,
    view.groupBy,
  ])
}

export function sameView(a: ViewState, b: ViewState): boolean {
  return viewKey(a) === viewKey(b)
}
