/**
 * Parse an allowlist CSV in the browser. Accepts a header row with an email
 * column (email / e-mail address / correo …) and optionally a name column
 * (name / nombre, or first + last name), or no header at all: then the email
 * is the cell containing "@" and the name is the other cell of a two-column
 * row. Handles quoted fields and comma, semicolon or tab delimiters.
 */

export type AllowlistRow = { email: string; name?: string }

export type ParsedAllowlist = {
  rows: Array<AllowlistRow>
  invalid: number
  duplicates: number
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Headers are compared without accents, case, spaces or punctuation, so
// "E-mail Address", "email_address" and "Email address" are all one key.
const EMAIL_HEADERS = new Set([
  'email',
  'mail',
  'correo',
  'correoelectronico',
  'emailaddress',
  'mailaddress',
  'direcciondecorreo',
  'direcciondecorreoelectronico',
  'direcciondeemail',
])
const NAME_HEADERS = new Set([
  'name',
  'nombre',
  'fullname',
  'nombrecompleto',
  'nombreyapellido',
])
const FIRST_NAME_HEADERS = new Set(['firstname', 'nombre'])
const LAST_NAME_HEADERS = new Set(['lastname', 'apellido'])

function normalizeHeader(cell: string): string {
  return cell
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function detectDelimiter(firstLine: string): string {
  const counts = { ',': 0, ';': 0, '\t': 0 }
  let inQuotes = false
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes
    else if (!inQuotes && ch in counts) counts[ch as keyof typeof counts]++
  }
  const best = (Object.keys(counts) as Array<keyof typeof counts>).sort(
    (a, b) => counts[b] - counts[a],
  )[0]
  return counts[best] > 0 ? best : ','
}

/**
 * Read the quoted field whose opening quote is at `start`. A field is only
 * quoted when its closing quote is followed by a delimiter, a line break or
 * the end of the text (it may span lines, and `""` is a literal quote).
 * Returns null for a quote that never closes that way.
 */
function readQuotedField(
  text: string,
  start: number,
  delimiter: string,
): { value: string; next: number } | null {
  let value = ''
  let i = start + 1
  while (i < text.length) {
    const ch = text[i]
    if (ch !== '"') {
      value += ch
      i++
      continue
    }
    if (text[i + 1] === '"') {
      value += '"'
      i += 2
      continue
    }
    let next = i + 1
    while (text[next] === ' ') next++
    const after = text[next]
    const closes =
      after === undefined ||
      after === delimiter ||
      after === '\n' ||
      after === '\r'
    return closes ? { value, next } : null
  }
  return null
}

function parseCsv(text: string): Array<Array<string>> {
  const clean = text.replace(/^﻿/, '')
  const delimiter = detectDelimiter(clean.split(/\r?\n/, 1)[0] ?? '')
  const rows: Array<Array<string>> = []
  let row: Array<string> = []
  let cell = ''
  let i = 0
  while (i < clean.length) {
    const ch = clean[i]
    if (ch === '"' && cell.trim() === '') {
      const quoted = readQuotedField(clean, i, delimiter)
      if (quoted) {
        cell = quoted.value
        i = quoted.next
      } else {
        // An unbalanced quote: drop it, so it can't swallow the rows below.
        i++
      }
    } else if (ch === delimiter) {
      row.push(cell)
      cell = ''
      i++
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      i++
    } else {
      cell += ch
      i++
    }
  }
  row.push(cell)
  rows.push(row)
  return rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ''))
}

export function parseAllowlistCsv(text: string): ParsedAllowlist {
  const table = parseCsv(text)
  if (table.length === 0) {
    return { rows: [], invalid: 0, duplicates: 0 }
  }

  const header = table[0].map(normalizeHeader)
  const emailCol = header.findIndex((h) => EMAIL_HEADERS.has(h))
  const hasHeader = emailCol !== -1
  let nameCol = -1
  let firstCol = -1
  let lastCol = -1
  if (hasHeader) {
    nameCol = header.findIndex((h) => NAME_HEADERS.has(h))
    lastCol = header.findIndex((h) => LAST_NAME_HEADERS.has(h))
    firstCol = header.findIndex((h) => FIRST_NAME_HEADERS.has(h))
    if (firstCol !== -1 && firstCol === nameCol) {
      // "nombre" + "apellido" is first + last; "nombre" alone is a full name.
      if (lastCol !== -1) nameCol = -1
      else firstCol = -1
    }
  }

  const body = hasHeader ? table.slice(1) : table
  const seen = new Set<string>()
  const rows: Array<AllowlistRow> = []
  let invalid = 0
  let duplicates = 0

  for (const cells of body) {
    let email: string | undefined
    let name: string | undefined
    if (hasHeader) {
      email = cells[emailCol]
      // A full-name column wins; when it is empty (or missing), first + last.
      name =
        (nameCol !== -1 ? cells[nameCol] : '') ||
        [cells[firstCol] ?? '', cells[lastCol] ?? ''].join(' ').trim()
    } else {
      const idx = cells.findIndex((c) => c.includes('@'))
      email = idx === -1 ? cells[0] : cells[idx]
      const others = cells.filter((_, i) => i !== idx && cells[i] !== '')
      if (idx !== -1 && others.length === 1) name = others[0]
    }

    const normalized = (email ?? '').trim().toLowerCase()
    if (!EMAIL_RE.test(normalized)) {
      invalid++
      continue
    }
    if (seen.has(normalized)) {
      duplicates++
      continue
    }
    seen.add(normalized)
    rows.push({ email: normalized, name: name?.trim() || undefined })
  }

  return { rows, invalid, duplicates }
}
