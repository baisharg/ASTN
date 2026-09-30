import {
  BUILTIN_FIELDS,
  CORE_COLUMNS,
  isSelect,
  keyFromLabel,
  normalizeValue,
} from './fields'
import type { FieldValue } from './fields'
import type { CrmCollection, CrmFieldType } from './validators'

/**
 * Pure part of the Airtable import (see docs/crm-consolidation.md, phase 3):
 * fetching, mapping Airtable records to CRM records and activities, and the
 * merge rules. The preview runs `mergeRecord` against a snapshot and the
 * write mutations run the same function against the live documents, so a
 * preview and a second import agree on what "unchanged" means.
 */

// ── Airtable ────────────────────────────────────────────────────────────

export const CRM_BASE = 'app2EMVZr0HLk1gWt'
export const TAIS_BASE = 'appenjNuTu9j3uv5d'

const TABLE_IDS = {
  personas: 'tblnTMaRcbbrVw3mQ',
  organizaciones: 'tbliFSbDfRRPeo1IA',
  formularios: 'tbl3gSmuMHiZTDXti',
  programs: 'tblwVmbGv72aEjajJ',
  participation: 'tblHVhLPdVxdCudVR',
  sessions: 'tblOicCbeuyfSrSBE',
  attendance: 'tblTeyx4wajLb8UfY',
  applications: 'tblWZH3nUTq1Whco6',
} as const

export type AirtableRecord = {
  id: string
  createdTime: string
  fields: Record<string, unknown>
}

export type AirtableField = {
  id: string
  name: string
  type: string
  options?: { choices?: Array<{ name: string; color?: string }> }
}

type AirtableTable = { id: string; name: string; fields: Array<AirtableField> }

export type AirtableData = {
  personaFields: Array<AirtableField>
  orgFields: Array<AirtableField>
  formFields: Array<AirtableField>
  attendanceFields: Array<AirtableField>
  applicationFields: Array<AirtableField>
  personas: Array<AirtableRecord>
  organizaciones: Array<AirtableRecord>
  formularios: Array<AirtableRecord>
  programs: Array<AirtableRecord>
  participation: Array<AirtableRecord>
  sessions: Array<AirtableRecord>
  attendance: Array<AirtableRecord>
  applications: Array<AirtableRecord>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** GET from the Airtable API, backing off on 429 (limit: 5 req/s per base). */
async function airtableGet(path: string, token: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.airtable.com/v0/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 429 && attempt < 4) {
      await sleep(5000 * (attempt + 1))
      continue
    }
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300)
      throw new Error(`Airtable API error ${res.status} on ${path}: ${body}`)
    }
    // Stay well under the rate limit.
    await sleep(220)
    return await res.json()
  }
}

async function fetchRecords(
  base: string,
  tableId: string,
  token: string,
): Promise<Array<AirtableRecord>> {
  const out: Array<AirtableRecord> = []
  let offset: string | undefined
  do {
    const qs = new URLSearchParams({ pageSize: '100' })
    if (offset) qs.set('offset', offset)
    const page = (await airtableGet(`${base}/${tableId}?${qs}`, token)) as {
      records: Array<AirtableRecord>
      offset?: string
    }
    out.push(...page.records)
    offset = page.offset
  } while (offset)
  return out
}

async function fetchTables(
  base: string,
  token: string,
): Promise<Map<string, AirtableTable>> {
  const meta = (await airtableGet(`meta/bases/${base}/tables`, token)) as {
    tables: Array<AirtableTable>
  }
  return new Map(meta.tables.map((t) => [t.id, t]))
}

export async function fetchAirtable(token: string): Promise<AirtableData> {
  const crm = async () => {
    const tables = await fetchTables(CRM_BASE, token)
    const get = (id: string) => fetchRecords(CRM_BASE, id, token)
    const fieldsOf = (id: string) => {
      const table = tables.get(id)
      if (!table) throw new Error(`Airtable table ${id} not found`)
      return table.fields
    }
    return {
      personaFields: fieldsOf(TABLE_IDS.personas),
      orgFields: fieldsOf(TABLE_IDS.organizaciones),
      formFields: fieldsOf(TABLE_IDS.formularios),
      attendanceFields: fieldsOf(TABLE_IDS.attendance),
      personas: await get(TABLE_IDS.personas),
      organizaciones: await get(TABLE_IDS.organizaciones),
      formularios: await get(TABLE_IDS.formularios),
      programs: await get(TABLE_IDS.programs),
      participation: await get(TABLE_IDS.participation),
      sessions: await get(TABLE_IDS.sessions),
      attendance: await get(TABLE_IDS.attendance),
    }
  }
  const tais = async () => {
    const tables = await fetchTables(TAIS_BASE, token)
    const table = tables.get(TABLE_IDS.applications)
    if (!table) throw new Error('Airtable TAIS applications table not found')
    return {
      applicationFields: table.fields,
      applications: await fetchRecords(
        TAIS_BASE,
        TABLE_IDS.applications,
        token,
      ),
    }
  }
  // Rate limits are per base, so the two bases can be read in parallel.
  const [a, b] = await Promise.all([crm(), tais()])
  return { ...a, ...b }
}

// ── Snapshot of what is in ASTN ─────────────────────────────────────────

export type CoreKey = 'phone' | 'linkedin' | 'website' | 'location' | 'notes'
export type OrgCoreKey = 'description' | 'notes'

export type ContactSnap = {
  _id: string
  name: string
  email?: string
  otherEmails?: Array<string>
  airtableId?: string
  // Airtable ids of contacts merged into this one (convex/contacts/merge.ts)
  mergedAirtableIds?: Array<string>
  phone?: string
  linkedin?: string
  website?: string
  location?: string
  notes?: string
  fields?: Record<string, FieldValue>
}

export type OrgSnap = {
  _id: string
  name: string
  description?: string
  notes?: string
  airtableId?: string
  fields?: Record<string, FieldValue>
}

export type DefSnap = {
  collection: CrmCollection
  key: string
  label: string
  type: CrmFieldType
  options: Array<string>
}

export type ActivitySnap = {
  externalId: string
  contactId: string
  title: string
  occurredAt?: number
  status?: string
  data?: Record<string, unknown>
}

export type State = {
  contacts: Array<ContactSnap>
  organizations: Array<OrgSnap>
  defs: Array<DefSnap>
  activities: Array<ActivitySnap>
}

// ── What gets written ───────────────────────────────────────────────────

export type ContactIn = {
  ref: string
  source: string // report row
  targetId?: string
  airtableId?: string
  name?: string
  emails: Array<string> // first is the primary
  core: Partial<Record<CoreKey, string>>
  fields: Record<string, FieldValue>
}

export type OrgIn = {
  ref: string
  targetId?: string
  airtableId: string
  name: string
  core: Partial<Record<OrgCoreKey, string>>
  fields: Record<string, FieldValue>
}

export type ContactLink = { id: string } | { ref: string }

export type ActivityIn = {
  source: string // report row
  externalId: string
  contact: ContactLink
  kind: 'program' | 'session' | 'form' | 'application'
  title: string
  occurredAt?: number
  status?: string
  data: Record<string, unknown>
}

export type FieldSpec = {
  collection: CrmCollection
  key: string
  label: string
  type: CrmFieldType
  source: 'builtin' | 'airtable'
  options: Array<{ value: string; color?: string }>
}

// ── Field mapping ───────────────────────────────────────────────────────

const PERSONA_CORE: Record<string, 'name' | 'email' | 'otherEmails' | CoreKey> =
  {
    Nombre: 'name',
    Email: 'email',
    'Otros Emails': 'otherEmails',
    Teléfono: 'phone',
    LinkedIn: 'linkedin',
    'Página web': 'website',
    Ubicación: 'location',
    Notas: 'notes',
  }

const PERSONA_BUILTIN: Record<string, string> = {
  Vínculo: 'relationship',
  Rol: 'role',
  Campo: 'professionalField',
  'Etapa profesional': 'careerStage',
  'Experiencia en AI Safety': 'aiSafetyExperience',
  Habilidades: 'skills',
  Intereses: 'interests',
  Disponibilidad: 'availability',
  'En Buenos Aires': 'inBuenosAires',
  'Fuente de contacto': 'contactSource',
  'Persona de contacto': 'contactPerson',
  'Primer contacto': 'firstContact',
  Organizaciones: 'associatedOrganizations',
  'Participó en': 'participatedIn',
}

const ORG_CORE: Record<string, 'name' | OrgCoreKey> = {
  'Organization Name': 'name',
  Description: 'description',
  Notes: 'notes',
}

const ORG_BUILTIN: Record<string, string> = {
  People: 'keyPeople',
  'Auto-Generated Organization Summary': 'autoSummary',
}

// Airtable-only org fields whose natural key reads like a core column.
const ORG_KEYS: Record<string, string> = {
  Website: 'orgWebsite',
  Location: 'orgLocation',
  'Main Email': 'mainEmail',
}

const AIRTABLE_TYPES: Record<string, CrmFieldType> = {
  singleSelect: 'singleSelect',
  multipleSelects: 'multiSelect',
  checkbox: 'checkbox',
  date: 'date',
  dateTime: 'date',
  number: 'number',
  currency: 'number',
  percent: 'number',
  rating: 'number',
  url: 'url',
  email: 'email',
  phoneNumber: 'phone',
  singleLineText: 'text',
  multilineText: 'longText',
  richText: 'longText',
}

// Keys createField refuses, so admin-created fields and ours stay distinct.
const RESERVED_KEYS = new Set([
  'name',
  'email',
  'phone',
  'linkedin',
  'website',
  'location',
  'notes',
  'description',
])

/** Airtable colors are names like `blueLight2`; keep the hue (a CSS color). */
function baseColor(color: string | undefined): string | undefined {
  const hue = color?.match(/^[a-z]+/)?.[0]
  return hue || undefined
}

/** Cell value with Airtable-specific shapes flattened. */
function cell(field: AirtableField | undefined, raw: unknown): unknown {
  if (raw === undefined || raw === null) return undefined
  if (field?.type === 'aiText' || isAiText(raw)) {
    const ai = raw as { state?: string; value?: unknown }
    return ai.state === 'generated' ? ai.value : undefined
  }
  // Airtable omits unchecked boxes; an explicit false carries no information.
  if (raw === false) return undefined
  return raw
}

function isAiText(raw: unknown): boolean {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    !Array.isArray(raw) &&
    'state' in raw &&
    'value' in raw
  )
}

type FieldTarget = { key: string; type: CrmFieldType; label: string }

/**
 * Decide the CRM field for every mappable Airtable field of a table, reusing
 * existing definitions (their type wins) and seeding select options from
 * Airtable's choices.
 */
function planFields(
  collection: CrmCollection,
  fields: Array<AirtableField>,
  core: Record<string, string>,
  builtin: Record<string, string>,
  keyOverrides: Record<string, string>,
  skip: Set<string>,
  existing: Map<string, DefSnap>,
): { targets: Map<string, FieldTarget>; specs: Map<string, FieldSpec> } {
  const builtinByKey = new Map(
    BUILTIN_FIELDS[collection].map((f) => [f.key, f]),
  )
  const taken = new Set([
    ...RESERVED_KEYS,
    ...CORE_COLUMNS[collection],
    ...builtinByKey.keys(),
  ])
  const targets = new Map<string, FieldTarget>()
  const specs = new Map<string, FieldSpec>()
  for (const field of fields) {
    if (field.name in core || skip.has(field.name)) continue
    const builtinKey = builtin[field.name]
    let key: string
    let type: CrmFieldType | undefined
    let source: FieldSpec['source']
    if (builtinKey) {
      const def = builtinByKey.get(builtinKey)
      if (!def) continue
      key = builtinKey
      type = def.type
      source = 'builtin'
    } else {
      type = AIRTABLE_TYPES[field.type]
      if (!type) continue // links, lookups, attachments, AI, formulas…
      const base = keyOverrides[field.name] ?? keyFromLabel(field.name)
      key = base
      for (let n = 2; taken.has(key); n++) key = `${base}${n}`
      source = 'airtable'
    }
    taken.add(key)
    const def = existing.get(key)
    const effectiveType = def?.type ?? type
    targets.set(field.name, {
      key,
      type: effectiveType,
      label: def?.label ?? field.name,
    })
    specs.set(key, {
      collection,
      key,
      label: def?.label ?? field.name,
      type: effectiveType,
      source,
      options: isSelect(effectiveType)
        ? (field.options?.choices ?? []).map((c) => ({
            value: c.name,
            color: baseColor(c.color),
          }))
        : [],
    })
  }
  return { targets, specs }
}

/** Record every select value on a spec so its definition knows it. */
function noteOption(spec: FieldSpec | undefined, value: FieldValue): void {
  if (!spec || !isSelect(spec.type) || value === null) return
  const values = Array.isArray(value) ? value : [String(value)]
  for (const v of values) {
    if (!spec.options.some((o) => o.value === v))
      spec.options.push({ value: v })
  }
}

// ── Value helpers ───────────────────────────────────────────────────────

export function parseEmails(...raws: Array<unknown>): Array<string> {
  const out: Array<string> = []
  for (const raw of raws) {
    const value = text(raw)
    if (!value) continue
    for (const token of value.split(/[\s,;<>]+/)) {
      const email = token
        .trim()
        .toLowerCase()
        .replace(/^mailto:/, '')
      if (email.includes('@') && !out.includes(email)) out.push(email)
    }
  }
  return out
}

/** A cell as text: scalars and lists of scalars; anything else is skipped. */
function text(raw: unknown): string | undefined {
  const scalar = (x: unknown) =>
    typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean'
      ? String(x)
      : ''
  const s = (
    Array.isArray(raw)
      ? raw.map(scalar).filter(Boolean).join(', ')
      : scalar(raw)
  ).trim()
  return s || undefined
}

/** Convex field names must be printable ASCII: fold accents, drop the rest. */
export function dataKey(name: string): string {
  const key = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/^[$_]+/, '')
    .trim()
  return key.slice(0, 200) || 'campo'
}

/** Activity `data`: every non-empty answer, keyed by (ASCII) field name. */
function answers(
  record: AirtableRecord,
  fields: Array<AirtableField> | undefined,
  exclude: Set<string>,
): Record<string, unknown> {
  const byName = new Map((fields ?? []).map((f) => [f.name, f]))
  const names = fields
    ? fields.map((f) => f.name)
    : Object.keys(record.fields).sort()
  const data: Record<string, unknown> = {}
  for (const name of names) {
    if (exclude.has(name)) continue
    const field = byName.get(name)
    if (field && SKIP_IN_DATA.has(field.type)) continue
    const value = dataValue(cell(field, record.fields[name]))
    if (value !== undefined) data[dataKey(name)] = value
  }
  return data
}

const SKIP_IN_DATA = new Set([
  'multipleRecordLinks',
  'multipleLookupValues',
  'multipleAttachments',
  'autoNumber',
  'rollup',
  'formula',
  'button',
])

function dataValue(raw: unknown): unknown {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === 'string') return raw.trim() || undefined
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined
  if (typeof raw === 'boolean') return raw
  if (Array.isArray(raw)) {
    const items = raw
      .filter((x) => typeof x === 'string' || typeof x === 'number')
      .map((x) => String(x).trim())
      .filter(Boolean)
    return items.length ? items : undefined
  }
  return undefined
}

function dateMs(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || !raw) return undefined
  const ms = Date.parse(raw)
  return Number.isNaN(ms) ? undefined : ms
}

// ── Matching (shared by the plan and the write mutations) ───────────────

type Emailed = { email?: string; otherEmails?: Array<string> }

/** Every email (primary and other) → the first contact that has it. */
export function indexByEmail<T extends Emailed>(
  contacts: Array<T>,
): Map<string, T> {
  const byEmail = new Map<string, T>()
  for (const c of contacts) addEmails(byEmail, c)
  return byEmail
}

export function addEmails<T extends Emailed>(
  byEmail: Map<string, T>,
  c: T,
): void {
  for (const e of [c.email, ...(c.otherEmails ?? [])]) {
    if (e && !byEmail.has(e)) byEmail.set(e, c)
  }
}

/**
 * Airtable ids of contacts that were merged away → the contact they were
 * merged into. Checked after the `airtableId` match, so a contact's own
 * id wins.
 */
export function indexByMergedAirtableId<
  T extends { mergedAirtableIds?: Array<string> },
>(contacts: Array<T>): Map<string, T> {
  const map = new Map<string, T>()
  for (const c of contacts) {
    for (const id of c.mergedAirtableIds ?? []) {
      if (!map.has(id)) map.set(id, c)
    }
  }
  return map
}

export function orgNameKey(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * An existing org can be matched by name only if no other Airtable row has
 * claimed it, so two Airtable orgs with one name stay two orgs.
 */
export function nameMatchable(
  org: { airtableId?: string },
  airtableId: string,
): boolean {
  return !org.airtableId || org.airtableId === airtableId
}

// ── Merge ───────────────────────────────────────────────────────────────

export type Conflict = {
  collection: CrmCollection
  record: string // the record's name, for the admin
  key: string
  label: string
  current: string
  incoming: string
  // Two Airtable rows for the same person disagree; the first row's value
  // (`current`) is the one imported.
  duplicate?: boolean
}

function display(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  return String(value)
}

function empty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  )
}

function loose(value: unknown, key: string): string {
  if (Array.isArray(value)) {
    return value
      .map((v) => loose(v, key))
      .sort()
      .join('|')
  }
  if (typeof value !== 'string') return JSON.stringify(value)
  if (/phone/i.test(key)) {
    const digits = value.replace(/\D/g, '')
    if (digits) return digits.replace(/^(54)?9?/, '')
  }
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
    .replace(/\s+/g, ' ')
}

export function sameValue(a: unknown, b: unknown, key = ''): boolean {
  return loose(a, key) === loose(b, key)
}

type Target = {
  name: string
  email?: string
  otherEmails?: Array<string>
  airtableId?: string
  fields?: Record<string, FieldValue>
} & Partial<Record<CoreKey | OrgCoreKey, string>>

type Incoming = {
  name?: string
  emails?: Array<string>
  airtableId?: string
  core: Partial<Record<string, string>>
  fields: Record<string, FieldValue>
}

/**
 * Merge an incoming Airtable record into an existing CRM record. Gaps are
 * filled, nothing is blanked, and where both sides hold different values the
 * CRM value stays unless `overwrite`. Exceptions, so Airtable data isn't
 * lost to the values the Luma import filled in: notes are appended when not
 * already there, `firstContact` keeps the earlier date, a Luma placeholder
 * `contactSource` is replaced, a fuller name replaces a partial one, and
 * extra emails go to `otherEmails`.
 */
export function mergeRecord(
  collection: CrmCollection,
  existing: Target,
  incoming: Incoming,
  labels: Map<string, string>,
  overwrite: boolean,
): { patch: Record<string, unknown>; conflicts: Array<Conflict> } {
  const patch: Record<string, unknown> = {}
  const conflicts: Array<Conflict> = []
  const conflict = (key: string, current: unknown, value: unknown) => {
    conflicts.push({
      collection,
      record: existing.name,
      key,
      label: labels.get(key) ?? key,
      current: display(current),
      incoming: display(value),
    })
    return overwrite
  }

  if (incoming.name && !sameValue(existing.name, incoming.name)) {
    // Luma often has only a first name; a fuller name that contains every
    // word of the current one is an improvement, not a conflict.
    if (
      extendsName(existing.name, incoming.name) ||
      conflict('name', existing.name, incoming.name)
    ) {
      patch.name = incoming.name
    }
  }

  if (collection === 'contacts' && incoming.emails?.length) {
    const known = new Set([existing.email, ...(existing.otherEmails ?? [])])
    let primary = existing.email
    if (!primary) {
      primary = incoming.emails[0]
      patch.email = primary
      known.add(primary)
    }
    const extra = incoming.emails.filter((e) => !known.has(e))
    if (extra.length)
      patch.otherEmails = [...(existing.otherEmails ?? []), ...extra]
  }

  if (incoming.airtableId && !existing.airtableId) {
    patch.airtableId = incoming.airtableId
  }

  for (const [key, value] of Object.entries(incoming.core)) {
    if (empty(value)) continue
    const current = existing[key as CoreKey]
    if (empty(current)) patch[key] = value
    else if (key === 'notes') {
      if (!loose(current, key).includes(loose(value, key))) {
        patch[key] = `${current}\n\n${value}`
      }
    } else if (
      !sameValue(current, value, key) &&
      conflict(key, current, value)
    ) {
      patch[key] = value
    }
  }

  const fields = { ...existing.fields }
  let fieldsChanged = false
  for (const [key, value] of Object.entries(incoming.fields)) {
    if (empty(value)) continue
    const current = fields[key]
    let next: FieldValue | undefined
    if (empty(current) || isPlaceholder(key, current)) next = value
    else if (sameValue(current, value, key)) continue
    else if (key === 'firstContact') {
      if (String(value) < String(current)) next = value
    } else if (conflict(key, current, value)) next = value
    if (next !== undefined) {
      fields[key] = next
      fieldsChanged = true
    }
  }
  if (fieldsChanged) patch.fields = fields
  return { patch, conflicts }
}

/**
 * Values the Luma import wrote only to fill a gap (contactSource "Luma"):
 * Airtable's real value replaces them without a conflict.
 */
function isPlaceholder(key: string, value: FieldValue | undefined): boolean {
  return key === 'contactSource' && value === 'Luma'
}

function nameWords(name: string): Array<string> {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function extendsName(current: string, incoming: string): boolean {
  const have = nameWords(current)
  const next = new Set(nameWords(incoming))
  return (
    have.length > 0 && next.size > have.length && have.every((w) => next.has(w))
  )
}

/** Stable JSON for comparing activity payloads. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

export function sameActivity(
  a: Omit<ActivitySnap, 'externalId' | 'contactId'>,
  b: Omit<ActivitySnap, 'externalId' | 'contactId'>,
): boolean {
  return (
    a.title === b.title &&
    (a.status ?? null) === (b.status ?? null) &&
    (a.occurredAt ?? null) === (b.occurredAt ?? null) &&
    stableJson(a.data ?? {}) === stableJson(b.data ?? {})
  )
}

// ── Plan ────────────────────────────────────────────────────────────────

export const SOURCES = {
  personas: 'Personas',
  organizaciones: 'Organizaciones',
  formularios: 'Formularios',
  participation: 'Program Participation',
  attendance: 'Session Attendance',
  applications: 'TAIS Applications',
} as const

export type Plan = {
  specs: Array<FieldSpec>
  contacts: Array<ContactIn>
  organizations: Array<OrgIn>
  activities: Array<ActivityIn>
  skipped: Record<string, number>
  duplicatePersonas: number
  duplicateConflicts: Array<Conflict>
}

/** Map every Airtable record to what should exist in the CRM. */
export function planImport(data: AirtableData, state: State): Plan {
  const defsFor = (collection: CrmCollection) =>
    new Map(
      state.defs
        .filter((d) => d.collection === collection)
        .map((d) => [d.key, d]),
    )
  const persona = planFields(
    'contacts',
    data.personaFields,
    PERSONA_CORE,
    PERSONA_BUILTIN,
    {},
    new Set(['Formularios']),
    defsFor('contacts'),
  )
  const org = planFields(
    'organizations',
    data.orgFields,
    ORG_CORE,
    ORG_BUILTIN,
    ORG_KEYS,
    new Set(['Logo']),
    defsFor('organizations'),
  )
  const skipped: Record<string, number> = {}
  const skip = (source: string) =>
    (skipped[source] = (skipped[source] ?? 0) + 1)

  // Where existing contacts are, by Airtable id and by every email.
  const byAirtableId = new Map<string, ContactSnap>()
  for (const c of state.contacts) {
    if (c.airtableId) byAirtableId.set(c.airtableId, c)
  }
  for (const [id, c] of indexByMergedAirtableId(state.contacts)) {
    if (!byAirtableId.has(id)) byAirtableId.set(id, c)
  }
  const byEmail = indexByEmail(state.contacts)

  const contacts: Array<ContactIn> = []
  const byTarget = new Map<string, ContactIn>()
  const byNewEmail = new Map<string, ContactIn>()
  let duplicatePersonas = 0
  const duplicateConflicts: Array<Conflict> = []
  const personaTypes = new Map(
    [...persona.targets.values()].map((t) => [t.key, t.type]),
  )
  const personaLabels = new Map<string, string>([
    ...Object.entries(PERSONA_CORE).map(([name, key]) => [key, name] as const),
    ...[...persona.targets.values()].map((t) => [t.key, t.label] as const),
  ])

  /** Find or start the contact an incoming record belongs to. */
  const place = (incoming: ContactIn, airtableId?: string): ContactIn => {
    const target =
      (airtableId ? byAirtableId.get(airtableId) : undefined) ??
      incoming.emails.map((e) => byEmail.get(e)).find(Boolean)
    let group: ContactIn | undefined
    if (target) {
      group = byTarget.get(target._id)
      if (!group) {
        group = { ...incoming, targetId: target._id }
        byTarget.set(target._id, group)
        contacts.push(group)
        return registerEmails(group)
      }
    } else {
      group = incoming.emails.map((e) => byNewEmail.get(e)).find(Boolean)
      if (!group) {
        contacts.push(incoming)
        return registerEmails(incoming)
      }
    }
    duplicateConflicts.push(
      ...mergeIncoming(group, incoming, personaTypes, personaLabels),
    )
    return registerEmails(group)
  }
  const registerEmails = (group: ContactIn) => {
    for (const e of group.emails)
      if (!byNewEmail.has(e)) byNewEmail.set(e, group)
    return group
  }
  /** Resolve an email-keyed row to a contact, if one exists or is planned. */
  const lookup = (emails: Array<string>): ContactLink | undefined => {
    for (const e of emails) {
      const planned = byNewEmail.get(e)
      if (planned) return linkOf(planned)
      const existing = byEmail.get(e)
      if (existing) return { id: existing._id }
    }
    return undefined
  }

  // Personas → contacts
  const personaRef = new Map<string, ContactIn>()
  const personaFieldByName = new Map(data.personaFields.map((f) => [f.name, f]))
  for (const record of data.personas) {
    const f = record.fields
    const incoming: ContactIn = {
      ref: `persona:${record.id}`,
      source: SOURCES.personas,
      airtableId: record.id,
      name: text(f.Nombre),
      emails: parseEmails(f.Email, f['Otros Emails']),
      core: {},
      fields: {},
    }
    for (const [name, key] of Object.entries(PERSONA_CORE)) {
      if (key === 'name' || key === 'email' || key === 'otherEmails') continue
      const value = text(cell(personaFieldByName.get(name), f[name]))
      if (value) incoming.core[key] = value
    }
    for (const [name, target] of persona.targets) {
      const value = normalizeValue(
        target.type,
        cell(personaFieldByName.get(name), f[name]),
      )
      if (value === undefined || value === null) continue
      incoming.fields[target.key] = value
      noteOption(persona.specs.get(target.key), value)
    }
    const before = contacts.length
    const group = place(incoming, record.id)
    if (contacts.length === before && group !== incoming) duplicatePersonas++
    personaRef.set(record.id, group)
  }

  // Minimal contacts for people who only appear in other tables.
  const minimal = (
    source: string,
    emails: Array<string>,
    name: string | undefined,
    extra?: Partial<Record<CoreKey, string>>,
  ): ContactLink => {
    const found = lookup(emails)
    if (found) return found
    const incoming: ContactIn = {
      ref: `${source}:${emails[0]}`,
      source,
      name: name || emails[0].split('@')[0],
      emails,
      core: extra ?? {},
      fields: {},
    }
    return linkOf(place(incoming))
  }

  const activities: Array<ActivityIn> = []

  // Formularios → form activities
  const formFieldByName = new Map(data.formFields.map((f) => [f.name, f]))
  const formIdentity = (f: Record<string, unknown>) => {
    const core: Partial<Record<CoreKey, string>> = {}
    for (const [name, key] of Object.entries(PERSONA_CORE)) {
      if (key === 'name' || key === 'email' || key === 'otherEmails') continue
      if (key === 'notes') continue
      const value = text(cell(formFieldByName.get(name), f[name]))
      if (value) core[key] = value
    }
    return core
  }
  for (const record of data.formularios) {
    const f = record.fields
    const linked = Array.isArray(f.Persona) ? String(f.Persona[0]) : undefined
    const emails = parseEmails(f.Email, f['Otros Emails'])
    let contact: ContactLink | undefined
    const group = linked ? personaRef.get(linked) : undefined
    if (group) contact = linkOf(group)
    else if (emails.length) {
      contact = minimal(
        SOURCES.formularios,
        emails,
        text(f.Nombre),
        formIdentity(f),
      )
    } else if (text(f.Nombre)) {
      // No email to match on later: key the contact by the form's own id.
      const incoming: ContactIn = {
        ref: `form:${record.id}`,
        source: SOURCES.formularios,
        airtableId: record.id,
        name: text(f.Nombre),
        emails: [],
        core: formIdentity(f),
        fields: {},
      }
      contact = linkOf(place(incoming, record.id))
    }
    if (!contact) {
      skip(SOURCES.formularios)
      continue
    }
    const title =
      [text(f.Fuente), text(f['Período'])].filter(Boolean).join(' · ') ||
      'Formulario'
    activities.push({
      source: SOURCES.formularios,
      externalId: `airtable:${record.id}`,
      contact,
      kind: 'form',
      title,
      occurredAt: dateMs(record.createdTime),
      data: answers(
        record,
        data.formFields,
        new Set(['Persona', 'Fuente', 'Período', 'Id']),
      ),
    })
  }

  // Program Participation → program activities
  const programs = new Map(data.programs.map((r) => [r.id, r.fields]))
  for (const record of data.participation) {
    const f = record.fields
    const emails = parseEmails(f['Person Email'])
    if (!emails.length) {
      skip(SOURCES.participation)
      continue
    }
    const program = Array.isArray(f.Program)
      ? programs.get(String(f.Program[0]))
      : undefined
    const title =
      text(program?.['Program Name']) ?? text(f['Program Name']) ?? 'Programa'
    const data_: Record<string, unknown> = {}
    const type = text(program?.['Program Type'])
    if (type) data_['Program Type'] = type
    const start = text(program?.['Start Date'])
    const end = text(program?.['End Date'])
    if (start) data_['Start Date'] = start
    if (end) data_['End Date'] = end
    activities.push({
      source: SOURCES.participation,
      externalId: `airtable:${record.id}`,
      contact: minimal(SOURCES.participation, emails, text(f.Person)),
      kind: 'program',
      title,
      occurredAt: dateMs(start),
      status: text(f['Completion Status']),
      data: data_,
    })
  }

  // Session Attendance → session activities
  const sessions = new Map(data.sessions.map((r) => [r.id, r.fields]))
  for (const record of data.attendance) {
    const f = record.fields
    const emails = parseEmails(f['Person Email'])
    if (!emails.length) {
      skip(SOURCES.attendance)
      continue
    }
    const session = Array.isArray(f.Session)
      ? sessions.get(String(f.Session[0]))
      : undefined
    const name =
      text(session?.['Session Name']) ?? text(f['Session Name']) ?? 'Sesión'
    const date = text(session?.Date)
    activities.push({
      source: SOURCES.attendance,
      externalId: `airtable:${record.id}`,
      contact: minimal(
        SOURCES.attendance,
        emails,
        text(f.Person) ?? text(f['Tu nombre']),
      ),
      kind: 'session',
      title: date ? `${name} (${date})` : name,
      occurredAt: dateMs(date),
      status: text(f.Attended),
      data: answers(
        record,
        data.attendanceFields,
        new Set([
          'Person Email',
          'Session Name',
          'Session',
          'Program',
          'Person',
          'Tu nombre',
          'Attended',
        ]),
      ),
    })
  }

  // TAIS applications → application activities
  for (const record of data.applications) {
    const f = record.fields
    const emails = parseEmails(f['Email address'])
    if (!emails.length) {
      skip(SOURCES.applications)
      continue
    }
    const name = [text(f['First name']), text(f['Last name'])]
      .filter(Boolean)
      .join(' ')
    const phone = text(f['Phone Number'])
    activities.push({
      source: SOURCES.applications,
      externalId: `airtable:${record.id}`,
      contact: minimal(
        SOURCES.applications,
        emails,
        name,
        phone ? { phone } : undefined,
      ),
      kind: 'application',
      title: 'TAIS (Airtable)',
      occurredAt: dateMs(f['Submitted at']) ?? dateMs(record.createdTime),
      data: answers(
        record,
        data.applicationFields,
        new Set(['Email address', 'First name', 'Last name', 'Submitted at']),
      ),
    })
  }

  // Organizaciones → organizations
  const orgByAirtableId = new Map<string, OrgSnap>()
  const orgsByName = new Map<string, Array<OrgSnap>>()
  for (const o of state.organizations) {
    if (o.airtableId) orgByAirtableId.set(o.airtableId, o)
    const n = orgNameKey(o.name)
    orgsByName.set(n, [...(orgsByName.get(n) ?? []), o])
  }
  const orgFieldByName = new Map(data.orgFields.map((f) => [f.name, f]))
  const organizations: Array<OrgIn> = []
  const orgTargets = new Set<string>()
  for (const record of data.organizaciones) {
    const f = record.fields
    const name = text(f['Organization Name'])
    if (!name) {
      skip(SOURCES.organizaciones)
      continue
    }
    const incoming: OrgIn = {
      ref: `org:${record.id}`,
      airtableId: record.id,
      name,
      core: {},
      fields: {},
    }
    for (const [fieldName, key] of Object.entries(ORG_CORE)) {
      if (key === 'name') continue
      const value = text(cell(orgFieldByName.get(fieldName), f[fieldName]))
      if (value) incoming.core[key] = value
    }
    for (const [fieldName, target] of org.targets) {
      const value = normalizeValue(
        target.type,
        cell(orgFieldByName.get(fieldName), f[fieldName]),
      )
      if (value === undefined || value === null) continue
      incoming.fields[target.key] = value
      noteOption(org.specs.get(target.key), value)
    }
    const target =
      orgByAirtableId.get(record.id) ??
      orgsByName
        .get(orgNameKey(name))
        ?.find((o) => nameMatchable(o, record.id) && !orgTargets.has(o._id))
    // Two Airtable rows for one CRM org: only the first merges into it.
    if (target && !orgTargets.has(target._id)) {
      orgTargets.add(target._id)
      incoming.targetId = target._id
    }
    organizations.push(incoming)
  }

  return {
    specs: [...persona.specs.values(), ...org.specs.values()],
    contacts,
    organizations,
    activities,
    skipped,
    duplicatePersonas,
    duplicateConflicts,
  }
}

function linkOf(group: ContactIn): ContactLink {
  return group.targetId ? { id: group.targetId } : { ref: group.ref }
}

/**
 * Fold a second Airtable row for the same person into the first: lists are
 * joined, long text is appended, gaps are filled, and where two single
 * values disagree the first row's value stays and the pair is returned as a
 * conflict.
 */
function mergeIncoming(
  into: ContactIn,
  from: ContactIn,
  types: Map<string, CrmFieldType>,
  labels: Map<string, string>,
): Array<Conflict> {
  const conflicts: Array<Conflict> = []
  const conflict = (key: string, current: unknown, value: unknown) =>
    conflicts.push({
      collection: 'contacts',
      record: into.name ?? from.name ?? into.emails[0] ?? '',
      key,
      label: labels.get(key) ?? key,
      current: display(current),
      incoming: display(value),
      duplicate: true,
    })

  if (!into.name) into.name = from.name
  else if (from.name && !sameValue(into.name, from.name)) {
    if (extendsName(into.name, from.name)) into.name = from.name
    else if (!extendsName(from.name, into.name)) {
      conflict('name', into.name, from.name)
    }
  }
  into.airtableId ??= from.airtableId
  for (const e of from.emails) if (!into.emails.includes(e)) into.emails.push(e)

  for (const [k, v] of Object.entries(from.core) as Array<[CoreKey, string]>) {
    const current = into.core[k]
    if (empty(current)) into.core[k] = v
    else if (k === 'notes') into.core[k] = appendText(current, v)
    else if (!sameValue(current, v, k)) conflict(k, current, v)
  }

  for (const [k, v] of Object.entries(from.fields)) {
    if (empty(v)) continue
    const current = into.fields[k]
    const type = types.get(k)
    if (empty(current)) into.fields[k] = v
    else if (sameValue(current, v, k)) continue
    else if (
      type === 'multiSelect' &&
      Array.isArray(current) &&
      Array.isArray(v)
    ) {
      into.fields[k] = [...current, ...v.filter((x) => !current.includes(x))]
    } else if (type === 'longText') {
      into.fields[k] = appendText(String(current), String(v))
    } else if (k === 'firstContact') {
      if (String(v) < String(current)) into.fields[k] = v
    } else conflict(k, current, v)
  }
  return conflicts
}

function appendText(current: string | undefined, value: string): string {
  if (!current) return value
  return loose(current, '').includes(loose(value, ''))
    ? current
    : `${current}\n\n${value}`
}
