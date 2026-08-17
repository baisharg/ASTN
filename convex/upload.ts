import { ConvexError, v } from 'convex/values'
import { mutation } from './_generated/server'
import { getUserId } from './lib/auth'
import { rateLimiter } from './lib/rateLimiter'

/**
 * Generate a one-time upload URL for file uploads.
 * The URL expires in 1 hour.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx)
    if (!userId) {
      throw new Error('Not authenticated')
    }

    await rateLimiter.limit(ctx, 'generateUploadUrl', {
      key: userId,
      throws: true,
    })

    return await ctx.storage.generateUploadUrl()
  },
})

/**
 * Upload URL for an `image` form field inside a feedback survey.
 *
 * Survey respondents are guests — they arrive on a token link and are never
 * logged in — so `generateUploadUrl` above, which requires auth, cannot serve
 * them. Instead of dropping the auth requirement, this gates on the survey
 * token itself: the link must resolve to a survey that is currently open,
 * either through a respondent's personal token or through the generic access
 * token of an anonymous survey. Rate-limited per token so a leaked link cannot
 * be turned into open file hosting.
 */
export const generateSurveyUploadUrl = mutation({
  args: { token: v.string() },
  returns: v.string(),
  handler: async (ctx, { token }) => {
    const respondent = await ctx.db
      .query('surveyRespondents')
      .withIndex('by_respondentToken', (q) => q.eq('respondentToken', token))
      .unique()

    const survey = respondent
      ? await ctx.db.get('feedbackSurveys', respondent.surveyId)
      : await ctx.db
          .query('feedbackSurveys')
          .withIndex('by_accessToken', (q) => q.eq('accessToken', token))
          .unique()

    if (!survey) throw new ConvexError('Survey not found')
    // The generic token only opens uploads for anonymous surveys; for the rest
    // it is a signpost page, not a way in.
    if (!respondent && !survey.anonymous)
      throw new ConvexError('This survey uses individual links')
    if (survey.status !== 'open')
      throw new ConvexError('Survey is no longer accepting responses')

    await rateLimiter.limit(ctx, 'surveyFileUpload', { key: token, throws: true })

    return await ctx.storage.generateUploadUrl()
  },
})

/**
 * Save uploaded document metadata after file is uploaded to storage.
 * Creates a record with "pending_extraction" status for Phase 8 processing.
 */
export const saveDocument = mutation({
  args: {
    storageId: v.id('_storage'),
    fileName: v.string(),
    fileSize: v.number(),
    mimeType: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getUserId(ctx)
    if (!userId) {
      throw new Error('Not authenticated')
    }

    const documentId = await ctx.db.insert('uploadedDocuments', {
      userId,
      storageId: args.storageId,
      fileName: args.fileName,
      fileSize: args.fileSize,
      mimeType: args.mimeType,
      status: 'pending_extraction',
      uploadedAt: Date.now(),
    })

    return documentId
  },
})
