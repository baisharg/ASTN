import { useMutation, useQuery } from 'convex/react'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  AlertTriangle,
  ExternalLink,
  Link2,
  Link2Off,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import { guestCountsText } from './luma-shared'
import { toastError } from './shared'
import type { AdminEvent } from './shared'
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
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Spinner } from '~/components/ui/spinner'
import { useBusyAction } from '~/lib/use-busy-action'
import { formatEventDateTime } from '~/lib/zoned-time'

/** Accepts "evt-…" on its own or inside a Luma admin URL. */
function extractLumaEventId(input: string): string | null {
  const match = input.match(/evt-[A-Za-z0-9]+/)
  return match ? match[0] : null
}

function Busy({ show }: { show: boolean }) {
  return show ? <Loader2 className="size-4 mr-2 animate-spin" /> : null
}

/**
 * The event's link to a Luma event: link it (after showing what linking
 * does), sync now, retry failed guests, or unlink.
 */
export function LumaLinkCard({ event }: { event: AdminEvent }) {
  const linkLuma = useMutation(api.social.events.linkLumaEvent)
  const unlinkLuma = useMutation(api.social.events.unlinkLumaEvent)
  const syncNow = useMutation(api.social.events.syncLumaNow)
  const retryErrors = useMutation(api.social.events.retryLumaErrors)
  const { busy, run } = useBusyAction<'link' | 'unlink' | 'sync' | 'retry'>()

  // Linked events show the form only while changing the link.
  const [changing, setChanging] = useState(false)
  const [input, setInput] = useState('')
  // The Luma event waiting for confirmation. It stays set while the dialog
  // closes, so the dialog's text doesn't empty out mid-animation.
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [unlinkOpen, setUnlinkOpen] = useState(false)

  const parsedId = extractLumaEventId(input)
  const linked = !!event.lumaEventId
  const showForm = !linked || changing

  const handlePreview = (e: React.FormEvent) => {
    e.preventDefault()
    if (!parsedId) return
    setPreviewId(parsedId)
    setPreviewOpen(true)
  }

  const handleLink = async () => {
    if (!previewId) return
    await run(
      'link',
      async () => {
        await linkLuma({ eventId: event._id, lumaEventId: previewId })
        toast.success(
          'Evento vinculado. Estamos trayendo los invitados de Luma.',
        )
        setChanging(false)
        setInput('')
      },
      toastError('No se pudo vincular'),
    )
    setPreviewOpen(false)
  }

  const handleUnlink = async () => {
    await run(
      'unlink',
      async () => {
        await unlinkLuma({ eventId: event._id })
        toast.success('Evento desvinculado de Luma')
        setChanging(false)
      },
      toastError('No se pudo desvincular'),
    )
    setUnlinkOpen(false)
  }

  const handleSync = () =>
    run(
      'sync',
      async () => {
        await syncNow({ eventId: event._id })
        toast.success('Sincronizando con Luma')
      },
      toastError('No se pudo sincronizar'),
    )

  const handleRetry = () =>
    run(
      'retry',
      async () => {
        const n = await retryErrors({ eventId: event._id })
        toast.success(
          n === 1 ? 'Reintentando 1 invitado' : `Reintentando ${n} invitados`,
        )
      },
      toastError('No se pudo reintentar'),
    )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Vínculo con Luma
          {linked && (
            <Badge
              variant="outline"
              className="bg-green-50 text-green-700 border-green-200"
            >
              Conectado
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Inscripciones y aprobaciones se sincronizan en los dos sentidos: lo
          que hagas acá se refleja en Luma.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {linked && (
          <div className="space-y-1 text-sm">
            <p>
              Evento vinculado:{' '}
              <span className="font-mono text-xs">{event.lumaEventId}</span>
            </p>
            <p className="text-muted-foreground">
              {event.lumaLastSyncedAt
                ? `Última sincronización ${formatDistanceToNow(
                    event.lumaLastSyncedAt,
                    { addSuffix: true, locale: es },
                  )}`
                : 'Todavía no se sincronizó'}
            </p>
          </div>
        )}

        {event.lumaLastSyncError && (
          <div
            role="alert"
            className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>
              La última sincronización falló: {event.lumaLastSyncError}
            </span>
          </div>
        )}

        {event.lumaErrors > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <span className="flex-1 min-w-48">
              {event.lumaErrors === 1
                ? '1 invitado no se pudo actualizar en Luma.'
                : `${event.lumaErrors} invitados no se pudieron actualizar en Luma.`}{' '}
              El detalle está en la pestaña Invitados.
            </span>
            <Button
              variant="outline"
              className="min-h-11 bg-white"
              disabled={busy !== null}
              onClick={() => void handleRetry()}
            >
              <Busy show={busy === 'retry'} />
              Reintentar
            </Button>
          </div>
        )}

        {linked && !changing && (
          <div className="flex flex-wrap gap-2">
            <Button
              className="min-h-11"
              disabled={busy !== null}
              onClick={() => void handleSync()}
            >
              {busy === 'sync' ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="size-4 mr-2" />
              )}
              Sincronizar ahora
            </Button>
            {event.lumaUrl && (
              <Button variant="outline" className="min-h-11" asChild>
                <a href={event.lumaUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4 mr-2" />
                  Abrir en Luma
                </a>
              </Button>
            )}
            <Button
              variant="ghost"
              className="min-h-11"
              onClick={() => setChanging(true)}
            >
              Cambiar evento vinculado
            </Button>
            <Button
              variant="ghost"
              className="min-h-11"
              disabled={busy !== null}
              onClick={() => setUnlinkOpen(true)}
            >
              <Link2Off className="size-4 mr-2" />
              Desvincular de Luma
            </Button>
          </div>
        )}

        {showForm && (
          <form onSubmit={handlePreview} className="space-y-2">
            <Label htmlFor="luma-event-id">ID del evento en Luma</Label>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                id="luma-event-id"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="evt-…"
                aria-describedby="luma-event-id-help"
                className="min-h-11"
              />
              <Button
                type="submit"
                className="min-h-11"
                disabled={!parsedId || busy !== null}
              >
                <Link2 className="size-4 mr-2" />
                Vincular
              </Button>
              {linked && (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11"
                  onClick={() => setChanging(false)}
                >
                  Cancelar
                </Button>
              )}
            </div>
            <p
              id="luma-event-id-help"
              className="text-xs text-muted-foreground"
            >
              Está en Luma, en la página de administración del evento: la
              dirección termina en <span className="font-mono">evt-…</span>.
              Podés pegar la dirección completa. Antes de vincular te mostramos
              qué evento es y qué va a pasar.
              {input && !parsedId && (
                <span className="block text-red-600 mt-1">
                  No encontramos un ID que empiece con evt-.
                </span>
              )}
            </p>
          </form>
        )}
      </CardContent>

      <AlertDialog
        open={previewOpen}
        onOpenChange={(open) => {
          if (busy === null) setPreviewOpen(open)
        }}
      >
        <AlertDialogContent>
          {previewId && (
            <LinkPreview
              event={event}
              lumaEventId={previewId}
              linking={busy === 'link'}
              onConfirm={() => void handleLink()}
            />
          )}
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={unlinkOpen}
        onOpenChange={(open) => {
          if (busy === null) setUnlinkOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desvincular de Luma?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Los invitados quedan en ASTN con el estado que tienen, pero
                  dejan de sincronizarse: lo que apruebes o rechaces acá ya no
                  llega a Luma, y lo que pase en Luma ya no llega acá.
                </p>
                <p>
                  En Luma no cambia nada: el evento y sus invitados siguen ahí.
                </p>
                <p>
                  Para volver a unirlos, vinculalo de nuevo desde esta tarjeta.
                  Si en cambio tocás “Gestionar en ASTN” en ese evento de Luma,
                  se crea otro evento de ASTN aparte.
                </p>
              </div>
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
                void handleUnlink()
              }}
            >
              <Busy show={busy === 'unlink'} />
              Sí, desvincular
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

/**
 * What linking to `lumaEventId` does, for the admin to confirm: which Luma
 * event it is (from the calendar mirror) and how many ASTN guests go to it.
 */
function LinkPreview({
  event,
  lumaEventId,
  linking,
  onConfirm,
}: {
  event: AdminEvent
  lumaEventId: string
  linking: boolean
  onConfirm: () => void
}) {
  const lumaEvent = useQuery(api.luma.admin.getLumaEvent, {
    orgId: event.orgId,
    lumaEventId,
  })
  const guests = useQuery(api.social.events.listGuests, { eventId: event._id })
  const loading = lumaEvent === undefined || guests === undefined

  // Linking sends Luma every guest it doesn't have yet, except declined
  // ones. Which of them Luma already has is only known once it answers.
  const toAdd = (guests ?? []).filter(
    (g) => g.lumaSync === 'not_linked' && g.status !== 'declined',
  ).length
  const takenByOther =
    !!lumaEvent?.socialEventId && lumaEvent.socialEventId !== event._id
  const otherCalendar = lumaEvent ? !lumaEvent.managedByCalendar : false
  const blocked = takenByOther || otherCalendar
  const counts = lumaEvent ? guestCountsText(lumaEvent) : null

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {lumaEvent
            ? `¿Vincular con “${lumaEvent.title}”?`
            : '¿Vincular con este evento de Luma?'}
        </AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className="space-y-3 text-sm text-muted-foreground">
            {loading ? (
              <Spinner className="size-6 mx-auto" />
            ) : (
              <>
                {lumaEvent ? (
                  <p>
                    <span className="first-letter:uppercase inline-block">
                      {formatEventDateTime(
                        lumaEvent.startAt,
                        lumaEvent.timezone,
                      )}
                    </span>
                    {lumaEvent.location ? ` · ${lumaEvent.location}` : ''}
                    <span className="block font-mono text-xs">
                      {lumaEventId}
                    </span>
                  </p>
                ) : (
                  <p className="text-amber-800">
                    No encontramos{' '}
                    <span className="font-mono">{lumaEventId}</span> en el
                    calendario de Luma que tiene ASTN, así que no podemos
                    mostrarte qué evento es. Puede ser nuevo y no haberse leído
                    todavía (probá “Sincronizar” en la lista de eventos), o el
                    ID puede estar mal.
                  </p>
                )}
                {takenByOther && (
                  <p className="text-red-700">
                    Ese evento de Luma ya está vinculado con otro evento de
                    ASTN.
                  </p>
                )}
                {otherCalendar && (
                  <p className="text-red-700">
                    Lo organiza otro calendario de Luma, así que ASTN no puede
                    leer ni cambiar sus invitados.
                  </p>
                )}
                {!blocked && (
                  <ul className="list-disc pl-5 space-y-1">
                    <li>
                      Los invitados de ese evento de Luma se traen a ASTN
                      {counts ? ` (${counts})` : ''}.
                    </li>
                    <li>
                      {toAdd === 0
                        ? 'No hay invitados de ASTN para agregar a Luma.'
                        : `Hasta ${toAdd} invitado${toAdd !== 1 ? 's' : ''} de ASTN se ${toAdd !== 1 ? 'agregan' : 'agrega'} al evento de Luma (quienes todavía no estén en su lista). Luma puede mandarles un email.`}
                    </li>
                    <li>
                      Para quien esté en las dos listas vale el estado que tenga
                      en Luma.
                    </li>
                    {event.lumaEventId && event.lumaEventId !== lumaEventId && (
                      <li>
                        Este evento deja de estar vinculado con{' '}
                        <span className="font-mono text-xs">
                          {event.lumaEventId}
                        </span>
                        .
                      </li>
                    )}
                  </ul>
                )}
              </>
            )}
          </div>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel className="min-h-11" disabled={linking}>
          Cancelar
        </AlertDialogCancel>
        <AlertDialogAction
          className="min-h-11"
          disabled={loading || blocked || linking}
          onClick={(e) => {
            e.preventDefault()
            onConfirm()
          }}
        >
          <Busy show={linking} />
          {lumaEvent || loading ? 'Sí, vincular' : 'Vincular igual'}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  )
}
