/**
 * Wall-clock time in an IANA timezone <-> epoch ms, with Intl only.
 *
 * Admins may enter an event's times from a different timezone than the
 * event's, so the browser's own offset must never be used for these.
 */

const partsFormatters = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = partsFormatters.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    partsFormatters.set(timeZone, fmt)
  }
  return fmt
}

function zonedParts(ms: number, timeZone: string) {
  const out: Record<string, number> = {}
  for (const p of partsFormatter(timeZone).formatToParts(ms)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value)
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  }
}

/** Offset of `timeZone` from UTC at instant `ms`, in ms (UTC-3 → -3h). */
function offsetAt(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(ms / 1000) * 1000
}

/** "2026-10-10" + "19:30" in `timeZone` → epoch ms. */
export function zonedToEpoch(
  date: string,
  time: string,
  timeZone: string,
): number {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const naive = Date.UTC(y, m - 1, d, hh, mm)
  // Two passes settle the offset around DST changes.
  const first = naive - offsetAt(naive, timeZone)
  const second = naive - offsetAt(first, timeZone)
  return second
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Epoch ms → { date: "2026-10-10", time: "19:30" } in `timeZone`. */
export function epochToZoned(
  ms: number,
  timeZone: string,
): { date: string; time: string } {
  const p = zonedParts(ms, timeZone)
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  }
}

/** "2026-10-10" → "2026-10-11". */
export function nextDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`
}

/**
 * A time on the night of an event. Times earlier than the event's start
 * belong to the following day (an event at 19:00 that ends at 01:00).
 */
export function timeOnEventNight(
  eventDate: string,
  eventStartTime: string,
  time: string,
  timeZone: string,
): number {
  const date = time < eventStartTime ? nextDate(eventDate) : eventDate
  return zonedToEpoch(date, time, timeZone)
}

/** Whether the browser is in a different timezone from `timeZone` right now. */
export function differsFromBrowserZone(timeZone: string): boolean {
  const now = Date.now()
  try {
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone
    return offsetAt(now, browser) !== offsetAt(now, timeZone)
  } catch {
    return false
  }
}

/** "sábado 10 de octubre, 19:00" in the event's timezone. */
export function formatEventDateTime(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ms)
}

/** "10 oct 2026" in the event's timezone. */
export function formatEventDateShort(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(ms)
}
