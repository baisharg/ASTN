import { useMutation } from 'convex/react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import { bookingSlots } from '../../../convex/social/constants'
import { toastError } from './shared'
import type { AdminEvent } from './shared'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { Label } from '~/components/ui/label'
import { Switch } from '~/components/ui/switch'
import { eventEndAt } from '~/lib/meetings-window'
import { useBusyAction } from '~/lib/use-busy-action'

/**
 * Whether attendees can book 1:1s for a set time at this event, on top of
 * asking to meet now. Off unless an admin switches it on; switching it only
 * changes what attendees can do in the app, and sends nothing to anyone.
 */
export function BookingCard({ event }: { event: AdminEvent }) {
  const updateEvent = useMutation(api.social.events.updateEvent)
  const { busy, run } = useBusyAction<'toggle'>()
  const enabled = event.bookingEnabled === true

  const slots = bookingSlots(
    {
      openAt: event.meetingsOpenAt ?? event.startAt,
      closeAt: event.meetingsCloseAt ?? eventEndAt(event),
    },
    event.meetingMinutes,
  ).length
  const places = event.spots.length

  const onToggle = (next: boolean) =>
    run(
      'toggle',
      async () => {
        await updateEvent({ eventId: event._id, bookingEnabled: next })
        toast.success(
          next
            ? 'Los asistentes ya pueden reservar 1:1 con horario'
            : 'Reserva de 1:1 con horario desactivada',
        )
      },
      toastError('No se pudo guardar'),
    )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reservar 1:1 con anticipación</CardTitle>
        <CardDescription>
          Además de “Reunirse ahora”, los asistentes aprobados pueden proponerse
          un horario desde que el evento está publicado, antes de llegar. Cada
          uno ve sus 1:1 en una agenda, con un lugar reservado. No se manda
          ningún email: todo pasa dentro de la app.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Switch
            id="booking-enabled"
            checked={enabled}
            disabled={busy !== null}
            onCheckedChange={(next) => void onToggle(next)}
          />
          <Label htmlFor="booking-enabled" className="font-normal">
            {enabled
              ? 'Activado: los asistentes pueden reservar 1:1 con horario'
              : 'Desactivado: los 1:1 solo se piden en el momento'}
          </Label>
        </div>
        <p className="text-sm text-muted-foreground">
          {slots === 0
            ? 'Con el horario de 1:1 actual no entra ningún turno: revisá la apertura, el cierre y la duración de arriba.'
            : `Con el horario y la duración de arriba hay ${slots} turnos de ${event.meetingMinutes} minutos. `}
          {slots > 0 &&
            (places === 0
              ? 'El evento no tiene lugares cargados, así que los 1:1 se reservan sin lugar y sin límite por turno.'
              : `Con ${places} ${places === 1 ? 'lugar' : 'lugares'}, cada turno admite hasta ${places} ${places === 1 ? '1:1 reservado' : '1:1 reservados'}; un turno completo deja de ofrecerse.`)}
        </p>
        {enabled && (
          <p className="text-sm text-muted-foreground">
            Si lo desactivás, los 1:1 ya reservados dejan de mostrarse y de
            contar; no se borran, y vuelven si lo activás de nuevo. Cambiar el
            horario o la duración de los 1:1 no mueve los que ya están
            reservados.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
