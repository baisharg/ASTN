/**
 * Wall-clock time in an IANA timezone <-> epoch ms.
 *
 * Admins may enter an event's times from a different timezone than the
 * event's, so the browser's own offset must never be used for these.
 */
import { addDays, format, parseISO } from 'date-fns'
import { formatInTimeZone, fromZonedTime, getTimezoneOffset } from 'date-fns-tz'

/** "2026-10-10" + "19:30" in `timeZone` → epoch ms. */
export function zonedToEpoch(
  date: string,
  time: string,
  timeZone: string,
): number {
  return fromZonedTime(`${date}T${time}:00`, timeZone).getTime()
}

/** Epoch ms → { date: "2026-10-10", time: "19:30" } in `timeZone`. */
export function epochToZoned(
  ms: number,
  timeZone: string,
): { date: string; time: string } {
  return {
    date: formatInTimeZone(ms, timeZone, 'yyyy-MM-dd'),
    time: formatInTimeZone(ms, timeZone, 'HH:mm'),
  }
}

/** "2026-10-10" → "2026-10-11". */
export function nextDate(date: string): string {
  return format(addDays(parseISO(date), 1), 'yyyy-MM-dd')
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
  try {
    const now = new Date()
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone
    return getTimezoneOffset(browser, now) !== getTimezoneOffset(timeZone, now)
  } catch {
    return false
  }
}

/** "sábado, 10 de octubre, 19:00" in the event's timezone. */
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
