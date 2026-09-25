/**
 * Parse an allowlist CSV in the browser. Accepts a header row with an email
 * column (email / mail / correo …) and optionally a name column (name /
 * nombre, or first + last name), or no header at all: then the email is the
 * cell containing "@" and the name is the other cell of a two-column row.
 * Handles quoted fields and comma, semicolon or tab delimiters.
 */

export type AllowlistRow = { email: string; name?: string }

export type ParsedAllowlist = {
  rows: Array<AllowlistRow>
  invalid: number
  duplicates: number
  hasHeader: boolean
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const EMAIL_HEADERS = new Set([
  'email',
  'e-mail',
  'mail',
  'correo',
  'correo electronico',
  'email address',
  'direccion de correo',
])
const NAME_HEADERS = new Set([
  'name',
  'nombre',
  'full name',
  'nombre completo',
  'nombre y apellido',
])
const FIRST_NAME_HEADERS = new Set(['first name', 'first_name', 'nombre'])
const LAST_NAME_HEADERS = new Set(['last name', 'last_name', 'apellido'])

function normalizeHeader(cell: string): string {
  return cell
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_]+/g, ' ')
    .trim()
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

function parseCsv(text: string): Array<Array<string>> {
  const clean = text.replace(/^﻿/, '')
  const delimiter = detectDelimiter(clean.split(/\r?\n/, 1)[0] ?? '')
  const rows: Array<Array<string>> = []
  let row: Array<string> = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += ch
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
    return { rows: [], invalid: 0, duplicates: 0, hasHeader: false }
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
    if (lastCol !== -1) {
      // "nombre" + "apellido" is first + last, not a full name.
      firstCol = header.findIndex((h) => FIRST_NAME_HEADERS.has(h))
      if (firstCol !== -1 && firstCol === nameCol) nameCol = -1
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
      if (nameCol !== -1) name = cells[nameCol]
      else if (firstCol !== -1 || lastCol !== -1) {
        name = [cells[firstCol] ?? '', cells[lastCol] ?? ''].join(' ').trim()
      }
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

  return { rows, invalid, duplicates, hasHeader }
}
