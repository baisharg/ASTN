import {
  applyView,
  buildColumns,
  groupRecords,
  neutralizeCsvFormula,
  paletteColor,
  matchesFilter,
  searchHaystack,
  sortRecords,
  toCsv,
  EMPTY_VIEW,
  type CrmColumn,
  type CrmRecord,
  type FieldDef,
} from './fieldValues'

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

function def(
  key: string,
  type: FieldDef['type'],
  order: number,
  options: Array<string> = [],
): FieldDef {
  return {
    _id: `def_${key}` as FieldDef['_id'],
    key,
    label: key,
    type,
    options: options.map((value) => ({ value })),
    order,
    hidden: false,
    source: 'admin',
  }
}

const defs = [
  def('stage', 'singleSelect', 0, ['Estudiante', 'Profesional']),
  def('skills', 'multiSelect', 1, ['ML', 'Policy', 'Ops']),
  def('core', 'checkbox', 2),
  def('since', 'date', 3),
  def('events', 'number', 4),
]

const columns = buildColumns('contacts', defs)
const byKey = new Map(columns.map((c) => [c.key, c]))
const col = (key: string) => byKey.get(key) as CrmColumn

function contact(
  id: string,
  name: string,
  fields: Record<string, string | Array<string> | boolean | number>,
): CrmRecord {
  return {
    _id: id,
    _creationTime: 0,
    orgId: 'org',
    name,
    fields,
    createdAt: 0,
    updatedAt: 0,
  } as unknown as CrmRecord
}

const ana = contact('a', 'Ána Pérez', {
  stage: 'Profesional',
  skills: ['ML', 'Policy'],
  core: true,
  since: '2024-03-01',
  events: 3,
})
const beto = contact('b', 'Beto', { stage: 'Estudiante', skills: ['Ops'] })
const caro = contact('c', 'Caro', { skills: ['Policy'], events: 10 })
const all = [ana, beto, caro]

describe('CRM field values', () => {
  test('columns put core first, fields in order, notes last', () => {
    expect(columns.map((c) => c.key)).toEqual([
      'name',
      'email',
      'phone',
      'linkedin',
      'website',
      'location',
      'stage',
      'skills',
      'core',
      'since',
      'events',
      'notes',
    ])
  })

  test('multi-select filters', () => {
    const f = (op: 'hasAny' | 'hasAll' | 'isNot', value: Array<string>) =>
      all
        .filter((r) =>
          matchesFilter(r, col('skills'), { field: 'skills', op, value }),
        )
        .map((r) => r._id)
    expect(f('hasAny', ['Policy'])).toEqual(['a', 'c'])
    expect(f('hasAll', ['ML', 'Policy'])).toEqual(['a'])
    expect(f('isNot', ['Policy'])).toEqual(['b'])
  })

  test('single-select, checkbox, date and number filters', () => {
    const ids = (field: string, op: never, value?: unknown) =>
      all
        .filter((r) => matchesFilter(r, col(field), { field, op, value }))
        .map((r) => r._id)
    expect(ids('stage', 'is' as never, ['Estudiante'])).toEqual(['b'])
    expect(ids('stage', 'isEmpty' as never)).toEqual(['c'])
    expect(ids('core', 'is' as never, true)).toEqual(['a'])
    expect(ids('core', 'is' as never, false)).toEqual(['b', 'c'])
    expect(ids('since', 'before' as never, '2025-01-01')).toEqual(['a'])
    expect(ids('events', 'after' as never, '5')).toEqual(['c'])
  })

  test('search ignores accents and case', () => {
    const haystacks = new Map(
      all.map((r) => [r._id, searchHaystack(r, columns)]),
    )
    const found = applyView(all, EMPTY_VIEW, byKey, 'ana perez', haystacks)
    expect(found.map((r) => r._id)).toEqual(['a'])
    const bySkill = applyView(all, EMPTY_VIEW, byKey, 'policy', haystacks)
    expect(bySkill.map((r) => r._id)).toEqual(['a', 'c'])
  })

  test('sort follows option order and keeps empty values last', () => {
    const asc = sortRecords(all, [{ field: 'stage', dir: 'asc' }], byKey)
    expect(asc.map((r) => r._id)).toEqual(['b', 'a', 'c'])
    const desc = sortRecords(all, [{ field: 'stage', dir: 'desc' }], byKey)
    expect(desc.map((r) => r._id)).toEqual(['a', 'b', 'c'])
    const num = sortRecords(all, [{ field: 'events', dir: 'desc' }], byKey)
    expect(num.map((r) => r._id)).toEqual(['c', 'a', 'b'])
  })

  test('grouping a multi-select puts a record in each of its groups', () => {
    const groups = groupRecords(all, col('skills'))
    expect(groups.map((g) => [g.label, g.records.map((r) => r._id)])).toEqual([
      ['ML', ['a']],
      ['Policy', ['a', 'c']],
      ['Ops', ['b']],
    ])
    const byStage = groupRecords(all, col('stage'))
    expect(byStage.map((g) => g.label)).toEqual([
      'Estudiante',
      'Profesional',
      'Sin valor',
    ])
  })

  test('CSV quotes cells and joins lists', () => {
    const csv = toCsv([ana], [col('name'), col('skills'), col('core')])
    expect(csv).toBe('\uFEFFNombre,skills,core\r\nÁna Pérez,"ML, Policy",Sí')
  })

  test('Airtable colors map to the palette, unknown ones to gray', () => {
    expect(paletteColor('cyan')).toBe('cyan')
    expect(paletteColor('blueLight2')).toBe('blue')
    expect(paletteColor('purpleDark1')).toBe('purple')
    expect(paletteColor('magenta')).toBe('gray')
    expect(paletteColor(undefined)).toBe('gray')
  })

  test('CSV cells cannot start a formula', () => {
    for (const bad of ['=SUM(A1)', '+1', '-2+3', '@cmd', '\tx', '\rx']) {
      expect(neutralizeCsvFormula(bad)).toBe(`'${bad}`)
    }
    expect(neutralizeCsvFormula('Ana = Ana')).toBe('Ana = Ana')
    const evil = contact('e', '=HYPERLINK("x")', { events: -3 })
    const csv = toCsv([evil], [col('name'), col('events')])
    expect(csv.split('\r\n')[1]).toBe('"\'=HYPERLINK(""x"")",-3')
  })
})
