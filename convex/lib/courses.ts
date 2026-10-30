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
