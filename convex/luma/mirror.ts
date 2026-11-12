import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalMutation, internalQuery } from '../_generated/server'
import { bumpCount } from '../crm'
import {
  addMissingOptions,
  ensureBuiltinFieldDefs,
  normalizeValue,
} from '../contacts/fields'
import { getGuestByEmail } from '../social/lib'
import { apiCalendarOrg, orgForCalendar } from './binding'
import {
  EMPTY_TOTALS,
  GUEST_LIST_SETTLES_AFTER_MS,
  attendanceExternalId,
  attendanceGuestValidator,
  eventEnd,
  mirrorChanges,
  mirroredEventValidator,
  newMirrorFields,
  recomputeLumaCounts,
  syncTotalsValidator,
} from './shared'
import type { FieldValue } from '../contacts/fields'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { MirroredEvent, SyncTotals } from './shared'

/**
 * Database side of the Luma mirror. Actions in ./sync.ts read Luma and call
 * these. Everything here is idempotent: re-running a sync changes nothing
 * when Luma hasn't changed.
 */

// How long a guest-sync chain may go without renewing its lock before
// another one may start.
const CHAIN_LOCK_MS = 15 * 60 * 1000

// ── Sync state ──────────────────────────────────────────────────────────

async function getState(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
): Promise<Doc<'lumaSyncState'> | null> {
  return await ctx.db
    .query('lumaSyncState')
    .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
    .first()
}

async function ensureState(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
): Promise<Doc<'lumaSyncState'>> {
  const existing = await getState(ctx, orgId)
  if (existing) return existing
  const id = await ctx.db.insert('lumaSyncState', {
    orgId,
    totals: EMPTY_TOTALS,
    updatedAt: Date.now(),
  })
  return (await ctx.db.get('lumaSyncState', id))!
}

function addTotals(a: SyncTotals, b: Partial<SyncTotals>): SyncTotals {
  return {
    eventsUpserted: a.eventsUpserted + (b.eventsUpserted ?? 0),
    eventsGuestSynced: a.eventsGuestSynced + (b.eventsGuestSynced ?? 0),
    guestsProcessed: a.guestsProcessed + (b.guestsProcessed ?? 0),
    contactsCreated: a.contactsCreated + (b.contactsCreated ?? 0),
    activitiesInserted: a.activitiesInserted + (b.activitiesInserted ?? 0),
    activitiesUpdated: a.activitiesUpdated + (b.activitiesUpdated ?? 0),
    activitiesDeleted: (a.activitiesDeleted ?? 0) + (b.activitiesDeleted ?? 0),
  }
}

export const getSyncState = internalQuery({
  args: { orgId: v.id('organizations') },
  returns: v.union(
    v.null(),
    v.object({
      calendarId: v.union(v.string(), v.null()),
      historyDoneAt: v.union(v.number(), v.null()),
      lastEventsSyncAt: v.union(v.number(), v.null()),
      lastEventsSyncError: v.union(v.string(), v.null()),
      chainLockedUntil: v.union(v.number(), v.null()),
      lastChainFinishedAt: v.union(v.number(), v.null()),
      lastChainError: v.union(v.string(), v.null()),
      pendingGuestSyncs: v.number(),
      totals: syncTotalsValidator,
    }),
  ),
  handler: async (ctx, { orgId }) => {
    const state = await getState(ctx, orgId)
    if (!state) return null
    const pending = await ctx.db
      .query('events')
      .withIndex('by_org_and_guestSyncNeeded_and_startAt', (q) =>
        q.eq('orgId', orgId).eq('guestSyncNeeded', true),
      )
      .take(1000)
    return {
      calendarId: state.calendarId ?? null,
      historyDoneAt: state.historyDoneAt ?? null,
      lastEventsSyncAt: state.lastEventsSyncAt ?? null,
      lastEventsSyncError: state.lastEventsSyncError ?? null,
      chainLockedUntil: state.chainLockedUntil ?? null,
      lastChainFinishedAt: state.lastChainFinishedAt ?? null,
      lastChainError: state.lastChainError ?? null,
      pendingGuestSyncs: pending.length,
      totals: state.totals,
    }
  },
})

/** Bind an org to a Luma calendar (the settings page does this for admins). */
export const setOrgCalendar = internalMutation({
  args: { orgId: v.id('organizations'), calendarId: v.string() },
  returns: v.null(),
  handler: async (ctx, { orgId, calendarId }) => {
    await ctx.db.patch('organizations', orgId, {
      lumaCalendarApiId: calendarId,
    })
    return null
  },
})

export const recordEventsSync = internalMutation({
  args: {
    orgId: v.id('organizations'),
    calendarId: v.optional(v.string()),
    historyDone: v.optional(v.boolean()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { orgId, calendarId, historyDone, error }) => {
    const state = await ensureState(ctx, orgId)
    const now = Date.now()
    const patch: Partial<Doc<'lumaSyncState'>> = {
      lastEventsSyncError: error,
      updatedAt: now,
    }
    if (calendarId) patch.calendarId = calendarId
    if (!error) {
      patch.lastEventsSyncAt = now
      if (historyDone) patch.historyDoneAt = now
    }
    await ctx.db.patch('lumaSyncState', state._id, patch)
    if (!error) {
      // Keeps the admin settings page's "last synced" line meaningful.
      await ctx.db.patch('organizations', orgId, { eventsLastSynced: now })
    }
    return null
  },
})

// ── Events ──────────────────────────────────────────────────────────────

/** Whether the event's guest list should be (re)read from Luma. */
function needsGuestSync(
  event: { startAt: number; endAt?: number; lumaAccess: string },
  existing: Doc<'events'> | null,
  now: number,
): boolean {
  if (event.lumaAccess !== 'manage') return false
  if (!existing?.lastGuestSyncAt) return true
  // Upcoming or just finished: the list is still moving.
  const settlesAt = eventEnd(event) + GUEST_LIST_SETTLES_AFTER_MS
  if (settlesAt > now) return true
  // Last read before it settled: read it once more.
  return existing.lastGuestSyncAt < settlesAt
}

/** The org's mirror row for a Luma event (each org has its own rows). */
export async function getOrgEventRow(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
  lumaEventId: string,
): Promise<Doc<'events'> | null> {
  return await ctx.db
    .query('events')
    .withIndex('by_orgId_and_lumaEventId', (q) =>
      q.eq('orgId', orgId).eq('lumaEventId', lumaEventId),
    )
    .first()
}

async function upsertEvent(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  event: MirroredEvent,
  options: { notify: boolean; now: number },
): Promise<'inserted' | 'updated' | 'unchanged'> {
  const existing = await getOrgEventRow(ctx, orgId, event.lumaEventId)
  const fields = newMirrorFields(event)
  const syncNeeded = needsGuestSync(fields, existing, options.now)

  if (!existing) {
    const eventId = await ctx.db.insert('events', {
      ...fields,
      orgId,
      syncedAt: options.now,
      canceled: false,
      guestSyncNeeded: syncNeeded || undefined,
    })
    // Tell members about new public events that haven't happened yet.
    if (
      options.notify &&
      event.visibility === 'public' &&
      event.startAt > options.now
    ) {
      await ctx.scheduler.runAfter(
        0,
        internal.notifications.realtime.notifyAllFrequencyUsers,
        { eventId, orgId },
      )
    }
    return 'inserted'
  }

  // A canceled row that Luma reports again is no longer canceled.
  const changes = mirrorChanges(existing, event)
  const changed = Object.keys(changes).length > 0 || existing.canceled === true
  const flagChange = syncNeeded && !existing.guestSyncNeeded
  if (!changed && !flagChange) return 'unchanged'
  const patch: Partial<Doc<'events'>> = { syncedAt: options.now }
  if (changed) Object.assign(patch, changes, { canceled: false })
  if (syncNeeded) patch.guestSyncNeeded = true
  await ctx.db.patch('events', existing._id, patch)
  if (existing.canceled) await scheduleAttendanceRecount(ctx, [existing._id])
  return changed ? 'updated' : 'unchanged'
}

export const upsertMirroredEvents = internalMutation({
  args: {
    orgId: v.id('organizations'),
    events: v.array(mirroredEventValidator),
    notify: v.boolean(),
  },
  returns: v.object({ inserted: v.number(), updated: v.number() }),
  handler: async (ctx, { orgId, events, notify }) => {
    const now = Date.now()
    let inserted = 0
    let updated = 0
    for (const event of events) {
      const result = await upsertEvent(ctx, orgId, event, { notify, now })
      if (result === 'inserted') inserted++
      if (result === 'updated') updated++
    }
    if (inserted + updated > 0) {
      const state = await ensureState(ctx, orgId)
      await ctx.db.patch('lumaSyncState', state._id, {
        totals: addTotals(state.totals, { eventsUpserted: inserted + updated }),
      })
    }
    return { inserted, updated }
  },
})

/**
 * After a complete listing: events of this org that Luma no longer lists
 * were canceled or deleted. Rows stay (attendance, notifications and
 * programs point at them) but are hidden.
 */
export const markMissingCanceled = internalMutation({
  args: { orgId: v.id('organizations'), seenIds: v.array(v.string()) },
  returns: v.number(),
  handler: async (ctx, { orgId, seenIds }) => {
    const seen = new Set(seenIds)
    const rows = await ctx.db
      .query('events')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .take(5000)
    const canceled: Array<Id<'events'>> = []
    for (const row of rows) {
      if (row.canceled || seen.has(row.lumaEventId)) continue
      if (!row.lumaEventId.startsWith('evt-')) continue // seeds, other sources
      await ctx.db.patch('events', row._id, {
        canceled: true,
        guestSyncNeeded: undefined,
      })
      canceled.push(row._id)
    }
    await scheduleAttendanceRecount(ctx, canceled)
    return canceled.length
  },
})

/**
 * Apply an event.created / event.updated / event.canceled webhook, or an
 * event just read back from Luma. The event goes to the one org bound to
 * its calendar (`orgId` when the caller already checked the binding); events
 * of calendars no org is bound to are ignored.
 */
export const applyWebhookEvent = internalMutation({
  args: {
    calendarId: v.union(v.string(), v.null()),
    event: mirroredEventValidator,
    canceled: v.boolean(),
    // True when the payload had no `access` field (webhooks).
    accessUnknown: v.optional(v.boolean()),
    orgId: v.optional(v.id('organizations')),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { event, canceled, accessUnknown } = args
    const orgId =
      args.orgId ??
      (args.calendarId
        ? await orgForCalendar(ctx, args.calendarId)
        : await apiCalendarOrg(ctx))
    if (!orgId) return false
    const existing = await getOrgEventRow(ctx, orgId, event.lumaEventId)
    if (canceled) {
      if (existing && !existing.canceled) {
        await ctx.db.patch('events', existing._id, {
          canceled: true,
          guestSyncNeeded: undefined,
        })
        await scheduleAttendanceRecount(ctx, [existing._id])
      }
      return !!existing
    }
    // Webhook payloads don't say whether the calendar runs the event or
    // only lists it; keep what the calendar listing said.
    const mirrored =
      existing?.lumaAccess && accessUnknown
        ? { ...event, lumaAccess: existing.lumaAccess }
        : event
    await upsertEvent(ctx, orgId, mirrored, { notify: true, now: Date.now() })
    await kickGuestSync(ctx, orgId)
    return true
  },
})

// ── Guest-sync chain ────────────────────────────────────────────────────

/**
 * Start the org's guest-sync chain unless one is already running. The
 * running chain keeps going until no event needs a guest sync, so anything
 * flagged meanwhile is picked up.
 */
export async function kickGuestSync(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
): Promise<boolean> {
  const state = await ensureState(ctx, orgId)
  const now = Date.now()
  if (state.chainLockedUntil && state.chainLockedUntil > now) return false
  await ctx.db.patch('lumaSyncState', state._id, {
    chainLockedUntil: now + CHAIN_LOCK_MS,
    updatedAt: now,
  })
  await ctx.scheduler.runAfter(0, internal.luma.sync.guestChain, { orgId })
  return true
}

/** Flag an org's mirrored event for a guest sync (e.g. a guest webhook). */
export async function flagGuestSync(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  lumaEventId: string,
): Promise<void> {
  const row = await getOrgEventRow(ctx, orgId, lumaEventId)
  if (!row || row.canceled || row.lumaAccess === 'view') return
  if (!row.guestSyncNeeded) {
    await ctx.db.patch('events', row._id, { guestSyncNeeded: true })
  }
  await kickGuestSync(ctx, row.orgId)
}

export const startGuestSync = internalMutation({
  args: { orgId: v.id('organizations') },
  returns: v.boolean(),
  handler: async (ctx, { orgId }) => await kickGuestSync(ctx, orgId),
})

/** Queue every managed event of the org for a guest sync (full refresh). */
export const flagAllForGuestSync = internalMutation({
  args: { orgId: v.id('organizations') },
  returns: v.number(),
  handler: async (ctx, { orgId }) => {
    const rows = await ctx.db
      .query('events')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .take(5000)
    let flagged = 0
    for (const row of rows) {
      if (row.canceled || row.lumaAccess !== 'manage' || row.guestSyncNeeded) {
        continue
      }
      await ctx.db.patch('events', row._id, { guestSyncNeeded: true })
      flagged++
    }
    await kickGuestSync(ctx, orgId)
    return flagged
  },
})

export const nextGuestSyncBatch = internalQuery({
  args: {
    orgId: v.id('organizations'),
    limit: v.number(),
    // Flagged events the running chain already failed to read.
    skip: v.optional(v.array(v.id('events'))),
  },
  returns: v.array(
    v.object({
      _id: v.id('events'),
      lumaEventId: v.string(),
      lumaAccess: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { orgId, limit, skip }) => {
    const skipped = new Set(skip ?? [])
    // Newest first: upcoming events matter most.
    const rows = await ctx.db
      .query('events')
      .withIndex('by_org_and_guestSyncNeeded_and_startAt', (q) =>
        q.eq('orgId', orgId).eq('guestSyncNeeded', true),
      )
      .order('desc')
      .take(limit + skipped.size)
    return rows
      .filter((r) => !skipped.has(r._id))
      .slice(0, limit)
      .map((r) => ({
        _id: r._id,
        lumaEventId: r.lumaEventId,
        lumaAccess: r.lumaAccess ?? null,
      }))
  },
})

/** Keep the chain's lock, or release it when nothing is left to do. */
export const renewOrReleaseChain = internalMutation({
  args: {
    orgId: v.id('organizations'),
    error: v.optional(v.string()),
    // Hold the lock this long (e.g. while waiting out a rate limit).
    holdMs: v.optional(v.number()),
    // Stop even if events are still flagged (e.g. the org lost the key).
    release: v.optional(v.boolean()),
    // Flagged events this chain already failed to read. They wait for the
    // next chain, so they don't keep this one going.
    skip: v.optional(v.array(v.id('events'))),
  },
  returns: v.boolean(), // true: keep going
  handler: async (ctx, { orgId, error, holdMs, release, skip }) => {
    const state = await ensureState(ctx, orgId)
    const now = Date.now()
    const skipped = new Set(skip ?? [])
    const flagged = await ctx.db
      .query('events')
      .withIndex('by_org_and_guestSyncNeeded_and_startAt', (q) =>
        q.eq('orgId', orgId).eq('guestSyncNeeded', true),
      )
      .take(skipped.size + 1)
    const pending = flagged.some((row) => !skipped.has(row._id))
    if (pending && !release) {
      await ctx.db.patch('lumaSyncState', state._id, {
        chainLockedUntil: now + Math.max(CHAIN_LOCK_MS, holdMs ?? 0),
        lastChainError: error,
        updatedAt: now,
      })
      return true
    }
    await ctx.db.patch('lumaSyncState', state._id, {
      chainLockedUntil: undefined,
      lastChainFinishedAt: now,
      lastChainError: error,
      updatedAt: now,
    })
    return false
  },
})

/**
 * A page of an event's Luma history rows, in externalId order. `next` is
 * the `after` of the following page, or null on the last one.
 */
async function attendancePage(
  ctx: QueryCtx | MutationCtx,
  event: Pick<Doc<'events'>, 'orgId' | 'lumaEventId'>,
  after: string | undefined,
  limit: number,
): Promise<{ rows: Array<Doc<'crmActivities'>>; next: string | null }> {
  const prefix = attendanceExternalId(event.lumaEventId, '')
  // ';' sorts right after ':', so this is every id with the prefix.
  const end = `${prefix.slice(0, -1)};`
  const page = await ctx.db
    .query('crmActivities')
    .withIndex('by_orgId_and_externalId', (q) =>
      q
        .eq('orgId', event.orgId)
        .gt('externalId', after ?? prefix)
        .lt('externalId', end),
    )
    .take(limit)
  const last = page[page.length - 1]?.externalId
  return {
    rows: page.filter((row) => row.source === 'luma'),
    next: page.length === limit && last ? last : null,
  }
}

/** Shallow equality of two `data` bags, ignoring key order. */
function sameData(a: Record<string, unknown>, b: Record<string, unknown>) {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((k) => a[k] === b[k])
}

// Matching guests on contacts' other emails reads the org's contacts once
// per chunk; past this many, it needs an index instead.
const MAX_CONTACTS_FOR_OTHER_EMAILS = 5000

/** Contacts by each of their other emails (read only when needed). */
async function otherEmailIndex(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
): Promise<Map<string, Id<'crmContacts'>>> {
  const contacts = await ctx.db
    .query('crmContacts')
    .withIndex('by_orgId', (q) => q.eq('orgId', orgId))
    .take(MAX_CONTACTS_FOR_OTHER_EMAILS + 1)
  if (contacts.length > MAX_CONTACTS_FOR_OTHER_EMAILS) {
    throw new Error(
      `More than ${MAX_CONTACTS_FOR_OTHER_EMAILS} contacts: matching Luma guests on other emails needs an index`,
    )
  }
  const map = new Map<string, Id<'crmContacts'>>()
  for (const c of contacts) {
    for (const email of c.otherEmails ?? []) {
      map.set(email.trim().toLowerCase(), c._id)
    }
  }
  return map
}

/** Upsert contacts and history rows for part of an event's guest list. */
export const applyAttendanceChunk = internalMutation({
  args: {
    eventRowId: v.id('events'),
    guests: v.array(attendanceGuestValidator),
  },
  returns: v.object({
    contactsCreated: v.number(),
    activitiesInserted: v.number(),
    activitiesUpdated: v.number(),
  }),
  handler: async (ctx, { eventRowId, guests }) => {
    const result = {
      contactsCreated: 0,
      activitiesInserted: 0,
      activitiesUpdated: 0,
    }
    const event = await ctx.db.get('events', eventRowId)
    if (!event) return result
    const orgId = event.orgId
    const now = Date.now()
    let byOtherEmail: Map<string, Id<'crmContacts'>> | null = null
    // ASTN door check-ins for events managed in ASTN; Luma never sees them.
    const socialEvent = (
      await ctx.db
        .query('socialEvents')
        .withIndex('by_lumaEventId', (q) =>
          q.eq('lumaEventId', event.lumaEventId),
        )
        .take(10)
    ).find((e) => e.orgId === orgId)

    let defs: Map<string, Doc<'crmFieldDefs'>> | null = null
    const fieldValue = async (key: string, raw: unknown) => {
      if (!defs) {
        const list = await ensureBuiltinFieldDefs(ctx, orgId, 'contacts')
        defs = new Map(list.map((d) => [d.key, d]))
      }
      const def = defs.get(key)
      if (!def) return undefined
      const value = normalizeValue(def.type, raw)
      if (value !== undefined)
        defs.set(key, await addMissingOptions(ctx, def, value))
      return value
    }

    const touched = new Set<Id<'crmContacts'>>()
    for (const guest of guests) {
      // Contact: by primary email, then by other emails, else a new one.
      let contactId: Id<'crmContacts'> | null =
        (
          await ctx.db
            .query('crmContacts')
            .withIndex('by_orgId_and_email', (q) =>
              q.eq('orgId', orgId).eq('email', guest.email),
            )
            .first()
        )?._id ?? null
      if (!contactId) {
        byOtherEmail ??= await otherEmailIndex(ctx, orgId)
        const other = byOtherEmail.get(guest.email)
        const contact = other ? await ctx.db.get('crmContacts', other) : null
        if (contact && contact.orgId === orgId) contactId = contact._id
      }
      if (!contactId) {
        const fields: Record<string, FieldValue> = {}
        const source = await fieldValue('contactSource', 'Luma')
        if (source !== undefined) fields.contactSource = source
        const first = await fieldValue(
          'firstContact',
          guest.registeredAt ?? event.startAt,
        )
        if (first !== undefined) fields.firstContact = first
        contactId = await ctx.db.insert('crmContacts', {
          orgId,
          name: guest.name,
          email: guest.email,
          fields,
          createdAt: now,
          updatedAt: now,
        })
        result.contactsCreated++
      }

      let status: string = guest.status
      if (socialEvent && status !== 'checked_in') {
        const row = await getGuestByEmail(ctx, socialEvent._id, guest.email)
        if (row?.checkedInAt !== undefined) status = 'checked_in'
      }

      const externalId = attendanceExternalId(event.lumaEventId, guest.email)
      const data: Record<string, string | number> = {
        lumaEventId: event.lumaEventId,
        lumaGuestId: guest.lumaGuestId,
      }
      if (guest.checkedInAt !== undefined) data.checkedInAt = guest.checkedInAt
      const doc = {
        contactId,
        title: event.title,
        occurredAt: event.startAt,
        status,
        data,
      }
      const existing = await ctx.db
        .query('crmActivities')
        .withIndex('by_orgId_and_externalId', (q) =>
          q.eq('orgId', orgId).eq('externalId', externalId),
        )
        .first()
      if (!existing) {
        await ctx.db.insert('crmActivities', {
          orgId,
          kind: 'event',
          source: 'luma',
          externalId,
          createdAt: now,
          ...doc,
        })
        result.activitiesInserted++
        touched.add(contactId)
        continue
      }
      const changed =
        existing.contactId !== doc.contactId ||
        existing.title !== doc.title ||
        existing.occurredAt !== doc.occurredAt ||
        existing.status !== doc.status ||
        !sameData(existing.data ?? {}, doc.data)
      if (!changed) continue
      await ctx.db.patch('crmActivities', existing._id, doc)
      result.activitiesUpdated++
      touched.add(contactId)
      if (existing.contactId !== contactId) touched.add(existing.contactId)
    }

    const knownCanceled = new Map<string, boolean>()
    for (const contactId of touched) {
      await recomputeLumaCounts(ctx, contactId, knownCanceled)
    }
    if (result.contactsCreated > 0) {
      await bumpCount(ctx, orgId, 'contacts', result.contactsCreated)
    }
    return result
  },
})

/**
 * After reading an event's complete guest list: delete its Luma history
 * rows for people no longer on it (removed, or registered under another
 * email), and recompute their contacts. Works through the event's rows in
 * pages; call again with `after` until it returns `next: null`.
 */
export const pruneRemovedAttendance = internalMutation({
  args: {
    eventRowId: v.id('events'),
    keepEmails: v.array(v.string()),
    after: v.optional(v.string()),
  },
  returns: v.object({
    deleted: v.number(),
    next: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { eventRowId, keepEmails, after }) => {
    const event = await ctx.db.get('events', eventRowId)
    if (!event) return { deleted: 0, next: null }
    const prefix = attendanceExternalId(event.lumaEventId, '')
    const { rows, next } = await attendancePage(ctx, event, after, 200)
    const keep = new Set(keepEmails)
    const touched = new Set<Id<'crmContacts'>>()
    let deleted = 0
    for (const row of rows) {
      if (!row.externalId) continue
      if (keep.has(row.externalId.slice(prefix.length))) continue
      await ctx.db.delete('crmActivities', row._id)
      touched.add(row.contactId)
      deleted++
    }
    const knownCanceled = new Map<string, boolean>()
    for (const contactId of touched) {
      await recomputeLumaCounts(ctx, contactId, knownCanceled)
    }
    return { deleted, next }
  },
})

// ── Canceled events ─────────────────────────────────────────────────────

// Each contact's whole history is read to recount it.
const RECOUNT_PAGE = 100

/**
 * Recount attendance for everyone with a history row for these events, once
 * the calling mutation commits. Whether an event is canceled changes what
 * its rows count for (attendanceStatusShown), and the counts are stored on
 * the contacts, so they are recomputed when an event is canceled or comes
 * back.
 */
async function scheduleAttendanceRecount(
  ctx: MutationCtx,
  eventRowIds: Array<Id<'events'>>,
): Promise<void> {
  if (eventRowIds.length === 0) return
  await ctx.scheduler.runAfter(0, internal.luma.mirror.recountAttendance, {
    eventRowIds,
  })
}

/**
 * Recompute the Luma counts of every contact with a history row for these
 * events: one page of one event's rows per run, rescheduling itself until
 * all are done. Safe to run again at any time.
 */
export const recountAttendance = internalMutation({
  args: {
    eventRowIds: v.array(v.id('events')),
    // Continue the first event's rows after this externalId.
    after: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { eventRowIds, after }) => {
    if (eventRowIds.length === 0) return null
    const event = await ctx.db.get('events', eventRowIds[0])
    let next: string | null = null
    if (event) {
      const page = await attendancePage(ctx, event, after, RECOUNT_PAGE)
      const knownCanceled = new Map<string, boolean>()
      for (const contactId of new Set(page.rows.map((r) => r.contactId))) {
        await recomputeLumaCounts(ctx, contactId, knownCanceled)
      }
      next = page.next
    }
    const rest = next ? eventRowIds : eventRowIds.slice(1)
    if (rest.length > 0) {
      await ctx.scheduler.runAfter(0, internal.luma.mirror.recountAttendance, {
        eventRowIds: rest,
        after: next ?? undefined,
      })
    }
    return null
  },
})

/**
 * Recount attendance for every canceled event of the org, for running by
 * hand when the stored counts may not reflect the cancellations. Canceling
 * an event recounts that event on its own. Returns how many events it
 * queued.
 */
export const recountCanceledEvents = internalMutation({
  args: { orgId: v.id('organizations') },
  returns: v.number(),
  handler: async (ctx, { orgId }) => {
    const rows = await ctx.db
      .query('events')
      .withIndex('by_org', (q) => q.eq('orgId', orgId))
      .take(5000)
    const canceled = rows.filter((row) => row.canceled).map((row) => row._id)
    await scheduleAttendanceRecount(ctx, canceled)
    return canceled.length
  },
})

/** Record an event's guest sync: counts, time, and the run's totals. */
export const finishEventGuestSync = internalMutation({
  args: {
    eventRowId: v.id('events'),
    counts: v.optional(
      v.object({
        guestCount: v.number(),
        approvedCount: v.number(),
        pendingCount: v.number(),
        checkedInCount: v.number(),
      }),
    ),
    error: v.optional(v.string()),
    // With `error`: the failure may pass (see guestReadFailure), so the
    // event stays flagged and the next chain reads it again.
    retry: v.optional(v.boolean()),
    totals: syncTotalsValidator,
  },
  returns: v.null(),
  handler: async (ctx, { eventRowId, counts, error, retry, totals }) => {
    const event = await ctx.db.get('events', eventRowId)
    if (!event) return null
    const now = Date.now()
    const patch: Partial<Doc<'events'>> = {
      ...counts,
      lastGuestSyncAt: error ? event.lastGuestSyncAt : now,
      guestSyncError: error,
    }
    if (!(error && retry)) patch.guestSyncNeeded = undefined
    await ctx.db.patch('events', eventRowId, patch)
    const state = await ensureState(ctx, event.orgId)
    await ctx.db.patch('lumaSyncState', state._id, {
      totals: addTotals(state.totals, totals),
      updatedAt: now,
    })
    return null
  },
})
