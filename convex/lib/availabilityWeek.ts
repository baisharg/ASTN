/**
 * Generic-week availability model — single source of truth for both the Convex
 * backend and the React frontend.
 *
 * Availability polls ask about a *generic* week (no specific calendar dates).
 * A weekday is identified by an index 0..6 where **0 = Monday … 6 = Sunday**.
 * Slot keys stored in `availabilityResponses.slots` use the format
 * `"<weekdayIndex>|<minutesFromMidnight>"` (e.g. `"0|540"` = Monday 9:00 AM).
 */

export const WEEKDAY_SHORT = [
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun',
] as const

export const WEEKDAY_LONG = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const

/** All weekday indices Monday→Sunday. */
export const ALL_WEEKDAYS: ReadonlyArray<number> = [0, 1, 2, 3, 4, 5, 6]

/** Convert a JS `Date.getDay()` value (0 = Sunday) to our index (0 = Monday). */
export function jsDayToWeekdayIndex(jsDay: number): number {
  return (jsDay + 6) % 7
}

/**
 * Convert an ISO date string "YYYY-MM-DD" to our weekday index (0 = Monday).
 * Parsed in UTC so the result is independent of the runtime timezone.
 */
export function isoDateToWeekdayIndex(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return jsDayToWeekdayIndex(new Date(Date.UTC(y, m - 1, d)).getUTCDay())
}

/** Build a slot key from a weekday index and minutes-from-midnight. */
export function slotKey(dayIndex: number, minutes: number): string {
  return `${dayIndex}|${minutes}`
}

/** Short label (e.g. "Mon") for a weekday index, or "?" if out of range. */
export function weekdayShort(dayIndex: number): string {
  return WEEKDAY_SHORT[dayIndex] ?? '?'
}

/** Long label (e.g. "Monday") for a weekday index, or "?" if out of range. */
export function weekdayLong(dayIndex: number): string {
  return WEEKDAY_LONG[dayIndex] ?? '?'
}

/** Normalize a list of weekday indices: dedupe, keep 0..6, sort Mon→Sun. */
export function normalizeDays(days: ReadonlyArray<number>): Array<number> {
  return [...new Set(days)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b)
}
