import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalAction } from '../_generated/server'
import {
  LumaApiError,
  hasLumaApiKey,
  listAllLumaGuests,
  listLumaCalendarEvents,
  lumaCheckedInAt,
} from '../social/luma'
import { assertOrgOwnsApiCalendar, resolveApiCalendar } from './binding'
import {
  EMPTY_TOTALS,
  attendanceFromLuma,
  guestReadFailure,
  mirrorFromLuma,
} from './shared'
import type { ActionCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import type { LumaGuest } from '../social/luma'
import type { AttendanceGuest, OtherEmailContact, SyncTotals } from './shared'

/**
 * Mirror the org's Luma calendar through the official API
 * (docs/crm-consolidation.md, phase 4).
 *
 * 1. List the calendar's events (all of them the first time, then the last
 *    week onward) and upsert them into `events`, flagging the ones whose
 *    guest list needs reading.
 * 2. A chain of actions reads flagged events' guest lists and writes each
 *    guest as a CRM contact plus one `crmActivities` row per event.
 *
 * The flags live on the rows, so a chain that dies halfway is resumed by the
 * next cron run. An event whose guest list Luma failed to serve stays
 * flagged too, and the next chain reads it again. Luma allows 200 requests
 * a minute per calendar; the chain paces itself well under that and backs
 * off on 429.
 */

const RECENT_WINDOW_MS = 7 * 24 * 3600 * 1000
const EVENTS_PER_ACTION = 12
const PAUSE_BETWEEN_EVENTS_MS = 700
const RATE_LIMIT_BACKOFF_MS = 65 * 1000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}

async function syncEventsImpl(
  ctx: ActionCtx,
  orgId: Id<'organizations'>,
  mode: 'full' | 'recent',
  calendarId: string | undefined,
): Promise<{ listed: number; inserted: number; updated: number }> {
  const state = await ctx.runQuery(internal.luma.mirror.getSyncState, {
    orgId,
  })
  const full = mode === 'full' || !state?.historyDoneAt
  const now = Date.now()
  try {
    const events = await listLumaCalendarEvents(
      full ? undefined : { after: now - RECENT_WINDOW_MS },
    )
    const mirrored = events
      .map((e) => mirrorFromLuma(e, { listed: true }))
      .filter((e) => e.title && !Number.isNaN(e.startAt))
    let inserted = 0
    let updated = 0
    for (let i = 0; i < mirrored.length; i += 50) {
      const r = await ctx.runMutation(
        internal.luma.mirror.upsertMirroredEvents,
        {
          orgId,
          events: mirrored.slice(i, i + 50),
          // No notifications while filling in the calendar's history.
          notify: !!state?.historyDoneAt,
        },
      )
      inserted += r.inserted
      updated += r.updated
    }
    if (full) {
      await ctx.runMutation(internal.luma.mirror.markMissingCanceled, {
        orgId,
        seenIds: mirrored.map((e) => e.lumaEventId),
      })
    }
    await ctx.runMutation(internal.luma.mirror.recordEventsSync, {
      orgId,
      calendarId,
      historyDone: full,
    })
    await ctx.runMutation(internal.luma.mirror.startGuestSync, { orgId })
    return { listed: mirrored.length, inserted, updated }
  } catch (error) {
    console.error('Luma event sync failed', orgId, error)
    await ctx.runMutation(internal.luma.mirror.recordEventsSync, {
      orgId,
      error: errorMessage(error),
    })
    throw error
  }
}

/**
 * Sync one org's calendar. `full` lists every event; `recent` lists the
 * last week onward (it becomes full until the history has been read once).
 */
export const syncOrg = internalAction({
  args: {
    orgId: v.id('organizations'),
    mode: v.union(v.literal('full'), v.literal('recent')),
  },
  returns: v.object({
    listed: v.number(),
    inserted: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx, { orgId, mode }) => {
    await assertOrgOwnsApiCalendar(ctx, orgId)
    const { calendarId } = await resolveApiCalendar(ctx)
    return await syncEventsImpl(ctx, orgId, mode, calendarId)
  },
})

/** The one org bound to the API key's calendar (re-read from Luma). */
async function boundOrg(
  ctx: ActionCtx,
): Promise<{ calendarId: string; orgId: Id<'organizations'> | null }> {
  const { calendarId, orgId, boundOrgCount, ownerSource } =
    await resolveApiCalendar(ctx, { fresh: true })
  if (boundOrgCount === 0 && ownerSource === 'env') {
    console.error(
      `LUMA_OWNER_ORG_SLUG names no org, so no org may use the Luma key (calendar ${calendarId})`,
    )
  } else if (boundOrgCount === 0) {
    console.warn(
      `Luma calendar ${calendarId} matches no org; set the org's Luma calendar in its settings`,
    )
  } else if (boundOrgCount > 1) {
    console.error(
      `Luma calendar ${calendarId} matches ${boundOrgCount} orgs; none may use the key until only one does`,
    )
  }
  return { calendarId, orgId }
}

/** Cron: the org on the key's calendar, recent events only. */
export const syncRecent = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (!hasLumaApiKey()) return null
    const { calendarId, orgId } = await boundOrg(ctx)
    if (!orgId) return null
    try {
      await syncEventsImpl(ctx, orgId, 'recent', calendarId)
    } catch {
      // Recorded on the sync state; the next run retries.
    }
    return null
  },
})

/**
 * Which orgs the official API covers (at most one). The daily legacy sync
 * (convex/events/sync.ts) runs it through `syncOrg` instead.
 */
export const officialApiOrgs = internalAction({
  args: {},
  returns: v.array(v.id('organizations')),
  handler: async (ctx) => {
    if (!hasLumaApiKey()) return []
    try {
      const { orgId } = await boundOrg(ctx)
      return orgId ? [orgId] : []
    } catch (error) {
      console.error('Could not read the Luma calendar', error)
      return []
    }
  },
})

// ── Guest-sync chain ────────────────────────────────────────────────────

type EventSyncResult = {
  counts?: {
    guestCount: number
    approvedCount: number
    pendingCount: number
    checkedInCount: number
  }
  totals: SyncTotals
}

// Contacts read per page when collecting their other emails.
const OTHER_EMAILS_PAGE_SIZE = 500
// Stops a cursor that never finishes; far more contacts than any org has.
const OTHER_EMAILS_MAX_PAGES = 2000

/**
 * The org's contacts by each of their other emails, read page by page so
 * the number of contacts has no limit. A guest who registered with one of
 * these addresses belongs to that contact instead of becoming a new one.
 */
async function readOtherEmailContacts(
  ctx: ActionCtx,
  orgId: Id<'organizations'>,
): Promise<Map<string, Id<'crmContacts'>>> {
  const byEmail = new Map<string, Id<'crmContacts'>>()
  let cursor: string | null = null
  for (let page = 0; page < OTHER_EMAILS_MAX_PAGES; page++) {
    const result: {
      entries: Array<OtherEmailContact>
      continueCursor: string
      isDone: boolean
    } = await ctx.runQuery(internal.luma.mirror.listContactOtherEmails, {
      orgId,
      paginationOpts: { numItems: OTHER_EMAILS_PAGE_SIZE, cursor },
    })
    for (const entry of result.entries) {
      byEmail.set(entry.email, entry.contactId)
    }
    if (result.isDone) return byEmail
    cursor = result.continueCursor
  }
  throw new Error("Reading the contacts' other emails did not finish")
}

/**
 * Write an event's complete guest list into the CRM. `otherEmailContacts`
 * is the org's contacts by other email (readOtherEmailContacts).
 */
async function writeEventGuests(
  ctx: ActionCtx,
  event: { _id: Id<'events'>; lumaEventId: string },
  guests: Array<LumaGuest>,
  otherEmailContacts: Map<string, Id<'crmContacts'>>,
): Promise<EventSyncResult> {
  const totals: SyncTotals = { ...EMPTY_TOTALS, eventsGuestSynced: 1 }
  const counts = {
    guestCount: 0,
    approvedCount: 0,
    pendingCount: 0,
    checkedInCount: 0,
  }
  const rows: Array<AttendanceGuest> = []
  const seen = new Set<string>()
  for (const guest of guests) {
    const row = attendanceFromLuma(guest, lumaCheckedInAt(guest))
    if (!row || seen.has(row.email)) continue
    seen.add(row.email)
    rows.push(row)
    counts.guestCount++
    if (row.status === 'approved' || row.status === 'checked_in') {
      counts.approvedCount++
    }
    if (row.status === 'pending') counts.pendingCount++
    if (row.status === 'checked_in') counts.checkedInCount++
  }
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100)
    const r = await ctx.runMutation(internal.luma.mirror.applyAttendanceChunk, {
      eventRowId: event._id,
      guests: chunk,
      otherEmailContacts: chunk.flatMap((guest) => {
        const contactId = otherEmailContacts.get(guest.email)
        return contactId ? [{ email: guest.email, contactId }] : []
      }),
    })
    totals.contactsCreated += r.contactsCreated
    totals.activitiesInserted += r.activitiesInserted
    totals.activitiesUpdated += r.activitiesUpdated
  }
  // The list is complete: drop history rows of people no longer on it.
  const keepEmails = [...seen]
  let after: string | undefined
  for (let page = 0; page < 1000; page++) {
    const r = await ctx.runMutation(
      internal.luma.mirror.pruneRemovedAttendance,
      { eventRowId: event._id, keepEmails, after },
    )
    totals.activitiesDeleted = (totals.activitiesDeleted ?? 0) + r.deleted
    if (!r.next) break
    after = r.next
  }
  totals.guestsProcessed = rows.length
  return { counts, totals }
}

/**
 * One link of the chain: sync the guests of up to EVENTS_PER_ACTION flagged
 * events, then schedule the next link while any remain. Started by
 * `kickGuestSync`, which holds the org's lock.
 *
 * `skip` holds the events whose guest list Luma failed to serve earlier in
 * this chain. They stay flagged, but this chain doesn't read them again: it
 * goes on with the other events and ends when only those are left, so a
 * failing event can neither keep the chain running nor hold up the rest.
 */
export const guestChain = internalAction({
  args: {
    orgId: v.id('organizations'),
    skip: v.optional(v.array(v.id('events'))),
  },
  returns: v.null(),
  handler: async (ctx, { orgId, skip }) => {
    if (!hasLumaApiKey()) {
      await ctx.runMutation(internal.luma.mirror.renewOrReleaseChain, {
        orgId,
        error: 'LUMA_API_KEY is not set',
      })
      return null
    }
    // The key must still belong to this org's calendar.
    try {
      await assertOrgOwnsApiCalendar(ctx, orgId)
    } catch (error) {
      await ctx.runMutation(internal.luma.mirror.renewOrReleaseChain, {
        orgId,
        error: errorMessage(error),
        release: true,
      })
      return null
    }
    const failedReads = [...(skip ?? [])]
    const batch = await ctx.runQuery(internal.luma.mirror.nextGuestSyncBatch, {
      orgId,
      limit: EVENTS_PER_ACTION,
      skip: failedReads,
    })

    let lastError: string | undefined
    // Read once for the whole batch, before the first event that needs it.
    let otherEmailContacts: Map<string, Id<'crmContacts'>> | null = null
    for (const event of batch) {
      if (event.lumaAccess !== 'manage' && event.lumaAccess !== null) {
        await ctx.runMutation(internal.luma.mirror.finishEventGuestSync, {
          eventRowId: event._id,
          totals: EMPTY_TOTALS,
        })
        continue
      }

      // Throws rather than return a cut-off list.
      let guests: Array<LumaGuest>
      try {
        guests = await listAllLumaGuests(event.lumaEventId)
      } catch (error) {
        const failure = guestReadFailure(error)
        if (failure === 'rate_limited') {
          // Leave the event flagged and come back after the window.
          const keepGoing = await ctx.runMutation(
            internal.luma.mirror.renewOrReleaseChain,
            {
              orgId,
              error: 'Rate limited by Luma; retrying in a minute',
              holdMs: RATE_LIMIT_BACKOFF_MS * 2,
              skip: failedReads,
            },
          )
          if (keepGoing) {
            await ctx.scheduler.runAfter(
              RATE_LIMIT_BACKOFF_MS,
              internal.luma.sync.guestChain,
              { orgId, skip: failedReads },
            )
          }
          return null
        }
        lastError = errorMessage(error)
        console.error('Luma guest list not read', event.lumaEventId, error)
        await ctx.runMutation(internal.luma.mirror.finishEventGuestSync, {
          eventRowId: event._id,
          error:
            error instanceof LumaApiError && error.status === 404
              ? 'Luma no encontró el evento'
              : lastError,
          retry: failure === 'transient',
          totals: EMPTY_TOTALS,
        })
        if (failure === 'transient') failedReads.push(event._id)
        await sleep(PAUSE_BETWEEN_EVENTS_MS)
        continue
      }

      try {
        otherEmailContacts ??= await readOtherEmailContacts(ctx, orgId)
        const result = await writeEventGuests(
          ctx,
          event,
          guests,
          otherEmailContacts,
        )
        await ctx.runMutation(internal.luma.mirror.finishEventGuestSync, {
          eventRowId: event._id,
          counts: result.counts,
          totals: result.totals,
        })
      } catch (error) {
        // Luma answered; writing the guests failed. Reading the list again
        // would fail the same way, so the event is not kept flagged.
        lastError = errorMessage(error)
        console.error('Luma guest sync failed', event.lumaEventId, error)
        await ctx.runMutation(internal.luma.mirror.finishEventGuestSync, {
          eventRowId: event._id,
          error: lastError,
          totals: EMPTY_TOTALS,
        })
      }
      await sleep(PAUSE_BETWEEN_EVENTS_MS)
    }

    const keepGoing = await ctx.runMutation(
      internal.luma.mirror.renewOrReleaseChain,
      { orgId, error: lastError, skip: failedReads },
    )
    if (keepGoing) {
      await ctx.scheduler.runAfter(0, internal.luma.sync.guestChain, {
        orgId,
        skip: failedReads,
      })
    }
    return null
  },
})
