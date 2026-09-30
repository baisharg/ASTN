import {
  findDuplicateGroups,
  legacyFlatKeys,
  linkedinKey,
  mergeNotes,
  mergeFieldValue,
  pairKey,
  pairReasons,
  phoneKey,
  planDismissalMove,
  planMerge,
  similarLocal,
  suggestKeep,
  type DupContact,
  type MergeContact,
  type MergeDef,
} from '../../../convex/contacts/mergeLogic'
import { countLumaAttendance } from '../../../convex/luma/shared'
import {
  mergeRecord,
  planImport,
  type AirtableData,
  type State,
} from '../../../convex/contacts/airtableMap'
import {
  INTERNAL_ERROR,
  INVALID_PARAMS,
  classifyToolError,
  cleanMessage,
  invalidParams,
  toolErrorText,
} from '../../../convex/mcp/errors'
import { ConvexError } from 'convex/values'

// Tests for contact merging and duplicate detection
// (convex/contacts/mergeLogic.ts), the per-event Luma counts, the Airtable
// importer's matching after a merge, and the MCP error text. Kept under src/
// so the Convex bundler never sees a test file.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
  toContain(expected: unknown): void
}

const DEFS: Array<MergeDef> = [
  { key: 'skills', type: 'multiSelect' },
  { key: 'inBuenosAires', type: 'checkbox' },
  { key: 'firstContact', type: 'date' },
  { key: 'contactSource', type: 'singleSelect' },
  { key: 'relationship', type: 'singleSelect' },
  { key: 'lumaApproved', type: 'number' },
  { key: 'title', type: 'text' },
]

const contact = (over: Partial<MergeContact> = {}): MergeContact => ({
  _id: 'c1',
  name: 'Ana',
  ...over,
})

function mustMerge(
  keep: MergeContact,
  others: Array<MergeContact>,
): Extract<ReturnType<typeof planMerge>, { ok: true }>['patch'] {
  const result = planMerge(keep, others, DEFS)
  if (!result.ok) throw new Error(result.error)
  return result.patch
}

describe('planMerge', () => {
  test('keeps the primary email and gathers every other one', () => {
    const patch = mustMerge(
      contact({ email: 'a@x.org', otherEmails: ['a2@x.org'] }),
      [
        contact({ _id: 'c2', email: 'B@X.org', otherEmails: ['a@x.org'] }),
        contact({ _id: 'c3', email: 'c@x.org' }),
      ],
    )
    expect(patch.email).toBe('a@x.org')
    expect(patch.otherEmails).toEqual(['a2@x.org', 'b@x.org', 'c@x.org'])
  })

  test('promotes an email when the kept contact has none', () => {
    const patch = mustMerge(contact(), [
      contact({ _id: 'c2', email: 'b@x.org', otherEmails: ['b2@x.org'] }),
    ])
    expect(patch.email).toBe('b@x.org')
    expect(patch.otherEmails).toEqual(['b2@x.org'])
  })

  test('fills empty core columns in order and appends distinct notes', () => {
    const patch = mustMerge(contact({ phone: '111', notes: 'Primera' }), [
      contact({ _id: 'c2', phone: '222', linkedin: 'li-2', notes: 'primera' }),
      contact({ _id: 'c3', linkedin: 'li-3', location: 'BA', notes: 'Otra' }),
    ])
    expect(patch.phone).toBe('111')
    expect(patch.linkedin).toBe('li-2')
    expect(patch.location).toBe('BA')
    expect(patch.notes).toBe('Primera\n\nOtra')
  })

  test('takes a fuller name, never a different one', () => {
    expect(
      mustMerge(contact({ name: 'Guido' }), [
        contact({ _id: 'c2', name: 'Guido Freire' }),
      ]).name,
    ).toBe('Guido Freire')
    expect(
      mustMerge(contact({ name: 'Guido Bergman' }), [
        contact({ _id: 'c2', name: 'Guido' }),
      ]).name,
    ).toBe('Guido Bergman')
    expect(
      mustMerge(contact({ name: 'Ana López' }), [
        contact({ _id: 'c2', name: 'Ana Pérez' }),
      ]).name,
    ).toBe('Ana López')
  })

  test('merges fields by type', () => {
    const patch = mustMerge(
      contact({
        fields: {
          skills: ['ml'],
          inBuenosAires: false,
          firstContact: '2024-05-01',
          contactSource: 'Luma',
          title: 'Keep',
        },
      }),
      [
        contact({
          _id: 'c2',
          fields: {
            skills: ['policy', 'ml'],
            inBuenosAires: true,
            firstContact: '2023-02-01',
            contactSource: 'Evento',
            relationship: 'Miembro',
            title: 'Other',
          },
        }),
      ],
    )
    expect(patch.fields).toEqual({
      skills: ['ml', 'policy'],
      inBuenosAires: true,
      firstContact: '2023-02-01',
      contactSource: 'Evento',
      title: 'Keep',
      relationship: 'Miembro',
    })
  })

  test('refuses two different linked accounts', () => {
    const result = planMerge(
      contact({ userId: 'u1' }),
      [contact({ _id: 'c2', userId: 'u2' })],
      DEFS,
    )
    expect(result.ok).toBe(false)
  })

  test('takes a merged account and Airtable id when keep has none', () => {
    const patch = mustMerge(contact(), [
      contact({ _id: 'c2', userId: 'u2', airtableId: 'recB' }),
    ])
    expect(patch.userId).toBe('u2')
    expect(patch.airtableId).toBe('recB')
    expect(patch.mergedAirtableIds).toBe(undefined)
  })

  test('keeps other Airtable ids in mergedAirtableIds', () => {
    const patch = mustMerge(
      contact({ airtableId: 'recA', mergedAirtableIds: ['recOld'] }),
      [contact({ _id: 'c2', airtableId: 'recB', mergedAirtableIds: ['recC'] })],
    )
    expect(patch.airtableId).toBe('recA')
    expect(patch.mergedAirtableIds).toEqual(['recOld', 'recB', 'recC'])
  })
})

describe('mergeNotes', () => {
  test('keeps a note that only contains another', () => {
    expect(mergeNotes(['Spoke to Alice about the proposal', 'Alice'])).toBe(
      'Spoke to Alice about the proposal\n\nAlice',
    )
  })
  test('drops exact repeats, ignoring case and spacing', () => {
    expect(mergeNotes(['Hola  mundo', ' hola mundo ', undefined, ''])).toBe(
      'Hola  mundo',
    )
  })
  test('drops a note already there as a paragraph', () => {
    expect(mergeNotes(['A\n\nB', 'b', 'C'])).toBe('A\n\nB\n\nC')
  })
})

describe('legacyFlatKeys', () => {
  test('lists old flat columns still on a contact', () => {
    expect(legacyFlatKeys({ name: 'X', skills: 'ml', role: '' })).toEqual([
      'skills',
    ])
    expect(legacyFlatKeys({ name: 'X', fields: { skills: ['ml'] } })).toEqual(
      [],
    )
  })
})

describe('mergeFieldValue', () => {
  test('scalars keep the first value', () => {
    expect(mergeFieldValue('score', 'number', [3, 5])).toBe(3)
  })
  test('a checked checkbox wins', () => {
    expect(mergeFieldValue('core', 'checkbox', [false, true])).toBe(true)
  })
})

// ── Duplicates ───────────────────────────────────────────────────────────

let seq = 0
const dup = (over: Partial<DupContact> = {}): DupContact => ({
  _id: `d${++seq}`,
  _creationTime: seq,
  name: 'Someone',
  ...over,
})

describe('normalizers', () => {
  test('phoneKey uses the last 8 digits of long enough numbers', () => {
    expect(phoneKey('+54 9 11 1234-5678')).toBe('12345678')
    expect(phoneKey('011 1234 5678')).toBe('12345678')
    expect(phoneKey('1234')).toBe(null)
  })
  test('linkedinKey reduces profile URLs to the handle', () => {
    expect(linkedinKey('https://www.linkedin.com/in/ana-lopez/')).toBe(
      'in/ana-lopez',
    )
    expect(linkedinKey('ar.linkedin.com/in/Ana-Lopez?trk=x')).toBe(
      'in/ana-lopez',
    )
    expect(linkedinKey('Ana López')).toBe(null)
  })
  test('similarLocal', () => {
    expect(similarLocal('freireguidoi', 'freireguido')).toBe(true)
    expect(similarLocal('gbergman', 'guido')).toBe(false)
    expect(similarLocal('anaperez', 'anaprez')).toBe(true)
    expect(similarLocal('ana', 'anabel')).toBe(false)
  })
})

describe('pairReasons', () => {
  test('same full name, accents and case ignored', () => {
    expect(
      pairReasons(
        dup({ name: 'Guido Bergman' }),
        dup({ name: 'guido  bérgman' }),
      ),
    ).toEqual(['sameName'])
  })

  test('a shorter name with similar email local parts', () => {
    expect(
      pairReasons(
        dup({ name: 'Guido Freire', email: 'freireguidoi@gmail.com' }),
        dup({ name: 'Guido', email: 'freireguido@outlook.com' }),
      ),
    ).toEqual(['similarName'])
  })

  test('a shorter name alone is not enough', () => {
    expect(
      pairReasons(
        dup({ name: 'Guido Freire', email: 'freire@gmail.com' }),
        dup({ name: 'Guido', email: 'gg@outlook.com' }),
      ),
    ).toEqual([])
  })

  test('an email that only contains the first name is not a signal', () => {
    expect(
      pairReasons(
        dup({ name: 'Sebastián Beltrán', email: 'sebastian@trace.example' }),
        dup({ name: 'Sebastian', email: 'rodriguezsebastian@gmail.com' }),
      ),
    ).toEqual([])
    expect(
      pairReasons(
        dup({ name: 'Guido Bergman', email: 'guido@baish.example' }),
        dup({ name: 'Guido', email: 'freireguido@outlook.com' }),
      ),
    ).toEqual([])
  })

  test('one-word names need more than the name', () => {
    expect(pairReasons(dup({ name: 'Juan' }), dup({ name: 'Juan' }))).toEqual(
      [],
    )
  })

  test('shared email, phone and LinkedIn', () => {
    expect(
      pairReasons(
        dup({
          name: 'A B',
          email: 'x@y.org',
          phone: '+54 11 5555 1234',
          linkedin: 'linkedin.com/in/ab',
        }),
        dup({
          name: 'Other Person',
          otherEmails: ['x@y.org'],
          phone: '1155551234',
          linkedin: 'https://www.linkedin.com/in/ab/',
        }),
      ),
    ).toEqual(['sameEmail', 'sameLinkedin', 'samePhone'])
  })
})

describe('findDuplicateGroups', () => {
  test('groups transitively and suggests the linked, then Airtable contact', () => {
    const a = dup({ name: 'Guido Bergman', email: 'gbergman@fi.uba.ar' })
    const b = dup({
      name: 'Guido Bergman',
      email: 'guido@baish.com.ar',
      airtableId: 'rec1',
    })
    const c = dup({
      name: 'G. Bergman',
      phone: '11 4444 3333',
      otherEmails: ['guido@baish.com.ar'],
      userId: 'u1',
    })
    const other = dup({ name: 'Ana López', email: 'ana@x.org' })
    const groups = findDuplicateGroups([a, b, c, other], new Set())
    expect(groups.length).toBe(1)
    expect(groups[0].ids.length).toBe(3)
    expect(groups[0].suggestedKeepId).toBe(c._id)
    expect(groups[0].ids[0]).toBe(c._id)
    expect(groups[0].reasons).toEqual(['sameEmail', 'sameName'])
    expect(groups[0].blocked).toBe(false)
  })

  test('skips dismissed pairs', () => {
    const a = dup({ name: 'María Gómez' })
    const b = dup({ name: 'Maria Gomez' })
    expect(findDuplicateGroups([a, b], new Set()).length).toBe(1)
    expect(
      findDuplicateGroups([a, b], new Set([pairKey(b._id, a._id)])).length,
    ).toBe(0)
  })

  test('never groups a dismissed pair, even through a third contact', () => {
    const a = dup({ name: 'Laura Díaz', email: 'laura@x.org' })
    const b = dup({ name: 'Laura Diaz', phone: '11 2222 3333' })
    const c = dup({
      name: 'Laura Díaz',
      otherEmails: ['laura@x.org'],
      phone: '1122223333',
    })
    const all = findDuplicateGroups([a, b, c], new Set())
    expect(all.length).toBe(1)
    expect(all[0].ids.length).toBe(3)
    const split = findDuplicateGroups(
      [a, b, c],
      new Set([pairKey(a._id, b._id)]),
    )
    expect(split.length).toBe(1)
    expect(split[0].ids.length).toBe(2)
    expect(split[0].ids.includes(a._id) && split[0].ids.includes(b._id)).toBe(
      false,
    )
  })

  test('flags groups with two different accounts', () => {
    const a = dup({ name: 'Pedro Paz', userId: 'u1' })
    const b = dup({ name: 'Pedro Paz', userId: 'u2' })
    expect(findDuplicateGroups([a, b], new Set())[0].blocked).toBe(true)
  })

  test('suggestKeep prefers the most filled in, then the oldest', () => {
    const older = dup({ name: 'X' })
    const richer = dup({ name: 'X', phone: '1', fields: { skills: ['a'] } })
    expect(suggestKeep([older, richer])._id).toBe(richer._id)
    const newer = dup({ name: 'X' })
    expect(suggestKeep([newer, older])._id).toBe(older._id)
  })
})

describe('planDismissalMove', () => {
  test('repoints pairs to keep, dropping ones inside the merge or already there', () => {
    const plan = planDismissalMove(
      [
        { _id: 'd1', a: 'm1', b: 'x' }, // m1 is not x → keep is not x
        { _id: 'd2', a: 'keep', b: 'x' }, // keep already has it
        { _id: 'd3', a: 'm2', b: 'x' }, // duplicate of d2 after moving
        { _id: 'd4', a: 'keep', b: 'm1' }, // inside the merge
        { _id: 'd5', a: 'm1', b: 'm2' }, // inside the merge
        { _id: 'd6', a: 'm2', b: 'y' }, // m2 is not y → keep is not y
        { _id: 'd6', a: 'm2', b: 'y' }, // seen twice (from both ends)
        { _id: 'd7', a: 'y', b: 'z' }, // untouched
      ],
      'keep',
      ['m1', 'm2'],
    )
    expect(plan.remove.sort()).toEqual(['d1', 'd3', 'd4', 'd5'])
    expect(plan.repoint).toEqual([{ _id: 'd6', a: 'keep', b: 'y' }])
  })

  test('moves a pair when keep has none yet', () => {
    const plan = planDismissalMove([{ _id: 'd1', a: 'aaa', b: 'm1' }], 'zzz', [
      'm1',
    ])
    expect(plan).toEqual({
      remove: [],
      repoint: [{ _id: 'd1', a: 'aaa', b: 'zzz' }],
    })
  })
})

// ── Luma counts ──────────────────────────────────────────────────────────

describe('countLumaAttendance', () => {
  const row = (event: string, email: string, status: string) => ({
    source: 'luma',
    kind: 'event',
    status,
    externalId: `luma:${event}:${email}`,
    data: { lumaEventId: event },
  })

  test('counts each event once with its best status', () => {
    expect(
      countLumaAttendance([
        row('evt-1', 'a@x.org', 'approved'),
        row('evt-1', 'b@x.org', 'checked_in'),
        row('evt-2', 'a@x.org', 'declined'),
        row('evt-2', 'b@x.org', 'approved'),
        row('evt-3', 'a@x.org', 'waitlist'),
        { source: 'airtable', kind: 'session', status: 'approved' },
      ]),
    ).toEqual({ approved: 2, checkedIn: 1 })
  })

  test('falls back to the event id in externalId', () => {
    expect(
      countLumaAttendance([
        {
          source: 'luma',
          kind: 'event',
          status: 'checked_in',
          externalId: 'luma:evt-9:a@x.org',
        },
        {
          source: 'luma',
          kind: 'event',
          status: 'pending',
          externalId: 'luma:evt-9:b@x.org',
        },
      ]),
    ).toEqual({ approved: 1, checkedIn: 1 })
  })
})

// ── Airtable re-import after a merge ─────────────────────────────────────

const personaFields = [
  { id: 'f1', name: 'Nombre', type: 'singleLineText' },
  { id: 'f2', name: 'Email', type: 'email' },
  { id: 'f3', name: 'Notas', type: 'multilineText' },
]

function airtableData(personas: AirtableData['personas']): AirtableData {
  return {
    personaFields,
    orgFields: [],
    formFields: [],
    attendanceFields: [],
    applicationFields: [],
    personas,
    organizaciones: [],
    formularios: [],
    programs: [],
    participation: [],
    sessions: [],
    attendance: [],
    applications: [],
  }
}

describe('Airtable import after a merge', () => {
  const personaA = {
    id: 'recTestA',
    createdTime: '2024-01-01T00:00:00.000Z',
    fields: {
      Nombre: 'Test Merge',
      Email: 'test-merge-a@example.com',
      Notas: 'Nota A',
    },
  }
  const personaB = {
    id: 'recTestB',
    createdTime: '2024-01-01T00:00:00.000Z',
    fields: {
      Nombre: 'Test Merge Persona',
      Email: 'test-merge-b@example.com',
      Notas: 'Nota B',
    },
  }
  const data = airtableData([personaA, personaB] as AirtableData['personas'])

  // Both personas imported as their own contacts, then B merged into A.
  const a: MergeContact = {
    _id: 'kA',
    name: 'Test Merge',
    email: 'test-merge-a@example.com',
    notes: 'Nota A',
    airtableId: 'recTestA',
  }
  const b: MergeContact = {
    _id: 'kB',
    name: 'Test Merge Persona',
    email: 'test-merge-b@example.com',
    notes: 'Nota B',
    airtableId: 'recTestB',
  }

  test('matches the merged persona by mergedAirtableIds and changes nothing', () => {
    const patch = mustMerge(a, [b])
    expect(patch.mergedAirtableIds).toEqual(['recTestB'])
    const state: State = {
      contacts: [{ _id: 'kA', ...patch }],
      organizations: [],
      defs: [],
      activities: [],
    }
    const plan = planImport(data, state)
    expect(plan.contacts.length).toBe(1)
    expect(plan.contacts[0].targetId).toBe('kA')
    const merged = mergeRecord(
      'contacts',
      state.contacts[0],
      plan.contacts[0],
      new Map(),
      false,
    )
    expect(merged.patch).toEqual({})
  })

  test('without mergedAirtableIds the merged persona would come back', () => {
    const patch = mustMerge(a, [b])
    const state: State = {
      contacts: [
        {
          _id: 'kA',
          ...patch,
          mergedAirtableIds: undefined,
          otherEmails: undefined,
        },
      ],
      organizations: [],
      defs: [],
      activities: [],
    }
    const plan = planImport(data, state)
    expect(plan.contacts.some((c) => !c.targetId)).toBe(true)
  })
})

// ── MCP error text ───────────────────────────────────────────────────────

describe('toolErrorText', () => {
  test('strips the Convex wrapper and stack', () => {
    const err = new Error(
      '[CONVEX Q(mcp/people:person)] [Request ID: 1234abcd] Server Error\n' +
        'Uncaught Error: Contact not found\n' +
        '    at handler (../../convex/mcp/people.ts:204:8)\n' +
        '    at async invokeQuery (../../node_modules/convex/src/server/impl/registration_impl.ts:89:0)\n' +
        '\n  Called by client',
    )
    expect(toolErrorText(err)).toBe('Contact not found')
  })

  test('strips a bare Uncaught prefix', () => {
    expect(
      cleanMessage(
        "Uncaught Error: Organization 'nope' not found\n    at resolveOrgForAdmin (../../convex/mcp/data.ts:127:14)",
      ),
    ).toBe("Organization 'nope' not found")
  })

  test('uses ConvexError data', () => {
    expect(
      toolErrorText(new ConvexError('No encontramos uno de los contactos')),
    ).toBe('No encontramos uno de los contactos')
    expect(
      toolErrorText(new ConvexError({ code: 'x', message: 'Con mensaje' })),
    ).toBe('Con mensaje')
  })

  test('cleans ConvexError string data too', () => {
    expect(
      toolErrorText(
        new ConvexError('Uncaught Error: Nope\n    at handler (x.ts:1:1)'),
      ),
    ).toBe('Nope')
  })

  test('finds nested messages and never shows stacks or causes', () => {
    expect(
      toolErrorText(
        new ConvexError({
          error: { message: 'Deep', stack: 'at x' },
          cause: 'secret',
        }),
      ),
    ).toBe('Deep')
    expect(toolErrorText({ message: 'Plain object', stack: 'at y' })).toBe(
      'Plain object',
    )
    const json = toolErrorText({ code: 1, stack: 'at y', cause: { z: 1 } })
    expect(json).toBe('{"code":1}')
  })

  test('never throws on bigint or circular data', () => {
    const circular: Record<string, unknown> = { code: 'x' }
    circular.self = circular
    expect(toolErrorText(new ConvexError({ n: 10n } as never))).toBe(
      '{"n":"10"}',
    )
    expect(toolErrorText(circular)).toBe('{"code":"x","self":"[Circular]"}')
    expect(toolErrorText(undefined)).toBe('The tool failed')
    const hostile = {
      get message(): string {
        throw new Error('boom')
      },
    }
    expect(toolErrorText(hostile)).toBe('The tool failed')
  })

  test('keeps plain messages', () => {
    expect(toolErrorText(new Error('Unknown tool: nope'))).toBe(
      'Unknown tool: nope',
    )
  })
})

describe('classifyToolError', () => {
  test('domain errors are tool results', () => {
    expect(
      classifyToolError(
        new Error('Uncaught Error: Contact not found\n    at handler (x)'),
      ),
    ).toEqual({ kind: 'result', text: 'Contact not found' })
    expect(classifyToolError(new ConvexError('Refusé'))).toEqual({
      kind: 'result',
      text: 'Refusé',
    })
  })

  test('unknown tools and bad arguments are Invalid params', () => {
    expect(classifyToolError(invalidParams('Unknown tool: x'))).toEqual({
      kind: 'rpc',
      code: INVALID_PARAMS,
      message: 'Unknown tool: x',
    })
    const validation = classifyToolError(
      new Error(
        'ArgumentValidationError: Value does not match validator.\nPath: .keepId\nValue: 3\nValidator: v.string()',
      ),
    )
    expect(validation.kind).toBe('rpc')
    expect(validation.kind === 'rpc' && validation.code).toBe(INVALID_PARAMS)
  })

  test('unexpected failures are Internal error, without the stack', () => {
    expect(
      classifyToolError(
        new Error(
          "Uncaught TypeError: Cannot read properties of undefined (reading 'x')\n    at handler (convex/mcp/tools.ts:1:1)",
        ),
      ),
    ).toEqual({
      kind: 'rpc',
      code: INTERNAL_ERROR,
      message:
        "Internal error: Cannot read properties of undefined (reading 'x')",
    })
    expect(classifyToolError(new TypeError('bad')).kind).toBe('rpc')
    expect(classifyToolError('a string').kind).toBe('rpc')
  })
})
