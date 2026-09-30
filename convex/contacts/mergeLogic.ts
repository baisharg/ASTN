import type { FieldValue } from './filters'
import type { CrmFieldType } from './validators'

/**
 * Pure logic for merging duplicate CRM contacts and finding candidates
 * (convex/contacts/merge.ts). No Convex server imports, so the tests under
 * src/ can import it.
 */

// ── Shared normalization ─────────────────────────────────────────────────

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function nameWords(name: string): Array<string> {
  return normalizeName(name).split(' ').filter(Boolean)
}

/** True when `incoming` has every word of `current` and more. */
export function extendsName(current: string, incoming: string): boolean {
  const have = nameWords(current)
  const next = new Set(nameWords(incoming))
  return (
    have.length > 0 && next.size > have.length && have.every((w) => next.has(w))
  )
}

function empty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  )
}

function looseText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Notes joined by blank lines, in order. A note is left out only when it
 * repeats one already there (the whole note or one of its paragraphs),
 * ignoring case and spacing; a note that merely contains another is kept.
 */
export function mergeNotes(
  notes: Array<string | undefined>,
): string | undefined {
  const parts: Array<string> = []
  const seen = new Set<string>()
  for (const raw of notes) {
    const note = raw?.trim()
    if (!note || seen.has(looseText(note))) continue
    parts.push(note)
    seen.add(looseText(note))
    for (const para of note.split(/\n\s*\n/)) seen.add(looseText(para))
  }
  return parts.length ? parts.join('\n\n') : undefined
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

// ── Merge ────────────────────────────────────────────────────────────────

export type MergeContact = {
  _id: string
  name: string
  email?: string
  otherEmails?: Array<string>
  phone?: string
  linkedin?: string
  website?: string
  location?: string
  notes?: string
  fields?: Record<string, FieldValue>
  userId?: string
  airtableId?: string
  mergedAirtableIds?: Array<string>
}

export type MergeDef = { key: string; type: CrmFieldType }

/**
 * Flat columns from before configurable fields, still allowed by the schema.
 * The migration moved them into `fields`; a merge refuses a contact that
 * still has one, rather than dropping it.
 */
export const LEGACY_FLAT_KEYS = [
  'relationship',
  'role',
  'title',
  'professionalField',
  'careerStage',
  'aiSafetyExperience',
  'skills',
  'interests',
  'availability',
  'inBuenosAires',
  'contactSource',
  'contactPerson',
  'firstContact',
  'associatedOrganizations',
  'participatedIn',
] as const

export function legacyFlatKeys(contact: object): Array<string> {
  const doc = contact as Record<string, unknown>
  return LEGACY_FLAT_KEYS.filter(
    (k) => doc[k] !== undefined && doc[k] !== null && doc[k] !== '',
  )
}

const FILL_CORE = ['phone', 'linkedin', 'website', 'location'] as const

export type MergeResult =
  | { ok: false; error: string }
  | {
      ok: true
      patch: {
        name: string
        email?: string
        otherEmails?: Array<string>
        phone?: string
        linkedin?: string
        website?: string
        location?: string
        notes?: string
        fields: Record<string, FieldValue>
        userId?: string
        airtableId?: string
        mergedAirtableIds?: Array<string>
      }
    }

/**
 * What `keep` looks like after absorbing `others` (in the order given):
 * every email is kept (keep's primary stays primary), empty core columns and
 * fields are filled, multi-selects are joined, a checked checkbox wins, the
 * earliest first contact wins, notes are appended, and a fuller name (one
 * with every word of keep's and more) replaces keep's. Refuses two
 * different linked accounts.
 */
export function planMerge(
  keep: MergeContact,
  others: Array<MergeContact>,
  defs: Array<MergeDef>,
): MergeResult {
  const all = [keep, ...others]

  const userIds = [...new Set(all.map((c) => c.userId).filter(Boolean))]
  if (userIds.length > 1) {
    return {
      ok: false,
      error:
        'Estos contactos están vinculados a dos cuentas de ASTN distintas; no se pueden fusionar.',
    }
  }

  let name = keep.name
  for (const o of others) if (extendsName(name, o.name)) name = o.name

  const emails: Array<string> = []
  for (const c of all) {
    for (const e of [c.email, ...(c.otherEmails ?? [])]) {
      const email = e ? normalizeEmail(e) : ''
      if (email && !emails.includes(email)) emails.push(email)
    }
  }
  const primary = keep.email ? normalizeEmail(keep.email) : emails[0]
  const otherEmails = emails.filter((e) => e !== primary)

  const core: Partial<Record<(typeof FILL_CORE)[number], string>> = {}
  for (const key of FILL_CORE) {
    const value = all.map((c) => c[key]).find((v) => !empty(v))
    if (value !== undefined) core[key] = value
  }

  const notes = mergeNotes(all.map((c) => c.notes))

  const types = new Map(defs.map((d) => [d.key, d.type]))
  const keys: Array<string> = []
  for (const c of all) {
    for (const k of Object.keys(c.fields ?? {})) {
      if (!keys.includes(k)) keys.push(k)
    }
  }
  const fields: Record<string, FieldValue> = {}
  for (const key of keys) {
    const values = all
      .map((c) => c.fields?.[key])
      .filter((v): v is Exclude<FieldValue, null> => !empty(v))
    if (values.length === 0) continue
    fields[key] = mergeFieldValue(key, types.get(key), values)
  }

  const airtableIds = all.flatMap((c) => [
    ...(c.airtableId ? [c.airtableId] : []),
    ...(c.mergedAirtableIds ?? []),
  ])
  const airtableId =
    keep.airtableId ?? others.find((c) => c.airtableId)?.airtableId
  const mergedAirtableIds = [...new Set(airtableIds)].filter(
    (id) => id !== airtableId,
  )

  return {
    ok: true,
    patch: {
      name,
      email: primary,
      otherEmails: otherEmails.length ? otherEmails : undefined,
      ...core,
      notes,
      fields,
      userId: userIds[0],
      airtableId,
      mergedAirtableIds: mergedAirtableIds.length
        ? mergedAirtableIds
        : undefined,
    },
  }
}

/** One field's merged value from its non-empty values, keep's first. */
export function mergeFieldValue(
  key: string,
  type: CrmFieldType | undefined,
  values: Array<Exclude<FieldValue, null>>,
): Exclude<FieldValue, null> {
  const [first] = values
  if (type === 'multiSelect' || Array.isArray(first)) {
    const out: Array<string> = []
    for (const v of values) {
      for (const item of Array.isArray(v) ? v : [String(v)]) {
        if (!out.includes(item)) out.push(item)
      }
    }
    return out
  }
  if (type === 'checkbox' || typeof first === 'boolean') {
    return values.some((v) => v === true)
  }
  if (key === 'firstContact') {
    return values.map(String).reduce((min, v) => (v < min ? v : min))
  }
  // "Luma" is what the Luma sync fills in when it knows nothing better.
  if (key === 'contactSource' && first === 'Luma') {
    return values.find((v) => v !== 'Luma') ?? first
  }
  return first
}

// ── Duplicates ───────────────────────────────────────────────────────────

export type DupContact = {
  _id: string
  _creationTime: number
  name: string
  email?: string
  otherEmails?: Array<string>
  phone?: string
  linkedin?: string
  website?: string
  location?: string
  notes?: string
  userId?: string
  airtableId?: string
  fields?: Record<string, FieldValue>
}

export type DupReason =
  | 'sameEmail'
  | 'sameLinkedin'
  | 'samePhone'
  | 'sameName'
  | 'similarName'

const REASON_SCORE: Record<DupReason, number> = {
  sameEmail: 5,
  sameLinkedin: 4,
  samePhone: 4,
  sameName: 3,
  similarName: 2,
}

export type DupPair = { a: string; b: string; reasons: Array<DupReason> }

export type DupGroup = {
  ids: Array<string>
  reasons: Array<DupReason>
  pairs: Array<DupPair>
  score: number
  suggestedKeepId: string
  // Two members are linked to different app accounts: can't be merged.
  blocked: boolean
}

/** Canonical key for an unordered pair of ids. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/** Last 8 digits of a phone with at least 8, else null. */
export function phoneKey(phone: string | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '')
  return digits.length >= 8 ? digits.slice(-8) : null
}

/** `in/<handle>` (or the cleaned URL) for a LinkedIn URL, else null. */
export function linkedinKey(url: string | undefined): string | null {
  if (!url) return null
  const clean = url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^([a-z]{2,3}\.)?(www\.)?/, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
  if (!clean.startsWith('linkedin.com/')) return null
  const path = clean.slice('linkedin.com/'.length)
  if (!path) return null
  const handle = path.match(/^(in|pub)\/([^/]+)/)
  return handle ? `in/${decodeURIComponentSafe(handle[2])}` : path
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** An email's local part without +tags, dots and symbols. */
export function emailLocal(email: string): string {
  return normalizeEmail(email)
    .split('@')[0]
    .replace(/\+.*$/, '')
    .replace(/[^a-z0-9]/g, '')
}

function editDistanceAtMost1(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else {
      i++
      j++
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

/**
 * Two email local parts that look like the same person's: equal, one
 * inside the other, or one typo apart. Containment doesn't count when the
 * shorter one is only a word of the name (`ignore`): "sebastian" inside
 * "rodriguezsebastian" says nothing beyond the first name.
 */
export function similarLocal(
  a: string,
  b: string,
  ignore: Set<string> = new Set(),
): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.length >= 5 && !ignore.has(short) && long.includes(short)) {
    return true
  }
  return short.length >= 6 && editDistanceAtMost1(a, b)
}

function emailsOf(c: DupContact): Array<string> {
  return [c.email, ...(c.otherEmails ?? [])]
    .filter((e): e is string => !!e)
    .map(normalizeEmail)
}

/** Why two contacts look like the same person (empty: they don't). */
export function pairReasons(x: DupContact, y: DupContact): Array<DupReason> {
  const reasons: Array<DupReason> = []
  const ex = emailsOf(x)
  const ey = emailsOf(y)
  if (ex.some((e) => ey.includes(e))) reasons.push('sameEmail')
  const lx = linkedinKey(x.linkedin)
  if (lx && lx === linkedinKey(y.linkedin)) reasons.push('sameLinkedin')
  const px = phoneKey(x.phone)
  if (px && px === phoneKey(y.phone)) reasons.push('samePhone')

  const wx = nameWords(x.name)
  const wy = nameWords(y.name)
  if (wx.length >= 2 && wx.join(' ') === wy.join(' ')) {
    reasons.push('sameName')
  } else if (wx.length > 0 && wy.length > 0 && wx[0] === wy[0]) {
    const [short, long] = wx.length <= wy.length ? [wx, wy] : [wy, wx]
    const subset = short.every((w) => long.includes(w))
    const localX = ex.map(emailLocal)
    const localY = ey.map(emailLocal)
    const words = new Set([...wx, ...wy])
    const emailsAlike = localX.some((a) =>
      localY.some((b) => similarLocal(a, b, words)),
    )
    if (
      subset &&
      (emailsAlike ||
        reasons.includes('samePhone') ||
        reasons.includes('sameLinkedin'))
    ) {
      reasons.push('similarName')
    }
  }
  return reasons
}

/** Filled core columns and fields, to prefer the richer record. */
export function filledCount(c: DupContact): number {
  const core = [c.email, c.phone, c.linkedin, c.website, c.location, c.notes]
  return (
    core.filter((v) => !empty(v)).length +
    Object.values(c.fields ?? {}).filter((v) => !empty(v)).length
  )
}

/**
 * The contact to keep: linked to an account, then imported from Airtable,
 * then the most filled in, then the oldest.
 */
export function suggestKeep(contacts: Array<DupContact>): DupContact {
  return [...contacts].sort(
    (a, b) =>
      Number(!!b.userId) - Number(!!a.userId) ||
      Number(!!b.airtableId) - Number(!!a.airtableId) ||
      filledCount(b) - filledCount(a) ||
      a._creationTime - b._creationTime,
  )[0]
}

// A bucket bigger than this (say, everyone named Juan) is only compared
// on its first members; it keeps the pair count bounded.
const MAX_BUCKET = 200

/**
 * Groups of contacts that look like the same person, strongest first.
 * Candidate pairs come from shared emails, LinkedIn, phone, full name or
 * first name; pairs in `dismissed` (pairKey) are skipped.
 */
export function findDuplicateGroups(
  contacts: Array<DupContact>,
  dismissed: Set<string>,
): Array<DupGroup> {
  const buckets = new Map<string, Array<DupContact>>()
  const add = (key: string, c: DupContact) => {
    const list = buckets.get(key)
    if (!list) buckets.set(key, [c])
    else if (list.length < MAX_BUCKET && !list.includes(c)) list.push(c)
  }
  for (const c of contacts) {
    for (const e of emailsOf(c)) add(`e:${e}`, c)
    const li = linkedinKey(c.linkedin)
    if (li) add(`l:${li}`, c)
    const ph = phoneKey(c.phone)
    if (ph) add(`p:${ph}`, c)
    const words = nameWords(c.name)
    if (words.length) add(`f:${words[0]}`, c)
  }

  const byId = new Map(contacts.map((c) => [c._id, c]))
  const pairs = new Map<string, DupPair>()
  for (const list of buckets.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const key = pairKey(list[i]._id, list[j]._id)
        if (pairs.has(key) || dismissed.has(key)) continue
        const reasons = pairReasons(list[i], list[j])
        if (reasons.length === 0) continue
        const [a, b] = key.split('|')
        pairs.set(key, { a, b, reasons })
      }
    }
  }

  // Grow groups from the strongest pairs down. A pair an admin dismissed
  // never ends up in one group: an edge that would join two dismissed
  // contacts is dropped, which splits the group instead.
  const groupOf = new Map<string, Set<string>>()
  const members = (id: string) => {
    let set = groupOf.get(id)
    if (!set) {
      set = new Set([id])
      groupOf.set(id, set)
    }
    return set
  }
  const scoreOf = (p: DupPair) =>
    p.reasons.reduce((sum, r) => sum + REASON_SCORE[r], 0)
  const kept: Array<DupPair> = []
  const ordered = [...pairs.values()].sort(
    (x, y) =>
      scoreOf(y) - scoreOf(x) ||
      pairKey(x.a, x.b).localeCompare(pairKey(y.a, y.b)),
  )
  for (const p of ordered) {
    const ga = members(p.a)
    const gb = members(p.b)
    if (ga !== gb) {
      const conflict = [...ga].some((x) =>
        [...gb].some((y) => dismissed.has(pairKey(x, y))),
      )
      if (conflict) continue
      for (const id of gb) {
        ga.add(id)
        groupOf.set(id, ga)
      }
    }
    kept.push(p)
  }
  const groups = new Map<Set<string>, Array<DupPair>>()
  for (const p of kept) {
    const g = members(p.a)
    const list = groups.get(g)
    if (list) list.push(p)
    else groups.set(g, [p])
  }

  const out: Array<DupGroup> = []
  for (const groupPairs of groups.values()) {
    const ids = [...new Set(groupPairs.flatMap((p) => [p.a, p.b]))]
    const people = ids.map((id) => byId.get(id) as DupContact)
    const reasons = [...new Set(groupPairs.flatMap((p) => p.reasons))].sort(
      (a, b) => REASON_SCORE[b] - REASON_SCORE[a],
    )
    const score = Math.max(...groupPairs.map(scoreOf))
    const keep = suggestKeep(people)
    const accounts = new Set(people.map((m) => m.userId).filter(Boolean))
    out.push({
      ids: [keep._id, ...ids.filter((id) => id !== keep._id)],
      reasons,
      pairs: groupPairs,
      score,
      suggestedKeepId: keep._id,
      blocked: accounts.size > 1,
    })
  }
  return out.sort(
    (a, b) =>
      Number(a.blocked) - Number(b.blocked) ||
      b.score - a.score ||
      a.suggestedKeepId.localeCompare(b.suggestedKeepId),
  )
}

// ── Dismissals on merge ──────────────────────────────────────────────────

export type DismissalRow = { _id: string; a: string; b: string }

/**
 * How a merge rewrites "not the same person" pairs: a merged contact's pair
 * with C becomes keep's pair with C. `rows` holds every row touching keep
 * or a merged contact. Pairs inside the merge, and pairs keep already has,
 * are removed; the rest are repointed (ordered `a < b`).
 */
export function planDismissalMove(
  rows: Array<DismissalRow>,
  keepId: string,
  mergedIds: Array<string>,
): { remove: Array<string>; repoint: Array<DismissalRow> } {
  const merged = new Set(mergedIds)
  const unique = [...new Map(rows.map((r) => [r._id, r])).values()]
  const have = new Set(
    unique
      .filter((r) => !merged.has(r.a) && !merged.has(r.b))
      .map((r) => pairKey(r.a, r.b)),
  )
  const remove: Array<string> = []
  const repoint: Array<DismissalRow> = []
  for (const r of unique) {
    if (!merged.has(r.a) && !merged.has(r.b)) continue
    const other = merged.has(r.a) ? r.b : r.a
    if (other === keepId || merged.has(other)) {
      remove.push(r._id)
      continue
    }
    const key = pairKey(keepId, other)
    if (have.has(key)) {
      remove.push(r._id)
      continue
    }
    have.add(key)
    const [a, b] = key.split('|')
    repoint.push({ _id: r._id, a, b })
  }
  return { remove, repoint }
}
