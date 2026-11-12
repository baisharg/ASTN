import { parseAllowlistCsv } from './parse-allowlist-csv'

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

describe('parseAllowlistCsv', () => {
  test('reads a header with email and name columns', () => {
    const parsed = parseAllowlistCsv(
      'Nombre,Email\nAna Pérez,ANA@example.com\nJuan,juan@example.com\n',
    )
    expect(parsed).toEqual({
      rows: [
        { email: 'ana@example.com', name: 'Ana Pérez' },
        { email: 'juan@example.com', name: 'Juan' },
      ],
      invalid: 0,
      duplicates: 0,
    })
  })

  test('reads a list without a header, with or without names', () => {
    expect(parseAllowlistCsv('ana@example.com\njuan@example.com').rows).toEqual(
      [{ email: 'ana@example.com' }, { email: 'juan@example.com' }],
    )
    expect(parseAllowlistCsv('Ana;ana@example.com').rows).toEqual([
      { email: 'ana@example.com', name: 'Ana' },
    ])
  })

  test('counts rows without a valid email and repeated emails', () => {
    const parsed = parseAllowlistCsv(
      'email\nana@example.com\nno-es-un-mail\nAna@example.com\n',
    )
    expect(parsed.rows).toEqual([{ email: 'ana@example.com' }])
    expect(parsed.invalid).toBe(1)
    expect(parsed.duplicates).toBe(1)
  })

  test('keeps commas, quotes and line breaks inside a quoted field', () => {
    const parsed = parseAllowlistCsv(
      'name,email,notes\n"Pérez, Ana",ana@example.com,"dijo ""hola""\ny se fue"\nJuan,juan@example.com,\n',
    )
    expect(parsed.rows).toEqual([
      { email: 'ana@example.com', name: 'Pérez, Ana' },
      { email: 'juan@example.com', name: 'Juan' },
    ])
  })

  test('an unbalanced quote does not swallow the rows below it', () => {
    const parsed = parseAllowlistCsv(
      [
        'name,email',
        '"Ana,ana@example.com',
        'Juan,juan@example.com',
        '"Gómez, Luz",luz@example.com',
        'Mara,mara@example.com',
      ].join('\n'),
    )
    expect(parsed.rows).toEqual([
      { email: 'ana@example.com', name: 'Ana' },
      { email: 'juan@example.com', name: 'Juan' },
      { email: 'luz@example.com', name: 'Gómez, Luz' },
      { email: 'mara@example.com', name: 'Mara' },
    ])
    expect(parsed.invalid).toBe(0)
  })

  test('an unbalanced quote on the last row is dropped', () => {
    const parsed = parseAllowlistCsv(
      'email,name\nana@example.com,Ana\njuan@example.com,"Juan',
    )
    expect(parsed.rows).toEqual([
      { email: 'ana@example.com', name: 'Ana' },
      { email: 'juan@example.com', name: 'Juan' },
    ])
  })

  test('a Luma export row with an empty name uses first and last name', () => {
    const parsed = parseAllowlistCsv(
      [
        'api_id,name,first_name,last_name,email,approval_status',
        'gst-1,,Ana,Pérez,ana@example.com,approved',
        'gst-2,Juan Gómez,Juan,G.,juan@example.com,approved',
        'gst-3,,,,luz@example.com,approved',
      ].join('\n'),
    )
    expect(parsed.rows).toEqual([
      { email: 'ana@example.com', name: 'Ana Pérez' },
      { email: 'juan@example.com', name: 'Juan Gómez' },
      { email: 'luz@example.com' },
    ])
  })

  test('"nombre" with "apellido" is a first name; alone it is the full name', () => {
    expect(
      parseAllowlistCsv('Nombre,Apellido,Correo\nAna,Pérez,ana@example.com')
        .rows,
    ).toEqual([{ email: 'ana@example.com', name: 'Ana Pérez' }])
    expect(
      parseAllowlistCsv('Nombre,Correo\nAna Pérez,ana@example.com').rows,
    ).toEqual([{ email: 'ana@example.com', name: 'Ana Pérez' }])
  })

  test('recognizes email headers whatever their punctuation and case', () => {
    for (const header of [
      'E-mail Address',
      'email_address',
      'E-Mail',
      'Correo electrónico',
      'Dirección de correo',
    ]) {
      expect(parseAllowlistCsv(`Name,${header}\nAna,ana@example.com`)).toEqual({
        rows: [{ email: 'ana@example.com', name: 'Ana' }],
        invalid: 0,
        duplicates: 0,
      })
    }
  })

  test('strips a byte order mark and reads tab-separated files', () => {
    const parsed = parseAllowlistCsv('﻿email\tname\nana@example.com\tAna')
    expect(parsed.rows).toEqual([{ email: 'ana@example.com', name: 'Ana' }])
  })
})
