import { useMutation } from 'convex/react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import { showsMyMeetings } from '../../../convex/social/constants'
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
import { useBusyAction } from '~/lib/use-busy-action'

/**
 * Whether the event's attendees see "Mis reuniones": the 1:1s they had,
 * with a private note per person. Off until an admin switches it on.
 */
export function MyMeetingsCard({ event }: { event: AdminEvent }) {
  const updateEvent = useMutation(api.social.events.updateEvent)
  const { busy, run } = useBusyAction<'save'>()

  const save = (myMeetingsEnabled: boolean) =>
    run(
      'save',
      async () => {
        await updateEvent({ eventId: event._id, myMeetingsEnabled })
        toast.success(
          myMeetingsEnabled
            ? '“Mis reuniones” activado para los asistentes'
            : '“Mis reuniones” desactivado',
        )
      },
      toastError('No se pudo guardar'),
    )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mis reuniones</CardTitle>
        <CardDescription>
          Lo que cada asistente puede ver de sus propios 1:1 cuando terminan.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="space-y-1">
            <Label htmlFor="event-my-meetings">
              Mostrar “Mis reuniones” y las notas privadas a los asistentes
            </Label>
            <p className="text-xs text-muted-foreground">
              Prendido: en la página de asistentes y al terminar una reunión
              aparece un link a “Mis reuniones”, donde cada persona ve los 1:1
              que tuvo en este evento y puede guardar una nota sobre cada
              persona. Las notas solo las ve quien las escribe: ni la otra
              persona ni los admins. Apagado: esos links no aparecen y las notas
              ya escritas se conservan. No se le manda nada a nadie.
            </p>
          </div>
          <Switch
            id="event-my-meetings"
            checked={showsMyMeetings(event)}
            disabled={busy !== null}
            onCheckedChange={(checked) => void save(checked)}
          />
        </div>
      </CardContent>
    </Card>
  )
}
