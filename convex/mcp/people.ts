import { v } from 'convex/values'
import { internalMutation, internalQuery } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import {
  buildPersonView,
  contactsByEmail,
  findContactByEmail,
  requireContact,
} from '../contacts/people'
import { attendanceExternalId } from '../luma/shared'
import { duplicateGroups, mergeContactsInOrg } from '../contacts/merge'
import { resolveOrgForAdmin } from './data'

// People, history and event attendance for the MCP endpoint. Internal
// functions, like the rest of convex/mcp: the HTTP action authenticates the
// caller and every handler re-checks org admin via resolveOrgForAdmin.

// ── crm_person ───────────────────────────────────────────────────────────

export const person = internalQuery({
  args: {
    userId: v.string(),
    orgSlug: v.string(),
    contactId: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    let contact: Doc<'crmContacts'> | null = null
    if (args.contactId) {
      const id = ctx.db.normalizeId('crmContacts', args.contactId)
      const doc = id ? await ctx.db.get('crmContacts', id) : null
      contact = doc && doc.orgId === org._id ? doc : null
      if (!contact) throw new Error('Contact not found')
    } else if (args.email) {
      contact = await findContactByEmail(ctx, org._id, args.email)
      if (!contact) {
        throw new Error(
          `No contact with email ${args.email} (primary or other emails)`,
        )
      }
    } else {
      throw new Error('Pass contactId or email')
    }
    const view = await buildPersonView(ctx, contact)
    const byKind: Record<string, number> = {}
    for (const item of view.timeline) {
      byKind[item.kind] = (byKind[item.kind] ?? 0) + 1
    }
    return { ...view, summary: { timelineItems: view.timeline.length, byKind } }
  },
})

// ── crm_activities ───────────────────────────────────────────────────────

// Kinds an agent may log by hand. Applications have a real home in ASTN.
const MANUAL_KINDS = ['note', 'event', 'program', 'session', 'form'] as const
type ManualKind = (typeof MANUAL_KINDS)[number]
const KINDS = [...MANUAL_KINDS, 'application']
const SOURCES = ['airtable', 'luma', 'app', 'manual']
const ACTIVITY_FIELDS = new Set([
  'contactId',
  'kind',
  'title',
  'occurredAt',
  'status',
])

async function contactInOrg(
  ctx: Parameters<typeof requireContact>[0],
  orgId: Id<'organizations'>,
  raw: string | undefined,
): Promise<Doc<'crmContacts'>> {
  const id = raw ? ctx.db.normalizeId('crmContacts', raw) : null
  if (!id) {
    throw new Error(
      raw
        ? 'Contact not found'
        : 'contactId is required (crm_person gives the whole timeline of a person)',
    )
  }
  try {
    return await requireContact(ctx, orgId, id)
  } catch {
    throw new Error('Contact not found')
  }
}

export const listActivities = internalQuery({
  args: {
    userId: v.string(),
    orgSlug: v.string(),
    contactId: v.optional(v.string()),
    kind: v.optional(v.string()),
    source: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    const contact = await contactInOrg(ctx, org._id, args.contactId)
    if (args.kind && !KINDS.includes(args.kind)) {
      throw new Error(`kind must be one of: ${KINDS.join(', ')}`)
    }
    if (args.source && !SOURCES.includes(args.source)) {
      throw new Error(`source must be one of: ${SOURCES.join(', ')}`)
    }
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 100), 1), 500)
    // A person's history is small; read it newest first and filter.
    const rows = await ctx.db
      .query('crmActivities')
      .withIndex('by_contactId_and_occurredAt', (q) =>
        q.eq('contactId', contact._id),
      )
      .order('desc')
      .take(2000)
    return rows
      .filter(
        (a) =>
          (!args.kind || a.kind === args.kind) &&
          (!args.source || a.source === args.source),
      )
      .slice(0, limit)
  },
})

export const getActivity = internalQuery({
  args: { userId: v.string(), orgSlug: v.string(), id: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    const id = ctx.db.normalizeId('crmActivities', args.id)
    const doc = id ? await ctx.db.get('crmActivities', id) : null
    return doc && doc.orgId === org._id ? doc : null
  },
})

function parseTime(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const t = Date.parse(raw)
    if (!Number.isNaN(t)) return t
  }
  throw new Error(
    'occurredAt must be a timestamp in ms or an ISO date (e.g. 2026-05-01)',
  )
}

export const createActivity = internalMutation({
  args: { userId: v.string(), orgSlug: v.string(), fields: v.any() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    const f = (
      args.fields && typeof args.fields === 'object' ? args.fields : {}
    ) as Record<string, unknown>
    const unknown = Object.keys(f).filter((k) => !ACTIVITY_FIELDS.has(k))
    if (unknown.length > 0) {
      throw new Error(
        `Unknown field(s) for crm_activities: ${unknown.join(', ')}. ` +
          `Valid fields: ${[...ACTIVITY_FIELDS].join(', ')}`,
      )
    }
    const contact = await contactInOrg(
      ctx,
      org._id,
      typeof f.contactId === 'string' ? f.contactId : undefined,
    )
    const kind = (f.kind ?? 'note') as ManualKind
    if (!MANUAL_KINDS.includes(kind)) {
      throw new Error(`kind must be one of: ${MANUAL_KINDS.join(', ')}`)
    }
    const title = typeof f.title === 'string' ? f.title.trim() : ''
    if (!title) throw new Error('title is required (the note text)')
    if (f.status !== undefined && typeof f.status !== 'string') {
      throw new Error('status must be a string')
    }
    const now = Date.now()
    const id = await ctx.db.insert('crmActivities', {
      orgId: org._id,
      contactId: contact._id,
      kind,
      title,
      occurredAt: f.occurredAt === undefined ? now : parseTime(f.occurredAt),
      status: (f.status as string | undefined)?.trim() || undefined,
      source: 'manual',
      createdAt: now,
    })
    return { id, resource: 'crm_activities', created: true }
  },
})

export const deleteActivity = internalMutation({
  args: { userId: v.string(), orgSlug: v.string(), id: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    const id = ctx.db.normalizeId('crmActivities', args.id)
    const doc = id ? await ctx.db.get('crmActivities', id) : null
    if (!id || !doc || doc.orgId !== org._id) {
      throw new Error('Activity not found')
    }
    if (doc.source !== 'manual') {
      throw new Error(
        `Only manual history can be deleted here; this one comes from ${doc.source} ` +
          'and would come back on the next sync or import.',
      )
    }
    await ctx.db.delete('crmActivities', id)
    return { id, resource: 'crm_activities', deleted: true, title: doc.title }
  },
})

// ── crm_duplicates / crm_merge_contacts ──────────────────────────────────

export const duplicates = internalQuery({
  args: { userId: v.string(), orgSlug: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    const groups = await duplicateGroups(ctx, org._id)
    const byReason: Record<string, number> = {}
    for (const g of groups) {
      for (const r of g.reasons) byReason[r] = (byReason[r] ?? 0) + 1
    }
    return {
      summary: {
        groups: groups.length,
        contacts: groups.reduce((n, g) => n + g.ids.length, 0),
        blocked: groups.filter((g) => g.blocked).length,
        byReason,
      },
      groups,
    }
  },
})

export const mergeContacts = internalMutation({
  args: {
    userId: v.string(),
    orgSlug: v.string(),
    keepId: v.string(),
    mergeIds: v.array(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    return await mergeContactsInOrg(ctx, org._id, args.keepId, args.mergeIds)
  },
})

// ── event_attendance ─────────────────────────────────────────────────────

// Most people read for one event, from each source.
const ATTENDANCE_CAP = 2000

export type Attendee = {
  contactId: Id<'crmContacts'> | null
  name: string | null
  email: string
  status: string
  checkedIn: boolean
  checkedInAt: number | null
  checkInSource: 'luma' | 'astn' | null
  source: 'luma' | 'astn' | 'both'
  astnStatus: string | null
}

/**
 * One person's attendance from the Luma history row (if any) and the linked
 * ASTN event's guest row. A check-in on either side counts; the ASTN door
 * page's timestamp and source win when it has one, and the status comes from
 * the merged result, so an unchecked ASTN row never hides a Luma check-in.
 * `contact` is used only when there is no Luma row.
 */
export function mergeGuest(
  luma: Attendee | undefined,
  g: Pick<
    Doc<'socialEventGuests'>,
    'email' | 'name' | 'status' | 'checkedInAt' | 'checkInSource'
  >,
  contact: Pick<Doc<'crmContacts'>, '_id' | 'name'> | null,
): Attendee {
  const astnCheckedIn = g.checkedInAt !== undefined
  const checkedIn = astnCheckedIn || (luma?.checkedIn ?? false)
  const astnStatus = g.status === 'pending_approval' ? 'pending' : g.status
  return {
    contactId: luma ? luma.contactId : (contact?._id ?? null),
    name: luma?.name ?? contact?.name ?? g.name ?? null,
    email: g.email,
    status: checkedIn ? 'checked_in' : astnStatus,
    checkedIn,
    checkedInAt: astnCheckedIn
      ? (g.checkedInAt ?? null)
      : (luma?.checkedInAt ?? null),
    checkInSource: astnCheckedIn
      ? (g.checkInSource ?? 'luma')
      : checkedIn
        ? (luma?.checkInSource ?? 'luma')
        : null,
    source: luma ? 'both' : 'astn',
    astnStatus: g.status,
  }
}

export const eventAttendance = internalQuery({
  args: {
    userId: v.string(),
    orgSlug: v.string(),
    eventId: v.optional(v.string()),
    lumaEventId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const org = await resolveOrgForAdmin(ctx, args.userId, args.orgSlug)
    const orgId = org._id

    let event: Doc<'events'> | null = null
    if (args.eventId) {
      const id = ctx.db.normalizeId('events', args.eventId)
      const doc = id ? await ctx.db.get('events', id) : null
      if (!doc || doc.orgId !== orgId) throw new Error('Event not found')
      event = doc
    } else if (args.lumaEventId) {
      event = await ctx.db
        .query('events')
        .withIndex('by_orgId_and_lumaEventId', (q) =>
          q.eq('orgId', orgId).eq('lumaEventId', args.lumaEventId as string),
        )
        .first()
    } else {
      throw new Error('Pass eventId (events _id) or lumaEventId')
    }
    const lumaEventId = event?.lumaEventId ?? args.lumaEventId!

    // An ASTN-managed event linked to the same Luma event, if any.
    const socialEvents = await ctx.db
      .query('socialEvents')
      .withIndex('by_lumaEventId', (q) => q.eq('lumaEventId', lumaEventId))
      .take(10)
    const socialEvent = socialEvents.find((e) => e.orgId === orgId) ?? null
    if (!event && !socialEvent) {
      throw new Error(`No event with lumaEventId ${lumaEventId} in this org`)
    }

    const people = new Map<string, Attendee>()
    const contacts = new Map<Id<'crmContacts'>, Doc<'crmContacts'> | null>()
    let truncated = false

    // Luma history rows: externalId `luma:{lumaEventId}:{email}`.
    const prefix = attendanceExternalId(lumaEventId, '')
    const rows = await ctx.db
      .query('crmActivities')
      .withIndex('by_orgId_and_externalId', (q) =>
        q
          .eq('orgId', orgId)
          .gt('externalId', prefix)
          .lt('externalId', `${prefix.slice(0, -1)};`),
      )
      .take(ATTENDANCE_CAP + 1)
    if (rows.length > ATTENDANCE_CAP) {
      truncated = true
      rows.pop()
    }
    for (const row of rows) {
      if (row.source !== 'luma' || !row.externalId) continue
      const email = row.externalId.slice(prefix.length)
      let contact = contacts.get(row.contactId)
      if (contact === undefined) {
        contact = await ctx.db.get('crmContacts', row.contactId)
        contacts.set(row.contactId, contact)
      }
      const checkedInAt =
        typeof row.data?.checkedInAt === 'number' ? row.data.checkedInAt : null
      const status = row.status ?? 'unknown'
      people.set(email, {
        contactId: contact ? contact._id : null,
        name: contact?.name ?? null,
        email,
        status,
        checkedIn: status === 'checked_in',
        checkedInAt,
        checkInSource: status === 'checked_in' ? 'luma' : null,
        source: 'luma',
        astnStatus: null,
      })
    }

    // Merge the linked ASTN event's guests: ASTN door check-ins never reach
    // Luma, and ASTN statuses are the current ones for guests it manages.
    if (socialEvent) {
      const guests = await ctx.db
        .query('socialEventGuests')
        .withIndex('by_eventId_and_email', (q) =>
          q.eq('eventId', socialEvent._id),
        )
        .take(ATTENDANCE_CAP + 1)
      if (guests.length > ATTENDANCE_CAP) {
        truncated = true
        guests.pop()
      }
      // Guests not in the Luma history are matched to contacts by any of
      // their emails, with one map built for the whole call.
      let byEmail: Map<string, Doc<'crmContacts'>> | null = null
      for (const g of guests) {
        const luma = people.get(g.email)
        let contact: Doc<'crmContacts'> | null = null
        if (!luma) {
          byEmail ??= await contactsByEmail(ctx, orgId)
          contact = byEmail.get(g.email) ?? null
        }
        people.set(g.email, mergeGuest(luma, g, contact))
      }
    }

    const attendees = [...people.values()].sort(
      (a, b) =>
        Number(b.checkedIn) - Number(a.checkedIn) ||
        a.status.localeCompare(b.status) ||
        (a.name ?? a.email).localeCompare(b.name ?? b.email),
    )
    const byStatus: Record<string, number> = {}
    for (const p of attendees)
      byStatus[p.status] = (byStatus[p.status] ?? 0) + 1

    return {
      event: event
        ? {
            _id: event._id,
            lumaEventId: event.lumaEventId,
            title: event.title,
            startAt: event.startAt,
            startAtIso: new Date(event.startAt).toISOString(),
            endAt: event.endAt ?? null,
            timezone: event.timezone,
            url: event.url,
            location: event.location ?? null,
            visibility: event.visibility ?? null,
            canceled: event.canceled ?? false,
            lumaCounts: {
              guestCount: event.guestCount ?? null,
              approvedCount: event.approvedCount ?? null,
              pendingCount: event.pendingCount ?? null,
              checkedInCount: event.checkedInCount ?? null,
              lastGuestSyncAt: event.lastGuestSyncAt ?? null,
            },
          }
        : null,
      socialEvent: socialEvent
        ? {
            _id: socialEvent._id,
            title: socialEvent.title,
            slug: socialEvent.slug,
            status: socialEvent.status,
          }
        : null,
      summary: {
        people: attendees.length,
        checkedIn: attendees.filter((p) => p.checkedIn).length,
        approvedOrCheckedIn: attendees.filter(
          (p) => p.status === 'approved' || p.status === 'checked_in',
        ).length,
        byStatus,
        withContact: attendees.filter((p) => p.contactId).length,
        ...(truncated
          ? { truncated: `Read at most ${ATTENDANCE_CAP} rows per source` }
          : {}),
      },
      attendees,
    }
  },
})
