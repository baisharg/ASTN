import { useState } from 'react'
import { DEFAULT_EVENT_TIMEZONE } from './shared'
import { VISIBILITY_LABELS } from './luma-shared'
import type { LumaVisibility } from './luma-shared'
import { TimezoneSelector } from '~/components/org/TimezoneSelector'
import { Checkbox } from '~/components/ui/checkbox'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Switch } from '~/components/ui/switch'
import { Textarea } from '~/components/ui/textarea'
import {
  differsFromBrowserZone,
  epochToZoned,
  timeOnEventNight,
  zonedToEpoch,
} from '~/lib/zoned-time'

/** A Luma event's settings as the admin types them (wall-clock times). */
export type LumaEventValues = {
  name: string
  date: string
  startTime: string
  endTime: string
  // Only for events spanning several days; blank means "the event's night".
  endDate: string
  timezone: string
  descriptionMd: string
  address: string
  visibility: LumaVisibility
  capacity: string // blank: no limit
  requireApproval: boolean
}

export const EMPTY_LUMA_EVENT: LumaEventValues = {
  name: '',
  date: '',
  startTime: '19:00',
  endTime: '22:00',
  endDate: '',
  timezone: DEFAULT_EVENT_TIMEZONE,
  descriptionMd: '',
  address: '',
  visibility: 'public',
  capacity: '',
  requireApproval: true,
}

export function valuesFromLuma(e: {
  name: string
  startAt: number
  endAt: number
  timezone: string
  descriptionMd: string
  address: string
  visibility: LumaVisibility
  maxCapacity: number | null
  requireApproval: boolean
}): LumaEventValues {
  const start = epochToZoned(e.startAt, e.timezone)
  const end = epochToZoned(e.endAt, e.timezone)
  // Ends the same night (up to the next morning): no separate end date.
  const sameNight =
    timeOnEventNight(start.date, start.time, end.time, e.timezone) === e.endAt
  return {
    name: e.name,
    date: start.date,
    startTime: start.time,
    endTime: end.time,
    endDate: sameNight ? '' : end.date,
    timezone: e.timezone,
    descriptionMd: e.descriptionMd,
    address: e.address,
    visibility: e.visibility,
    capacity: e.maxCapacity === null ? '' : String(e.maxCapacity),
    requireApproval: e.requireApproval,
  }
}

/** The values as the Luma actions take them (epoch ms, null capacity). */
export function lumaArgs(values: LumaEventValues) {
  const capacity = values.capacity.trim()
  return {
    name: values.name.trim(),
    startAt: zonedToEpoch(values.date, values.startTime, values.timezone),
    // An end earlier than the start is on the next day.
    endAt: values.endDate
      ? zonedToEpoch(values.endDate, values.endTime, values.timezone)
      : timeOnEventNight(
          values.date,
          values.startTime,
          values.endTime,
          values.timezone,
        ),
    timezone: values.timezone,
    descriptionMd: values.descriptionMd,
    address: values.address,
    visibility: values.visibility,
    maxCapacity: capacity ? Math.max(1, Math.round(Number(capacity))) : null,
    requireApproval: values.requireApproval,
  }
}

export function useLumaEventForm(initial: LumaEventValues) {
  const [values, setValues] = useState(initial)
  const set = <K extends keyof LumaEventValues>(
    key: K,
    value: LumaEventValues[K],
  ) => setValues((prev) => ({ ...prev, [key]: value }))
  const capacity = values.capacity.trim()
  const capacityValid =
    !capacity || (Number.isFinite(Number(capacity)) && Number(capacity) >= 1)
  const endAfterStart =
    !values.date ||
    !values.startTime ||
    !values.endTime ||
    lumaArgs(values).endAt > lumaArgs(values).startAt
  const canSave =
    endAfterStart &&
    values.name.trim() !== '' &&
    values.date !== '' &&
    values.startTime !== '' &&
    values.endTime !== '' &&
    capacityValid
  return { values, set, setValues, canSave, capacityValid }
}

export type LumaEventForm = ReturnType<typeof useLumaEventForm>

/**
 * The fields of a Luma event. With `settingsOnly`, just the settings ASTN
 * doesn't hold itself (for events managed in ASTN, whose details are edited
 * on their ASTN page).
 */
export function LumaEventFields({
  form,
  idPrefix,
  settingsOnly = false,
  editing = false,
}: {
  form: LumaEventForm
  idPrefix: string
  settingsOnly?: boolean
  // Editing an existing Luma event (not creating one).
  editing?: boolean
}) {
  const { values, set } = form
  const id = (field: string) => `${idPrefix}-${field}`

  return (
    <>
      {!settingsOnly && (
        <>
          <div className="space-y-1">
            <Label htmlFor={id('name')}>Nombre</Label>
            <Input
              id={id('name')}
              value={values.name}
              onChange={(e) => set('name', e.target.value)}
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
              <Label htmlFor={id('end')}>Termina</Label>
              <Input
                id={id('end')}
                type="time"
                value={values.endTime}
                onChange={(e) => set('endTime', e.target.value)}
                required
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
            />
            <p
              id={id('end-date-help')}
              className="text-xs text-muted-foreground"
            >
              Solo si dura más de un día. Vacía: termina esa noche (o la
              madrugada siguiente).
            </p>
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
          <div className="space-y-1">
            <Label htmlFor={id('address')}>Dirección</Label>
            <Input
              id={id('address')}
              value={values.address}
              onChange={(e) => set('address', e.target.value)}
              placeholder="Calle 123, Buenos Aires"
            />
            {editing && !values.address.trim() && (
              <p className="text-xs text-muted-foreground">
                Luma no deja borrar la dirección desde ASTN: si la dejás vacía,
                en Luma queda la que tenía. Para cambiarla, escribí otra.
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor={id('desc')}>Descripción</Label>
            <Textarea
              id={id('desc')}
              value={values.descriptionMd}
              onChange={(e) => set('descriptionMd', e.target.value)}
              rows={6}
              aria-describedby={id('desc-help')}
            />
            <p id={id('desc-help')} className="text-xs text-muted-foreground">
              Acepta Markdown: **negrita**, _cursiva_, listas y enlaces.
            </p>
          </div>
        </>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={id('visibility')}>Visibilidad</Label>
          <Select
            value={values.visibility}
            onValueChange={(v) => set('visibility', v as LumaVisibility)}
          >
            <SelectTrigger id={id('visibility')} className="min-h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(VISIBILITY_LABELS) as Array<LumaVisibility>).map(
                (v) => (
                  <SelectItem key={v} value={v}>
                    {VISIBILITY_LABELS[v]}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={id('capacity')}>Cupo (opcional)</Label>
          <Input
            id={id('capacity')}
            type="number"
            min={1}
            inputMode="numeric"
            value={values.capacity}
            onChange={(e) => set('capacity', e.target.value)}
            placeholder="Sin límite"
            aria-invalid={!form.capacityValid}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-md border p-3">
        <div>
          <Label htmlFor={id('approval')}>Requiere aprobación</Label>
          <p className="text-xs text-muted-foreground">
            La gente que se anota queda pendiente hasta que la apruebes.
          </p>
        </div>
        <Switch
          id={id('approval')}
          checked={values.requireApproval}
          onCheckedChange={(checked) => set('requireApproval', checked)}
        />
      </div>
    </>
  )
}

/** "Don't email guests" for edits of name, time or place. */
export function SuppressEmailCheckbox({
  id,
  checked,
  onChange,
}: {
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(c) => onChange(c === true)}
        className="mt-0.5"
      />
      <Label htmlFor={id} className="font-normal leading-snug">
        No avisarles a los invitados. Si no lo marcás, Luma les manda un email
        cuando cambian el nombre, el horario o el lugar.
      </Label>
    </div>
  )
}
