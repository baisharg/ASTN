import { ConvexError, v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalQuery, mutation, query } from '../_generated/server'
import { requireOrgAdmin } from '../lib/auth'
import { DEFAULT_MEETING_MINUTES } from '../social/constants'
import { uniqueEventSlug } from '../social/events'
import { slugifyTitle } from '../orgOpportunities'
import { orgOwnsApiCalendar, requireOrgOwnsApiCalendar } from './binding'
import { flagGuestSync, getOrgEventRow } from './mirror'
import { lumaEventUrl, syncTotalsValidator } from './shared'
import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'

/** Admin screens for the org's Luma calendar (every mirrored event). */

const mirroredEventView = v.object({
  _id: v.id('events'),
  lumaEventId: v.string(),
  title: v.string(),
  startAt: v.number(),
  endAt: v.union(v.number(), v.null()),
  timezone: v.string(),
  url: v.string(),
  location: v.union(v.string(), v.null()),
  isVirtual: v.boolean(),
  visibility: v.string(),
  // false for events only listed on the calendar (run by someone else)
  managedByCalendar: v.boolean(),
  requireApproval: v.union(v.boolean(), v.null()),
  guestCount: v.union(v.number(), v.null()),
  approvedCount: v.union(v.number(), v.null()),
  pendingCount: v.union(v.number(), v.null()),
  checkedInCount: v.union(v.number(), v.null()),
  lastGuestSyncAt: v.union(v.number(), v.null()),
  guestSyncPending: v.boolean(),
  guestSyncError: v.union(v.string(), v.null()),
  // The ASTN event managing it (registration, approvals, 1:1s, check-in).
  socialEventId: v.union(v.id('socialEvents'), v.null()),
})

function toView(e: Doc<'events'>, socialEventId: Id<'socialEvents'> | null) {
  return {
    _id: e._id,
    lumaEventId: e.lumaEventId,
    title: e.title,
    startAt: e.startAt,
    endAt: e.endAt ?? null,
    timezone: e.timezone,
    url: lumaEventUrl(e.url),
    location: e.location ?? null,
    isVirtual: e.isVirtual,
    visibility: e.visibility ?? 'public',
    managedByCalendar: (e.lumaAccess ?? 'manage') === 'manage',
    requireApproval: e.requireApproval ?? null,
    guestCount: e.guestCount ?? null,
    approvedCount: e.approvedCount ?? null,
    pendingCount: e.pendingCount ?? null,
    checkedInCount: e.checkedInCount ?? null,
    lastGuestSyncAt: e.lastGuestSyncAt ?? null,
    guestSyncPending: e.guestSyncNeeded === true,
    guestSyncError: e.guestSyncError ?? null,
    socialEventId,
  }
}

/** Luma event id → the org's ASTN event linked to it. */
async function linkedSocialEvents(
  ctx: QueryCtx,
  orgId: Id<'organizations'>,
): Promise<Map<string, Id<'socialEvents'>>> {
  const events = await ctx.db
    .query('socialEvents')
    .withIndex('by_org_and_startAt', (q) => q.eq('orgId', orgId))
    .take(1000)
  const map = new Map<string, Id<'socialEvents'>>()
  for (const e of events) if (e.lumaEventId) map.set(e.lumaEventId, e._id)
  return map
}

/**
 * Every event on the org's Luma calendar, as mirrored. `now` comes from
 * the client so the split into upcoming and past doesn't go stale.
 */
export const listLumaEvents = query({
  args: { orgId: v.id('organizations'), now: v.number() },
  returns: v.object({
    connected: v.boolean(),
    upcoming: v.array(mirroredEventView),
    past: v.array(mirroredEventView),
  }),
  handler: async (ctx, { orgId, now }) => {
    await requireOrgAdmin(ctx, orgId)
    const linked = await linkedSocialEvents(ctx, orgId)
    const view = (e: Doc<'events'>) =>
      toView(e, linked.get(e.lumaEventId) ?? null)
    // Events still running count as upcoming.
    const cutoff = now - 12 * 3600 * 1000
    const upcoming = await ctx.db
      .query('events')
      .withIndex('by_org_start', (q) =>
        q.eq('orgId', orgId).gte('startAt', cutoff),
      )
      .order('asc')
      .take(200)
    const past = await ctx.db
      .query('events')
      .withIndex('by_org_start', (q) =>
        q.eq('orgId', orgId).lt('startAt', cutoff),
      )
      .order('desc')
      .take(400)
    const isLuma = (e: Doc<'events'>) =>
      !e.canceled && e.lumaEventId.startsWith('evt-')
    return {
      connected: await orgOwnsApiCalendar(ctx, orgId),
      upcoming: upcoming.filter(isLuma).map(view),
      past: past.filter(isLuma).map(view),
    }
  },
})

export const getLumaEvent = query({
  args: { orgId: v.id('organizations'), lumaEventId: v.string() },
  returns: v.union(v.null(), mirroredEventView),
  handler: async (ctx, { orgId, lumaEventId }) => {
    await requireOrgAdmin(ctx, orgId)
    const row = await getOrgEventRow(ctx, orgId, lumaEventId)
    if (!row || row.orgId !== orgId) return null
    const social = await ctx.db
      .query('socialEvents')
      .withIndex('by_lumaEventId', (q) => q.eq('lumaEventId', lumaEventId))
      .first()
    return toView(row, social && social.orgId === orgId ? social._id : null)
  },
})

export const getSyncStatus = query({
  args: { orgId: v.id('organizations') },
  returns: v.union(
    v.null(),
    v.object({
      historyDoneAt: v.union(v.number(), v.null()),
      lastEventsSyncAt: v.union(v.number(), v.null()),
      lastEventsSyncError: v.union(v.string(), v.null()),
      guestSyncRunning: v.boolean(),
      lastChainFinishedAt: v.union(v.number(), v.null()),
      lastChainError: v.union(v.string(), v.null()),
      totals: syncTotalsValidator,
    }),
  ),
  handler: async (ctx, { orgId }) => {
    await requireOrgAdmin(ctx, orgId)
    const state = await ctx.db
      .query('lumaSyncState')
      .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
      .first()
    if (!state) return null
    return {
      historyDoneAt: state.historyDoneAt ?? null,
      lastEventsSyncAt: state.lastEventsSyncAt ?? null,
      lastEventsSyncError: state.lastEventsSyncError ?? null,
      // Locked means a chain is running or waiting out a rate limit.
      guestSyncRunning: state.chainLockedUntil !== undefined,
      lastChainFinishedAt: state.lastChainFinishedAt ?? null,
      lastChainError: state.lastChainError ?? null,
      totals: state.totals,
    }
  },
})

/** Re-read the calendar from Luma now (events, then guests). */
export const syncNow = mutation({
  args: { orgId: v.id('organizations') },
  returns: v.null(),
  handler: async (ctx, { orgId }) => {
    await requireOrgAdmin(ctx, orgId)
    await requireOrgOwnsApiCalendar(ctx, orgId)
    await ctx.scheduler.runAfter(0, internal.luma.sync.syncOrg, {
      orgId,
      mode: 'recent',
    })
    return null
  },
})

/** Re-read one event's guest list (counts and CRM history). */
export const refreshGuests = mutation({
  args: { orgId: v.id('organizations'), lumaEventId: v.string() },
  returns: v.null(),
  handler: async (ctx, { orgId, lumaEventId }) => {
    await requireOrgAdmin(ctx, orgId)
    await requireOrgOwnsApiCalendar(ctx, orgId)
    const row = await getOrgEventRow(ctx, orgId, lumaEventId)
    if (!row) throw new ConvexError('Event not found')
    await flagGuestSync(ctx, orgId, lumaEventId)
    return null
  },
})

/**
 * Manage a Luma event in ASTN: create an ASTN event linked to it, so
 * registration, approvals, 1:1s and door check-in apply. Returns the
 * existing one if it's already managed.
 */
export const manageInAstn = mutation({
  args: { orgId: v.id('organizations'), lumaEventId: v.string() },
  returns: v.object({ eventId: v.id('socialEvents'), created: v.boolean() }),
  handler: async (ctx, { orgId, lumaEventId }) => {
    const userId = await requireOrgAdmin(ctx, orgId)
    await requireOrgOwnsApiCalendar(ctx, orgId)
    const row = await getOrgEventRow(ctx, orgId, lumaEventId)
    if (!row || row.orgId !== orgId || row.canceled) {
      throw new ConvexError('Event not found')
    }
    if ((row.lumaAccess ?? 'manage') !== 'manage') {
      throw new ConvexError(
        'This event is run by another Luma calendar, so it can’t be managed here',
      )
    }
    const existing = await ctx.db
      .query('socialEvents')
      .withIndex('by_lumaEventId', (q) => q.eq('lumaEventId', lumaEventId))
      .first()
    if (existing) {
      if (existing.orgId !== orgId) {
        throw new ConvexError(
          'Another organization already manages that Luma event',
        )
      }
      return { eventId: existing._id, created: false }
    }
    const now = Date.now()
    const slug = await uniqueEventSlug(
      ctx,
      orgId,
      slugifyTitle(row.title) || 'evento',
    )
    const eventId = await ctx.db.insert('socialEvents', {
      orgId,
      slug,
      title: row.title,
      description: row.description,
      startAt: row.startAt,
      endAt: row.endAt,
      timezone: row.timezone,
      venueAddress: row.isVirtual ? undefined : row.location,
      status: 'draft',
      lumaEventId,
      lumaUrl: lumaEventUrl(row.url),
      meetingMinutes: DEFAULT_MEETING_MINUTES,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    // Same as linking by hand: read details, pull guests, push ours.
    await ctx.scheduler.runAfter(0, internal.social.lumaSync.importLumaEvent, {
      eventId,
    })
    return { eventId, created: true }
  },
})

/**
 * For actions: the caller must be an org admin, and the event must be on
 * the org's calendar. Returns what the action needs.
 */
export const requireCalendarEvent = internalQuery({
  args: {
    orgId: v.id('organizations'),
    lumaEventId: v.string(),
    // Guests, edits and blasts need the calendar to run the event.
    needsManage: v.boolean(),
  },
  returns: v.object({
    title: v.string(),
    socialEventId: v.union(v.id('socialEvents'), v.null()),
  }),
  handler: async (ctx, { orgId, lumaEventId, needsManage }) => {
    await requireOrgAdmin(ctx, orgId)
    const row = await getOrgEventRow(ctx, orgId, lumaEventId)
    if (!row || row.orgId !== orgId) throw new ConvexError('Event not found')
    if (needsManage && (row.lumaAccess ?? 'manage') !== 'manage') {
      throw new ConvexError(
        'This event is run by another Luma calendar, so its guests and settings aren’t available here',
      )
    }
    const social = await ctx.db
      .query('socialEvents')
      .withIndex('by_lumaEventId', (q) => q.eq('lumaEventId', lumaEventId))
      .first()
    return {
      title: row.title,
      socialEventId: social && social.orgId === orgId ? social._id : null,
    }
  },
})

export const assertOrgAdmin = internalQuery({
  args: { orgId: v.id('organizations') },
  returns: v.null(),
  handler: async (ctx, { orgId }) => {
    await requireOrgAdmin(ctx, orgId)
    return null
  },
})

/** For the push to Luma after an ASTN event's details change. */
export const getSocialEventForPush = internalQuery({
  args: { eventId: v.id('socialEvents') },
  returns: v.union(
    v.null(),
    v.object({
      lumaEventId: v.string(),
      orgId: v.id('organizations'),
      title: v.string(),
      description: v.union(v.string(), v.null()),
      startAt: v.number(),
      endAt: v.union(v.number(), v.null()),
      timezone: v.string(),
      venueAddress: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { eventId }) => {
    const e = await ctx.db.get('socialEvents', eventId)
    if (!e?.lumaEventId) return null
    return {
      lumaEventId: e.lumaEventId,
      orgId: e.orgId,
      title: e.title,
      description: e.description ?? null,
      startAt: e.startAt,
      endAt: e.endAt ?? null,
      timezone: e.timezone,
      venueAddress: e.venueAddress ?? null,
    }
  },
})
