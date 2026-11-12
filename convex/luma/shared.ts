import { v } from 'convex/values'
import { LumaApiError } from '../social/luma'
import type { Infer } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { LumaEvent, LumaGuest } from '../social/luma'

/**
 * Helpers shared by the Luma mirror (docs/crm-consolidation.md, phase 4):
 * every calendar event is copied into `events`, and every guest of every
 * event becomes a `crmActivities` row on their CRM contact.
 */

/**
 * An event as a Luma source (calendar listing, /v1/events/get, webhook)
 * reported it, in the shape of an `events` row. In the fields that take
 * null, null means the source reported the field empty, so the mirror
 * removes it; a missing key means the source said nothing about it, so the
 * mirror keeps what it has.
 */
export const mirroredEventValidator = v.object({
  lumaEventId: v.string(),
  title: v.string(),
  // Only from /v1/events/get and webhooks; the list endpoint has none.
  description: v.optional(v.union(v.string(), v.null())),
  startAt: v.number(),
  endAt: v.optional(v.union(v.number(), v.null())),
  timezone: v.string(),
  coverUrl: v.optional(v.union(v.string(), v.null())),
  url: v.string(),
  location: v.optional(v.union(v.string(), v.null())),
  isVirtual: v.boolean(),
  visibility: v.string(),
  lumaAccess: v.string(),
  requireApproval: v.optional(v.boolean()),
  maxCapacity: v.optional(v.union(v.number(), v.null())),
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

/**
 * A field of a Luma payload as the mirror takes it: undefined when the
 * payload has no such key (not reported), null when the key is there with
 * no value (reported empty), else the value.
 */
function reported<T>(raw: unknown, value: T | undefined): T | null | undefined {
  if (raw === undefined) return undefined
  return value ?? null
}

/**
 * `listed`: the payload is an entry of the calendar listing, which carries
 * no descriptions, so it never reports one as empty.
 */
export function mirrorFromLuma(
  e: LumaEvent,
  options: { listed?: boolean } = {},
): MirroredEvent {
  const endAt = e.end_at ? Date.parse(e.end_at) : NaN
  const geo = e.geo_address_json
  const location = geo?.full_address || geo?.address || geo?.city || undefined
  const description = e.description_md?.trim() || undefined
  return {
    lumaEventId: e.id,
    title: e.name,
    description: options.listed
      ? description
      : reported(e.description_md, description),
    startAt: Date.parse(e.start_at),
    endAt: reported(e.end_at, Number.isNaN(endAt) ? undefined : endAt),
    timezone: e.timezone,
    coverUrl: reported(e.cover_url, e.cover_url || undefined),
    url: lumaEventUrl(e.url),
    location: reported(geo, location),
    isVirtual:
      ONLINE_LOCATIONS.has(e.location_type ?? '') ||
      (!location && !!e.meeting_url),
    visibility:
      e.platform === 'external' ? 'public' : (e.visibility ?? 'public'),
    lumaAccess: e.access ?? 'manage',
    requireApproval: e.require_approval,
    maxCapacity: reported(e.max_capacity, e.max_capacity ?? undefined),
  }
}

/** The fields of a new mirror row: what the source reported with a value. */
export function newMirrorFields(event: MirroredEvent) {
  return {
    ...event,
    description: event.description ?? undefined,
    endAt: event.endAt ?? undefined,
    coverUrl: event.coverUrl ?? undefined,
    location: event.location ?? undefined,
    maxCapacity: event.maxCapacity ?? undefined,
  }
}

/**
 * The patch that brings a mirror row in line with what the source reported:
 * a value that differs is set, a field reported empty is removed (its patch
 * value is undefined), and a field the source didn't report is left alone.
 * Empty when the row already matches.
 */
export function mirrorChanges(
  existing: Pick<Doc<'events'>, keyof MirroredEvent>,
  event: MirroredEvent,
): Partial<Pick<Doc<'events'>, keyof MirroredEvent>> {
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(event)) {
    if (value === undefined) continue
    const current = existing[key as keyof MirroredEvent]
    if (value === null) {
      if (current !== undefined) patch[key] = undefined
    } else if (current !== value) {
      patch[key] = value
    }
  }
  return patch
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

/**
 * What a failed read of an event's guest list means for its guest sync:
 * - 'rate_limited': Luma answered 429. The chain waits and reads it again.
 * - 'transient': Luma answered 5xx, or there was no answer (network). The
 *   event stays flagged and the next chain reads it again.
 * - 'permanent': Luma refused (another 4xx, e.g. 404 for an event it no
 *   longer has) or this client did (status 0, e.g. a list too long to
 *   read). Reading again would fail the same way, so the flag is cleared.
 */
export function guestReadFailure(
  error: unknown,
): 'rate_limited' | 'transient' | 'permanent' {
  if (!(error instanceof LumaApiError)) return 'transient'
  if (error.status === 429) return 'rate_limited'
  return error.status >= 500 ? 'transient' : 'permanent'
}

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

// Best first: the status that counts when one person has two rows for one
// event (registered with two emails, then merged into one contact).
const STATUS_RANK: Record<string, number> = {
  checked_in: 5,
  approved: 4,
  pending: 3,
  waitlist: 2,
  declined: 1,
}

/** The better of two attendance statuses (checked_in > approved > …). */
export function bestStatus(
  a: string | undefined,
  b: string | undefined,
): string | undefined {
  return (STATUS_RANK[b ?? ''] ?? 0) > (STATUS_RANK[a ?? ''] ?? 0) ? b : a
}

type LumaRow = {
  source: string
  kind: string
  status?: string
  externalId?: string
  data?: Record<string, unknown>
}

/** The Luma event id of a Luma history row, or null for other rows. */
export function lumaEventOf(row: LumaRow): string | null {
  if (row.source !== 'luma' || row.kind !== 'event') return null
  const fromData = row.data?.lumaEventId
  if (typeof fromData === 'string' && fromData) return fromData
  return row.externalId?.split(':')[1] || null
}

/**
 * A Luma history row's status as the CRM counts and shows it. A
 * registration for a canceled event is 'canceled': there was nothing to
 * attend. A check-in stays a check-in, because the mirror also marks as
 * canceled an event that was deleted from the calendar after it took place.
 * The stored status is never rewritten, so an event that comes back counts
 * again as it did.
 */
export function attendanceStatusShown(
  status: string | undefined,
  eventCanceled: boolean,
): string | undefined {
  return eventCanceled && status !== 'checked_in' ? 'canceled' : status
}

/**
 * Events a person was approved for (checked in included) and checked in
 * to, counting each Luma event once with its best status: a merged contact
 * can hold one row per email it registered with, and the sync keeps both.
 * Rows of the events in `canceledEventIds` count as attendanceStatusShown
 * says.
 */
export function countLumaAttendance(
  rows: Array<LumaRow>,
  canceledEventIds: ReadonlySet<string> = new Set(),
): {
  approved: number
  checkedIn: number
} {
  const byEvent = new Map<string, string | undefined>()
  for (const row of rows) {
    const event = lumaEventOf(row)
    if (!event) continue
    const status = attendanceStatusShown(
      row.status,
      canceledEventIds.has(event),
    )
    byEvent.set(event, bestStatus(byEvent.get(event), status))
  }
  let approved = 0
  let checkedIn = 0
  for (const status of byEvent.values()) {
    if (status === 'approved' || status === 'checked_in') approved++
    if (status === 'checked_in') checkedIn++
  }
  return { approved, checkedIn }
}

/**
 * Which of these Luma events the org's mirror has as canceled. `known`
 * holds answers already read for this org, so a caller that asks for many
 * contacts in one function reads each event once.
 */
export async function canceledLumaEvents(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
  lumaEventIds: Iterable<string>,
  known: Map<string, boolean> = new Map(),
): Promise<Set<string>> {
  const canceled = new Set<string>()
  for (const lumaEventId of lumaEventIds) {
    let isCanceled = known.get(lumaEventId)
    if (isCanceled === undefined) {
      const row = await ctx.db
        .query('events')
        .withIndex('by_orgId_and_lumaEventId', (q) =>
          q.eq('orgId', orgId).eq('lumaEventId', lumaEventId),
        )
        .first()
      isCanceled = row?.canceled === true
      known.set(lumaEventId, isCanceled)
    }
    if (isCanceled) canceled.add(lumaEventId)
  }
  return canceled
}

/**
 * Recompute a contact's lumaApproved / lumaCheckedIn fields from its Luma
 * event history. Approved includes checked in. `knownCanceled` is
 * canceledLumaEvents' `known`, for callers that recompute many contacts of
 * one org.
 */
export async function recomputeLumaCounts(
  ctx: MutationCtx,
  contactId: Id<'crmContacts'>,
  knownCanceled?: Map<string, boolean>,
): Promise<void> {
  const contact = await ctx.db.get('crmContacts', contactId)
  if (!contact) return
  // A person's whole history; far below this in practice.
  const activities = await ctx.db
    .query('crmActivities')
    .withIndex('by_contactId_and_occurredAt', (q) =>
      q.eq('contactId', contactId),
    )
    .take(5000)
  const lumaEventIds = new Set<string>()
  for (const activity of activities) {
    const lumaEventId = lumaEventOf(activity)
    if (lumaEventId) lumaEventIds.add(lumaEventId)
  }
  const canceled = await canceledLumaEvents(
    ctx,
    contact.orgId,
    lumaEventIds,
    knownCanceled,
  )
  const { approved, checkedIn } = countLumaAttendance(activities, canceled)
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
