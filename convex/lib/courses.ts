/**
 * Tags that say which course an opportunity belongs to. Every opportunity has
 * at most one. They group the admin's opportunity filter and scope per-course
 * access (convex/lib/courseAccess.ts). A new course needs its tag added here.
 */
export const COURSE_TAGS = [
  'TAIS Course',
  'TAIS Projects',
  'Governance',
  'AGI Strategy',
  'Biosecurity',
] as const

export type CourseTag = (typeof COURSE_TAGS)[number]

/** The course tag among `tags`, matched case-insensitively, if any. */
export function courseOf(
  tags: ReadonlyArray<string> | undefined,
): CourseTag | undefined {
  for (const tag of tags ?? []) {
    const match = COURSE_TAGS.find(
      (c) => c.toLowerCase() === tag.trim().toLowerCase(),
    )
    if (match) return match
  }
  return undefined
}

/**
 * What each course puts into the canonical form's placeholders:
 * {{course}} -> `name` ("¿Por qué te interesa el Curso de Biocustodia?") and
 * {{area}} -> `area` ("¿Cómo te involucraste con la biocustodia?"). Written
 * with their article so the sentences read naturally. A new course needs an
 * entry here along with its tag.
 */
export const COURSE_PLACEHOLDERS: Record<
  CourseTag,
  { name: string; area: string }
> = {
  'TAIS Course': {
    name: 'el Curso de Technical AI Safety',
    area: 'la seguridad en IA',
  },
  'TAIS Projects': {
    name: 'el Sprint de Technical AI Safety Projects',
    area: 'la seguridad en IA',
  },
  Governance: {
    name: 'el Curso de Gobernanza de IA Avanzada',
    area: 'la gobernanza de la IA',
  },
  'AGI Strategy': {
    name: 'el Curso de Estrategia sobre IA General',
    area: 'la seguridad en IA',
  },
  Biosecurity: {
    name: 'el Curso de Biocustodia',
    area: 'la biocustodia',
  },
}
