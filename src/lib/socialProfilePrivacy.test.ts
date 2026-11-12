import {
  attendeeVisibleProfile,
  optedOutOfSuggestions,
  privateProfileSections,
  sharedProfileParts,
  socialProfileView,
  takesPartInSuggestions,
} from '../../convex/social/lib'
import { rosterEntry, summarizeProfile } from '../../convex/social/suggestions'
import type { Doc } from '../../convex/_generated/dataModel'
import type { ProfileSection } from '../../convex/social/lib'

// What a profile shares at an in-person event, with other attendees and with
// the suggestions model (convex/social/lib.ts attendeeVisibleProfile). Kept
// under src/ so the Convex bundler never sees a test file.

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
  toContain(expected: unknown): void
  not: { toContain(expected: unknown): void }
}

type Privacy = Doc<'profiles'>['privacySettings']

/** A profile with something in every field the event pages read. */
function fullProfile(privacySettings?: Privacy): Doc<'profiles'> {
  return {
    userId: 'user_ana',
    name: 'Ana Pérez',
    headline: 'Investigadora de interpretabilidad',
    seeking: 'Un proyecto para arrancar',
    canHelpWith: 'Evals en producción',
    location: 'Buenos Aires',
    linkedinUrl: 'https://www.linkedin.com/in/ana',
    workHistory: [
      { organization: 'Org 1', title: 'Rol 1', current: true },
      { organization: 'Org 2', title: 'Rol 2' },
      { organization: 'Org 3', title: 'Rol 3' },
      { organization: 'Org 4', title: 'Rol 4' },
      { organization: 'Org 5', title: 'Rol 5' },
    ],
    education: [{ institution: 'UBA', degree: 'Lic.', field: 'Computación' }],
    skills: ['Python', 'PyTorch'],
    careerGoals: 'Trabajar en seguridad de IA',
    aiSafetyInterests: ['Interpretabilidad'],
    privacySettings,
  } as unknown as Doc<'profiles'>
}

/** The fields of each section, and what they are when the section is hidden. */
const SECTION_FIELDS: Record<
  ProfileSection,
  Array<keyof ReturnType<typeof attendeeVisibleProfile>>
> = {
  basicInfo: ['location', 'linkedinUrl'],
  workHistory: ['workHistory'],
  education: ['education'],
  skills: ['skills'],
  careerGoals: ['careerGoals', 'interests'],
}
const ALL_SECTIONS = Object.keys(SECTION_FIELDS) as Array<ProfileSection>

function isEmpty(value: unknown): boolean {
  return value === null || (Array.isArray(value) && value.length === 0)
}

describe('privateProfileSections', () => {
  test('without privacy settings nothing is private', () => {
    expect(privateProfileSections(undefined)).toEqual([])
  })

  test("a 'public' or 'connections' default keeps every section shared", () => {
    expect(privateProfileSections({ defaultVisibility: 'public' })).toEqual([])
    expect(
      privateProfileSections({ defaultVisibility: 'connections' }),
    ).toEqual([])
  })

  test("a 'private' default makes every section private", () => {
    expect(
      [...privateProfileSections({ defaultVisibility: 'private' })].sort(),
    ).toEqual([...ALL_SECTIONS].sort())
  })

  test("a section set to 'private' is private under a shared default", () => {
    for (const section of ALL_SECTIONS) {
      expect(
        privateProfileSections({
          defaultVisibility: 'public',
          sectionVisibility: { [section]: 'private' },
        }),
      ).toEqual([section])
    }
  })

  test("a section set to 'public' or 'connections' is shared under a private default", () => {
    for (const section of ALL_SECTIONS) {
      for (const visibility of ['public', 'connections']) {
        const hidden = privateProfileSections({
          defaultVisibility: 'private',
          sectionVisibility: { [section]: visibility },
        })
        expect(hidden.includes(section)).toBe(false)
        expect(hidden.length).toBe(ALL_SECTIONS.length - 1)
      }
    }
  })

  test("only the exact value 'private' hides a section", () => {
    expect(
      privateProfileSections({
        defaultVisibility: 'public',
        sectionVisibility: { skills: 'Private', education: 'hidden' },
      }),
    ).toEqual([])
  })
})

describe('attendeeVisibleProfile', () => {
  test('a missing profile shares nothing and hides nothing', () => {
    expect(attendeeVisibleProfile(null)).toEqual({
      name: null,
      headline: null,
      seeking: null,
      canHelpWith: null,
      location: null,
      linkedinUrl: null,
      workHistory: [],
      education: [],
      skills: [],
      careerGoals: null,
      interests: [],
      hiddenSections: [],
    })
  })

  test('without privacy settings every field is shared', () => {
    const profile = fullProfile()
    const visible = attendeeVisibleProfile(profile)
    expect(visible.name).toBe('Ana Pérez')
    expect(visible.headline).toBe('Investigadora de interpretabilidad')
    expect(visible.seeking).toBe('Un proyecto para arrancar')
    expect(visible.canHelpWith).toBe('Evals en producción')
    expect(visible.location).toBe('Buenos Aires')
    expect(visible.linkedinUrl).toBe('https://www.linkedin.com/in/ana')
    expect(visible.workHistory).toEqual(profile.workHistory)
    expect(visible.education).toEqual(profile.education)
    expect(visible.skills).toEqual(['Python', 'PyTorch'])
    expect(visible.careerGoals).toBe('Trabajar en seguridad de IA')
    expect(visible.interests).toEqual(['Interpretabilidad'])
    expect(visible.hiddenSections).toEqual([])
  })

  test('each private section hides its own fields and no others', () => {
    for (const section of ALL_SECTIONS) {
      const visible = attendeeVisibleProfile(
        fullProfile({
          defaultVisibility: 'connections',
          sectionVisibility: { [section]: 'private' },
        }),
      )
      expect(visible.hiddenSections).toEqual([section])
      for (const other of ALL_SECTIONS) {
        for (const field of SECTION_FIELDS[other]) {
          expect(isEmpty(visible[field])).toBe(other === section)
        }
      }
    }
  })

  test('name, headline, seeking and canHelpWith are shared even when everything is private', () => {
    const visible = attendeeVisibleProfile(
      fullProfile({ defaultVisibility: 'private' }),
    )
    expect(visible.name).toBe('Ana Pérez')
    expect(visible.headline).toBe('Investigadora de interpretabilidad')
    expect(visible.seeking).toBe('Un proyecto para arrancar')
    expect(visible.canHelpWith).toBe('Evals en producción')
    for (const section of ALL_SECTIONS) {
      for (const field of SECTION_FIELDS[section]) {
        expect(isEmpty(visible[field])).toBe(true)
      }
    }
  })

  test('a section shared under a private default shows its fields', () => {
    const visible = attendeeVisibleProfile(
      fullProfile({
        defaultVisibility: 'private',
        sectionVisibility: { workHistory: 'connections' },
      }),
    )
    expect(visible.workHistory.length).toBe(5)
    expect(visible.skills).toEqual([])
    expect(visible.location).toBe(null)
  })

  test('a LinkedIn URL that is not a LinkedIn link is never shared', () => {
    const profile = fullProfile()
    profile.linkedinUrl = 'javascript:alert(1)'
    expect(attendeeVisibleProfile(profile).linkedinUrl).toBe(null)
  })
})

describe('socialProfileView', () => {
  test('shows the last four jobs and every shared field', () => {
    const view = socialProfileView(fullProfile(), 'Nombre de Luma')
    expect(view.name).toBe('Ana Pérez')
    expect(view.workHistory.length).toBe(4)
    expect(view.workHistory[0]).toEqual({
      organization: 'Org 1',
      title: 'Rol 1',
      current: true,
      startDate: null,
      endDate: null,
    })
    expect(view.location).toBe('Buenos Aires')
    expect(view.skills).toEqual(['Python', 'PyTorch'])
  })

  test('keeps every key when sections are private, as null or an empty list', () => {
    const view = socialProfileView(
      fullProfile({ defaultVisibility: 'private' }),
      undefined,
    )
    expect(view).toEqual({
      name: 'Ana Pérez',
      headline: 'Investigadora de interpretabilidad',
      location: null,
      linkedinUrl: null,
      seeking: 'Un proyecto para arrancar',
      canHelpWith: 'Evals en producción',
      careerGoals: null,
      interests: [],
      skills: [],
      workHistory: [],
    })
  })

  test('falls back to the registration name, then to a generic one', () => {
    expect(socialProfileView(null, 'Nombre de Luma').name).toBe(
      'Nombre de Luma',
    )
    expect(socialProfileView(null, undefined).name).toBe('Asistente')
  })
})

describe('summarizeProfile (what the suggestions model reads)', () => {
  test('without privacy settings it includes every section', () => {
    const summary = summarizeProfile(
      attendeeVisibleProfile(fullProfile()),
      undefined,
    )
    expect(summary).toContain('Nombre: Ana Pérez')
    expect(summary).toContain('Titular: Investigadora de interpretabilidad')
    expect(summary).toContain('Trayectoria: Rol 1 en Org 1 (actual); Rol 2')
    expect(summary).toContain('Formación: Lic., Computación, UBA')
    expect(summary).toContain('Busca: Un proyecto para arrancar')
    expect(summary).toContain('Puede ayudar con: Evals en producción')
    expect(summary).toContain('Objetivos: Trabajar en seguridad de IA')
    expect(summary).toContain('Intereses: Interpretabilidad')
    expect(summary).toContain('Habilidades: Python, PyTorch')
  })

  test('private sections never reach the model', () => {
    const summary = summarizeProfile(
      attendeeVisibleProfile(fullProfile({ defaultVisibility: 'private' })),
      undefined,
    )
    expect(summary).toBe(
      [
        'Nombre: Ana Pérez',
        'Titular: Investigadora de interpretabilidad',
        'Busca: Un proyecto para arrancar',
        'Puede ayudar con: Evals en producción',
      ].join('\n'),
    )
  })

  test('one private section leaves the others in', () => {
    const summary = summarizeProfile(
      attendeeVisibleProfile(
        fullProfile({
          defaultVisibility: 'public',
          sectionVisibility: { education: 'private' },
        }),
      ),
      undefined,
    )
    expect(summary).not.toContain('Formación')
    expect(summary).toContain('Trayectoria')
    expect(summary).toContain('Habilidades')
  })

  test('uses the registration name when the profile has none', () => {
    expect(
      summarizeProfile(attendeeVisibleProfile(null), 'Nombre de Luma'),
    ).toBe('Nombre: Nombre de Luma')
    expect(summarizeProfile(attendeeVisibleProfile(null), undefined)).toBe(
      'Nombre: Sin nombre',
    )
  })
})

describe('turning suggestions off', () => {
  const optedOut = {
    ...fullProfile(),
    socialSuggestionsOptOut: true,
  } as Doc<'profiles'>

  test('a profile without the setting has them on', () => {
    expect(optedOutOfSuggestions(fullProfile())).toBe(false)
    expect(optedOutOfSuggestions(null)).toBe(false)
    expect(optedOutOfSuggestions(optedOut)).toBe(true)
  })

  test('a ready profile is ranked, unless the person turned suggestions off', () => {
    expect(takesPartInSuggestions(fullProfile())).toBe(true)
    expect(takesPartInSuggestions(optedOut)).toBe(false)
  })

  test('a profile that is not ready is not ranked either way', () => {
    const incomplete = {
      ...fullProfile(),
      seeking: undefined,
    } as Doc<'profiles'>
    expect(takesPartInSuggestions(incomplete)).toBe(false)
    expect(takesPartInSuggestions(null)).toBe(false)
  })
})

describe('rosterEntry (who the suggestions model reads about)', () => {
  const entry = (
    profile: Doc<'profiles'> | null,
    selfId = 'user_other',
  ): ReturnType<typeof rosterEntry> =>
    rosterEntry({
      selfId,
      userId: 'user_ana',
      registrationName: 'Ana P.',
      profile,
    })

  test('an attendee with a profile is in, with the summary the model reads', () => {
    const profile = fullProfile()
    expect(entry(profile)).toEqual({
      userId: 'user_ana',
      summary: summarizeProfile(attendeeVisibleProfile(profile), 'Ana P.'),
    })
  })

  test('someone who turned suggestions off is left out', () => {
    const optedOut = {
      ...fullProfile(),
      socialSuggestionsOptOut: true,
    } as Doc<'profiles'>
    expect(entry(optedOut)).toBe(null)
  })

  test('someone who turned suggestions off is left out of their own ranking too', () => {
    const optedOut = {
      ...fullProfile(),
      socialSuggestionsOptOut: true,
    } as Doc<'profiles'>
    expect(entry(optedOut, 'user_ana')).toBe(null)
  })

  test('someone else with no headline, goal or jobs is left out', () => {
    const vague = {
      userId: 'user_ana',
      name: 'Ana Pérez',
      skills: ['Python'],
    } as unknown as Doc<'profiles'>
    expect(entry(vague)).toBe(null)
    expect(entry(null)).toBe(null)
  })

  test('the attendee being ranked is in even with a thin profile', () => {
    const thin = {
      userId: 'user_ana',
      name: 'Ana Pérez',
    } as unknown as Doc<'profiles'>
    expect(entry(thin, 'user_ana')?.userId).toBe('user_ana')
  })
})

describe('sharedProfileParts (the list on the event profile page)', () => {
  test('lists every filled part, with education for suggestions only', () => {
    expect(sharedProfileParts(attendeeVisibleProfile(fullProfile()))).toEqual({
      attendees: [
        'name',
        'headline',
        'seeking',
        'canHelpWith',
        'location',
        'linkedin',
        'workHistory',
        'skills',
        'careerGoals',
        'interests',
      ],
      suggestionsOnly: ['education'],
    })
  })

  test('leaves out private sections', () => {
    expect(
      sharedProfileParts(
        attendeeVisibleProfile(fullProfile({ defaultVisibility: 'private' })),
      ),
    ).toEqual({
      attendees: ['name', 'headline', 'seeking', 'canHelpWith'],
      suggestionsOnly: [],
    })
  })

  test('leaves out empty parts but always lists the name', () => {
    expect(sharedProfileParts(attendeeVisibleProfile(null))).toEqual({
      attendees: ['name'],
      suggestionsOnly: [],
    })
  })
})
