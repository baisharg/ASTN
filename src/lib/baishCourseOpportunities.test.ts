import {
  compareBaishCourseOpportunities,
  inferBaishCourseKey,
  inferBaishCourseState,
  toBaishCourseOpportunityContract,
  type BaishCourseOpportunitySource,
} from '../../convex/lib/baishCourseOpportunities'

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
  toBeNull(): void
}

const baseOpportunity: BaishCourseOpportunitySource = {
  _id: 'opp_123',
  title: 'Technical AI Safety Course',
  description: 'Apply to the next BAISH cohort.',
  type: 'course',
  status: 'active',
  featured: false,
}

describe('BAISH course opportunities contract', () => {
  test('normalizes recognized active course opportunities into a public contract', () => {
    const contract = toBaishCourseOpportunityContract({
      ...baseOpportunity,
      deadline: 1780272000000,
      externalUrl: 'https://example.com/syllabus',
      featured: true,
    })

    expect(contract).toEqual({
      opportunityId: 'opp_123',
      courseKey: 'technical_ai_safety_course',
      title: 'Technical AI Safety Course',
      description: 'Apply to the next BAISH cohort.',
      state: 'applications_open',
      applyUrlPath: '/org/baish/apply/opp_123',
      externalUrl: 'https://example.com/syllabus',
      deadline: 1780272000000,
      featured: true,
    })
  })

  test('recognizes the three public BAISH course keys from title variants', () => {
    expect(inferBaishCourseKey('BAISH Technical AI Safety Course 2026')).toBe(
      'technical_ai_safety_course',
    )
    expect(inferBaishCourseKey('Technical AI Safety Project - Cohort 2')).toBe(
      'technical_ai_safety_project',
    )
    expect(inferBaishCourseKey('Frontier AI Governance EOI')).toBe(
      'frontier_ai_governance',
    )
  })

  test('can infer a course key from description copy', () => {
    const contract = toBaishCourseOpportunityContract({
      ...baseOpportunity,
      title: 'Applications now open',
      description: 'Apply for the BAISH Frontier AI Governance cohort.',
    })

    expect(contract?.courseKey).toBe('frontier_ai_governance')
  })

  test('infers expression-of-interest state from title or description copy', () => {
    expect(inferBaishCourseState('Frontier AI Governance EOI', '')).toBe(
      'eoi_open',
    )
    expect(
      inferBaishCourseState(
        'Technical AI Safety Project',
        'Submit an expression of interest for the next cohort.',
      ),
    ).toBe('eoi_open')
    expect(
      inferBaishCourseState(
        'Technical AI Safety Course',
        'Applications close soon.',
      ),
    ).toBe('applications_open')
  })

  test('excludes inactive, non-course, and unrecognized opportunities', () => {
    expect(
      toBaishCourseOpportunityContract({
        ...baseOpportunity,
        status: 'draft',
      }),
    ).toBeNull()
    expect(
      toBaishCourseOpportunityContract({
        ...baseOpportunity,
        type: 'fellowship',
      }),
    ).toBeNull()
    expect(
      toBaishCourseOpportunityContract({
        ...baseOpportunity,
        title: 'BAISH Summer Research Fellowship',
      }),
    ).toBeNull()
  })

  test('sorts courses in the stable BAISH display order', () => {
    const courses = [
      {
        courseKey: 'frontier_ai_governance' as const,
        title: 'Frontier AI Governance',
      },
      {
        courseKey: 'technical_ai_safety_project' as const,
        title: 'Technical AI Safety Project',
      },
      {
        courseKey: 'technical_ai_safety_course' as const,
        title: 'Technical AI Safety Course',
      },
    ]

    courses.sort(compareBaishCourseOpportunities)

    expect(courses.map((course) => course.courseKey)).toEqual([
      'technical_ai_safety_course',
      'technical_ai_safety_project',
      'frontier_ai_governance',
    ])
  })
})
