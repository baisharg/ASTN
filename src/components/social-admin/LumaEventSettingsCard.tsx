import { useAction } from 'convex/react'
import { Loader2, Save } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import {
  LumaEventFields,
  SuppressEmailCheckbox,
  lumaArgs,
  useLumaEventForm,
  valuesFromLuma,
} from './LumaEventForm'
import type { LumaEventValues } from './LumaEventForm'
import { toastError } from './shared'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { Spinner } from '~/components/ui/spinner'
import { errorText } from '~/lib/convex-error'
import { useBusyAction } from '~/lib/use-busy-action'

/**
 * A Luma event's settings, read live from Luma when the card mounts and
 * saved straight to Luma. With `settingsOnly` (an event managed in ASTN,
 * whose name, time, place and description are edited as ASTN details), only
 * the settings ASTN doesn't hold: visibility, capacity and approval.
 */
export function LumaEventSettingsCard({
  orgId,
  lumaEventId,
  settingsOnly,
}: {
  orgId: Id<'organizations'>
  lumaEventId: string
  settingsOnly: boolean
}) {
  const getForEdit = useAction(api.luma.api.getEventForEdit)
  const [initial, setInitial] = useState<LumaEventValues | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setInitial(valuesFromLuma(await getForEdit({ orgId, lumaEventId })))
    } catch (err) {
      setError(errorText(err, 'No se pudieron leer los datos de Luma'))
    }
  }, [getForEdit, orgId, lumaEventId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {settingsOnly ? 'Ajustes en Luma' : 'Datos en Luma'}
        </CardTitle>
        <CardDescription>
          {settingsOnly
            ? 'Visibilidad, cupo y aprobación solo existen en Luma y se guardan directamente ahí. El nombre, horario, lugar y descripción se editan en la pestaña Configuración y se copian a Luma.'
            : 'Los cambios se guardan directamente en Luma.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {initial ? (
          <LumaEventSettingsForm
            key={JSON.stringify(initial)}
            orgId={orgId}
            lumaEventId={lumaEventId}
            initial={initial}
            settingsOnly={settingsOnly}
            onSaved={() => void load()}
          />
        ) : error ? (
          <div className="space-y-3">
            <p className="text-sm text-red-700">{error}</p>
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => void load()}
            >
              Reintentar
            </Button>
          </div>
        ) : (
          <Spinner className="size-6 mx-auto" />
        )}
      </CardContent>
    </Card>
  )
}

function LumaEventSettingsForm({
  orgId,
  lumaEventId,
  initial,
  settingsOnly,
  onSaved,
}: {
  orgId: Id<'organizations'>
  lumaEventId: string
  initial: LumaEventValues
  settingsOnly: boolean
  onSaved: () => void
}) {
  const updateEvent = useAction(api.luma.api.updateEvent)
  const form = useLumaEventForm(initial)
  const [suppressEmail, setSuppressEmail] = useState(false)
  const { busy, run } = useBusyAction<'save'>()

  const next = lumaArgs(form.values)
  const before = lumaArgs(initial)
  const timeChanged =
    next.startAt !== before.startAt ||
    next.endAt !== before.endAt ||
    next.timezone !== before.timezone
  const changes = {
    ...(next.name !== before.name ? { name: next.name } : {}),
    ...(timeChanged
      ? { startAt: next.startAt, endAt: next.endAt, timezone: next.timezone }
      : {}),
    ...(next.descriptionMd !== before.descriptionMd
      ? { descriptionMd: next.descriptionMd }
      : {}),
    ...(next.address !== before.address ? { address: next.address } : {}),
    ...(next.visibility !== before.visibility
      ? { visibility: next.visibility }
      : {}),
    ...(next.maxCapacity !== before.maxCapacity
      ? { maxCapacity: next.maxCapacity }
      : {}),
    ...(next.requireApproval !== before.requireApproval
      ? { requireApproval: next.requireApproval }
      : {}),
  }
  const hasChanges = Object.keys(changes).length > 0
  const notifiesGuests =
    'name' in changes || 'startAt' in changes || 'address' in changes

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.canSave || !hasChanges || busy) return
    await run(
      'save',
      async () => {
        await updateEvent({ orgId, lumaEventId, ...changes, suppressEmail })
        toast.success('Guardado en Luma')
        onSaved()
      },
      toastError('No se pudo guardar en Luma'),
    )
  }

  const idPrefix = settingsOnly ? 'luma-settings' : 'luma-edit'

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <LumaEventFields
        form={form}
        idPrefix={idPrefix}
        settingsOnly={settingsOnly}
        editing
      />
      {notifiesGuests && (
        <SuppressEmailCheckbox
          id={`${idPrefix}-suppress`}
          checked={suppressEmail}
          onChange={setSuppressEmail}
        />
      )}
      <Button
        type="submit"
        className="min-h-11"
        disabled={!form.canSave || !hasChanges || busy !== null}
      >
        {busy ? (
          <Loader2 className="size-4 mr-2 animate-spin" />
        ) : (
          <Save className="size-4 mr-2" />
        )}
        Guardar en Luma
      </Button>
    </form>
  )
}
