import { v } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { Id } from '../_generated/dataModel'

// LLM pricing (per million tokens)
export const PRICING: Partial<
  Record<string, { input: number; output: number }>
> = {
  'openai/gpt-6-luna': { input: 0.1, output: 0.5 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 0.8, output: 4 },
  'gemini-3-flash-preview': { input: 0.5, output: 3 },
  'kimi-k2.5': { input: 0.6, output: 3 },
}

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = PRICING[model]
  if (!pricing) return 0
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  )
}

/** Insert a single LLM usage row. Called from actions after each API call. */
export const logUsage = internalMutation({
  args: {
    operation: v.string(),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    userId: v.optional(v.string()),
    profileId: v.optional(v.id('profiles')),
    durationMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert('llmUsage', {
      ...args,
      createdAt: Date.now(),
    })
    return null
  },
})

/** Aggregate usage stats grouped by operation and model for a time range. */
export const getUsageSummary = internalQuery({
  args: {
    startTime: v.number(),
    endTime: v.number(),
  },
  returns: v.array(
    v.object({
      operation: v.string(),
      model: v.string(),
      callCount: v.number(),
      totalInputTokens: v.number(),
      totalOutputTokens: v.number(),
      estimatedCostUsd: v.number(),
    }),
  ),
  handler: async (ctx, { startTime, endTime }) => {
    const rows = await ctx.db
      .query('llmUsage')
      .withIndex('by_createdAt', (q) =>
        q.gte('createdAt', startTime).lte('createdAt', endTime),
      )
      .collect()

    const buckets = new Map<
      string,
      {
        operation: string
        model: string
        callCount: number
        totalInputTokens: number
        totalOutputTokens: number
      }
    >()

    for (const row of rows) {
      const key = `${row.operation}|${row.model}`
      const bucket = buckets.get(key) ?? {
        operation: row.operation,
        model: row.model,
        callCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
      }
      bucket.callCount++
      bucket.totalInputTokens += row.inputTokens
      bucket.totalOutputTokens += row.outputTokens
      buckets.set(key, bucket)
    }

    return [...buckets.values()].map((b) => ({
      ...b,
      estimatedCostUsd: estimateCost(
        b.model,
        b.totalInputTokens,
        b.totalOutputTokens,
      ),
    }))
  },
})

/** Per-user cost breakdown for a time range. */
export const getUsageByUser = internalQuery({
  args: {
    userId: v.string(),
    startTime: v.number(),
    endTime: v.number(),
  },
  returns: v.array(
    v.object({
      operation: v.string(),
      model: v.string(),
      callCount: v.number(),
      totalInputTokens: v.number(),
      totalOutputTokens: v.number(),
      estimatedCostUsd: v.number(),
    }),
  ),
  handler: async (ctx, { userId, startTime, endTime }) => {
    const rows = await ctx.db
      .query('llmUsage')
      .withIndex('by_userId_and_createdAt', (q) =>
        q
          .eq('userId', userId)
          .gte('createdAt', startTime)
          .lte('createdAt', endTime),
      )
      .collect()

    const buckets = new Map<
      string,
      {
        operation: string
        model: string
        callCount: number
        totalInputTokens: number
        totalOutputTokens: number
      }
    >()

    for (const row of rows) {
      const key = `${row.operation}|${row.model}`
      const bucket = buckets.get(key) ?? {
        operation: row.operation,
        model: row.model,
        callCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
      }
      bucket.callCount++
      bucket.totalInputTokens += row.inputTokens
      bucket.totalOutputTokens += row.outputTokens
      buckets.set(key, bucket)
    }

    return [...buckets.values()].map((b) => ({
      ...b,
      estimatedCostUsd: estimateCost(
        b.model,
        b.totalInputTokens,
        b.totalOutputTokens,
      ),
    }))
  },
})

/**
 * Helper to build logUsage args from an LLM API response.
 * Accepts both Anthropic (input_tokens/output_tokens) and
 * Gemini (promptTokenCount/candidatesTokenCount) usage formats.
 */
export function buildUsageArgs(
  operation: string,
  model: string,
  usage:
    | { input_tokens: number; output_tokens: number }
    | { promptTokenCount: number; candidatesTokenCount: number },
  opts?: {
    userId?: string
    profileId?: Id<'profiles'>
    durationMs?: number
  },
) {
  const inputTokens =
    'input_tokens' in usage ? usage.input_tokens : usage.promptTokenCount
  const outputTokens =
    'output_tokens' in usage ? usage.output_tokens : usage.candidatesTokenCount
  return {
    operation,
    model,
    inputTokens,
    outputTokens,
    ...opts,
  }
}
