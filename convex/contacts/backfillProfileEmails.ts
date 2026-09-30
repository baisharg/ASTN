import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalAction, internalMutation } from '../_generated/server'

/**
 * One-off: profiles only store an email once their user logs in again
 * (profiles.ts backfills it lazily), so linking CRM contacts to accounts
 * misses everyone who hasn't. Copy primary emails from Clerk into profiles
 * that lack one. Idempotent. Run with:
 *   bunx convex run contacts/backfillProfileEmails:run
 */

const PAGE = 500

type ClerkUser = {
  id: string
  primary_email_address_id: string | null
  email_addresses: Array<{ id: string; email_address: string }>
}

export const run = internalAction({
  args: {},
  returns: v.object({ clerkUsers: v.number(), updated: v.number() }),
  handler: async (ctx) => {
    const key = process.env.CLERK_SECRET_KEY
    if (!key) throw new Error('CLERK_SECRET_KEY is not set')
    let offset = 0
    let clerkUsers = 0
    let updated = 0
    for (;;) {
      const res = await fetch(
        `https://api.clerk.com/v1/users?limit=${PAGE}&offset=${offset}&order_by=created_at`,
        { headers: { Authorization: `Bearer ${key}` } },
      )
      if (!res.ok) throw new Error(`Clerk users list failed: ${res.status}`)
      const users = (await res.json()) as Array<ClerkUser>
      clerkUsers += users.length
      const emails = users.flatMap((u) => {
        // Only the primary address: `apply` never overwrites, so a wrong
        // guess would stick.
        const primary = u.email_addresses.find(
          (e) => e.id === u.primary_email_address_id,
        )
        return primary
          ? [{ userId: u.id, email: primary.email_address.toLowerCase() }]
          : []
      })
      if (emails.length) {
        updated += await ctx.runMutation(
          internal.contacts.backfillProfileEmails.apply,
          { emails },
        )
      }
      if (users.length < PAGE) break
      offset += PAGE
    }
    return { clerkUsers, updated }
  },
})

export const apply = internalMutation({
  args: {
    emails: v.array(v.object({ userId: v.string(), email: v.string() })),
  },
  returns: v.number(),
  handler: async (ctx, { emails }) => {
    let updated = 0
    for (const { userId, email } of emails) {
      const profile = await ctx.db
        .query('profiles')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .first()
      if (!profile || profile.email) continue
      await ctx.db.patch('profiles', profile._id, { email })
      updated++
    }
    return updated
  },
})
