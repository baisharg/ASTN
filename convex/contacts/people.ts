import { ConvexError, v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { requireOrgAdmin } from '../lib/auth'
import { normalizeEmail } from '../social/lib'
import {
  crmActivityKindValidator,
  crmCollectionValidator,
  crmViewFilterValidator,
  crmViewSortValidator,
} from './validators'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/**
 * One person across ASTN: the CRM contact, the app account it links to, and
 * everything tied to them by account or email (docs/crm-consolidation.md).
 */

function contactEmails(contact: Doc<'crmContacts'>): Array<string> {
  return [contact.email, ...(contact.otherEmails ?? [])]
    .filter((e): e is string => !!e)
    .map(normalizeEmail)
}

export async function requireContact(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
  contactId: Id<'crmContacts'>,
): Promise<Doc<'crmContacts'>> {
  const contact = await ctx.db.get('crmContacts', contactId)
  if (!contact || contact.orgId !== orgId) {
    throw new ConvexError('Contact not found')
  }
  return contact
}

export type TimelineItem = {
  kind: 'application' | 'event' | 'program' | 'session' | 'form' | 'note'
  title: string
  status: string | null
  at: number | null
  source: 'app' | 'luma' | 'airtable' | 'manual'
  href: string | null
  activityId: Id<'crmActivities'> | null
  details: Record<string, unknown> | null
}

export type PersonView = {
  contact: Doc<'crmContacts'>
  emails: Array<string>
  profile: {
    name: string | null
    headline: string | null
    location: string | null
    linkedinUrl: string | null
    seeking: string | null
    canHelpWith: string | null
    careerGoals: string | null
    skills: Array<string>
    interests: Array<string>
  } | null
  timeline: Array<TimelineItem>
}

/**
 * The person page's data for a contact the caller may already see: the
 * contact, all its emails, the linked profile, and one timeline (newest
 * first) of applications, event registrations, program participation and
 * crmActivities. Shared by getPerson and the MCP `crm_person` tool.
 */
export async function buildPersonView(
  ctx: QueryCtx,
  contact: Doc<'crmContacts'>,
): Promise<PersonView> {
  const orgId = contact.orgId
  const org = await ctx.db.get('organizations', orgId)
  const emails = contactEmails(contact)

  const profile = contact.userId
    ? await ctx.db
        .query('profiles')
        .withIndex('by_user', (q) => q.eq('userId', contact.userId as string))
        .first()
    : null

  const timeline: Array<TimelineItem> = []

  // Applications to the org's opportunities, by account and by email.
  const applications: Array<Doc<'opportunityApplications'>> = []
  if (contact.userId) {
    const byUser = await ctx.db
      .query('opportunityApplications')
      .withIndex('by_user_and_opportunity', (q) =>
        q.eq('userId', contact.userId as string),
      )
      .take(200)
    applications.push(...byUser.filter((a) => a.orgId === orgId))
  }
  for (const email of emails) {
    const byEmail = await ctx.db
      .query('opportunityApplications')
      .withIndex('by_guest_email_and_opportunity', (q) =>
        q.eq('guestEmail', email),
      )
      .take(200)
    for (const a of byEmail) {
      if (a.orgId === orgId && !applications.some((x) => x._id === a._id)) {
        applications.push(a)
      }
    }
  }
  for (const a of applications) {
    const opp = await ctx.db.get('orgOpportunities', a.opportunityId)
    timeline.push({
      kind: 'application',
      title: opp?.title ?? 'Postulación',
      status: a.status,
      at: a.submittedAt,
      source: 'app',
      href: org?.slug
        ? `/org/${org.slug}/admin/opportunities/${a.opportunityId}`
        : null,
      activityId: null,
      details: null,
    })
  }

  // In-person events registered through ASTN or Luma.
  const guestRows: Array<Doc<'socialEventGuests'>> = []
  for (const email of emails) {
    const rows = await ctx.db
      .query('socialEventGuests')
      .withIndex('by_email', (q) => q.eq('email', email))
      .take(100)
    guestRows.push(...rows.filter((g) => g.orgId === orgId))
  }
  // Luma events that ASTN manages show up once, from socialEventGuests.
  const managedLumaIds = new Set<string>()
  for (const g of guestRows) {
    const event = await ctx.db.get('socialEvents', g.eventId)
    if (event?.lumaEventId) managedLumaIds.add(event.lumaEventId)
    timeline.push({
      kind: 'event',
      title: event?.title ?? 'Evento',
      status: g.checkedInAt ? 'checked_in' : g.status,
      at: event?.startAt ?? g.registeredAt,
      source: g.source === 'luma' ? 'luma' : 'app',
      href:
        org?.slug && event
          ? `/org/${org.slug}/admin/events/${event._id}`
          : null,
      activityId: null,
      details: null,
    })
  }

  // Program participation (needs an account).
  if (contact.userId) {
    const parts = await ctx.db
      .query('programParticipation')
      .withIndex('by_user_org', (q) =>
        q.eq('userId', contact.userId as string).eq('orgId', orgId),
      )
      .take(100)
    for (const p of parts) {
      const program = await ctx.db.get('programs', p.programId)
      timeline.push({
        kind: 'program',
        title: program?.name ?? 'Programa',
        status: p.status,
        at: p.enrolledAt,
        source: 'app',
        href:
          org?.slug && program
            ? `/org/${org.slug}/admin/programs/${program._id}`
            : null,
        activityId: null,
        details: null,
      })
    }
  }

  // Imported and manual history.
  const activities = await ctx.db
    .query('crmActivities')
    .withIndex('by_contactId_and_occurredAt', (q) =>
      q.eq('contactId', contact._id),
    )
    .take(500)
  for (const a of activities) {
    const lumaEventId =
      a.source === 'luma' ? a.externalId?.split(':')[1] : undefined
    if (lumaEventId && managedLumaIds.has(lumaEventId)) continue
    timeline.push({
      kind: a.kind,
      title: a.title,
      status: a.status ?? null,
      at: a.occurredAt ?? a.createdAt,
      source: a.source,
      href: null,
      activityId: a._id,
      details: a.data ?? null,
    })
  }

  timeline.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))

  return {
    contact,
    emails,
    profile: profile
      ? {
          name: profile.name ?? null,
          headline: profile.headline ?? null,
          location: profile.location ?? null,
          linkedinUrl: profile.linkedinUrl ?? null,
          seeking: profile.seeking ?? null,
          canHelpWith: profile.canHelpWith ?? null,
          careerGoals: profile.careerGoals ?? null,
          skills: profile.skills ?? [],
          interests: profile.aiSafetyInterests ?? [],
        }
      : null,
    timeline,
  }
}

/**
 * The org's contact with this email as its primary or one of its other
 * emails, or null. Other emails have no index, so that fallback scans the
 * org's contacts (bounded).
 */
const OTHER_EMAIL_SCAN_LIMIT = 10000

export async function findContactByEmail(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
  rawEmail: string,
): Promise<Doc<'crmContacts'> | null> {
  const email = normalizeEmail(rawEmail)
  if (!email) return null
  const primary = await ctx.db
    .query('crmContacts')
    .withIndex('by_orgId_and_email', (q) =>
      q.eq('orgId', orgId).eq('email', email),
    )
    .first()
  if (primary) return primary
  let scanned = 0
  for await (const contact of ctx.db
    .query('crmContacts')
    .withIndex('by_orgId', (q) => q.eq('orgId', orgId))) {
    if (contact.otherEmails?.includes(email)) return contact
    if (++scanned >= OTHER_EMAIL_SCAN_LIMIT) break
  }
  return null
}

/**
 * Email → contact for the whole org, primary emails first, then other
 * emails not already taken; the same matching as findContactByEmail, built
 * once for callers that look up many emails.
 */
export async function contactsByEmail(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
): Promise<Map<string, Doc<'crmContacts'>>> {
  const contacts = await ctx.db
    .query('crmContacts')
    .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
    .take(OTHER_EMAIL_SCAN_LIMIT)
  const map = new Map<string, Doc<'crmContacts'>>()
  for (const c of contacts) {
    const email = c.email ? normalizeEmail(c.email) : ''
    // First by creation, as the index lookup in findContactByEmail.
    if (email && !map.has(email)) map.set(email, c)
  }
  for (const c of contacts) {
    for (const e of c.otherEmails ?? []) {
      const email = normalizeEmail(e)
      if (!map.has(email)) map.set(email, c)
    }
  }
  return map
}

export const getPerson = query({
  args: { orgId: v.id('organizations'), contactId: v.id('crmContacts') },
  returns: v.any(),
  handler: async (ctx, { orgId, contactId }) => {
    await requireOrgAdmin(ctx, orgId)
    const contact = await requireContact(ctx, orgId, contactId)
    return await buildPersonView(ctx, contact)
  },
})

/**
 * Link contacts to app accounts by email (primary or other emails). Returns
 * how many were linked. Safe to run repeatedly.
 */
export const linkAccounts = mutation({
  args: { orgId: v.id('organizations') },
  returns: v.number(),
  handler: async (ctx, { orgId }) => {
    await requireOrgAdmin(ctx, orgId)
    // profiles.email isn't indexed; the table is small enough to map once.
    const profiles = await ctx.db.query('profiles').take(10000)
    const userByEmail = new Map<string, string>()
    for (const p of profiles) {
      if (p.email) userByEmail.set(normalizeEmail(p.email), p.userId)
    }
    const contacts = await ctx.db
      .query('crmContacts')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .take(10000)
    let linked = 0
    for (const contact of contacts) {
      if (contact.userId) continue
      const userId = contactEmails(contact)
        .map((e) => userByEmail.get(e))
        .find(Boolean)
      if (!userId) continue
      await ctx.db.patch('crmContacts', contact._id, { userId })
      linked++
    }
    return linked
  },
})

export const setOtherEmails = mutation({
  args: {
    orgId: v.id('organizations'),
    contactId: v.id('crmContacts'),
    emails: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { orgId, contactId, emails }) => {
    await requireOrgAdmin(ctx, orgId)
    const contact = await requireContact(ctx, orgId, contactId)
    const clean = [
      ...new Set(
        emails
          .map(normalizeEmail)
          .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)),
      ),
    ].filter((e) => e !== contact.email)
    await ctx.db.patch('crmContacts', contactId, {
      otherEmails: clean.length ? clean : undefined,
      updatedAt: Date.now(),
    })
    return null
  },
})

// ── History ──────────────────────────────────────────────────────────────

export const addActivity = mutation({
  args: {
    orgId: v.id('organizations'),
    contactId: v.id('crmContacts'),
    kind: crmActivityKindValidator,
    title: v.string(),
    occurredAt: v.optional(v.number()),
    status: v.optional(v.string()),
  },
  returns: v.id('crmActivities'),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.orgId)
    await requireContact(ctx, args.orgId, args.contactId)
    const title = args.title.trim()
    if (!title) throw new ConvexError('Write something first')
    return await ctx.db.insert('crmActivities', {
      orgId: args.orgId,
      contactId: args.contactId,
      kind: args.kind,
      title,
      occurredAt: args.occurredAt ?? Date.now(),
      status: args.status?.trim() || undefined,
      source: 'manual',
      createdAt: Date.now(),
    })
  },
})

export const deleteActivity = mutation({
  args: { orgId: v.id('organizations'), activityId: v.id('crmActivities') },
  returns: v.null(),
  handler: async (ctx, { orgId, activityId }) => {
    await requireOrgAdmin(ctx, orgId)
    const activity = await ctx.db.get('crmActivities', activityId)
    if (!activity || activity.orgId !== orgId) {
      throw new ConvexError('Not found')
    }
    await ctx.db.delete('crmActivities', activityId)
    return null
  },
})

// ── Saved views ──────────────────────────────────────────────────────────

export const listViews = query({
  args: { orgId: v.id('organizations'), collection: crmCollectionValidator },
  returns: v.array(v.any()),
  handler: async (ctx, { orgId, collection }) => {
    await requireOrgAdmin(ctx, orgId)
    return await ctx.db
      .query('crmViews')
      .withIndex('by_orgId_and_collection', (q) =>
        q.eq('orgId', orgId).eq('collection', collection),
      )
      .take(100)
  },
})

export const saveView = mutation({
  args: {
    orgId: v.id('organizations'),
    collection: crmCollectionValidator,
    viewId: v.optional(v.id('crmViews')),
    name: v.string(),
    filters: v.array(crmViewFilterValidator),
    sort: v.array(crmViewSortValidator),
    columns: v.optional(v.array(v.string())),
    groupBy: v.optional(v.string()),
  },
  returns: v.id('crmViews'),
  handler: async (ctx, args) => {
    const userId = await requireOrgAdmin(ctx, args.orgId)
    const name = args.name.trim()
    if (!name) throw new ConvexError('The view needs a name')
    const now = Date.now()
    const doc = {
      name,
      filters: args.filters,
      sort: args.sort,
      columns: args.columns,
      groupBy: args.groupBy,
      updatedAt: now,
    }
    if (args.viewId) {
      const view = await ctx.db.get('crmViews', args.viewId)
      if (!view || view.orgId !== args.orgId) {
        throw new ConvexError('View not found')
      }
      await ctx.db.patch('crmViews', args.viewId, doc)
      return args.viewId
    }
    return await ctx.db.insert('crmViews', {
      orgId: args.orgId,
      collection: args.collection,
      createdBy: userId,
      createdAt: now,
      ...doc,
    })
  },
})

export const deleteView = mutation({
  args: { orgId: v.id('organizations'), viewId: v.id('crmViews') },
  returns: v.null(),
  handler: async (ctx, { orgId, viewId }) => {
    await requireOrgAdmin(ctx, orgId)
    const view = await ctx.db.get('crmViews', viewId)
    if (!view || view.orgId !== orgId) throw new ConvexError('View not found')
    await ctx.db.delete('crmViews', viewId)
    return null
  },
})
