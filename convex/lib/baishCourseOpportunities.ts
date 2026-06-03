export const BAISH_ORG_SLUG = 'baish'

const BAISH_APPLY_BASE_PATH = `/org/${BAISH_ORG_SLUG}/apply`

export type BaishCourseKey =
  | 'technical_ai_safety_course'
  | 'technical_ai_safety_project'
  | 'frontier_ai_governance'

export type BaishCourseState = 'eoi_open' | 'applications_open'

type OrgOpportunityStatus = 'active' | 'closed' | 'draft'
type OrgOpportunityType = 'course' | 'fellowship' | 'job' | 'other'

export type BaishCourseOpportunitySource<OpportunityId = string> = {
  _id: OpportunityId
  title: string
  description: string
  type: OrgOpportunityType
  status: OrgOpportunityStatus
  deadline?: number
  externalUrl?: string
  featured: boolean
}

export type BaishCourseOpportunityContract<OpportunityId = string> = {
  opportunityId: OpportunityId
  courseKey: BaishCourseKey
  title: string
  description: string
  state: BaishCourseState
  applyUrlPath: string
  externalUrl?: string
  deadline?: number
  featured: boolean
}

const COURSE_SPECS: Array<{
  key: BaishCourseKey
  textMatchers: Array<string>
}> = [
  {
    key: 'technical_ai_safety_course',
    textMatchers: ['technical ai safety course'],
  },
  {
    key: 'technical_ai_safety_project',
    textMatchers: ['technical ai safety project'],
  },
  {
    key: 'frontier_ai_governance',
    textMatchers: ['frontier ai governance'],
  },
]

const COURSE_SORT_ORDER: Record<BaishCourseKey, number> = {
  technical_ai_safety_course: 0,
  technical_ai_safety_project: 1,
  frontier_ai_governance: 2,
}

function normalizeForCourseMatching(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function containsWord(value: string, word: string): boolean {
  return ` ${value} `.includes(` ${word} `)
}

export function inferBaishCourseKey(
  title: string,
  description = '',
): BaishCourseKey | null {
  const normalizedText = normalizeForCourseMatching(`${title} ${description}`)

  for (const course of COURSE_SPECS) {
    for (const matcher of course.textMatchers) {
      if (normalizedText.includes(matcher)) return course.key
    }
  }

  return null
}

export function inferBaishCourseState(
  title: string,
  description: string,
): BaishCourseState {
  const normalizedText = normalizeForCourseMatching(`${title} ${description}`)

  if (
    normalizedText.includes('expression of interest') ||
    containsWord(normalizedText, 'eoi') ||
    normalizedText.includes('register interest')
  ) {
    return 'eoi_open'
  }

  return 'applications_open'
}

/**
 * Stable public BAISH course-opportunity contract for next-baish.
 *
 * This intentionally centralizes the temporary inference from current
 * orgOpportunity titles/descriptions until course metadata is stored directly.
 */
export function toBaishCourseOpportunityContract<OpportunityId extends string>(
  opportunity: BaishCourseOpportunitySource<OpportunityId>,
): BaishCourseOpportunityContract<OpportunityId> | null {
  if (opportunity.status !== 'active' || opportunity.type !== 'course') {
    return null
  }

  const courseKey = inferBaishCourseKey(
    opportunity.title,
    opportunity.description,
  )
  if (!courseKey) return null

  const contract: BaishCourseOpportunityContract<OpportunityId> = {
    opportunityId: opportunity._id,
    courseKey,
    title: opportunity.title,
    description: opportunity.description,
    state: inferBaishCourseState(opportunity.title, opportunity.description),
    applyUrlPath: `${BAISH_APPLY_BASE_PATH}/${opportunity._id}`,
    featured: opportunity.featured,
  }

  if (opportunity.externalUrl) contract.externalUrl = opportunity.externalUrl
  if (opportunity.deadline !== undefined)
    contract.deadline = opportunity.deadline

  return contract
}

export function compareBaishCourseOpportunities(
  left: Pick<BaishCourseOpportunityContract, 'courseKey' | 'title'>,
  right: Pick<BaishCourseOpportunityContract, 'courseKey' | 'title'>,
): number {
  const byCourseKey =
    COURSE_SORT_ORDER[left.courseKey] - COURSE_SORT_ORDER[right.courseKey]

  if (byCourseKey !== 0) return byCourseKey
  return left.title.localeCompare(right.title)
}
