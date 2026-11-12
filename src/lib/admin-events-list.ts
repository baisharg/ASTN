/**
 * The admin events list: the org's Luma calendar events and its ASTN events
 * as one chronological list. A Luma event managed in ASTN and its ASTN event
 * are one row; every other event is a row of its own, so nothing is dropped.
 */

/** A Luma calendar event as the list needs it (the calendar mirror's row). */
export type LumaListEvent = {
  lumaEventId: string
  title: string
  startAt: number
  timezone: string
  // The ASTN event that manages it, when there is one.
  socialEventId: string | null
}

/** An ASTN event as the list needs it. */
export type AstnListEvent = {
  _id: string
  title: string
  startAt: number
  timezone: string
}

export type AdminEventRow<
  Luma extends LumaListEvent,
  Astn extends AstnListEvent,
> = {
  key: string
  // Shown title and time: the ASTN event's when it is loaded (its details
  // are the ones admins edit), otherwise Luma's.
  title: string
  startAt: number
  timezone: string
  luma: Luma | null
  // Null for a Luma event that isn't managed in ASTN, and for a managed one
  // whose ASTN event isn't among the ones loaded.
  astn: Astn | null
  // The ASTN event to open, known even when `astn` isn't loaded.
  astnEventId: NonNullable<Luma['socialEventId']> | Astn['_id'] | null
}

/** Where an event exists. */
export type EventPlace = 'luma_and_astn' | 'astn' | 'luma'

export function eventPlace(row: {
  luma: object | null
  // `lumaLinked`: the ASTN event is linked to a Luma event, which may not be
  // on the list (e.g. it is no longer on the calendar).
  astn: { lumaLinked: boolean } | null
  astnEventId: string | null
}): EventPlace {
  if (row.astnEventId === null) return 'luma'
  return row.luma !== null || row.astn?.lumaLinked === true
    ? 'luma_and_astn'
    : 'astn'
}

// An event that started less than this long ago still counts as upcoming
// (the same rule as listLumaEvents in convex/luma/admin.ts).
export const STILL_UPCOMING_MS = 12 * 3600 * 1000

export function mergeAdminEvents<
  Luma extends LumaListEvent,
  Astn extends AstnListEvent,
>(args: {
  luma: Array<Luma>
  astn: Array<Astn>
  now: number
}): {
  upcoming: Array<AdminEventRow<Luma, Astn>>
  past: Array<AdminEventRow<Luma, Astn>>
} {
  const astnById = new Map(args.astn.map((event) => [event._id, event]))
  const joined = new Set<string>()
  const rows: Array<AdminEventRow<Luma, Astn>> = []

  for (const luma of args.luma) {
    const astn =
      luma.socialEventId === null
        ? null
        : (astnById.get(luma.socialEventId) ?? null)
    if (astn) joined.add(astn._id)
    rows.push({
      key: `luma:${luma.lumaEventId}`,
      title: astn?.title ?? luma.title,
      startAt: astn?.startAt ?? luma.startAt,
      timezone: astn?.timezone ?? luma.timezone,
      luma,
      astn,
      astnEventId: luma.socialEventId as NonNullable<
        Luma['socialEventId']
      > | null,
    })
  }
  for (const astn of args.astn) {
    if (joined.has(astn._id)) continue
    rows.push({
      key: `astn:${astn._id}`,
      title: astn.title,
      startAt: astn.startAt,
      timezone: astn.timezone,
      luma: null,
      astn,
      astnEventId: astn._id,
    })
  }

  const cutoff = args.now - STILL_UPCOMING_MS
  return {
    upcoming: rows
      .filter((row) => row.startAt >= cutoff)
      .sort((a, b) => a.startAt - b.startAt),
    past: rows
      .filter((row) => row.startAt < cutoff)
      .sort((a, b) => b.startAt - a.startAt),
  }
}
