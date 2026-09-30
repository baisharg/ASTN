import { v } from 'convex/values'
import type { Infer } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import type { LumaEvent, LumaGuest } from '../social/luma'

/**
 * Helpers shared by the Luma mirror (docs/crm-consolidation.md, phase 4):
 * every calendar event is copied into `events`, and every guest of every
 * event becomes a `crmActivities` row on their CRM contact.
 */

/** An event as stored in `events`, from the official API. */
export const mirroredEventValidator = v.object({
  lumaEventId: v.string(),
  title: v.string(),
  // Only from /v1/events/get and webhooks; the list endpoint has none.
  description: v.optional(v.string()),
  startAt: v.number(),
  endAt: v.optional(v.number()),
  timezone: v.string(),
  coverUrl: v.optional(v.string()),
  url: v.string(),
  location: v.optional(v.string()),
  isVirtual: v.boolean(),
  visibility: v.string(),
  lumaAccess: v.string(),
  requireApproval: v.optional(v.boolean()),
  maxCapacity: v.optional(v.number()),
})
export type MirroredEvent = Infer<typeof mirroredEventValidator>

const ONLINE_LOCATIONS = new Set([
  'discord',
  'meet',
  'twitch',
  'twitter',
  'youtube',
  'zoom',
])

/** Luma's event URL, full. Older rows stored only the slug. */
export function lumaEventUrl(url: string): string {
  return /^https?:\/\//.test(url) ? url : `https://luma.com/${url}`
}

export function mirrorFromLuma(e: LumaEvent): MirroredEvent {
  const endAt = e.end_at ? Date.parse(e.end_at) : NaN
  const geo = e.geo_address_json
  const location = geo?.full_address || geo?.address || geo?.city || undefined
  return {
    lumaEventId: e.id,
    title: e.name,
    description: e.description_md?.trim() || undefined,
    startAt: Date.parse(e.start_at),
    endAt: Number.isNaN(endAt) ? undefined : endAt,
    timezone: e.timezone,
    coverUrl: e.cover_url || undefined,
    url: lumaEventUrl(e.url),
    location,
    isVirtual:
      ONLINE_LOCATIONS.has(e.location_type ?? '') ||
      (!location && !!e.meeting_url),
    visibility:
      e.platform === 'external' ? 'public' : (e.visibility ?? 'public'),
    lumaAccess: e.access ?? 'manage',
    requireApproval: e.require_approval,
    maxCapacity: e.max_capacity ?? undefined,
  }
}

/** When an event is over, for sync purposes. */
export function eventEnd(event: { startAt: number; endAt?: number }): number {
  return event.endAt ?? event.startAt + 3 * 3600 * 1000
}

/**
 * Guest lists keep changing until a little after the event (late check-ins,
 * no-show cleanups). A sync after this point is final.
 */
export const GUEST_LIST_SETTLES_AFTER_MS = 2 * 24 * 3600 * 1000

// ── Attendance ──────────────────────────────────────────────────────────

export type AttendanceStatus =
  | 'approved'
  | 'checked_in'
  | 'pending'
  | 'declined'
  | 'waitlist'

/** A guest as the attendance sync needs it. */
export const attendanceGuestValidator = v.object({
  email: v.string(), // lowercased
  name: v.string(),
  lumaGuestId: v.string(),
  status: v.union(
    v.literal('approved'),
    v.literal('checked_in'),
    v.literal('pending'),
    v.literal('declined'),
    v.literal('waitlist'),
  ),
  registeredAt: v.optional(v.number()),
  checkedInAt: v.optional(v.number()),
})
export type AttendanceGuest = Infer<typeof attendanceGuestValidator>

/**
 * A Luma guest as a history row, or null for people who were only invited
 * and never registered.
 */
export function attendanceFromLuma(
  guest: LumaGuest,
  checkedInAt: number | undefined,
): AttendanceGuest | null {
  let status: AttendanceStatus
  switch (guest.approval_status) {
    case 'approved':
    case 'session':
      status = 'approved'
      break
    case 'pending_approval':
      status = 'pending'
      break
    case 'declined':
      status = 'declined'
      break
    case 'waitlist':
      status = 'waitlist'
      break
    default:
      return null // invited
  }
  if (checkedInAt !== undefined) status = 'checked_in'
  const email = guest.user_email?.trim().toLowerCase()
  if (!email) return null
  const name =
    guest.user_name?.trim() ||
    [guest.user_first_name, guest.user_last_name]
      .filter(Boolean)
      .join(' ')
      .trim() ||
    email.split('@')[0]
  const registeredAt = guest.registered_at
    ? Date.parse(guest.registered_at)
    : NaN
  return {
    email,
    name,
    lumaGuestId: guest.id,
    status,
    registeredAt: Number.isNaN(registeredAt) ? undefined : registeredAt,
    checkedInAt,
  }
}

export function attendanceExternalId(lumaEventId: string, email: string) {
  return `luma:${lumaEventId}:${email}`
}

/**
 * Recompute a contact's lumaApproved / lumaCheckedIn fields from its Luma
 * event history. Approved includes checked in.
 */
export async function recomputeLumaCounts(
  ctx: MutationCtx,
  contactId: Id<'crmContacts'>,
): Promise<void> {
  const contact = await ctx.db.get('crmContacts', contactId)
  if (!contact) return
  let approved = 0
  let checkedIn = 0
  // A person's whole history; far below this in practice.
  const activities = await ctx.db
    .query('crmActivities')
    .withIndex('by_contactId_and_occurredAt', (q) =>
      q.eq('contactId', contactId),
    )
    .take(5000)
  for (const a of activities) {
    if (a.source !== 'luma' || a.kind !== 'event') continue
    if (a.status === 'approved' || a.status === 'checked_in') approved++
    if (a.status === 'checked_in') checkedIn++
  }
  const fields = contact.fields ?? {}
  if (fields.lumaApproved === approved && fields.lumaCheckedIn === checkedIn) {
    return
  }
  await ctx.db.patch('crmContacts', contactId, {
    fields: { ...fields, lumaApproved: approved, lumaCheckedIn: checkedIn },
    updatedAt: Date.now(),
  })
}

/**
 * Point a person's history row for a Luma event at a new status (used by
 * the ASTN door check-in, which Luma never hears about).
 */
export async function setAttendanceStatus(
  ctx: MutationCtx,
  args: {
    orgId: Id<'organizations'>
    lumaEventId: string
    email: string
    status: AttendanceStatus
  },
): Promise<void> {
  const activity = await ctx.db
    .query('crmActivities')
    .withIndex('by_orgId_and_externalId', (q) =>
      q
        .eq('orgId', args.orgId)
        .eq('externalId', attendanceExternalId(args.lumaEventId, args.email)),
    )
    .first()
  if (!activity || activity.status === args.status) return
  await ctx.db.patch('crmActivities', activity._id, { status: args.status })
  await recomputeLumaCounts(ctx, activity.contactId)
}

export type SyncTotals = Doc<'lumaSyncState'>['totals']

export const EMPTY_TOTALS: SyncTotals = {
  eventsUpserted: 0,
  eventsGuestSynced: 0,
  guestsProcessed: 0,
  contactsCreated: 0,
  activitiesInserted: 0,
  activitiesUpdated: 0,
  activitiesDeleted: 0,
}

export const syncTotalsValidator = v.object({
  eventsUpserted: v.number(),
  eventsGuestSynced: v.number(),
  guestsProcessed: v.number(),
  contactsCreated: v.number(),
  activitiesInserted: v.number(),
  activitiesUpdated: v.number(),
  activitiesDeleted: v.optional(v.number()),
})
