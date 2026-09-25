import { createTool } from '@convex-dev/agent'
import { z } from 'zod'
import { internal } from '../_generated/api'
import { SKILLS_LIST, SKILLS_LIST_STRING } from './prompts'
import {
  convertDateString,
  educationMatches,
  normalize,
  workMatches,
} from './utils'

const SKILLS_SET = new Set(SKILLS_LIST)

// Fuzzy find: try exact match first, fall back to substring
function fuzzyFindIndex<T>(
  items: Array<T>,
  getText: (item: T) => string,
  search: string,
): number {
  const s = normalize(search)
  // Exact match first
  const exact = items.findIndex((item) => normalize(getText(item)) === s)
  if (exact >= 0) return exact
  // Substring fallback
  return items.findIndex((item) => normalize(getText(item)).includes(s))
}

// Helper: look up the current user's profile from tool context
async function getProfile(ctx: {
  userId?: string
  runQuery: (ref: never, args: never) => Promise<unknown>
}) {
  if (!ctx.userId) return null
  return (await ctx.runQuery(
    internal.agent.queries.getProfileByUserId as never,
    { userId: ctx.userId } as never,
  )) as {
    _id: string
    name?: string
    pronouns?: string
    location?: string
    headline?: string
    linkedinUrl?: string
    education?: Array<{
      institution: string
      degree?: string
      field?: string
      startYear?: number
      endYear?: number
      current?: boolean
    }>
    workHistory?: Array<{
      organization: string
      title: string
      startDate?: number
      endDate?: number
      current?: boolean
      description?: string
    }>
    skills?: Array<string>
    careerGoals?: string
    aiSafetyInterests?: Array<string>
    seeking?: string
    canHelpWith?: string
    matchPreferences?: {
      remotePreference?: string
      roleTypes?: Array<string>
      experienceLevels?: Array<string>
      willingToRelocate?: boolean
      workAuthorization?: string
      minimumSalaryUSD?: number
      availability?: string
      commitmentTypes?: Array<string>
    }
  } | null
}

export const updateBasicInfo = createTool({
  description:
    "Update the user's basic profile info. Call with any subset of: name, pronouns, location, headline, linkedinUrl.",
  inputSchema: z.object({
    name: z.string().optional().describe("The user's full name"),
    pronouns: z
      .string()
      .optional()
      .describe('Pronouns, e.g. "they/them", "she/her"'),
    location: z
      .string()
      .optional()
      .describe('City and country, e.g. "San Francisco, USA"'),
    headline: z
      .string()
      .optional()
      .describe(
        'Short professional headline, e.g. "AI Safety Researcher at Anthropic"',
      ),
    linkedinUrl: z
      .string()
      .optional()
      .describe(
        'LinkedIn profile URL, e.g. "https://linkedin.com/in/username"',
      ),
  }),
  execute: async (ctx, input): Promise<string> => {
    const profile = await getProfile(ctx)
    if (!profile) return 'Error: profile not found'

    const updates: Record<string, string> = {}
    const previousValues: Record<string, string | undefined> = {}

    if (input.name !== undefined) {
      previousValues.name = profile.name
      updates.name = input.name
    }
    if (input.pronouns !== undefined) {
      previousValues.pronouns = profile.pronouns
      updates.pronouns = input.pronouns
    }
    if (input.location !== undefined) {
      previousValues.location = profile.location
      updates.location = input.location
    }
    if (input.headline !== undefined) {
      previousValues.headline = profile.headline
      updates.headline = input.headline
    }
    if (input.linkedinUrl !== undefined) {
      previousValues.linkedinUrl = profile.linkedinUrl
      updates.linkedinUrl = input.linkedinUrl
    }

    if (Object.keys(updates).length === 0) return 'No updates provided'

    const displayParts: Array<string> = []
    if (updates.name) displayParts.push(`name to ${updates.name}`)
    if (updates.pronouns) displayParts.push(`pronouns to ${updates.pronouns}`)
    if (updates.location) displayParts.push(`location to ${updates.location}`)
    if (updates.headline) displayParts.push(`headline to "${updates.headline}"`)
    if (updates.linkedinUrl) displayParts.push(`LinkedIn URL`)
    const displayText = `Updated ${displayParts.join(', ')}`

    await ctx.runMutation(
      internal.agent.mutations.proposeToolChange as never,
      {
        profileId: profile._id,
        threadId: ctx.threadId,
        toolName: 'update_basic_info',
        displayText,
        updates: JSON.stringify(updates),
        previousValues: JSON.stringify(previousValues),
      } as never,
    )

    return displayText
  },
})

export const addEducation = createTool({
  description:
    "Add an education entry to the user's profile. Appends to existing education array.",
  inputSchema: z.object({
    institution: z.string().describe('Name of the institution'),
    degree: z
      .string()
      .optional()
      .describe('Degree type, e.g. "PhD", "MSc", "BA"'),
    field: z
      .string()
      .optional()
      .describe('Field of study, e.g. "Computer Science"'),
    startYear: z.number().optional().describe('Year started'),
    endYear: z.number().optional().describe('Year completed'),
    current: z.boolean().optional().describe('Whether currently studying here'),
  }),
  execute: async (ctx, input): Promise<string> => {
    const profile = await getProfile(ctx)
    if (!profile) return 'Error: profile not found'

    // Validate years
    const currentYear = new Date().getFullYear()
    if (
      input.startYear !== undefined &&
      (input.startYear < 1900 || input.startYear > currentYear + 5)
    )
      return `Error: startYear ${input.startYear} is out of valid range (1900-${currentYear + 5})`
    if (
      input.endYear !== undefined &&
      (input.endYear < 1900 || input.endYear > currentYear + 5)
    )
      return `Error: endYear ${input.endYear} is out of valid range (1900-${currentYear + 5})`
    if (
      input.startYear !== undefined &&
      input.endYear !== undefined &&
      input.endYear < input.startYear
    )
      return `Error: endYear (${input.endYear}) cannot be before startYear (${input.startYear})`

    const existing = profile.education ?? []
    const newEntry = {
      institution: input.institution,
      degree: input.degree,
      field: input.field,
      startYear: input.startYear,
      endYear: input.endYear,
      current: input.current,
    }

    // Check for duplicate — merge if found
    const matchIdx = existing.findIndex((e) => educationMatches(e, newEntry))
    let updated: typeof existing
    let verb: string
    if (matchIdx >= 0) {
      updated = [...existing]
      updated[matchIdx] = {
        ...updated[matchIdx],
        ...Object.fromEntries(
          Object.entries(newEntry).filter(([, v]) => v !== undefined),
        ),
      }
      verb = 'Updated'
    } else {
      updated = [...existing, newEntry]
      verb = 'Added'
    }

    const displayText = `${verb} education: ${input.degree ? `${input.degree} ` : ''}${input.field ? `in ${input.field} ` : ''}at ${input.institution}`

    await ctx.runMutation(
      internal.agent.mutations.proposeToolChange as never,
      {
        profileId: profile._id,
        threadId: ctx.threadId,
        toolName: 'add_education',
        displayText,
        updates: JSON.stringify({ education: updated }),
        previousValues: JSON.stringify({ education: existing }),
      } as never,
    )

    return displayText
  },
})

export const addWorkExperience = createTool({
  description:
    "Add a work experience entry to the user's profile. Appends to existing work history array. Dates should be YYYY-MM format strings which will be converted to timestamps.",
  inputSchema: z.object({
    organization: z.string().describe('Company or organization name'),
    title: z.string().describe('Job title'),
    startDate: z
      .string()
      .optional()
      .describe('Start date in YYYY-MM format, e.g. "2023-01"'),
    endDate: z
      .string()
      .optional()
      .describe('End date in YYYY-MM format, or omit if current'),
    current: z
      .boolean()
      .optional()
      .describe('Whether this is the current role'),
    description: z.string().optional().describe('Brief role description'),
  }),
  execute: async (ctx, input): Promise<string> => {
    const profile = await getProfile(ctx)
    if (!profile) return 'Error: profile not found'

    // Validate date format (YYYY-MM) and year range
    const dateRegex = /^\d{4}-\d{2}$/
    if (input.startDate && !dateRegex.test(input.startDate))
      return `Error: startDate "${input.startDate}" must be in YYYY-MM format`
    if (input.endDate && !dateRegex.test(input.endDate))
      return `Error: endDate "${input.endDate}" must be in YYYY-MM format`
    const currentYear = new Date().getFullYear()
    if (input.startDate) {
      const year = parseInt(input.startDate.split('-')[0], 10)
      if (year < 1900 || year > currentYear + 5)
        return `Error: startDate year ${year} is out of valid range (1900-${currentYear + 5})`
    }
    if (input.endDate) {
      const year = parseInt(input.endDate.split('-')[0], 10)
      if (year < 1900 || year > currentYear + 5)
        return `Error: endDate year ${year} is out of valid range (1900-${currentYear + 5})`
    }
    if (input.startDate && input.endDate && input.startDate > input.endDate)
      return `Error: endDate (${input.endDate}) cannot be before startDate (${input.startDate})`

    const existing = profile.workHistory ?? []
    const newEntry = {
      organization: input.organization,
      title: input.title,
      startDate: convertDateString(input.startDate),
      endDate: convertDateString(input.endDate),
      current: input.current,
      description: input.description,
    }

    // Check for duplicate — merge if found
    const matchIdx = existing.findIndex((e) => workMatches(e, newEntry))
    let updated: typeof existing
    let verb: string
    if (matchIdx >= 0) {
      updated = [...existing]
      updated[matchIdx] = {
        ...updated[matchIdx],
        ...Object.fromEntries(
          Object.entries(newEntry).filter(([, v]) => v !== undefined),
        ),
      }
      verb = 'Updated'
    } else {
      updated = [...existing, newEntry]
      verb = 'Added'
    }

    const displayText = `${verb} work experience: ${input.title} at ${input.organization}`

    await ctx.runMutation(
      internal.agent.mutations.proposeToolChange as never,
      {
        profileId: profile._id,
        threadId: ctx.threadId,
        toolName: 'add_work_experience',
        displayText,
        updates: JSON.stringify({ workHistory: updated }),
        previousValues: JSON.stringify({ workHistory: existing }),
      } as never,
    )

    return displayText
  },
})

export const setSkills = createTool({
  description: `Replace the user's skills array. Use ONLY skill names from the taxonomy: ${SKILLS_LIST_STRING}. Map mentioned skills to the closest match in the taxonomy.`,
  inputSchema: z.object({
    skills: z
      .array(z.string())
      .describe('Array of skill names from the taxonomy'),
  }),
  execute: async (ctx, input): Promise<string> => {
    const profile = await getProfile(ctx)
    if (!profile) return 'Error: profile not found'

    // Validate skills against taxonomy
    const validSkills = input.skills.filter((s) => SKILLS_SET.has(s))
    if (validSkills.length === 0)
      return 'Error: none of the provided skills match the taxonomy. Use exact names from the skills list.'

    const skipped = input.skills.filter((s) => !SKILLS_SET.has(s))
    const existing = profile.skills ?? []
    const displayText =
      skipped.length > 0
        ? `Updated skills (${skipped.length} unrecognized skipped: ${skipped.join(', ')})`
        : `Updated skills`

    await ctx.runMutation(
      internal.agent.mutations.proposeToolChange as never,
      {
        profileId: profile._id,
        threadId: ctx.threadId,
        toolName: 'set_skills',
        displayText,
        updates: JSON.stringify({ skills: validSkills }),
        previousValues: JSON.stringify({ skills: existing }),
      } as never,
    )

    return displayText
  },
})

export const setCareerGoals = createTool({
  description:
    "Set the user's career goals description. A paragraph summarizing their aspirations and direction.",
  inputSchema: z.object({
    careerGoals: z.string().describe('Career goals paragraph'),
  }),
  execute: async (ctx, input): Promise<string> => {
    const profile = await getProfile(ctx)
    if (!profile) return 'Error: profile not found'

    const existing = profile.careerGoals
    const displayText = `Updated career goals`

    await ctx.runMutation(
      internal.agent.mutations.proposeToolChange as never,
      {
        profileId: profile._id,
        threadId: ctx.threadId,
        toolName: 'set_career_goals',
        displayText,
        updates: JSON.stringify({ careerGoals: input.careerGoals }),
        previousValues: JSON.stringify({ careerGoals: existing }),
      } as never,
    )

    return displayText
  },
})

export const setAiSafetyInterests = createTool({
  description:
    "Set the user's AI safety interest areas. Examples: technical alignment, governance, policy, interpretability, field-building, coordination, red teaming.",
  inputSchema: z.object({
    interests: z
      .array(z.string())
      .describe('Array of AI safety interest areas'),
  }),
  execute: async (ctx, input): Promise<string> => {
    const profile = await getProfile(ctx)
    if (!profile) return 'Error: profile not found'

    const existing = profile.aiSafetyInterests ?? []
    const displayText = `Updated areas of interest`

    await ctx.runMutation(
      internal.agent.mutations.proposeToolChange as never,
      {
        profileId: profile._id,
        threadId: ctx.threadId,
        toolName: 'set_ai_safety_interests',
        displayText,
        updates: JSON.stringify({ aiSafetyInterests: input.interests }),
        previousValues: JSON.stringify({ aiSafetyInterests: existing }),
      } as never,
    )

    return displayText
  },
})

export const setSeeking = createTool({
  description:
    "Set what the user is seeking — their desired role type or contribution. E.g. 'Full-time research position in alignment', 'Part-time policy consulting', 'Volunteer field-building'.",
  inputSchema: z.object({
    seeking: z.string().describe('What the user is looking for'),
  }),
  execute: async (ctx, input): Promise<string> => {
    const profile = await getProfile(ctx)
    if (!profile) return 'Error: profile not found'

    const existing = profile.seeking
    const displayText = `Updated looking for`

    await ctx.runMutation(
      internal.agent.mutations.proposeToolChange as never,
      {
        profileId: profile._id,
        threadId: ctx.threadId,
        toolName: 'set_seeking',
        displayText,
        updates: JSON.stringify({ seeking: input.seeking }),
        previousValues: JSON.stringify({ seeking: existing }),
      } as never,
    )

    return displayText
  },
})

export const setCanHelpWith = createTool({
  description:
    "Set what the user can help other people with: skills, experience or introductions they could offer. Shown on their profile at in-person events and used to suggest who they should meet. E.g. 'Getting started in interpretability research; reviewing MATS applications'.",
  inputSchema: z.object({
    canHelpWith: z.string().describe('What the user can help others with'),
  }),
  execute: async (ctx, input): Promise<string> => {
    const profile = await getProfile(ctx)
    if (!profile) return 'Error: profile not found'

    const existing = profile.canHelpWith
    const displayText = `Updated what you can help with`

    await ctx.runMutation(
      internal.agent.mutations.proposeToolChange as never,
      {
        profileId: profile._id,
        threadId: ctx.threadId,
        toolName: 'set_can_help_with',
        displayText,
        updates: JSON.stringify({ canHelpWith: input.canHelpWith }),
        previousValues: JSON.stringify({ canHelpWith: existing }),
      } as never,
    )

    return displayText
  },
})

export const setMatchPreferences = createTool({
  description:
    "Set the user's match preferences for opportunity filtering. Call when they mention constraints like remote-only, role types, relocation, visa, salary, availability, or commitment type. Merges with existing preferences — only sets fields you provide.",
  inputSchema: z.object({
    remotePreference: z
      .enum(['remote_only', 'on_site_ok', 'no_preference'])
      .optional()
      .describe('Remote work preference'),
    roleTypes: z
      .array(z.string())
      .optional()
      .describe(
        'Preferred role types, e.g. ["research", "engineering", "policy"]',
      ),
    experienceLevels: z
      .array(z.string())
      .optional()
      .describe('Preferred experience levels, e.g. ["entry", "mid", "senior"]'),
    willingToRelocate: z
      .boolean()
      .optional()
      .describe('Whether the user is willing to relocate'),
    workAuthorization: z
      .string()
      .optional()
      .describe(
        'Work authorization status, e.g. "US citizen", "Need visa sponsorship"',
      ),
    minimumSalaryUSD: z
      .number()
      .optional()
      .describe('Minimum acceptable salary in USD per year'),
    availability: z
      .enum([
        'immediately',
        'within_1_month',
        'within_3_months',
        'within_6_months',
        'not_available',
      ])
      .optional()
      .describe('When the user can start'),
    commitmentTypes: z
      .array(
        z.enum([
          'full_time',
          'part_time',
          'contract',
          'fellowship',
          'internship',
          'volunteer',
        ]),
      )
      .optional()
      .describe('Acceptable commitment types'),
  }),
  execute: async (ctx, input): Promise<string> => {
    const profile = await getProfile(ctx)
    if (!profile) return 'Error: profile not found'

    // Merge with existing preferences
    const existing = profile.matchPreferences ?? {}
    const merged = { ...existing }

    if (input.remotePreference !== undefined)
      merged.remotePreference = input.remotePreference
    if (input.roleTypes !== undefined) merged.roleTypes = input.roleTypes
    if (input.experienceLevels !== undefined)
      merged.experienceLevels = input.experienceLevels
    if (input.willingToRelocate !== undefined)
      merged.willingToRelocate = input.willingToRelocate
    if (input.workAuthorization !== undefined)
      merged.workAuthorization = input.workAuthorization
    if (input.minimumSalaryUSD !== undefined)
      merged.minimumSalaryUSD = input.minimumSalaryUSD
    if (input.availability !== undefined)
      merged.availability = input.availability
    if (input.commitmentTypes !== undefined)
      merged.commitmentTypes = input.commitmentTypes

    const displayParts: Array<string> = []
    if (input.remotePreference)
      displayParts.push(`remote: ${input.remotePreference.replace(/_/g, ' ')}`)
    if (input.roleTypes?.length)
      displayParts.push(`roles: ${input.roleTypes.join(', ')}`)
    if (input.experienceLevels?.length)
      displayParts.push(`levels: ${input.experienceLevels.join(', ')}`)
    if (input.willingToRelocate !== undefined)
      displayParts.push(
        input.willingToRelocate ? 'willing to relocate' : 'not relocating',
      )
    if (input.workAuthorization)
      displayParts.push(`authorization: ${input.workAuthorization}`)
    if (input.minimumSalaryUSD)
      displayParts.push(
        `min salary: $${input.minimumSalaryUSD.toLocaleString()}`,
      )
    if (input.availability)
      displayParts.push(`available: ${input.availability.replace(/_/g, ' ')}`)
    if (input.commitmentTypes?.length)
      displayParts.push(
        `commitment: ${input.commitmentTypes.map((t) => t.replace(/_/g, ' ')).join(', ')}`,
      )

    const displayText =
      displayParts.length > 0
        ? `Updated match preferences: ${displayParts.join(', ')}`
        : 'Updated match preferences'

    await ctx.runMutation(
      internal.agent.mutations.proposeToolChange as never,
      {
        profileId: profile._id,
        threadId: ctx.threadId,
        toolName: 'set_match_preferences',
        displayText,
        updates: JSON.stringify({ matchPreferences: merged }),
        previousValues: JSON.stringify({
          matchPreferences: profile.matchPreferences,
        }),
      } as never,
    )

    return displayText
  },
})

export const setLanguagePreference = createTool({
  description:
    "Set the user's preferred conversation language. Use ISO 639-1 codes: 'en' for English, 'es' for Spanish, 'pt' for Portuguese, etc.",
  inputSchema: z.object({
    languageCode: z
      .string()
      .describe('ISO 639-1 language code, e.g. "es", "en", "pt"'),
  }),
  execute: async (ctx, input): Promise<string> => {
    const profile = await getProfile(ctx)
    if (!profile) return 'Error: profile not found'

    const displayText = `Set language preference to ${input.languageCode}`

    await ctx.runMutation(
      internal.agent.mutations.proposeToolChange as never,
      {
        profileId: profile._id,
        threadId: ctx.threadId,
        toolName: 'set_language_preference',
        displayText,
        updates: JSON.stringify({ preferredLanguage: input.languageCode }),
        previousValues: JSON.stringify({
          preferredLanguage: (profile as Record<string, unknown>)
            .preferredLanguage,
        }),
      } as never,
    )

    return displayText
  },
})

// ── Remove/edit tools ────────────────────────────────────────────────────────

export const removeEducation = createTool({
  description:
    "Remove an education entry from the user's profile by institution name.",
  inputSchema: z.object({
    institution: z
      .string()
      .describe('Name of the institution to remove (fuzzy matched)'),
    degree: z.string().optional().describe('Degree to narrow the match'),
    field: z.string().optional().describe('Field to narrow the match'),
  }),
  execute: async (ctx, input): Promise<string> => {
    const profile = await getProfile(ctx)
    if (!profile) return 'Error: profile not found'

    const existing = profile.education ?? []
    // Narrow by degree/field first if provided, then fuzzy-find by institution
    const candidates = existing.filter((e) => {
      if (
        input.degree &&
        !normalize(e.degree ?? '').includes(normalize(input.degree))
      )
        return false
      if (
        input.field &&
        !normalize(e.field ?? '').includes(normalize(input.field))
      )
        return false
      return true
    })
    const candidateIdx = fuzzyFindIndex(
      candidates,
      (e) => e.institution,
      input.institution,
    )
    const idx =
      candidateIdx >= 0 ? existing.indexOf(candidates[candidateIdx]) : -1

    if (idx === -1)
      return `Error: no education entry found matching "${input.institution}"`

    const removed = existing[idx]
    const updated = existing.filter((_, i) => i !== idx)
    const displayText = `Removed education: ${removed.degree ? `${removed.degree} ` : ''}${removed.field ? `in ${removed.field} ` : ''}at ${removed.institution}`

    await ctx.runMutation(
      internal.agent.mutations.proposeToolChange as never,
      {
        profileId: profile._id,
        threadId: ctx.threadId,
        toolName: 'remove_education',
        displayText,
        updates: JSON.stringify({ education: updated }),
        previousValues: JSON.stringify({ education: existing }),
      } as never,
    )

    return displayText
  },
})

export const removeWorkExperience = createTool({
  description:
    "Remove a work experience entry from the user's profile by organization name.",
  inputSchema: z.object({
    organization: z
      .string()
      .describe('Organization name to remove (fuzzy matched)'),
    title: z.string().optional().describe('Title to narrow the match'),
  }),
  execute: async (ctx, input): Promise<string> => {
    const profile = await getProfile(ctx)
    if (!profile) return 'Error: profile not found'

    const existing = profile.workHistory ?? []
    const candidates = input.title
      ? existing.filter((e) =>
          normalize(e.title).includes(normalize(input.title!)),
        )
      : existing
    const candidateIdx = fuzzyFindIndex(
      candidates,
      (e) => e.organization,
      input.organization,
    )
    const idx =
      candidateIdx >= 0 ? existing.indexOf(candidates[candidateIdx]) : -1

    if (idx === -1)
      return `Error: no work experience found matching "${input.organization}"`

    const removed = existing[idx]
    const updated = existing.filter((_, i) => i !== idx)
    const displayText = `Removed work experience: ${removed.title} at ${removed.organization}`

    await ctx.runMutation(
      internal.agent.mutations.proposeToolChange as never,
      {
        profileId: profile._id,
        threadId: ctx.threadId,
        toolName: 'remove_work_experience',
        displayText,
        updates: JSON.stringify({ workHistory: updated }),
        previousValues: JSON.stringify({ workHistory: existing }),
      } as never,
    )

    return displayText
  },
})

export const editEducation = createTool({
  description:
    'Edit an existing education entry. Find by institution name, then update provided fields.',
  inputSchema: z.object({
    institution: z
      .string()
      .describe('Current institution name to find the entry'),
    newInstitution: z.string().optional().describe('New institution name'),
    degree: z.string().optional().describe('New degree'),
    field: z.string().optional().describe('New field of study'),
    startYear: z.number().optional().describe('New start year'),
    endYear: z.number().optional().describe('New end year'),
    current: z.boolean().optional().describe('Whether currently studying here'),
  }),
  execute: async (ctx, input): Promise<string> => {
    const profile = await getProfile(ctx)
    if (!profile) return 'Error: profile not found'

    // Validate input year ranges
    const currentYear = new Date().getFullYear()
    if (
      input.startYear !== undefined &&
      (input.startYear < 1900 || input.startYear > currentYear + 5)
    )
      return `Error: startYear ${input.startYear} is out of valid range (1900-${currentYear + 5})`
    if (
      input.endYear !== undefined &&
      (input.endYear < 1900 || input.endYear > currentYear + 5)
    )
      return `Error: endYear ${input.endYear} is out of valid range (1900-${currentYear + 5})`

    const existing = profile.education ?? []
    const idx = fuzzyFindIndex(
      existing,
      (e) => e.institution,
      input.institution,
    )

    if (idx === -1)
      return `Error: no education entry found matching "${input.institution}"`

    const updated = [...existing]
    const entry = { ...updated[idx] }
    if (input.newInstitution !== undefined)
      entry.institution = input.newInstitution
    if (input.degree !== undefined) entry.degree = input.degree
    if (input.field !== undefined) entry.field = input.field
    if (input.startYear !== undefined) entry.startYear = input.startYear
    if (input.endYear !== undefined) entry.endYear = input.endYear
    if (input.current !== undefined) entry.current = input.current

    // Validate resulting entry's year ordering
    if (entry.startYear && entry.endYear && entry.endYear < entry.startYear)
      return `Error: endYear (${entry.endYear}) cannot be before startYear (${entry.startYear})`

    updated[idx] = entry

    const displayText = `Edited education at ${entry.institution}`

    await ctx.runMutation(
      internal.agent.mutations.proposeToolChange as never,
      {
        profileId: profile._id,
        threadId: ctx.threadId,
        toolName: 'edit_education',
        displayText,
        updates: JSON.stringify({ education: updated }),
        previousValues: JSON.stringify({ education: existing }),
      } as never,
    )

    return displayText
  },
})

export const editWorkExperience = createTool({
  description:
    'Edit an existing work experience entry. Find by organization name, then update provided fields.',
  inputSchema: z.object({
    organization: z
      .string()
      .describe('Current organization name to find the entry'),
    title: z.string().optional().describe('Title to narrow the match'),
    newOrganization: z.string().optional().describe('New organization name'),
    newTitle: z.string().optional().describe('New job title'),
    startDate: z
      .string()
      .optional()
      .describe('New start date in YYYY-MM format'),
    endDate: z.string().optional().describe('New end date in YYYY-MM format'),
    current: z
      .boolean()
      .optional()
      .describe('Whether this is the current role'),
    description: z.string().optional().describe('New role description'),
  }),
  execute: async (ctx, input): Promise<string> => {
    const profile = await getProfile(ctx)
    if (!profile) return 'Error: profile not found'

    // Validate date format (YYYY-MM)
    const dateRegex = /^\d{4}-\d{2}$/
    if (input.startDate && !dateRegex.test(input.startDate))
      return `Error: startDate "${input.startDate}" must be in YYYY-MM format`
    if (input.endDate && !dateRegex.test(input.endDate))
      return `Error: endDate "${input.endDate}" must be in YYYY-MM format`
    // Validate year ranges
    const currentYear = new Date().getFullYear()
    if (input.startDate) {
      const year = parseInt(input.startDate.split('-')[0], 10)
      if (year < 1900 || year > currentYear + 5)
        return `Error: startDate year ${year} is out of valid range (1900-${currentYear + 5})`
    }
    if (input.endDate) {
      const year = parseInt(input.endDate.split('-')[0], 10)
      if (year < 1900 || year > currentYear + 5)
        return `Error: endDate year ${year} is out of valid range (1900-${currentYear + 5})`
    }

    const existing = profile.workHistory ?? []
    const candidates = input.title
      ? existing.filter((e) =>
          normalize(e.title).includes(normalize(input.title!)),
        )
      : existing
    const candidateIdx = fuzzyFindIndex(
      candidates,
      (e) => e.organization,
      input.organization,
    )
    const idx =
      candidateIdx >= 0 ? existing.indexOf(candidates[candidateIdx]) : -1

    if (idx === -1)
      return `Error: no work experience found matching "${input.organization}"`

    const updated = [...existing]
    const entry = { ...updated[idx] }
    if (input.newOrganization !== undefined)
      entry.organization = input.newOrganization
    if (input.newTitle !== undefined) entry.title = input.newTitle
    if (input.startDate !== undefined)
      entry.startDate = convertDateString(input.startDate)
    if (input.endDate !== undefined)
      entry.endDate = convertDateString(input.endDate)
    if (input.current !== undefined) entry.current = input.current
    if (input.description !== undefined) entry.description = input.description

    // Validate resulting entry's date ordering
    if (entry.startDate && entry.endDate && entry.endDate < entry.startDate)
      return 'Error: end date cannot be before start date'

    updated[idx] = entry

    const displayText = `Edited work experience: ${entry.title} at ${entry.organization}`

    await ctx.runMutation(
      internal.agent.mutations.proposeToolChange as never,
      {
        profileId: profile._id,
        threadId: ctx.threadId,
        toolName: 'edit_work_experience',
        displayText,
        updates: JSON.stringify({ workHistory: updated }),
        previousValues: JSON.stringify({ workHistory: existing }),
      } as never,
    )

    return displayText
  },
})

// ── Read-only tools ──────────────────────────────────────────────────────────

export const getMyMatchesSummary = createTool({
  description:
    "Get a summary of the user's opportunity matches — counts per tier and top 5 per tier.",
  inputSchema: z.object({}),
  execute: async (ctx): Promise<string> => {
    const profile = await getProfile(ctx)
    if (!profile) return 'Error: profile not found'

    const results = (await ctx.runQuery(
      internal.agent.queries.getMatchesWithOpportunities as never,
      { profileId: profile._id } as never,
    )) as Array<{
      matchId: string
      tier: string
      score: number
      status?: string
      strengths: Array<string>
      gap?: string
      opportunityTitle: string
      organization: string
      roleType: string
      location: string
      isRemote: boolean
    }>

    if (results.length === 0) return 'No matches found yet.'

    const tiers: Record<string, typeof results> = {
      great: [],
      good: [],
      exploring: [],
    }
    for (const r of results) {
      tiers[r.tier].push(r)
    }

    const parts: Array<string> = []
    parts.push(
      `Match summary: ${tiers.great.length} great, ${tiers.good.length} good, ${tiers.exploring.length} exploring`,
    )

    for (const tier of ['great', 'good', 'exploring']) {
      const items = tiers[tier].slice(0, 5)
      if (items.length > 0) {
        parts.push(`\n${tier.toUpperCase()} matches:`)
        for (const item of items) {
          parts.push(
            `- ${item.opportunityTitle} at ${item.organization} (${item.roleType}, ${item.isRemote ? 'remote' : item.location})`,
          )
        }
      }
    }

    return parts.join('\n')
  },
})

export const getMatchDetail = createTool({
  description:
    'Get full details about a specific match including explanation, strengths, gaps, and recommendations.',
  inputSchema: z.object({
    matchId: z.string().describe('The match ID to look up'),
  }),
  execute: async (ctx, input): Promise<string> => {
    const profile = await getProfile(ctx)
    if (!profile) return 'Error: profile not found'

    const data = (await ctx.runQuery(
      internal.agent.queries.getMatchWithOpportunity as never,
      { matchId: input.matchId, profileId: profile._id } as never,
    )) as {
      match: {
        tier: string
        score: number
        status?: string
        explanation: { strengths: Array<string>; gap?: string }
        recommendations: Array<{
          type: string
          action: string
          priority: string
        }>
      }
      opportunity: {
        title: string
        organization: string
        location: string
        isRemote: boolean
        roleType: string
        description: string
        requirements?: Array<string>
        deadline?: number
        sourceUrl: string
      }
    } | null

    if (!data) return 'Match not found or does not belong to you.'

    const { match, opportunity } = data
    const lines: Array<string> = []
    lines.push(`Match: ${opportunity.title} at ${opportunity.organization}`)
    lines.push(`Tier: ${match.tier} (score: ${match.score}/100)`)
    lines.push(
      `Location: ${opportunity.location}${opportunity.isRemote ? ' (remote)' : ''}`,
    )
    lines.push(`Role type: ${opportunity.roleType}`)
    if (opportunity.deadline)
      lines.push(
        `Deadline: ${new Date(opportunity.deadline).toLocaleDateString()}`,
      )
    lines.push(
      `\nStrengths:\n${match.explanation.strengths.map((s) => `- ${s}`).join('\n')}`,
    )
    if (match.explanation.gap) lines.push(`\nGap: ${match.explanation.gap}`)
    if (match.recommendations.length > 0) {
      lines.push(
        `\nRecommendations:\n${match.recommendations.map((r) => `- [${r.priority}] ${r.action}`).join('\n')}`,
      )
    }
    lines.push(`\nApply: ${opportunity.sourceUrl}`)

    return lines.join('\n')
  },
})

export const searchOpportunities = createTool({
  description:
    'Search for AI safety opportunities by keyword, role type, or remote preference.',
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe('Search term to match against opportunity titles'),
    roleType: z
      .string()
      .optional()
      .describe(
        'Filter by role type: "research", "engineering", "operations", "policy", "other"',
      ),
    isRemote: z
      .boolean()
      .optional()
      .describe('Filter for remote-only opportunities'),
    limit: z.number().optional().describe('Max results to return (default 10)'),
  }),
  execute: async (ctx, input): Promise<string> => {
    let results: Array<{
      _id: string
      title: string
      organization: string
      location: string
      isRemote: boolean
      roleType: string
      description: string
      deadline?: number
      sourceUrl: string
    }>

    if (input.query) {
      results = (await ctx.runQuery(
        internal.agent.queries.searchOpportunitiesInternal as never,
        {
          searchTerm: input.query,
          roleType: input.roleType,
          isRemote: input.isRemote,
          limit: input.limit,
        } as never,
      )) as typeof results
    } else {
      results = (await ctx.runQuery(
        internal.agent.queries.listOpportunitiesInternal as never,
        {
          roleType: input.roleType,
          isRemote: input.isRemote,
          limit: input.limit,
        } as never,
      )) as typeof results
    }

    if (results.length === 0)
      return 'No opportunities found matching those criteria.'

    const lines: Array<string> = [`Found ${results.length} opportunities:\n`]
    for (const opp of results) {
      lines.push(
        `- ${opp.title} at ${opp.organization} (${opp.roleType}, ${opp.isRemote ? 'remote' : opp.location})${opp.deadline ? ` — deadline ${new Date(opp.deadline).toLocaleDateString()}` : ''}`,
      )
    }

    return lines.join('\n')
  },
})

export const getOpportunityDetail = createTool({
  description:
    "Get full details about a specific opportunity, including the user's existing match if any.",
  inputSchema: z.object({
    opportunityId: z.string().describe('The opportunity ID to look up'),
  }),
  execute: async (ctx, input): Promise<string> => {
    const profile = await getProfile(ctx)
    if (!profile) return 'Error: profile not found'

    const data = (await ctx.runQuery(
      internal.agent.queries.getOpportunityForContext as never,
      { opportunityId: input.opportunityId, profileId: profile._id } as never,
    )) as {
      opportunity: {
        title: string
        organization: string
        location: string
        isRemote: boolean
        roleType: string
        description: string
        requirements?: Array<string>
        salaryRange?: string
        deadline?: number
        sourceUrl: string
      }
      existingMatch: {
        tier: string
        score: number
        explanation: { strengths: Array<string>; gap?: string }
      } | null
    } | null

    if (!data) return 'Opportunity not found.'

    const { opportunity, existingMatch } = data
    const lines: Array<string> = []
    lines.push(`${opportunity.title} at ${opportunity.organization}`)
    lines.push(
      `Location: ${opportunity.location}${opportunity.isRemote ? ' (remote)' : ''}`,
    )
    lines.push(`Role type: ${opportunity.roleType}`)
    if (opportunity.salaryRange)
      lines.push(`Salary: ${opportunity.salaryRange}`)
    if (opportunity.deadline)
      lines.push(
        `Deadline: ${new Date(opportunity.deadline).toLocaleDateString()}`,
      )
    lines.push(`\nDescription: ${opportunity.description.slice(0, 500)}`)
    if (opportunity.requirements && opportunity.requirements.length > 0) {
      lines.push(
        `\nRequirements:\n${opportunity.requirements.map((r) => `- ${r}`).join('\n')}`,
      )
    }
    lines.push(`\nApply: ${opportunity.sourceUrl}`)

    if (existingMatch) {
      lines.push(
        `\nYour match: ${existingMatch.tier} tier (score: ${existingMatch.score}/100)`,
      )
      lines.push(
        `Strengths: ${existingMatch.explanation.strengths.join(' | ')}`,
      )
      if (existingMatch.explanation.gap)
        lines.push(`Gap: ${existingMatch.explanation.gap}`)
    } else {
      lines.push(`\nNo match computed yet for this opportunity.`)
    }

    return lines.join('\n')
  },
})

export const getCareerActions = createTool({
  description: "Get the user's personalized career actions grouped by status.",
  inputSchema: z.object({}),
  execute: async (ctx): Promise<string> => {
    const profile = await getProfile(ctx)
    if (!profile) return 'Error: profile not found'

    const actions = (await ctx.runQuery(
      internal.agent.queries.getCareerActionsForAgent as never,
      { profileId: profile._id } as never,
    )) as Array<{
      type: string
      title: string
      description: string
      rationale: string
      status: string
    }>

    if (actions.length === 0) return 'No career actions generated yet.'

    const grouped = new Map<string, typeof actions>()
    for (const action of actions) {
      const group = grouped.get(action.status)
      if (group) {
        group.push(action)
      } else {
        grouped.set(action.status, [action])
      }
    }

    const lines: Array<string> = [`${actions.length} career actions:\n`]
    for (const status of [
      'in_progress',
      'active',
      'saved',
      'done',
      'dismissed',
    ]) {
      const items = grouped.get(status)
      if (!items || items.length === 0) continue
      lines.push(
        `${status.replace(/_/g, ' ').toUpperCase()} (${items.length}):`,
      )
      for (const item of items) {
        lines.push(`- ${item.title}: ${item.description.slice(0, 100)}`)
      }
      lines.push('')
    }

    return lines.join('\n')
  },
})
