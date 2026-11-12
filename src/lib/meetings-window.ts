/**
 * When an event's 1:1s open and close, from the wall-clock times an admin
 * types (in the event's timezone). The effective window follows
 * `meetingsWindow` in convex/social/lib.ts: without explicit times, 1:1s run
 * for as long as the event does.
 */
import { DEFAULT_EVENT_HOURS } from '../../convex/social/constants'
import { epochToZoned, nextDate, zonedToEpoch } from './zoned-time'

export type EventSpan = { startAt: number; endAt?: number; timezone: string }

/** When the event ends: its end, or DEFAULT_EVENT_HOURS after its start. */
export function eventEndAt(event: EventSpan): number {
  return event.endAt ?? event.startAt + DEFAULT_EVENT_HOURS * 3600 * 1000
}

// Far more days than any event lasts; only stops a bad date from looping.
const MAX_EVENT_DAYS = 60

/** `time` on every calendar day of the event, and on the day after it. */
function occurrences(time: string, event: EventSpan): Array<number> {
  const lastDate = epochToZoned(eventEndAt(event), event.timezone).date
  const result: Array<number> = []
  let date = epochToZoned(event.startAt, event.timezone).date
  for (let i = 0; i < MAX_EVENT_DAYS; i++) {
    result.push(zonedToEpoch(date, time, event.timezone))
    if (date > lastDate) break
    date = nextDate(date)
  }
  return result
}

/**
 * The moment 1:1s open for an opening time: the first time the clock shows
 * it while the event is on. A time outside the event's hours is taken on the
 * event's first day, so "18:30" for an event starting at 19:00 opens 1:1s
 * half an hour early.
 */
export function resolveMeetingsOpen(time: string, event: EventSpan): number {
  const all = occurrences(time, event)
  const end = eventEndAt(event)
  return all.find((t) => t >= event.startAt && t < end) ?? all[0]
}

/**
 * The moment 1:1s close for a closing time: the last time the clock shows it
 * while the event is on, or else the first time after the event ends.
 */
export function resolveMeetingsClose(time: string, event: EventSpan): number {
  const all = occurrences(time, event)
  const end = eventEndAt(event)
  const during = all.filter((t) => t > event.startAt && t <= end)
  if (during.length > 0) return during[during.length - 1]
  return all.find((t) => t > end) ?? all[all.length - 1]
}

export type MeetingsWindowProblem =
  | 'closes_before_opening'
  | 'opens_after_event'
  | 'closes_before_event'

/**
 * Why a 1:1 window can never be used during the event, or null when it can.
 * `openAt` / `closeAt` are the explicit times (null: follow the event).
 */
export function meetingsWindowProblem(
  event: EventSpan,
  openAt: number | null,
  closeAt: number | null,
): MeetingsWindowProblem | null {
  const end = eventEndAt(event)
  const opens = openAt ?? event.startAt
  const closes = closeAt ?? end
  if (opens >= end) return 'opens_after_event'
  if (closes <= event.startAt) return 'closes_before_event'
  if (closes <= opens) return 'closes_before_opening'
  return null
}
