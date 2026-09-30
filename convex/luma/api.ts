import { ConvexError, v } from 'convex/values'
import { internal } from '../_generated/api'
import { action, internalAction } from '../_generated/server'
import { DEFAULT_EVENT_HOURS } from '../social/constants'
import {
  LumaApiError,
  createLumaBlast,
  createLumaEvent,
  getLumaEvent,
  hasLumaApiKey,
  listAllLumaGuests,
  listLumaBlasts,
  lumaCheckedInAt,
  setLumaRequireApproval,
  updateLumaEvent,
} from '../social/luma'
import { assertOrgOwnsApiCalendar } from './binding'
import { mirrorFromLuma } from './shared'
import type { ActionCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import type { LumaEventInput, LumaVisibility } from '../social/luma'

/**
 * Admin actions that talk to Luma: read an event's guests, create and edit
 * events, and email guests (blasts). Every one checks the caller is an org
 * admin and that the event is on the org's calendar.
 */

const visibilityValidator = v.union(
  v.literal('public'),
  v.literal('members-only'),
  v.literal('private'),
)

function requireKey() {
  if (!hasLumaApiKey()) {
    throw new ConvexError('Luma no está conectado (falta LUMA_API_KEY)')
  }
}

/** Luma's message for a failed call, as a user-facing error. */
function asUserError(error: unknown): never {
  if (error instanceof ConvexError) throw error
  if (error instanceof LumaApiError) {
    if (error.status === 429) {
      throw new ConvexError(
        'Luma está limitando los pedidos. Probá de nuevo en un minuto.',
      )
    }
    throw new ConvexError(`Luma respondió con un error: ${error.message}`)
  }
  throw error
}

/** Admin of the org, the org owns the key's calendar, event is on it. */
async function requireEvent(
  ctx: ActionCtx,
  orgId: Id<'organizations'>,
  lumaEventId: string,
  needsManage = true,
) {
  const event = await ctx.runQuery(internal.luma.admin.requireCalendarEvent, {
    orgId,
    lumaEventId,
    needsManage,
  })
  await assertOrgOwnsApiCalendar(ctx, orgId)
  return event
}

/** Read the event back from Luma and update the mirror row. */
async function refreshMirror(
  ctx: ActionCtx,
  orgId: Id<'organizations'>,
  lumaEventId: string,
): Promise<void> {
  const event = await getLumaEvent(lumaEventId)
  const mirrored = mirrorFromLuma({ ...event, access: 'manage' })
  await ctx.runMutation(internal.luma.mirror.applyWebhookEvent, {
    calendarId: event.calendar_id ?? null,
    event: mirrored,
    canceled: false,
    orgId,
  })
}

// ── Guests ──────────────────────────────────────────────────────────────

const guestStatusValidator = v.union(
  v.literal('approved'),
  v.literal('pending_approval'),
  v.literal('declined'),
  v.literal('waitlist'),
  v.literal('invited'),
)

/** An event's guest list, live from Luma (read-only). */
export const listGuests = action({
  args: { orgId: v.id('organizations'), lumaEventId: v.string() },
  returns: v.array(
    v.object({
      name: v.string(),
      email: v.string(),
      status: guestStatusValidator,
      checkedInAt: v.union(v.number(), v.null()),
      registeredAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx, { orgId, lumaEventId }) => {
    requireKey()
    await requireEvent(ctx, orgId, lumaEventId)
    try {
      const guests = await listAllLumaGuests(lumaEventId)
      return guests.map((g) => {
        const registered = g.registered_at ? Date.parse(g.registered_at) : NaN
        return {
          name:
            g.user_name?.trim() ||
            [g.user_first_name, g.user_last_name]
              .filter(Boolean)
              .join(' ')
              .trim() ||
            g.user_email,
          email: g.user_email.toLowerCase(),
          status:
            g.approval_status === 'session' ? 'approved' : g.approval_status,
          checkedInAt: lumaCheckedInAt(g) ?? null,
          registeredAt: Number.isNaN(registered) ? null : registered,
        }
      })
    } catch (error) {
      asUserError(error)
    }
  },
})

// ── Create and edit ─────────────────────────────────────────────────────

const editableValidator = v.object({
  name: v.string(),
  startAt: v.number(),
  endAt: v.number(),
  timezone: v.string(),
  descriptionMd: v.string(),
  address: v.string(),
  visibility: visibilityValidator,
  maxCapacity: v.union(v.number(), v.null()),
  requireApproval: v.boolean(),
})

/** The event's editable settings, live from Luma. */
export const getEventForEdit = action({
  args: { orgId: v.id('organizations'), lumaEventId: v.string() },
  returns: editableValidator.extend({ url: v.string() }),
  handler: async (ctx, { orgId, lumaEventId }) => {
    requireKey()
    await requireEvent(ctx, orgId, lumaEventId)
    try {
      const e = await getLumaEvent(lumaEventId)
      const startAt = Date.parse(e.start_at)
      const endAt = e.end_at ? Date.parse(e.end_at) : NaN
      return {
        name: e.name,
        startAt,
        endAt: Number.isNaN(endAt) ? startAt + 2 * 3600 * 1000 : endAt,
        timezone: e.timezone,
        descriptionMd: e.description_md ?? '',
        address:
          e.geo_address_json?.full_address || e.geo_address_json?.address || '',
        visibility: e.visibility ?? 'public',
        maxCapacity: e.max_capacity ?? null,
        requireApproval: e.require_approval ?? false,
        url: e.url,
      }
    } catch (error) {
      asUserError(error)
    }
  },
})

function validateTimes(startAt: number, endAt: number) {
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) {
    throw new ConvexError('Invalid date')
  }
  if (endAt <= startAt) {
    throw new ConvexError('The event must end after it starts')
  }
}

function validateTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    throw new ConvexError(`Unknown timezone: ${timezone}`)
  }
}

/** Create an event on the org's Luma calendar. It shows up here right away. */
export const createEvent = action({
  args: { orgId: v.id('organizations'), ...editableValidator.fields },
  returns: v.object({ lumaEventId: v.string(), url: v.string() }),
  handler: async (ctx, args) => {
    requireKey()
    await ctx.runQuery(internal.luma.admin.assertOrgAdmin, {
      orgId: args.orgId,
    })
    await assertOrgOwnsApiCalendar(ctx, args.orgId)
    const name = args.name.trim()
    if (!name) throw new ConvexError('The event needs a name')
    validateTimes(args.startAt, args.endAt)
    validateTimezone(args.timezone)
    if (args.maxCapacity !== null && args.maxCapacity < 1) {
      throw new ConvexError('Capacity must be at least 1')
    }
    try {
      const lumaEventId = await createLumaEvent({
        name,
        start_at: new Date(args.startAt).toISOString(),
        end_at: new Date(args.endAt).toISOString(),
        timezone: args.timezone,
        description_md: args.descriptionMd.trim() || undefined,
        geo_address_json: args.address.trim()
          ? { type: 'manual', address: args.address.trim() }
          : undefined,
        visibility: args.visibility,
        max_capacity: args.maxCapacity,
        requireApproval: args.requireApproval,
      })
      const event = await getLumaEvent(lumaEventId)
      await ctx.runMutation(internal.luma.mirror.applyWebhookEvent, {
        calendarId: event.calendar_id ?? null,
        event: mirrorFromLuma({ ...event, access: 'manage' }),
        canceled: false,
        orgId: args.orgId,
      })
      return { lumaEventId, url: event.url }
    } catch (error) {
      asUserError(error)
    }
  },
})

/**
 * Change an event's settings on Luma. Only the fields passed change. Luma
 * emails guests about a new name, time or place unless `suppressEmail`.
 */
export const updateEvent = action({
  args: {
    orgId: v.id('organizations'),
    lumaEventId: v.string(),
    name: v.optional(v.string()),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
    timezone: v.optional(v.string()),
    descriptionMd: v.optional(v.string()),
    address: v.optional(v.string()),
    visibility: v.optional(visibilityValidator),
    maxCapacity: v.optional(v.union(v.number(), v.null())),
    requireApproval: v.optional(v.boolean()),
    suppressEmail: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireKey()
    const { socialEventId } = await requireEvent(
      ctx,
      args.orgId,
      args.lumaEventId,
    )
    const touchesDetails = [
      args.name,
      args.startAt,
      args.endAt,
      args.timezone,
      args.descriptionMd,
      args.address,
    ].some((x) => x !== undefined)
    if (socialEventId && touchesDetails) {
      throw new ConvexError(
        'This event is managed in ASTN; edit its details from its ASTN page and they go to Luma',
      )
    }
    const body: LumaEventInput & { suppress_email?: boolean } = {
      suppress_email: args.suppressEmail,
    }
    if (args.name !== undefined) {
      const name = args.name.trim()
      if (!name) throw new ConvexError('The event needs a name')
      body.name = name
    }
    if (args.startAt !== undefined || args.endAt !== undefined) {
      if (args.startAt === undefined || args.endAt === undefined) {
        throw new ConvexError('Send both start and end')
      }
      validateTimes(args.startAt, args.endAt)
      body.start_at = new Date(args.startAt).toISOString()
      body.end_at = new Date(args.endAt).toISOString()
    }
    if (args.timezone !== undefined) {
      validateTimezone(args.timezone)
      body.timezone = args.timezone
    }
    if (args.descriptionMd !== undefined) {
      body.description_md = args.descriptionMd.trim()
    }
    // Luma's API has no way to clear an address; the form says so.
    if (args.address !== undefined && args.address.trim()) {
      body.geo_address_json = { type: 'manual', address: args.address.trim() }
    }
    if (args.visibility !== undefined) {
      body.visibility = args.visibility as LumaVisibility
    }
    if (args.maxCapacity !== undefined) {
      if (args.maxCapacity !== null && args.maxCapacity < 1) {
        throw new ConvexError('Capacity must be at least 1')
      }
      body.max_capacity = args.maxCapacity
    }
    try {
      if (Object.keys(body).length > 1) {
        await updateLumaEvent(args.lumaEventId, body)
      }
      if (args.requireApproval !== undefined) {
        await setLumaRequireApproval(args.lumaEventId, args.requireApproval)
      }
      await refreshMirror(ctx, args.orgId, args.lumaEventId)
    } catch (error) {
      asUserError(error)
    }
    return null
  },
})

const lumaFieldValidator = v.union(
  v.literal('name'),
  v.literal('description'),
  v.literal('time'),
  v.literal('address'),
)

/**
 * After an ASTN event linked to Luma changes, send the changed details to
 * Luma (scheduled by social/events.updateEvent).
 */
export const pushSocialEventToLuma = internalAction({
  args: {
    eventId: v.id('socialEvents'),
    fields: v.array(lumaFieldValidator),
  },
  returns: v.null(),
  handler: async (ctx, { eventId, fields }) => {
    const event = await ctx.runQuery(
      internal.luma.admin.getSocialEventForPush,
      { eventId },
    )
    if (!event || !hasLumaApiKey() || fields.length === 0) return null
    const body: LumaEventInput = {}
    if (fields.includes('name')) body.name = event.title
    // An emptied description clears it in Luma too.
    if (fields.includes('description')) {
      body.description_md = event.description ?? ''
    }
    if (fields.includes('time')) {
      body.start_at = new Date(event.startAt).toISOString()
      body.end_at = new Date(
        event.endAt ?? event.startAt + DEFAULT_EVENT_HOURS * 3600 * 1000,
      ).toISOString()
      body.timezone = event.timezone
    }
    if (fields.includes('address') && event.venueAddress) {
      body.geo_address_json = { type: 'manual', address: event.venueAddress }
    }
    // Luma's API can't clear an address; an emptied one stays in Luma
    // (the ASTN form says so).
    if (Object.keys(body).length === 0) return null
    try {
      await assertOrgOwnsApiCalendar(ctx, event.orgId)
      await updateLumaEvent(event.lumaEventId, body)
      await refreshMirror(ctx, event.orgId, event.lumaEventId)
      await ctx.runMutation(internal.social.lumaSync.setEventSyncResult, {
        eventId,
      })
    } catch (error) {
      console.error('Luma event update failed', eventId, error)
      await ctx.runMutation(internal.social.lumaSync.setEventSyncResult, {
        eventId,
        error: `No se pudieron actualizar los datos en Luma: ${
          error instanceof Error ? error.message : String(error)
        }`.slice(0, 500),
      })
    }
    return null
  },
})

// ── Blasts ──────────────────────────────────────────────────────────────

const recipientValidator = v.union(
  v.literal('approved'),
  v.literal('checked_in'),
  v.literal('pending_approval'),
  v.literal('waitlist'),
  v.literal('invited'),
)

const blastView = v.object({
  id: v.string(),
  subject: v.union(v.string(), v.null()),
  contentMd: v.string(),
  status: v.string(), // scheduled | sent | quarantined
  scheduledFor: v.union(v.number(), v.null()),
  sentAt: v.union(v.number(), v.null()),
  recipients: v.array(v.string()),
  recipientCount: v.number(),
  openCount: v.number(),
  senderName: v.union(v.string(), v.null()),
})

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null
  const t = Date.parse(value)
  return Number.isNaN(t) ? null : t
}

/** The event's email blasts, newest first, with recipient and open counts. */
export const listBlasts = action({
  args: { orgId: v.id('organizations'), lumaEventId: v.string() },
  returns: v.array(blastView),
  handler: async (ctx, { orgId, lumaEventId }) => {
    requireKey()
    await requireEvent(ctx, orgId, lumaEventId)
    try {
      const blasts = await listLumaBlasts(lumaEventId)
      return blasts.map((b) => ({
        id: b.id,
        subject: b.subject ?? null,
        contentMd: b.content_md ?? '',
        status: b.status,
        scheduledFor: parseTime(b.scheduled_for),
        sentAt: parseTime(b.sent_at),
        recipients: (b.recipient_groups ?? []).map((g) => g.status),
        recipientCount: b.recipient_count ?? 0,
        openCount: b.email_open_count ?? 0,
        senderName: b.sender?.name ?? null,
      }))
    } catch (error) {
      asUserError(error)
    }
  },
})

/**
 * Email the event's guests through Luma, now or at `scheduledFor`. This
 * reaches real people and can't be recalled once sent; the admin screen
 * confirms first.
 */
export const sendBlast = action({
  args: {
    orgId: v.id('organizations'),
    lumaEventId: v.string(),
    subject: v.string(),
    contentMd: v.string(),
    recipients: v.array(recipientValidator),
    scheduledFor: v.optional(v.number()),
  },
  returns: v.object({ id: v.string(), status: v.string() }),
  handler: async (ctx, args) => {
    requireKey()
    await requireEvent(ctx, args.orgId, args.lumaEventId)
    const contentMd = args.contentMd.trim()
    if (!contentMd) throw new ConvexError('Write the message first')
    if (args.recipients.length === 0) {
      throw new ConvexError('Choose who gets the email')
    }
    if (args.scheduledFor !== undefined && args.scheduledFor < Date.now()) {
      throw new ConvexError('The send time is in the past')
    }
    try {
      const blast = await createLumaBlast({
        eventId: args.lumaEventId,
        subject: args.subject.trim() || undefined,
        contentMd,
        recipients: [...new Set(args.recipients)],
        scheduledFor: args.scheduledFor,
      })
      return { id: blast.id, status: blast.status }
    } catch (error) {
      asUserError(error)
    }
  },
})
