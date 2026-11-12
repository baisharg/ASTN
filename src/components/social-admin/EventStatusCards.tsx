import { useMutation, useQuery } from 'convex/react'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import { EVENT_STATUS_LABELS, EventStatusBadge, toastError } from './shared'
import type { AdminEvent, EventStatus } from './shared'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Button } from '~/components/ui/button'
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
 * The event's status (draft, published, closed) and whether it approves the
 * org's preapproved people on its own. Publishing a draft, or switching that
 * approval on for a published event, approves the preapproved people who
 * were waiting, so both ask first with the number.
 */

function Busy({ show }: { show: boolean }) {
  return show ? <Loader2 className="size-4 mr-2 animate-spin" /> : null
}

/** Unset counts as on: see `autoApprovesKnownGuests` in convex/social/lib.ts. */
function autoApproveIsOn(event: AdminEvent): boolean {
  return event.autoApproveKnown !== false
}

/** "3 personas preaprobadas van a quedar aprobadas", plus what Luma does. */
function KnownPendingNotice({
  count,
  lumaLinked,
}: {
  count: number
  lumaLinked: boolean
}) {
  return (
    <>
      {count === 1
        ? '1 persona preaprobada que ya se anotó va a quedar aprobada.'
        : `${count} personas preaprobadas que ya se anotaron van a quedar aprobadas.`}
      {lumaLinked &&
        ' También se aprueban en Luma, que puede mandarles un email.'}
    </>
  )
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

export function StatusCard({ event }: { event: AdminEvent }) {
  const updateEvent = useMutation(api.social.events.updateEvent)
  const { busy, run } = useBusyAction<EventStatus>()
  const [confirmOpen, setConfirmOpen] = useState(false)
  // The number the confirmation shows, kept from when it opened: the count
  // stops loading once the event is published.
  const [confirmCount, setConfirmCount] = useState(0)

  // Leaving draft is when a draft's preapproved guests get approved.
  const approvesOnPublish = event.status === 'draft' && autoApproveIsOn(event)
  const knownPending = useQuery(
    api.social.events.getKnownPendingCount,
    approvesOnPublish ? { eventId: event._id } : 'skip',
  )
  const countLoading = approvesOnPublish && knownPending === undefined

  const setStatus = (status: EventStatus) =>
    run(
      status,
      async () => {
        await updateEvent({ eventId: event._id, status })
        toast.success(`Evento: ${EVENT_STATUS_LABELS[status].toLowerCase()}`)
      },
      toastError('No se pudo cambiar el estado'),
    )

  const handleAction = (status: EventStatus) => {
    if (approvesOnPublish && knownPending !== undefined && knownPending > 0) {
      setConfirmCount(knownPending)
      setConfirmOpen(true)
      return
    }
    void setStatus(status)
  }

  const handleConfirm = async () => {
    await setStatus('published')
    setConfirmOpen(false)
  }

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
            disabled={busy !== null || countLoading}
            onClick={() => handleAction(a.status)}
          >
            <Busy show={busy === a.status} />
            {a.label}
          </Button>
        ))}
      </CardContent>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (busy === null) setConfirmOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Publicar el evento?</AlertDialogTitle>
            <AlertDialogDescription>
              <KnownPendingNotice
                count={confirmCount}
                lumaLinked={!!event.lumaEventId}
              />{' '}
              Si preferís aprobarlas vos, cancelá y apagá “Aprobar
              automáticamente a las personas preaprobadas” antes de publicar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={busy !== null}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              disabled={busy !== null}
              onClick={(e) => {
                e.preventDefault()
                void handleConfirm()
              }}
            >
              <Busy show={busy !== null} />
              Sí, publicar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

// ── Automatic approval ──────────────────────────────────────────────────

export function AutoApproveCard({ event }: { event: AdminEvent }) {
  const updateEvent = useMutation(api.social.events.updateEvent)
  const { busy, run } = useBusyAction<'save'>()
  const [confirmOpen, setConfirmOpen] = useState(false)
  // The number the confirmation shows, kept from when it opened: the count
  // stops loading once the setting is on.
  const [confirmCount, setConfirmCount] = useState(0)

  const isOn = autoApproveIsOn(event)
  const isDraft = event.status === 'draft'
  // Switching it on for an event that isn't a draft approves right away.
  const approvesOnSwitch = !isOn && !isDraft
  const knownPending = useQuery(
    api.social.events.getKnownPendingCount,
    approvesOnSwitch ? { eventId: event._id } : 'skip',
  )
  const countLoading = approvesOnSwitch && knownPending === undefined

  const save = (autoApproveKnown: boolean) =>
    run(
      'save',
      async () => {
        await updateEvent({ eventId: event._id, autoApproveKnown })
        toast.success(
          autoApproveKnown
            ? 'Aprobación automática activada'
            : 'Aprobación automática desactivada',
        )
      },
      toastError('No se pudo guardar'),
    )

  const handleChange = (checked: boolean) => {
    if (
      checked &&
      approvesOnSwitch &&
      knownPending !== undefined &&
      knownPending > 0
    ) {
      setConfirmCount(knownPending)
      setConfirmOpen(true)
      return
    }
    void save(checked)
  }

  const handleConfirm = async () => {
    await save(true)
    setConfirmOpen(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Aprobación de invitados</CardTitle>
        <CardDescription>
          Quién queda aprobado sin que lo revises. La lista de preaprobados es
          de la organización y está en la pestaña Preaprobados.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="space-y-1">
            <Label htmlFor="event-auto-approve">
              Aprobar automáticamente a las personas preaprobadas
            </Label>
            <p className="text-xs text-muted-foreground">
              Prendido: quien está en la lista de preaprobados queda aprobado
              apenas se anota, acá o en Luma. Apagalo en los eventos donde
              elegís vos quién viene: todos quedan pendientes hasta que los
              apruebes.
            </p>
          </div>
          <Switch
            id="event-auto-approve"
            checked={isOn}
            disabled={busy !== null || countLoading}
            onCheckedChange={handleChange}
          />
        </div>
        {isOn && isDraft && (
          <p className="text-xs text-muted-foreground">
            Mientras el evento es un borrador no se aprueba a nadie
            automáticamente: pasa cuando lo publicás.
          </p>
        )}
      </CardContent>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (busy === null) setConfirmOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Aprobar automáticamente a las personas preaprobadas?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <KnownPendingNotice
                count={confirmCount}
                lumaLinked={!!event.lumaEventId}
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={busy !== null}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              disabled={busy !== null}
              onClick={(e) => {
                e.preventDefault()
                void handleConfirm()
              }}
            >
              <Busy show={busy !== null} />
              Sí, aprobar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
