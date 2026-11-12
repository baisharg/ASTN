import {
  changedEventDetails,
  detailsFromEvent,
  eventDetailsArgs,
  eventDetailsProblem,
} from './event-details'
import type { EventDetailsValues } from './event-details'
import { zonedToEpoch } from './zoned-time'

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

const TZ = 'America/Argentina/Buenos_Aires'
const at = (date: string, time: string) => zonedToEpoch(date, time, TZ)

const base = {
  title: 'BAISH Social',
  timezone: TZ,
  venueName: 'El lugar',
  venueAddress: 'Calle 123',
  description: 'Hola',
}

const values = (over: Partial<EventDetailsValues>): EventDetailsValues => ({
  ...base,
  date: '2026-10-10',
  startTime: '19:00',
  endTime: '',
  endDate: '',
  ...over,
})

describe('detailsFromEvent and eventDetailsArgs', () => {
  test('an event that ends the next evening keeps its end date', () => {
    const event = {
      ...base,
      startAt: at('2026-10-10', '10:00'),
      endAt: at('2026-10-11', '18:00'),
    }
    const form = detailsFromEvent(event)
    expect(form.date).toBe('2026-10-10')
    expect(form.startTime).toBe('10:00')
    expect(form.endDate).toBe('2026-10-11')
    expect(form.endTime).toBe('18:00')
    const args = eventDetailsArgs(form)
    expect(args.startAt).toBe(event.startAt)
    expect(args.endAt).toBe(event.endAt)
  })

  test('an event that ends after midnight needs no end date', () => {
    const event = {
      ...base,
      startAt: at('2026-10-10', '19:00'),
      endAt: at('2026-10-11', '01:00'),
    }
    const form = detailsFromEvent(event)
    expect(form.endDate).toBe('')
    expect(form.endTime).toBe('01:00')
    expect(eventDetailsArgs(form).endAt).toBe(event.endAt)
  })

  test('an event without an end stays without one', () => {
    const event = { ...base, startAt: at('2026-10-10', '19:00') }
    const form = detailsFromEvent(event)
    expect(form.endTime).toBe('')
    expect(form.endDate).toBe('')
    expect(eventDetailsArgs(form).endAt).toBe(null)
  })

  test('missing optional text becomes empty, and text is trimmed on the way out', () => {
    const form = detailsFromEvent({
      title: 'Evento',
      startAt: at('2026-10-10', '19:00'),
      timezone: TZ,
    })
    expect(form.venueName).toBe('')
    expect(form.description).toBe('')
    expect(eventDetailsArgs({ ...form, title: '  Evento  ' }).title).toBe(
      'Evento',
    )
  })

  test('times are read in the event timezone, not the browser one', () => {
    const args = eventDetailsArgs(
      values({ timezone: 'Europe/London', endTime: '22:00' }),
    )
    expect(args.startAt).toBe(
      zonedToEpoch('2026-10-10', '19:00', 'Europe/London'),
    )
    expect(args.endAt).toBe(
      zonedToEpoch('2026-10-10', '22:00', 'Europe/London'),
    )
  })
})

describe('eventDetailsProblem', () => {
  test('a complete form has no problem, with or without an end', () => {
    expect(eventDetailsProblem(values({}))).toBe(null)
    expect(eventDetailsProblem(values({ endTime: '23:00' }))).toBe(null)
    expect(
      eventDetailsProblem(values({ endDate: '2026-10-12', endTime: '09:00' })),
    ).toBe(null)
  })

  test('a title, a date and a start time are required', () => {
    expect(eventDetailsProblem(values({ title: '  ' }))).toBe('incomplete')
    expect(eventDetailsProblem(values({ date: '' }))).toBe('incomplete')
    expect(eventDetailsProblem(values({ startTime: '' }))).toBe('incomplete')
  })

  test('an end date needs an end time', () => {
    expect(eventDetailsProblem(values({ endDate: '2026-10-11' }))).toBe(
      'end_date_without_time',
    )
  })

  test('the end must be after the start', () => {
    expect(
      eventDetailsProblem(values({ endDate: '2026-10-09', endTime: '22:00' })),
    ).toBe('ends_before_start')
    expect(
      eventDetailsProblem(values({ endDate: '2026-10-10', endTime: '18:00' })),
    ).toBe('ends_before_start')
    // Same time as the start, no end date: a zero-length event.
    expect(eventDetailsProblem(values({ endTime: '19:00' }))).toBe(
      'ends_before_start',
    )
  })
})

describe('changedEventDetails', () => {
  const stored = detailsFromEvent({
    ...base,
    startAt: at('2026-10-10', '10:00'),
    // Seconds don't survive the form; they must not count as an edit.
    endAt: at('2026-10-11', '18:00') + 30_000,
  })

  test('an untouched form changes nothing', () => {
    expect(changedEventDetails(stored, { ...stored })).toEqual({})
  })

  test('only the edited text field is sent', () => {
    expect(
      changedEventDetails(stored, { ...stored, description: 'Otra cosa' }),
    ).toEqual({ description: 'Otra cosa' })
    expect(
      changedEventDetails(stored, { ...stored, venueAddress: '' }),
    ).toEqual({ venueAddress: '' })
  })

  test('surrounding spaces are not an edit', () => {
    expect(
      changedEventDetails(stored, { ...stored, title: ` ${stored.title} ` }),
    ).toEqual({})
  })

  test('a new start time leaves the end alone', () => {
    expect(
      changedEventDetails(stored, { ...stored, startTime: '11:00' }),
    ).toEqual({ startAt: at('2026-10-10', '11:00') })
  })

  test('a new date moves the start and a same-night end', () => {
    const night = detailsFromEvent({
      ...base,
      startAt: at('2026-10-10', '19:00'),
      endAt: at('2026-10-11', '01:00'),
    })
    expect(
      changedEventDetails(night, { ...night, date: '2026-10-17' }),
    ).toEqual({
      startAt: at('2026-10-17', '19:00'),
      endAt: at('2026-10-18', '01:00'),
    })
  })

  test('clearing the end time removes the end', () => {
    expect(
      changedEventDetails(stored, { ...stored, endTime: '', endDate: '' }),
    ).toEqual({ endAt: null })
  })

  test('a new timezone moves both times', () => {
    const changes = changedEventDetails(stored, {
      ...stored,
      timezone: 'Europe/London',
    })
    expect(changes.timezone).toBe('Europe/London')
    expect(changes.startAt).toBe(
      zonedToEpoch('2026-10-10', '10:00', 'Europe/London'),
    )
    expect(changes.endAt).toBe(
      zonedToEpoch('2026-10-11', '18:00', 'Europe/London'),
    )
  })
})
