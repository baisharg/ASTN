'use node'

import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalAction } from '../_generated/server'
import { buildProfileContext } from '../enrichment/conversation'
import { computeProfileCompleteness, isProfileMatchReady } from '../profiles'
import { MODEL_QUALITY } from '../lib/models'
import {
  buildAgentSystemPrompt,
  buildBaishContextBlock,
  buildCompletenessBlock,
  buildExtractedDocumentsBlock,
  buildPageContextBlock,
} from './prompts'
import { profileAgent } from './index'
import type { ProfileData } from '../enrichment/conversation'
import type { Id } from '../_generated/dataModel'

/**
 * Internal action that streams the agent response.
 * Loads fresh profile context, then runs agent.streamText via continueThread.
 */
export const streamResponse = internalAction({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
    profileId: v.id('profiles'),
    pageContext: v.optional(
      v.union(
        v.literal('viewing_home'),
        v.literal('viewing_profile'),
        v.literal('editing_profile'),
        v.literal('browsing_matches'),
        v.literal('viewing_match'),
        v.literal('browsing_opportunities'),
        v.literal('viewing_opportunity'),
        v.literal('event_profile'),
      ),
    ),
    pageContextEntityId: v.optional(v.string()),
    userEmail: v.optional(v.string()),
    preferredLanguage: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (
    ctx,
    {
      threadId,
      promptMessageId,
      profileId,
      pageContext,
      pageContextEntityId,
      userEmail,
      preferredLanguage,
    },
  ) => {
    const profile = (await ctx.runQuery(internal.agent.queries.getProfileById, {
      profileId,
    })) as ProfileData | null

    const profileContext = profile
      ? buildProfileContext(profile)
      : 'New profile (no data yet)'

    // Fetch rich entity data based on page context type
    let entityData: unknown = null
    if (pageContext === 'viewing_match' && pageContextEntityId) {
      entityData = await ctx.runQuery(
        internal.agent.queries.getMatchWithOpportunity,
        {
          matchId: pageContextEntityId as Id<'matches'>,
          profileId,
        },
      )
    } else if (pageContext === 'viewing_opportunity' && pageContextEntityId) {
      entityData = await ctx.runQuery(
        internal.agent.queries.getOpportunityForContext,
        {
          opportunityId: pageContextEntityId as Id<'opportunities'>,
          profileId,
        },
      )
    } else if (pageContext === 'event_profile' && pageContextEntityId) {
      entityData = await ctx.runQuery(
        internal.social.agentContext.getEventForAgent,
        { key: pageContextEntityId },
      )
    } else if (pageContext === 'browsing_matches') {
      entityData = await ctx.runQuery(
        internal.agent.queries.getMatchesSummary,
        { profileId },
      )
    }

    const pageContextData = buildPageContextBlock(pageContext, entityData)

    // Compute profile completeness and match readiness for the system prompt
    const profileRecord = profile as unknown as Record<string, unknown> | null
    const completeness = computeProfileCompleteness(profileRecord)
    const matchReadiness = isProfileMatchReady(profileRecord)
    const completenessBlock = buildCompletenessBlock(
      completeness,
      matchReadiness,
    )

    // Fetch recently extracted documents for agent context
    // profileRecord has the full DB shape (including userId) since getProfileById returns the raw doc
    const profileUserId = (profileRecord as { userId?: string } | null)?.userId
    let extractedDocsBlock = ''
    if (profileUserId) {
      const extractedDocs = (await ctx.runQuery(
        internal.agent.queries.getRecentExtractedDocuments,
        { userId: profileUserId },
      )) as Array<{
        fileName: string
        uploadedAt: number
        extractedData: {
          name?: string
          education?: Array<{
            institution: string
            degree?: string
            field?: string
          }>
          workHistory?: Array<{
            organization: string
            title: string
            description?: string
          }>
          skills?: Array<string>
        }
      }>
      extractedDocsBlock = buildExtractedDocumentsBlock(extractedDocs)
    }

    // Check for BAISH CRM data for new profiles
    // Profile from DB has hasEnrichmentConversation but ProfileData type doesn't include it
    const fullProfile = profile as
      | (ProfileData & { hasEnrichmentConversation?: boolean })
      | null
    let baishContextBlock = ''
    const isNewProfile =
      fullProfile && !fullProfile.name && !fullProfile.hasEnrichmentConversation
    if (isNewProfile && userEmail) {
      const baishRecord = await ctx.runQuery(
        internal.agent.queries.getBaishImport,
        { email: userEmail },
      )
      if (baishRecord) {
        baishContextBlock = buildBaishContextBlock(
          baishRecord as Parameters<typeof buildBaishContextBlock>[0],
        )
      }
    }

    const system =
      buildAgentSystemPrompt(
        profileContext,
        pageContext,
        pageContextData,
        completenessBlock,
        preferredLanguage,
      ) +
      baishContextBlock +
      extractedDocsBlock

    const { thread } = await profileAgent.continueThread(ctx, { threadId })
    // Type assertion needed: @convex-dev/agent generic resolution for
    // StreamingTextArgs resolves to `never` with complex tool types
    const result = await thread.streamText(
      { promptMessageId, system } as Parameters<typeof thread.streamText>[0],
      { saveStreamDeltas: { chunking: 'word', throttleMs: 100 } },
    )

    await result.consumeStream()

    // Log LLM usage for cost tracking
    try {
      const usage = await result.usage
      await ctx.runMutation(internal.lib.llmUsage.logUsage, {
        operation: 'agent_chat',
        model: MODEL_QUALITY,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        profileId,
      })
    } catch (e) {
      console.error('Failed to log agent_chat usage:', e)
    }

    // Mark enrichment as done after first successful response
    await ctx.runMutation(internal.agent.mutations.markEnrichmentDone, {
      profileId,
    })

    return null
  },
})
