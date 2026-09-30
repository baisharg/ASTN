import { useState } from 'react'
import type { Doc } from '../../../convex/_generated/dataModel'
import { DEFAULT_EVENT_TIMEZONE } from './shared'
import { TimezoneSelector } from '~/components/org/TimezoneSelector'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Textarea } from '~/components/ui/textarea'
import {
  differsFromBrowserZone,
  epochToZoned,
  timeOnEventNight,
  zonedToEpoch,
} from '~/lib/zoned-time'

/** The event's details as the admin types them: wall-clock times, raw text. */
export type EventDetailsValues = {
  title: string
  date: string
  startTime: string
  endTime: string
  timezone: string
  venueName: string
  venueAddress: string
  description: string
}

export const EMPTY_EVENT_DETAILS: EventDetailsValues = {
  title: '',
  date: '',
  startTime: '19:00',
  endTime: '',
  timezone: DEFAULT_EVENT_TIMEZONE,
  venueName: '',
  venueAddress: '',
  description: '',
}

export function detailsFromEvent(
  event: Doc<'socialEvents'>,
): EventDetailsValues {
  const start = epochToZoned(event.startAt, event.timezone)
  return {
    title: event.title,
    date: start.date,
    startTime: start.time,
    endTime: event.endAt ? epochToZoned(event.endAt, event.timezone).time : '',
    timezone: event.timezone,
    venueName: event.venueName ?? '',
    venueAddress: event.venueAddress ?? '',
    description: event.description ?? '',
  }
}

/**
 * Form state for an event's details. `toArgs` converts the wall-clock times
 * (in the event's timezone) to epoch ms; an end time earlier than the start
 * falls on the next day.
 */
export function useEventDetailsForm(initial: EventDetailsValues) {
  const [values, setValues] = useState(initial)

  const set = <K extends keyof EventDetailsValues>(
    key: K,
    value: EventDetailsValues[K],
  ) => setValues((prev) => ({ ...prev, [key]: value }))

  const canSave =
    values.title.trim() !== '' && values.date !== '' && values.startTime !== ''

  const toArgs = () => ({
    title: values.title.trim(),
    startAt: zonedToEpoch(values.date, values.startTime, values.timezone),
    endAt: values.endTime
      ? timeOnEventNight(
          values.date,
          values.startTime,
          values.endTime,
          values.timezone,
        )
      : null,
    timezone: values.timezone,
    venueName: values.venueName,
    venueAddress: values.venueAddress,
    description: values.description,
  })

  return { values, set, canSave, toArgs }
}

export type EventDetailsForm = ReturnType<typeof useEventDetailsForm>

export function EventDetailsFields({
  form,
  idPrefix,
}: {
  form: EventDetailsForm
  idPrefix: string
}) {
  const { values, set } = form
  const id = (field: string) => `${idPrefix}-${field}`

  return (
    <>
      <div className="space-y-1">
        <Label htmlFor={id('title')}>Nombre</Label>
        <Input
          id={id('title')}
          value={values.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="BAISH Social"
          required
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={id('date')}>Fecha</Label>
          <Input
            id={id('date')}
            type="date"
            value={values.date}
            onChange={(e) => set('date', e.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id('start')}>Empieza</Label>
          <Input
            id={id('start')}
            type="time"
            value={values.startTime}
            onChange={(e) => set('startTime', e.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id('end')}>Termina (opcional)</Label>
          <Input
            id={id('end')}
            type="time"
            value={values.endTime}
            onChange={(e) => set('endTime', e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={id('tz')}>Zona horaria</Label>
        <TimezoneSelector
          id={id('tz')}
          value={values.timezone}
          onChange={(tz) => set('timezone', tz)}
        />
        {differsFromBrowserZone(values.timezone) && (
          <p className="text-xs text-muted-foreground">
            Los horarios están en la hora del evento, no en la tuya.
          </p>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={id('venue')}>Lugar</Label>
          <Input
            id={id('venue')}
            value={values.venueName}
            onChange={(e) => set('venueName', e.target.value)}
            placeholder="Nombre del lugar"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id('address')}>Dirección</Label>
          <Input
            id={id('address')}
            value={values.venueAddress}
            onChange={(e) => set('venueAddress', e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={id('desc')}>Descripción</Label>
        <Textarea
          id={id('desc')}
          value={values.description}
          onChange={(e) => set('description', e.target.value)}
          rows={4}
        />
      </div>
    </>
  )
}
