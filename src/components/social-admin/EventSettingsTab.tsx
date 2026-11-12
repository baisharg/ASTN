import { useMutation } from 'convex/react'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import { EventDetailsFields, useEventDetailsForm } from './EventDetailsFields'
import { LumaLinkCard } from './LumaLinkCard'
import { OneOnOneCard } from './OneOnOneCard'
import { SpotsCard } from './SpotsCard'
import { EVENT_STATUS_LABELS, EventStatusBadge, toastError } from './shared'
import type { AdminEvent, EventStatus } from './shared'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { detailsFromEvent } from '~/lib/event-details'
import { useBusyAction } from '~/lib/use-busy-action'
import { carryZonedTime } from '~/lib/zoned-time'

export function EventSettingsTab({ event }: { event: AdminEvent }) {
  return (
    <div className="space-y-6">
      <StatusCard event={event} />
      <DetailsCard key={`details-${event._id}`} event={event} />
      <LumaLinkCard event={event} />
      <OneOnOneCard key={`meetings-${event._id}`} event={event} />
      <SpotsCard key={`spots-${event._id}`} event={event} />
    </div>
  )
}

function Busy({ show }: { show: boolean }) {
  return show ? <Loader2 className="size-4 mr-2 animate-spin" /> : null
}

// ── Status ──────────────────────────────────────────────────────────────

const STATUS_HELP: Record<EventStatus, string> = {
  draft:
    'Solo los admins ven la página del evento. Publicalo para abrir las inscripciones.',
  published:
    'La página es pública y la gente puede inscribirse. Las inscripciones de Luma también entran.',
  closed:
    'La página sigue visible, pero ya no se puede inscribir nadie desde la app.',
}

const STATUS_ACTIONS: Record<
  EventStatus,
  Array<{ status: EventStatus; label: string; variant: 'default' | 'outline' }>
> = {
  draft: [{ status: 'published', label: 'Publicar', variant: 'default' }],
  published: [
    { status: 'closed', label: 'Cerrar inscripciones', variant: 'outline' },
    { status: 'draft', label: 'Volver a borrador', variant: 'outline' },
  ],
  closed: [{ status: 'published', label: 'Reabrir', variant: 'default' }],
}

function StatusCard({ event }: { event: AdminEvent }) {
  const updateEvent = useMutation(api.social.events.updateEvent)
  const { busy, run } = useBusyAction<EventStatus>()

  const setStatus = (status: EventStatus) =>
    run(
      status,
      async () => {
        await updateEvent({ eventId: event._id, status })
        toast.success(`Evento: ${EVENT_STATUS_LABELS[status].toLowerCase()}`)
      },
      toastError('No se pudo cambiar el estado'),
    )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Estado <EventStatusBadge status={event.status} />
        </CardTitle>
        <CardDescription>{STATUS_HELP[event.status]}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        {STATUS_ACTIONS[event.status].map((a) => (
          <Button
            key={a.status}
            variant={a.variant}
            className="min-h-11"
            disabled={busy !== null}
            onClick={() => void setStatus(a.status)}
          >
            <Busy show={busy === a.status} />
            {a.label}
          </Button>
        ))}
      </CardContent>
    </Card>
  )
}

// ── Details ─────────────────────────────────────────────────────────────

function DetailsCard({ event }: { event: AdminEvent }) {
  const updateEvent = useMutation(api.social.events.updateEvent)
  const stored = detailsFromEvent(event)
  const form = useEventDetailsForm(stored)
  const { busy, run } = useBusyAction<'save'>()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.canSave || !form.hasChanges || busy) return
    const saved = form.values
    // Moving the event to another day or timezone takes the 1:1 window along.
    const moved =
      saved.date !== stored.date || saved.timezone !== stored.timezone
    const old = { date: stored.date, timeZone: stored.timezone }
    const next = { date: saved.date, timeZone: saved.timezone }
    const { meetingsOpenAt, meetingsCloseAt } = event
    await run(
      'save',
      async () => {
        // Only what the admin edited: the rest may have changed since the
        // page loaded (e.g. an address read from Luma after linking).
        await updateEvent({
          eventId: event._id,
          ...form.changes,
          ...(moved && meetingsOpenAt !== undefined
            ? { meetingsOpenAt: carryZonedTime(meetingsOpenAt, old, next) }
            : {}),
          ...(moved && meetingsCloseAt !== undefined
            ? { meetingsCloseAt: carryZonedTime(meetingsCloseAt, old, next) }
            : {}),
        })
        form.markSaved(saved)
        toast.success('Datos del evento guardados')
      },
      toastError('No se pudieron guardar los datos'),
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Datos del evento</CardTitle>
        <CardDescription>
          Lo que ve la gente en la página del evento.
          {event.lumaEventId &&
            ' Como está vinculado con Luma, el nombre, el horario, la dirección y la descripción también se actualizan allá (Luma avisa a los invitados si cambian el horario o el lugar). Una dirección borrada solo se borra en ASTN: Luma no deja quitarla desde acá.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <EventDetailsFields form={form} idPrefix="event" />
          <Button
            type="submit"
            className="min-h-11"
            disabled={!form.canSave || !form.hasChanges || busy !== null}
          >
            {busy ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Save className="size-4 mr-2" />
            )}
            Guardar
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
