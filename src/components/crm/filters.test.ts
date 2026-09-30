import {
  CORE_COLUMN_DEFS,
  OPS_BY_TYPE,
  filterIsActive,
  matchesAll,
  matchesFilter,
  readValue,
  type FilterColumn,
  type FilterRecord,
  type ViewFilter,
} from '../../../convex/contacts/filters'

// Tests for the filter module shared by the CRM screens and the MCP server
// (convex/contacts/filters.ts). Kept under src/ so the Convex bundler never
// sees a test file.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

const name: FilterColumn = { key: 'name', type: 'text', core: true }
const email: FilterColumn = { key: 'email', type: 'email', core: true }
const skills: FilterColumn = { key: 'skills', type: 'multiSelect', core: false }
const stage: FilterColumn = { key: 'stage', type: 'singleSelect', core: false }
const inBA: FilterColumn = { key: 'inBA', type: 'checkbox', core: false }
const since: FilterColumn = { key: 'since', type: 'date', core: false }
const events: FilterColumn = { key: 'events', type: 'number', core: false }

function rec(core: Record<string, string>, fields: FilterRecord['fields']) {
  return { ...core, fields } as FilterRecord
}

const ana = rec(
  { name: 'Ána Pérez', email: 'ana@example.org' },
  {
    skills: ['ML', 'Policy'],
    stage: 'Profesional',
    inBA: true,
    since: '2024-03-01',
    events: 3,
  },
)
const beto = rec({ name: 'Beto' }, { skills: ['Ops'], inBA: false })
const caro = rec({ name: 'Caro', email: '' }, {})

const f = (field: string, op: ViewFilter['op'], value?: unknown) =>
  ({ field, op, value }) as ViewFilter

describe('readValue', () => {
  test('core columns read from the record, empty strings as null', () => {
    expect(readValue(ana, email)).toBe('ana@example.org')
    expect(readValue(caro, email)).toBe(null)
  })
  test('fields read from the bag, missing as null', () => {
    expect(readValue(ana, skills)).toEqual(['ML', 'Policy'])
    expect(readValue(caro, skills)).toBe(null)
  })
})

describe('matchesFilter', () => {
  test('text contains ignores case and accents', () => {
    expect(matchesFilter(ana, name, f('name', 'contains', 'ana pe'))).toBe(true)
    expect(matchesFilter(beto, name, f('name', 'contains', 'ana'))).toBe(false)
  })
  test('multiSelect hasAny / hasAll / isNot', () => {
    expect(
      matchesFilter(ana, skills, f('skills', 'hasAny', ['Ops', 'ML'])),
    ).toBe(true)
    expect(
      matchesFilter(ana, skills, f('skills', 'hasAll', ['ML', 'Ops'])),
    ).toBe(false)
    expect(matchesFilter(beto, skills, f('skills', 'isNot', ['ML']))).toBe(true)
    expect(matchesFilter(caro, skills, f('skills', 'hasAny', 'ML'))).toBe(false)
  })
  test('singleSelect is takes a string or a list (any of)', () => {
    expect(matchesFilter(ana, stage, f('stage', 'is', 'Profesional'))).toBe(
      true,
    )
    expect(
      matchesFilter(
        ana,
        stage,
        f('stage', 'is', ['Estudiante', 'Profesional']),
      ),
    ).toBe(true)
    expect(
      matchesFilter(caro, stage, f('stage', 'isNot', ['Profesional'])),
    ).toBe(true)
  })
  test('checkbox is true / false; missing counts as false', () => {
    expect(matchesFilter(ana, inBA, f('inBA', 'is', true))).toBe(true)
    expect(matchesFilter(beto, inBA, f('inBA', 'is', false))).toBe(true)
    expect(matchesFilter(caro, inBA, f('inBA', 'is', false))).toBe(true)
  })
  test('date and number before / after', () => {
    expect(matchesFilter(ana, since, f('since', 'before', '2025-01-01'))).toBe(
      true,
    )
    expect(matchesFilter(ana, since, f('since', 'after', '2025-01-01'))).toBe(
      false,
    )
    expect(matchesFilter(ana, events, f('events', 'after', 2))).toBe(true)
    expect(matchesFilter(caro, events, f('events', 'isNot', 2))).toBe(true)
  })
  test('isEmpty / isNotEmpty', () => {
    expect(matchesFilter(caro, email, f('email', 'isEmpty'))).toBe(true)
    expect(matchesFilter(ana, skills, f('skills', 'isNotEmpty'))).toBe(true)
  })
})

describe('matchesAll', () => {
  test('ANDs the filters', () => {
    const filters = [
      { filter: f('skills', 'hasAny', ['ML', 'Ops']), column: skills },
      { filter: f('inBA', 'is', true), column: inBA },
    ]
    expect([ana, beto, caro].filter((r) => matchesAll(r, filters)).length).toBe(
      1,
    )
    expect(matchesAll(caro, [])).toBe(true)
  })
})

describe('filterIsActive', () => {
  test('value-less ops are always active; others need a value', () => {
    expect(filterIsActive(f('x', 'isEmpty'))).toBe(true)
    expect(filterIsActive(f('x', 'is', ''))).toBe(false)
    expect(filterIsActive(f('x', 'hasAny', []))).toBe(false)
    expect(filterIsActive(f('x', 'is', false))).toBe(true)
  })
})

describe('shared tables', () => {
  test('every field type has ops; checkbox only is', () => {
    expect(OPS_BY_TYPE.checkbox).toEqual(['is'])
    expect(CORE_COLUMN_DEFS.contacts.map((c) => c.key)).toEqual([
      'name',
      'email',
      'phone',
      'linkedin',
      'website',
      'location',
      'notes',
    ])
  })
})
