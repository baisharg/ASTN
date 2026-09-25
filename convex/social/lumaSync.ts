import { v } from 'convex/values'
import { internal } from '../_generated/api'
import {
  internalAction,
  internalMutation,
  internalQuery,
} from '../_generated/server'
import {
  addToAllowlist,
  getGuestByEmail,
  guestStatusFromLuma,
  isOnAllowlist,
  normalizeEmail,
} from './lib'
import {
  LumaApiError,
  addLumaGuests,
  getLumaEvent,
  getLumaGuest,
  hasLumaApiKey,
  listAllLumaGuests,
  lumaCheckedInAt,
  updateLumaGuestStatus,
} from './luma'
import type { Doc, Id } from '../_generated/dataModel'
import type { ActionCtx, MutationCtx } from '../_generated/server'

const lumaGuestValidator = v.object({
  id: v.string(),
  email: v.string(),
  name: v.union(v.string(), v.null()),
  approvalStatus: v.string(),
  checkedInAt: v.optional(v.number()),
})

type IncomingLumaGuest = {
  id: string
  email: string
  name: string | null
  approvalStatus: string
  checkedInAt?: number
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ── Reads for actions ───────────────────────────────────────────────────

export const getGuestForSync = internalQuery({
  args: { guestId: v.id('socialEventGuests') },
  returns: v.union(
    v.null(),
    v.object({
      guest: v.object({
        email: v.string(),
        name: v.union(v.string(), v.null()),
        status: v.string(),
        lumaGuestId: v.union(v.string(), v.null()),
      }),
      lumaEventId: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { guestId }) => {
    const guest = await ctx.db.get('socialEventGuests', guestId)
    if (!guest) return null
    const event = await ctx.db.get('socialEvents', guest.eventId)
    return {
      guest: {
        email: guest.email,
        name: guest.name ?? null,
        status: guest.status,
        lumaGuestId: guest.lumaGuestId ?? null,
      },
      lumaEventId: event?.lumaEventId ?? null,
    }
  },
})

export const getLumaEventId = internalQuery({
  args: { eventId: v.id('socialEvents') },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get('socialEvents', eventId)
    return event?.lumaEventId ?? null
  },
})

export const listSyncableEvents = internalQuery({
  args: { now: v.number() },
  returns: v.array(v.id('socialEvents')),
  handler: async (ctx, { now }) => {
    // Small table; published events with a Luma link, from yesterday on.
    const events = await ctx.db.query('socialEvents').take(500)
    return events
      .filter(
        (e) =>
          e.status === 'published' &&
          !!e.lumaEventId &&
          (e.endAt ?? e.startAt) > now - 24 * 3600 * 1000,
      )
      .map((e) => e._id)
  },
})

// ── Writes ──────────────────────────────────────────────────────────────

export const markGuestSynced = internalMutation({
  args: {
    guestId: v.id('socialEventGuests'),
    lumaGuestId: v.optional(v.string()),
    error: v.optional(v.string()),
    // Luma's current status for the guest, when we read it back.
    lumaStatus: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { guestId, lumaGuestId, error, lumaStatus }) => {
    const guest = await ctx.db.get('socialEventGuests', guestId)
    if (!guest) return null
    const patch: Partial<Doc<'socialEventGuests'>> = {
      lumaSync: error ? 'error' : 'synced',
      lumaSyncError: error,
      updatedAt: Date.now(),
    }
    if (lumaGuestId) patch.lumaGuestId = lumaGuestId
    // Luma is the record for anything we didn't decide ourselves: e.g. the
    // guest was already declined there before registering in the app.
    if (!error && lumaStatus) {
      const fromLuma = guestStatusFromLuma(lumaStatus)
      if (fromLuma === 'declined' && guest.status === 'pending_approval') {
        patch.status = 'declined'
      }
    }
    await ctx.db.patch('socialEventGuests', guestId, patch)
    return null
  },
})

export const setEventSyncResult = internalMutation({
  args: {
    eventId: v.id('socialEvents'),
    error: v.optional(v.string()),
    lumaUrl: v.optional(v.string()),
    title: v.optional(v.string()),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
    timezone: v.optional(v.string()),
    venueAddress: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { eventId, error, ...details }) => {
    const event = await ctx.db.get('socialEvents', eventId)
    if (!event) return null
    const patch: Partial<Doc<'socialEvents'>> = {
      lumaLastSyncedAt: Date.now(),
      lumaLastSyncError: error,
    }
    if (details.lumaUrl) patch.lumaUrl = details.lumaUrl
    // Fill in details from Luma only where the admin left them empty.
    if (details.venueAddress && !event.venueAddress) {
      patch.venueAddress = details.venueAddress
    }
    if (details.timezone && !event.timezone) patch.timezone = details.timezone
    await ctx.db.patch('socialEvents', eventId, patch)
    return null
  },
})

/**
 * Upsert one guest as Luma reports it. Shared by the webhook and the pull.
 * Rows with a local change still on its way to Luma keep their status.
 */
async function applyLumaGuest(
  ctx: MutationCtx,
  event: Doc<'socialEvents'>,
  incoming: IncomingLumaGuest,
): Promise<'inserted' | 'updated' | 'unchanged'> {
  const email = normalizeEmail(incoming.email)
  const now = Date.now()
  let status = guestStatusFromLuma(incoming.approvalStatus)
  const existing = await getGuestByEmail(ctx, event._id, email)

  if (!existing) {
    // People the org already knows skip Luma's approval queue too.
    let needsPush = false
    if (
      status === 'pending_approval' &&
      (await isOnAllowlist(ctx, event.orgId, email))
    ) {
      status = 'approved'
      needsPush = true
    }
    const guestId = await ctx.db.insert('socialEventGuests', {
      eventId: event._id,
      orgId: event.orgId,
      email,
      name: incoming.name ?? undefined,
      status,
      source: 'luma',
      lumaGuestId: incoming.id,
      lumaSync: needsPush ? 'pending' : 'synced',
      checkedInAt: incoming.checkedInAt,
      registeredAt: now,
      updatedAt: now,
    })
    if (needsPush) {
      await ctx.scheduler.runAfter(0, internal.social.lumaSync.pushGuest, {
        guestId,
      })
    }
    // Arriving already approved (e.g. an event without approval) isn't an
    // admin vouching for them, so they don't join the allowlist here.
    return 'inserted'
  }

  const patch: Partial<Doc<'socialEventGuests'>> = {}
  if (existing.lumaGuestId !== incoming.id) patch.lumaGuestId = incoming.id
  if (!existing.name && incoming.name) patch.name = incoming.name
  if (
    incoming.checkedInAt !== undefined &&
    existing.checkedInAt !== incoming.checkedInAt
  ) {
    patch.checkedInAt = incoming.checkedInAt
  }
  const localChangeInFlight = existing.lumaSync === 'pending'
  if (!localChangeInFlight && existing.status !== status) {
    patch.status = status
    // An admin approved them in Luma: remember them for future events.
    if (status === 'approved' && existing.status === 'pending_approval') {
      await addToAllowlist(ctx, {
        orgId: event.orgId,
        email,
        name: existing.name ?? incoming.name ?? undefined,
        source: 'approval',
      })
    }
  }
  if (Object.keys(patch).length === 0) return 'unchanged'
  patch.updatedAt = now
  await ctx.db.patch('socialEventGuests', existing._id, patch)
  return 'updated'
}

export const applyLumaGuests = internalMutation({
  args: {
    eventId: v.id('socialEvents'),
    guests: v.array(lumaGuestValidator),
  },
  returns: v.object({
    inserted: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx, { eventId, guests }) => {
    const event = await ctx.db.get('socialEvents', eventId)
    if (!event) return { inserted: 0, updated: 0 }
    let inserted = 0
    let updated = 0
    for (const guest of guests) {
      const result = await applyLumaGuest(ctx, event, guest)
      if (result === 'inserted') inserted++
      if (result === 'updated') updated++
    }
    return { inserted, updated }
  },
})

/** Called by the Luma webhook for guest.registered and guest.updated. */
export const applyWebhookGuest = internalMutation({
  args: {
    lumaEventId: v.string(),
    guest: lumaGuestValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, { lumaEventId, guest }) => {
    const event = await ctx.db
      .query('socialEvents')
      .withIndex('by_lumaEventId', (q) => q.eq('lumaEventId', lumaEventId))
      .first()
    if (!event) return false
    await applyLumaGuest(ctx, event, guest)
    return true
  },
})

// ── Actions ─────────────────────────────────────────────────────────────

/** Mirror one guest's registration or status to Luma. */
export const pushGuest = internalAction({
  args: { guestId: v.id('socialEventGuests') },
  returns: v.null(),
  handler: async (ctx, { guestId }) => {
    const data = await ctx.runQuery(internal.social.lumaSync.getGuestForSync, {
      guestId,
    })
    if (!data) return null
    const { guest, lumaEventId } = data
    if (!lumaEventId) return null
    if (!hasLumaApiKey()) {
      await ctx.runMutation(internal.social.lumaSync.markGuestSynced, {
        guestId,
        error: 'LUMA_API_KEY is not set',
      })
      return null
    }

    try {
      const wanted =
        guest.status === 'approved' || guest.status === 'declined'
          ? guest.status
          : 'pending_approval'

      let lumaGuest = guest.lumaGuestId
        ? await getLumaGuest(lumaEventId, guest.lumaGuestId)
        : await getLumaGuest(lumaEventId, guest.email)

      if (!lumaGuest && wanted !== 'declined') {
        const skipped = await addLumaGuests({
          eventId: lumaEventId,
          guests: [{ email: guest.email, name: guest.name ?? undefined }],
          approvalStatus: wanted,
          sendEmail: true,
        })
        if (skipped.length > 0) {
          throw new Error(
            'Luma skipped this guest (unsubscribed or blocked on Luma)',
          )
        }
        lumaGuest = await getLumaGuest(lumaEventId, guest.email)
      }

      if (
        lumaGuest &&
        guestStatusFromLuma(lumaGuest.approval_status) !== wanted
      ) {
        const lumaIsDecided =
          lumaGuest.approval_status === 'declined' &&
          wanted === 'pending_approval'
        if (!lumaIsDecided) {
          await updateLumaGuestStatus({
            eventId: lumaEventId,
            guestId: lumaGuest.id,
            status: wanted,
            sendEmail: true,
          })
        }
      }

      await ctx.runMutation(internal.social.lumaSync.markGuestSynced, {
        guestId,
        lumaGuestId: lumaGuest?.id,
        lumaStatus: lumaGuest?.approval_status,
      })
    } catch (error) {
      console.error('Luma push failed', guestId, error)
      await ctx.runMutation(internal.social.lumaSync.markGuestSynced, {
        guestId,
        error: errorMessage(error).slice(0, 500),
      })
    }
    return null
  },
})

/** Pull an event's whole Luma guest list into the app. */
async function pullGuestsImpl(
  ctx: ActionCtx,
  eventId: Id<'socialEvents'>,
): Promise<void> {
  const lumaEventId = await ctx.runQuery(
    internal.social.lumaSync.getLumaEventId,
    { eventId },
  )
  if (!lumaEventId || !hasLumaApiKey()) return
  try {
    const guests = await listAllLumaGuests(lumaEventId)
    const mapped = guests.map((g) => ({
      id: g.id,
      email: g.user_email,
      name: g.user_name,
      approvalStatus: g.approval_status,
      checkedInAt: lumaCheckedInAt(g),
    }))
    for (let i = 0; i < mapped.length; i += 100) {
      await ctx.runMutation(internal.social.lumaSync.applyLumaGuests, {
        eventId,
        guests: mapped.slice(i, i + 100),
      })
    }
    await ctx.runMutation(internal.social.lumaSync.setEventSyncResult, {
      eventId,
    })
  } catch (error) {
    console.error('Luma pull failed', eventId, error)
    await ctx.runMutation(internal.social.lumaSync.setEventSyncResult, {
      eventId,
      error: errorMessage(error).slice(0, 500),
    })
  }
}

export const pullGuests = internalAction({
  args: { eventId: v.id('socialEvents') },
  returns: v.null(),
  handler: async (ctx, { eventId }) => {
    await pullGuestsImpl(ctx, eventId)
    return null
  },
})

/** After linking: read the Luma event's details, then pull its guests. */
export const importLumaEvent = internalAction({
  args: { eventId: v.id('socialEvents') },
  returns: v.null(),
  handler: async (ctx, { eventId }) => {
    const lumaEventId = await ctx.runQuery(
      internal.social.lumaSync.getLumaEventId,
      { eventId },
    )
    if (!lumaEventId) return null
    if (!hasLumaApiKey()) {
      await ctx.runMutation(internal.social.lumaSync.setEventSyncResult, {
        eventId,
        error: 'LUMA_API_KEY is not set',
      })
      return null
    }
    try {
      const lumaEvent = await getLumaEvent(lumaEventId)
      await ctx.runMutation(internal.social.lumaSync.setEventSyncResult, {
        eventId,
        lumaUrl: lumaEvent.url,
        timezone: lumaEvent.timezone,
        venueAddress:
          lumaEvent.geo_address_json?.full_address ??
          lumaEvent.geo_address_json?.address ??
          undefined,
      })
    } catch (error) {
      const message =
        error instanceof LumaApiError && error.status === 404
          ? `Luma has no event ${lumaEventId} on this calendar`
          : errorMessage(error)
      await ctx.runMutation(internal.social.lumaSync.setEventSyncResult, {
        eventId,
        error: message.slice(0, 500),
      })
      return null
    }
    await pullGuestsImpl(ctx, eventId)
    return null
  },
})

/** Cron: keep open events in step with Luma in case a webhook is missed. */
export const pullAllOpenEvents = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (!hasLumaApiKey()) return null
    const eventIds: Array<Id<'socialEvents'>> = await ctx.runQuery(
      internal.social.lumaSync.listSyncableEvents,
      { now: Date.now() },
    )
    for (const eventId of eventIds) {
      await pullGuestsImpl(ctx, eventId)
    }
    return null
  },
})
