import { v } from 'convex/values'
import { internalQuery } from '../_generated/server'
import { focusFromPrompt } from './lib'

/** Event details for the profile agent. `key` is "<orgSlug>/<eventSlug>". */
export const getEventForAgent = internalQuery({
  args: { key: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      title: v.string(),
      date: v.string(),
      focus: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { key }) => {
    const [orgSlug, eventSlug] = key.split('/')
    if (!orgSlug || !eventSlug) return null
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', orgSlug))
      .first()
    if (!org) return null
    const event = await ctx.db
      .query('socialEvents')
      .withIndex('by_org_and_slug', (q) =>
        q.eq('orgId', org._id).eq('slug', eventSlug),
      )
      .first()
    if (!event || event.status === 'draft') return null
    return {
      title: event.title,
      date: new Date(event.startAt).toLocaleDateString('es-AR', {
        timeZone: event.timezone,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }),
      focus: focusFromPrompt(event.matchingPrompt),
    }
  },
})
