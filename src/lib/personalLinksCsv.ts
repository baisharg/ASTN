/**
 * The CSV of an event's personal links, for a mail merge: one row per
 * approved guest with their name, email and link.
 *
 * `link` is the personal link when the guest got one, otherwise the event
 * page's plain address; `sesion_iniciada` says which ("si" or "no"), so the
 * email's text can differ. A file with personal links holds credentials.
 */
export type PersonalLinkCsvRow = {
  name: string | null
  email: string
  link: string
  // True when `link` signs the guest in.
  signsIn: boolean
}

export const PERSONAL_LINKS_CSV_HEADER = [
  'nombre',
  'email',
  'link',
  'sesion_iniciada',
] as const

/**
 * One CSV cell: quoted, with quotes doubled. Guests choose their own names,
 * so a value a spreadsheet would run as a formula (starting with = + - @, a
 * tab or a carriage return) gets a leading apostrophe.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

export function personalLinksCsv(rows: Array<PersonalLinkCsvRow>): string {
  const lines = [
    PERSONAL_LINKS_CSV_HEADER.map(csvCell).join(','),
    ...rows.map((row) =>
      [
        csvCell(row.name ?? ''),
        csvCell(row.email),
        // Always an https address built by the backend: never a formula.
        `"${row.link.replace(/"/g, '""')}"`,
        csvCell(row.signsIn ? 'si' : 'no'),
      ].join(','),
    ),
  ]
  // The byte order mark makes Excel read accented names as UTF-8.
  return `﻿${lines.join('\r\n')}\r\n`
}
