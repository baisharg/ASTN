/**
 * An ASTN event's details as the admin form holds them (wall-clock dates and
 * times in the event's timezone, raw text) and their conversion to what the
 * backend stores (epoch ms).
 */
import { epochToZoned, timeOnEventNight, zonedToEpoch } from './zoned-time'

export type EventDetailsValues = {
  title: string
  date: string
  startTime: string
  endTime: string
  // Only for events spanning several days; blank means "the event's night".
  endDate: string
  timezone: string
  venueName: string
  venueAddress: string
  description: string
}

/** The stored fields the form edits. */
export type StoredEventDetails = {
  title: string
  startAt: number
  endAt?: number
  timezone: string
  venueName?: string
  venueAddress?: string
  description?: string
}

/** The details as `createEvent` and `updateEvent` take them. */
export type EventDetailsArgs = {
  title: string
  startAt: number
  endAt: number | null
  timezone: string
  venueName: string
  venueAddress: string
  description: string
}

export function detailsFromEvent(
  event: StoredEventDetails,
): EventDetailsValues {
  const start = epochToZoned(event.startAt, event.timezone)
  const end =
    event.endAt === undefined ? null : epochToZoned(event.endAt, event.timezone)
  // Ends the same night (up to the next morning): no separate end date.
  const sameNight =
    end !== null &&
    timeOnEventNight(start.date, start.time, end.time, event.timezone) ===
      event.endAt
  return {
    title: event.title,
    date: start.date,
    startTime: start.time,
    endTime: end?.time ?? '',
    endDate: end === null || sameNight ? '' : end.date,
    timezone: event.timezone,
    venueName: event.venueName ?? '',
    venueAddress: event.venueAddress ?? '',
    description: event.description ?? '',
  }
}

/**
 * Wall-clock times to epoch ms. Without an end date, an end time earlier than
 * the start falls on the next day; without an end time there is no end.
 */
export function eventDetailsArgs(values: EventDetailsValues): EventDetailsArgs {
  const { date, startTime, endDate, endTime, timezone } = values
  let endAt: number | null = null
  if (endTime) {
    endAt = endDate
      ? zonedToEpoch(endDate, endTime, timezone)
      : timeOnEventNight(date, startTime, endTime, timezone)
  }
  return {
    title: values.title.trim(),
    startAt: zonedToEpoch(date, startTime, timezone),
    endAt,
    timezone,
    venueName: values.venueName.trim(),
    venueAddress: values.venueAddress.trim(),
    description: values.description.trim(),
  }
}

/** What stops the form from being saved, or null. */
export function eventDetailsProblem(
  values: EventDetailsValues,
): 'incomplete' | 'end_date_without_time' | 'ends_before_start' | null {
  if (!values.title.trim() || !values.date || !values.startTime) {
    return 'incomplete'
  }
  if (values.endDate && !values.endTime) return 'end_date_without_time'
  const { startAt, endAt } = eventDetailsArgs(values)
  if (endAt !== null && !(endAt > startAt)) return 'ends_before_start'
  return null
}
