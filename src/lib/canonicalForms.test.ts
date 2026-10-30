import {
  canonicalFormProblems,
  fillFormPlaceholders,
  missingPlaceholders,
  type FormField,
} from '../../convex/lib/formFields'

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

const identity: Array<FormField> = [
  { key: 'firstName', kind: 'text', label: 'Nombre', required: true },
  { key: 'lastName', kind: 'text', label: 'Apellido', required: true },
  { key: 'email', kind: 'email', label: 'Email', required: true },
]

describe('canonical form placeholders', () => {
  const fields: Array<FormField> = [
    ...identity,
    {
      key: 'whyInterested',
      kind: 'textarea',
      label: '¿Por qué te interesa {{course}}?',
      description: 'Contanos cómo te acercaste a {{area}}.',
    },
    {
      key: 'track',
      kind: 'select',
      label: 'Track',
      options: ['{{course}} presencial', '{{course}} virtual'],
      placeholder: 'Elegí uno de {{course}}',
    },
  ]

  test('fills course and area in labels, descriptions, options and placeholders', () => {
    const filled = fillFormPlaceholders(fields, {
      course: 'el Curso de Biocustodia',
      area: 'la biocustodia',
    })
    expect(filled[3].label).toBe('¿Por qué te interesa el Curso de Biocustodia?')
    expect(filled[3].description).toBe('Contanos cómo te acercaste a la biocustodia.')
    expect(filled[4].options).toEqual([
      'el Curso de Biocustodia presencial',
      'el Curso de Biocustodia virtual',
    ])
    expect(filled[4].placeholder).toBe('Elegí uno de el Curso de Biocustodia')
  })

  test('does not change the canonical it copies', () => {
    fillFormPlaceholders(fields, { course: 'X', area: 'Y' })
    expect(fields[3].label).toBe('¿Por qué te interesa {{course}}?')
  })

  test('reports each placeholder the form uses without a value', () => {
    expect(missingPlaceholders(fields, {})).toEqual(['course name', 'area'])
    expect(missingPlaceholders(fields, { course: 'X', area: '  ' })).toEqual([
      'area',
    ])
    expect(missingPlaceholders(fields, { course: 'X', area: 'Y' })).toEqual([])
  })

  test('does not ask for values the form does not use', () => {
    expect(missingPlaceholders(identity, {})).toEqual([])
  })
})

describe('canonical form validation', () => {
  test('accepts a form with the three identity questions', () => {
    expect(canonicalFormProblems(identity)).toEqual([])
  })

  test('asks for each missing, optional or mistyped identity question', () => {
    const problems = canonicalFormProblems([
      { key: 'firstName', kind: 'text', label: 'Nombre', required: true },
      { key: 'lastName', kind: 'text', label: 'Apellido' },
      { key: 'email', kind: 'text', label: 'Email', required: true },
    ])
    expect(problems).toEqual([
      'The "lastName" question must be required.',
      'The "email" question must be of type email.',
    ])
    expect(canonicalFormProblems(identity.slice(0, 2))).toEqual([
      'Add a required email question for the email, with key "email".',
    ])
  })
})
