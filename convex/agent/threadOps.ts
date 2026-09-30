import { v } from 'convex/values'
import {
  abortStream,
  createThread,
  listStreams,
  saveMessage,
} from '@convex-dev/agent'
import { components, internal } from '../_generated/api'
import { mutation } from '../_generated/server'
import { getUserId } from '../lib/auth'

/**
 * Create a new agent thread and store it on the profile.
 */
export const createAgentThread = mutation({
  args: {
    profileId: v.id('profiles'),
  },
  returns: v.string(),
  handler: async (ctx, { profileId }) => {
    const userId = await getUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const profile = await ctx.db.get('profiles', profileId)
    if (!profile || profile.userId !== userId) {
      throw new Error('Not authorized')
    }

    const threadId = await createThread(ctx, components.agent, {
      userId,
    })

    await ctx.db.patch('profiles', profileId, {
      agentThreadId: threadId,
      updatedAt: Date.now(),
    })

    return threadId
  },
})

/**
 * Save a user message and schedule streaming response.
 */
export const sendMessage = mutation({
  args: {
    threadId: v.string(),
    prompt: v.string(),
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
    browserLocale: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (
    ctx,
    {
      threadId,
      prompt,
      profileId,
      pageContext,
      pageContextEntityId,
      browserLocale,
    },
  ) => {
    const userId = await getUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    // Extract user email for BAISH CRM lookup
    const identity = await ctx.auth.getUserIdentity()
    const userEmail = identity?.email ?? undefined

    // Resolve preferred language from profile or browser locale
    const profile = await ctx.db.get('profiles', profileId)
    let preferredLanguage = profile?.preferredLanguage
    if (!preferredLanguage && browserLocale) {
      // Extract ISO 639-1 code from locale (e.g., "es-AR" -> "es")
      preferredLanguage = browserLocale.split('-')[0]
      if (profile) {
        await ctx.db.patch('profiles', profileId, {
          preferredLanguage,
          updatedAt: Date.now(),
        })
      }
    }

    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId,
      prompt,
    })

    await ctx.scheduler.runAfter(0, internal.agent.actions.streamResponse, {
      threadId,
      promptMessageId: messageId,
      profileId,
      pageContext,
      pageContextEntityId,
      userEmail,
      preferredLanguage,
    })

    return messageId
  },
})

/**
 * Delete messages from a given order onward (for edit-and-resend).
 */
export const deleteMessagesFrom = mutation({
  args: {
    threadId: v.string(),
    startOrder: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { threadId, startOrder }) => {
    const userId = await getUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    // Abort any active streams first
    const streams = await listStreams(ctx, components.agent, {
      threadId,
      includeStatuses: ['streaming'],
    })
    for (const stream of streams) {
      await abortStream(ctx, components.agent, {
        streamId: stream.streamId,
        reason: 'Edit message',
      })
    }

    // Delete messages from startOrder to a large upper bound
    let isDone = false
    let curOrder = startOrder
    let curStepOrder = 0
    while (!isDone) {
      const result = await ctx.runMutation(
        components.agent.messages.deleteByOrder,
        {
          threadId,
          startOrder: curOrder,
          startStepOrder: curStepOrder,
          endOrder: 1_000_000,
        },
      )
      isDone = result.isDone
      curOrder = result.lastOrder ?? curOrder
      curStepOrder = result.lastStepOrder ?? curStepOrder
    }

    return null
  },
})

/**
 * Abort all active streams on a thread.
 */
export const abortGeneration = mutation({
  args: { threadId: v.string() },
  returns: v.number(),
  handler: async (ctx, { threadId }) => {
    const userId = await getUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const streams = await listStreams(ctx, components.agent, {
      threadId,
      includeStatuses: ['streaming'],
    })
    let count = 0
    for (const stream of streams) {
      if (
        await abortStream(ctx, components.agent, {
          streamId: stream.streamId,
          reason: 'User cancelled',
        })
      ) {
        count++
      }
    }
    return count
  },
})
