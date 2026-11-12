import { useState } from 'react'
import { DEFAULT_EVENT_TIMEZONE } from './shared'
import { TimezoneSelector } from '~/components/org/TimezoneSelector'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Textarea } from '~/components/ui/textarea'
import { eventDetailsArgs, eventDetailsProblem } from '~/lib/event-details'
import type { EventDetailsValues } from '~/lib/event-details'
import { differsFromBrowserZone } from '~/lib/zoned-time'

export const EMPTY_EVENT_DETAILS: EventDetailsValues = {
  title: '',
  date: '',
  startTime: '19:00',
  endTime: '',
  endDate: '',
  timezone: DEFAULT_EVENT_TIMEZONE,
  venueName: '',
  venueAddress: '',
  description: '',
}

/**
 * Form state for an event's details. `toArgs` converts the wall-clock times
 * (in the event's timezone) to epoch ms; see `eventDetailsArgs`.
 */
export function useEventDetailsForm(initial: EventDetailsValues) {
  const [values, setValues] = useState(initial)

  const set = <K extends keyof EventDetailsValues>(
    key: K,
    value: EventDetailsValues[K],
  ) => setValues((prev) => ({ ...prev, [key]: value }))

  const problem = eventDetailsProblem(values)
  const toArgs = () => eventDetailsArgs(values)

  return { values, set, problem, canSave: problem === null, toArgs }
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
  const endProblem =
    form.problem === 'ends_before_start'
      ? 'El evento tiene que terminar después de empezar.'
      : form.problem === 'end_date_without_time'
        ? 'Si ponés una fecha de fin, poné también la hora en que termina.'
        : null

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
        <Label htmlFor={id('end-date')}>Fecha de fin (opcional)</Label>
        <Input
          id={id('end-date')}
          type="date"
          value={values.endDate}
          min={values.date}
          onChange={(e) => set('endDate', e.target.value)}
          aria-describedby={id('end-date-help')}
          aria-invalid={endProblem ? true : undefined}
        />
        <p id={id('end-date-help')} className="text-xs text-muted-foreground">
          Solo si dura más de un día. Vacía: termina esa noche (o la madrugada
          siguiente).
        </p>
        {endProblem && (
          <p className="text-sm text-red-600" role="alert">
            {endProblem}
          </p>
        )}
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
