import { v } from 'convex/values'
import { internalMutation, mutation } from '../_generated/server'
import { safeLinkedinUrl } from '../social/lib'
import { getUserId } from '../lib/auth'
import { SKILLS_LIST } from './prompts'
import { convertDateString, educationMatches, workMatches } from './utils'
import type { Id } from '../_generated/dataModel'

const SKILLS_SET = new Set(SKILLS_LIST)

/**
 * Mark enrichment conversation as done on the profile.
 * Called after the first successful agent response.
 */
export const markEnrichmentDone = internalMutation({
  args: { profileId: v.id('profiles') },
  returns: v.null(),
  handler: async (ctx, { profileId }) => {
    const profile = await ctx.db.get('profiles', profileId)
    if (profile && !profile.hasEnrichmentConversation) {
      await ctx.db.patch('profiles', profileId, {
        hasEnrichmentConversation: true,
        updatedAt: Date.now(),
      })
    }
    return null
  },
})

// Fields that affect match quality — trigger staleness indicator
const MATCH_AFFECTING_FIELDS = new Set([
  'skills',
  'education',
  'workHistory',
  'careerGoals',
  'aiSafetyInterests',
  'seeking',
  'enrichmentSummary',
  'matchPreferences',
])

/**
 * Propose a tool change without touching the profile.
 * Creates a record with status 'proposed' that waits for user approval.
 * Called by agent tools when auto-approve may be off.
 */
export const proposeToolChange = internalMutation({
  args: {
    profileId: v.id('profiles'),
    threadId: v.string(),
    toolName: v.string(),
    displayText: v.string(),
    updates: v.string(), // JSON
    previousValues: v.string(), // JSON
  },
  returns: v.id('agentToolCalls'),
  handler: async (ctx, args) => {
    const profile = await ctx.db.get('profiles', args.profileId)
    if (!profile) throw new Error('Profile not found')

    const toolCallId = await ctx.db.insert('agentToolCalls', {
      profileId: args.profileId,
      threadId: args.threadId,
      toolName: args.toolName,
      displayText: args.displayText,
      updates: args.updates,
      previousValues: args.previousValues,
      status: 'proposed',
      createdAt: Date.now(),
    })

    return toolCallId
  },
})

/**
 * Apply a tool change to the profile and record it for approve/undo UI.
 * Called by agent tools after extracting information from conversation.
 */
export const applyToolChange = internalMutation({
  args: {
    profileId: v.id('profiles'),
    threadId: v.string(),
    toolName: v.string(),
    displayText: v.string(),
    updates: v.string(), // JSON
    previousValues: v.string(), // JSON
  },
  returns: v.id('agentToolCalls'),
  handler: async (ctx, args) => {
    const profile = await ctx.db.get('profiles', args.profileId)
    if (!profile) throw new Error('Profile not found')

    // Parse and apply updates to profile
    const updates = JSON.parse(args.updates) as Record<string, unknown>
    // Same rule as profiles.updateField: only store linkable LinkedIn URLs.
    if ('linkedinUrl' in updates) {
      updates.linkedinUrl =
        safeLinkedinUrl(updates.linkedinUrl as string | undefined) ?? undefined
    }
    const affectsMatches = Object.keys(updates).some((f) =>
      MATCH_AFFECTING_FIELDS.has(f),
    )

    await ctx.db.patch('profiles', args.profileId, {
      ...updates,
      updatedAt: Date.now(),
      ...(affectsMatches ? { matchesStaleAt: Date.now() } : {}),
    })

    // Record the tool call for approve/undo
    const toolCallId = await ctx.db.insert('agentToolCalls', {
      profileId: args.profileId,
      threadId: args.threadId,
      toolName: args.toolName,
      displayText: args.displayText,
      updates: args.updates,
      previousValues: args.previousValues,
      status: 'pending',
      createdAt: Date.now(),
    })

    return toolCallId
  },
})

/**
 * Resolve a tool change — approve or undo.
 * Approve: marks as approved (no-op on data, just clears pending UI).
 * Undo: restores previous values to the profile and marks as undone.
 */
export const resolveToolChange = mutation({
  args: {
    toolCallId: v.id('agentToolCalls'),
    action: v.union(v.literal('approve'), v.literal('undo')),
  },
  returns: v.null(),
  handler: async (ctx, { toolCallId, action }) => {
    const userId = await getUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const toolCall = await ctx.db.get('agentToolCalls', toolCallId)
    if (!toolCall) throw new Error('Tool call not found')

    // Idempotency: skip if already in a terminal state
    if (toolCall.status === 'approved' || toolCall.status === 'undone')
      return null

    // Verify ownership via profile
    const profile = await ctx.db.get('profiles', toolCall.profileId)
    if (!profile || profile.userId !== userId) {
      throw new Error('Not authorized')
    }

    if (action === 'approve') {
      await ctx.db.patch('agentToolCalls', toolCallId, { status: 'approved' })
    } else {
      // Undo: restore previous values
      const previousValues = JSON.parse(toolCall.previousValues) as Record<
        string,
        unknown
      >

      const affectsMatches = Object.keys(previousValues).some((f) =>
        MATCH_AFFECTING_FIELDS.has(f),
      )

      await ctx.db.patch('profiles', toolCall.profileId, {
        ...previousValues,
        updatedAt: Date.now(),
        ...(affectsMatches ? { matchesStaleAt: Date.now() } : {}),
      })

      await ctx.db.patch('agentToolCalls', toolCallId, { status: 'undone' })
    }

    return null
  },
})

/**
 * Approve a proposed tool change — apply its updates to the profile.
 * Called by frontend when user clicks Approve on a proposed change.
 */
export const approveProposal = mutation({
  args: {
    toolCallId: v.id('agentToolCalls'),
    editedUpdates: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { toolCallId, editedUpdates }) => {
    const userId = await getUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const toolCall = await ctx.db.get('agentToolCalls', toolCallId)
    if (!toolCall) throw new Error('Tool call not found')

    const profile = await ctx.db.get('profiles', toolCall.profileId)
    if (!profile || profile.userId !== userId) {
      throw new Error('Not authorized')
    }

    // Idempotency: silently skip if no longer in proposed state
    if (toolCall.status !== 'proposed') return null

    const updatesJson = editedUpdates ?? toolCall.updates
    const updates = JSON.parse(updatesJson) as Record<string, unknown>
    const affectsMatches = Object.keys(updates).some((f) =>
      MATCH_AFFECTING_FIELDS.has(f),
    )

    await ctx.db.patch('profiles', toolCall.profileId, {
      ...updates,
      updatedAt: Date.now(),
      ...(affectsMatches ? { matchesStaleAt: Date.now() } : {}),
    })

    await ctx.db.patch('agentToolCalls', toolCallId, {
      status: 'approved',
      ...(editedUpdates ? { editedUpdates } : {}),
    })

    return null
  },
})

/**
 * Deny a proposed tool change — mark as denied without touching the profile.
 * Called by frontend when user clicks Deny on a proposed change.
 */
export const denyProposal = mutation({
  args: {
    toolCallId: v.id('agentToolCalls'),
  },
  returns: v.null(),
  handler: async (ctx, { toolCallId }) => {
    const userId = await getUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const toolCall = await ctx.db.get('agentToolCalls', toolCallId)
    if (!toolCall) throw new Error('Tool call not found')

    const profile = await ctx.db.get('profiles', toolCall.profileId)
    if (!profile || profile.userId !== userId) {
      throw new Error('Not authorized')
    }

    if (toolCall.status !== 'proposed') {
      throw new Error('Tool call is not in proposed state')
    }

    await ctx.db.patch('agentToolCalls', toolCallId, { status: 'denied' })

    return null
  },
})

/**
 * Batch-approve all pending tool calls for a thread.
 * Called when the user sends a new message (auto-approve on send).
 */
export const batchApprovePending = mutation({
  args: {
    threadId: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, { threadId }) => {
    const userId = await getUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const pending = await ctx.db
      .query('agentToolCalls')
      .withIndex('by_thread_and_createdAt', (q) => q.eq('threadId', threadId))
      .collect()

    let count = 0
    for (const tc of pending) {
      if (tc.status === 'pending' && !tc.requiresManualApproval) {
        // Legacy: already applied, just mark approved
        await ctx.db.patch('agentToolCalls', tc._id, { status: 'approved' })
        count++
      } else if (tc.status === 'proposed' && !tc.requiresManualApproval) {
        // New flow: apply updates to profile then mark approved
        const profile = await ctx.db.get('profiles', tc.profileId)
        if (profile) {
          const updates = JSON.parse(tc.updates) as Record<string, unknown>
          const affectsMatches = Object.keys(updates).some((f) =>
            MATCH_AFFECTING_FIELDS.has(f),
          )
          await ctx.db.patch('profiles', tc.profileId, {
            ...updates,
            updatedAt: Date.now(),
            ...(affectsMatches ? { matchesStaleAt: Date.now() } : {}),
          })
        }
        await ctx.db.patch('agentToolCalls', tc._id, { status: 'approved' })
        count++
      }
    }

    return count
  },
})

/**
 * Apply extracted data from sidebar smart input (LinkedIn, CV, text paste).
 * Creates tool call records for each category so user can undo individually.
 * Only fills gaps — does not overwrite existing basic info fields.
 */
export const applyExtractionResults = mutation({
  args: {
    profileId: v.id('profiles'),
    threadId: v.string(),
    extractedData: v.object({
      name: v.optional(v.string()),
      location: v.optional(v.string()),
      education: v.optional(
        v.array(
          v.object({
            institution: v.string(),
            degree: v.optional(v.string()),
            field: v.optional(v.string()),
            startYear: v.optional(v.number()),
            endYear: v.optional(v.number()),
          }),
        ),
      ),
      workHistory: v.optional(
        v.array(
          v.object({
            organization: v.string(),
            title: v.string(),
            startDate: v.optional(v.string()),
            endDate: v.optional(v.string()),
            description: v.optional(v.string()),
          }),
        ),
      ),
      skills: v.optional(v.array(v.string())),
    }),
    source: v.union(v.literal('linkedin'), v.literal('cv'), v.literal('text')),
  },
  returns: v.object({
    toolCallIds: v.array(v.id('agentToolCalls')),
    summary: v.string(),
  }),
  handler: async (ctx, { profileId, threadId, extractedData, source }) => {
    const userId = await getUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const profile = await ctx.db.get('profiles', profileId)
    if (!profile || profile.userId !== userId) throw new Error('Not authorized')

    const manualApproval = source === 'linkedin'
    const toolCallIds: Array<Id<'agentToolCalls'>> = []
    const summaryParts: Array<string> = []
    let affectsMatches = false
    const allUpdates: Record<string, unknown> = {}

    // Basic info (only fill gaps — don't overwrite existing data)
    const basicUpdates: Record<string, string> = {}
    const basicPrevious: Record<string, string | undefined> = {}

    if (extractedData.name && !profile.name) {
      basicUpdates.name = extractedData.name
      basicPrevious.name = profile.name
      summaryParts.push('name')
    }
    if (extractedData.location && !profile.location) {
      basicUpdates.location = extractedData.location
      basicPrevious.location = profile.location
      summaryParts.push('location')
    }

    if (Object.keys(basicUpdates).length > 0) {
      Object.assign(allUpdates, basicUpdates)
      const id = await ctx.db.insert('agentToolCalls', {
        profileId,
        threadId,
        toolName: 'import_basic_info',
        displayText: `Imported ${Object.keys(basicUpdates).join(', ')}`,
        updates: JSON.stringify(basicUpdates),
        previousValues: JSON.stringify(basicPrevious),
        status: 'pending',
        ...(manualApproval ? { requiresManualApproval: true } : {}),
        createdAt: Date.now(),
      })
      toolCallIds.push(id)
    }

    // Education (append to existing, dedup by institution+degree+field)
    if (extractedData.education && extractedData.education.length > 0) {
      const existing = profile.education ?? []
      const newEntries = extractedData.education
        .map((e) => ({
          institution: e.institution,
          degree: e.degree,
          field: e.field,
          startYear: e.startYear,
          endYear: e.endYear,
        }))
        .filter((newE) => !existing.some((ex) => educationMatches(ex, newE)))
      const updated = [...existing, ...newEntries]
      allUpdates.education = updated
      affectsMatches = true
      const count = newEntries.length
      summaryParts.push(
        `${count} education ${count === 1 ? 'entry' : 'entries'}`,
      )
      const id = await ctx.db.insert('agentToolCalls', {
        profileId,
        threadId,
        toolName: 'import_education',
        displayText: `Imported ${count} education ${count === 1 ? 'entry' : 'entries'}`,
        updates: JSON.stringify({ education: updated }),
        previousValues: JSON.stringify({ education: existing }),
        status: 'pending',
        ...(manualApproval ? { requiresManualApproval: true } : {}),
        createdAt: Date.now(),
      })
      toolCallIds.push(id)
    }

    // Work history (append, convert YYYY-MM strings to timestamps, dedup by org+title)
    if (extractedData.workHistory && extractedData.workHistory.length > 0) {
      const existing = profile.workHistory ?? []
      const newEntries = extractedData.workHistory
        .map((w) => ({
          organization: w.organization,
          title: w.title,
          startDate: convertDateString(w.startDate),
          endDate: convertDateString(w.endDate),
          current:
            !w.endDate || w.endDate.toLowerCase() === 'present'
              ? true
              : undefined,
          description: w.description,
        }))
        .filter((newW) => !existing.some((ex) => workMatches(ex, newW)))
      const updated = [...existing, ...newEntries]
      allUpdates.workHistory = updated
      affectsMatches = true
      const count = newEntries.length
      summaryParts.push(
        `${count} work ${count === 1 ? 'experience' : 'experiences'}`,
      )
      const id = await ctx.db.insert('agentToolCalls', {
        profileId,
        threadId,
        toolName: 'import_work_history',
        displayText: `Imported ${count} work ${count === 1 ? 'experience' : 'experiences'}`,
        updates: JSON.stringify({ workHistory: updated }),
        previousValues: JSON.stringify({ workHistory: existing }),
        status: 'pending',
        ...(manualApproval ? { requiresManualApproval: true } : {}),
        createdAt: Date.now(),
      })
      toolCallIds.push(id)
    }

    // Skills (merge with existing, validate against taxonomy)
    if (extractedData.skills && extractedData.skills.length > 0) {
      const validSkills = extractedData.skills.filter((s) => SKILLS_SET.has(s))
      const skippedCount = extractedData.skills.length - validSkills.length
      if (validSkills.length > 0) {
        const existing = profile.skills ?? []
        const merged = [...new Set([...existing, ...validSkills])]
        allUpdates.skills = merged
        affectsMatches = true
        const skillNote =
          skippedCount > 0
            ? `${validSkills.length} skills (${skippedCount} unrecognized skipped)`
            : `${validSkills.length} skills`
        summaryParts.push(skillNote)
        const id = await ctx.db.insert('agentToolCalls', {
          profileId,
          threadId,
          toolName: 'import_skills',
          displayText: `Imported ${validSkills.length} skills`,
          updates: JSON.stringify({ skills: merged }),
          previousValues: JSON.stringify({ skills: existing }),
          status: 'pending',
          ...(manualApproval ? { requiresManualApproval: true } : {}),
          createdAt: Date.now(),
        })
        toolCallIds.push(id)
      }
    }

    // Apply all updates in one patch
    if (Object.keys(allUpdates).length > 0) {
      await ctx.db.patch('profiles', profileId, {
        ...allUpdates,
        updatedAt: Date.now(),
        ...(affectsMatches ? { matchesStaleAt: Date.now() } : {}),
      })
    }

    const sourceLabel =
      source === 'linkedin'
        ? 'LinkedIn'
        : source === 'cv'
          ? 'CV/resume'
          : 'pasted text'
    const summary =
      summaryParts.length > 0
        ? `Imported from ${sourceLabel}: ${summaryParts.join(', ')}`
        : `No new data found in ${sourceLabel}`

    return { toolCallIds, summary }
  },
})
