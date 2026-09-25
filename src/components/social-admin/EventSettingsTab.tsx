import { useMutation } from 'convex/react'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  AlertTriangle,
  ExternalLink,
  Link2,
  Loader2,
  RefreshCw,
  Save,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import { SpotsCard } from './SpotsCard'
import {
  EVENT_STATUS_LABELS,
  EventStatusBadge,
  TimezoneSelect,
  errorMessage,
} from './shared'
import type { AdminEvent, EventStatus } from './shared'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Textarea } from '~/components/ui/textarea'
import {
  differsFromBrowserZone,
  epochToZoned,
  nextDate,
  timeOnEventNight,
  zonedToEpoch,
} from '~/lib/zoned-time'

export function EventSettingsTab({ event }: { event: AdminEvent }) {
  return (
    <div className="space-y-6">
      <StatusCard event={event} />
      <DetailsCard key={`details-${event._id}`} event={event} />
      <LumaCard event={event} />
      <OneOnOneCard key={`meetings-${event._id}`} event={event} />
      <SpotsCard key={`spots-${event._id}`} event={event} />
    </div>
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

function StatusCard({ event }: { event: AdminEvent }) {
  const updateEvent = useMutation(api.social.events.updateEvent)
  const [pending, setPending] = useState<EventStatus | null>(null)

  const setStatus = async (status: EventStatus) => {
    setPending(status)
    try {
      await updateEvent({ eventId: event._id, status })
      toast.success(`Evento: ${EVENT_STATUS_LABELS[status].toLowerCase()}`)
    } catch (err) {
      toast.error('No se pudo cambiar el estado', {
        description: errorMessage(err),
      })
    } finally {
      setPending(null)
    }
  }

  const actions: Array<{
    status: EventStatus
    label: string
    variant: 'default' | 'outline'
  }> =
    event.status === 'draft'
      ? [{ status: 'published', label: 'Publicar', variant: 'default' }]
      : event.status === 'published'
        ? [
            {
              status: 'closed',
              label: 'Cerrar inscripciones',
              variant: 'outline',
            },
            { status: 'draft', label: 'Volver a borrador', variant: 'outline' },
          ]
        : [{ status: 'published', label: 'Reabrir', variant: 'default' }]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Estado <EventStatusBadge status={event.status} />
        </CardTitle>
        <CardDescription>{STATUS_HELP[event.status]}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        {actions.map((a) => (
          <Button
            key={a.status}
            variant={a.variant}
            className="min-h-11"
            disabled={pending !== null}
            onClick={() => void setStatus(a.status)}
          >
            {pending === a.status && (
              <Loader2 className="size-4 mr-2 animate-spin" />
            )}
            {a.label}
          </Button>
        ))}
      </CardContent>
    </Card>
  )
}

// ── Details ─────────────────────────────────────────────────────────────

/**
 * Move a stored time to a new event date/timezone, keeping its wall-clock
 * time and whether it falls on the event night's second day.
 */
function carryTime(
  ms: number | undefined,
  old: { date: string; tz: string },
  next: { date: string; tz: string },
): number | undefined {
  if (ms === undefined) return undefined
  const z = epochToZoned(ms, old.tz)
  const date = z.date === old.date ? next.date : nextDate(next.date)
  return zonedToEpoch(date, z.time, next.tz)
}

function DetailsCard({ event }: { event: AdminEvent }) {
  const updateEvent = useMutation(api.social.events.updateEvent)
  const start = epochToZoned(event.startAt, event.timezone)

  const [title, setTitle] = useState(event.title)
  const [date, setDate] = useState(start.date)
  const [startTime, setStartTime] = useState(start.time)
  const [endTime, setEndTime] = useState(
    event.endAt ? epochToZoned(event.endAt, event.timezone).time : '',
  )
  const [timezone, setTimezone] = useState(event.timezone)
  const [venueName, setVenueName] = useState(event.venueName ?? '')
  const [venueAddress, setVenueAddress] = useState(event.venueAddress ?? '')
  const [description, setDescription] = useState(event.description ?? '')
  const [saving, setSaving] = useState(false)

  const canSave = title.trim() !== '' && date !== '' && startTime !== ''

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSave || saving) return
    setSaving(true)
    try {
      const startAt = zonedToEpoch(date, startTime, timezone)
      const endAt = endTime
        ? timeOnEventNight(date, startTime, endTime, timezone)
        : null
      // Moving the event to another day keeps the 1:1 window on it.
      const moved = date !== start.date || timezone !== event.timezone
      const old = { date: start.date, tz: event.timezone }
      const next = { date, tz: timezone }
      await updateEvent({
        eventId: event._id,
        title: title.trim(),
        startAt,
        endAt,
        timezone,
        venueName,
        venueAddress,
        description,
        ...(moved
          ? {
              meetingsOpenAt:
                carryTime(event.meetingsOpenAt, old, next) ?? null,
              meetingsCloseAt:
                carryTime(event.meetingsCloseAt, old, next) ?? null,
            }
          : {}),
      })
      toast.success('Datos del evento guardados')
    } catch (err) {
      toast.error('No se pudieron guardar los datos', {
        description: errorMessage(err),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Datos del evento</CardTitle>
        <CardDescription>
          Lo que ve la gente en la página del evento.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="event-title">Nombre</Label>
            <Input
              id="event-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="event-date">Fecha</Label>
              <Input
                id="event-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="event-start">Empieza</Label>
              <Input
                id="event-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="event-end">Termina (opcional)</Label>
              <Input
                id="event-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="event-tz">Zona horaria</Label>
            <TimezoneSelect
              id="event-tz"
              value={timezone}
              onChange={setTimezone}
            />
            {differsFromBrowserZone(timezone) && (
              <p className="text-xs text-muted-foreground">
                Los horarios están en la hora del evento, no en la tuya.
              </p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="event-venue">Lugar</Label>
              <Input
                id="event-venue"
                value={venueName}
                onChange={(e) => setVenueName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="event-address">Dirección</Label>
              <Input
                id="event-address"
                value={venueAddress}
                onChange={(e) => setVenueAddress(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="event-desc">Descripción</Label>
            <Textarea
              id="event-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </div>
          <Button
            type="submit"
            className="min-h-11"
            disabled={!canSave || saving}
          >
            {saving ? (
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

// ── Luma ────────────────────────────────────────────────────────────────

/** Accepts "evt-…" on its own or inside a Luma admin URL. */
function extractLumaEventId(input: string): string | null {
  const match = input.match(/evt-[A-Za-z0-9]+/)
  return match ? match[0] : null
}

function LumaCard({ event }: { event: AdminEvent }) {
  const linkLuma = useMutation(api.social.events.linkLumaEvent)
  const syncNow = useMutation(api.social.events.syncLumaNow)
  const retryErrors = useMutation(api.social.events.retryLumaErrors)

  const [editing, setEditing] = useState(!event.lumaEventId)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState<'link' | 'sync' | 'retry' | null>(null)

  const parsedId = extractLumaEventId(input)
  const linked = !!event.lumaEventId

  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!parsedId) return
    setBusy('link')
    try {
      await linkLuma({ eventId: event._id, lumaEventId: parsedId })
      toast.success('Evento vinculado. Estamos trayendo los invitados de Luma.')
      setEditing(false)
      setInput('')
    } catch (err) {
      toast.error('No se pudo vincular', { description: errorMessage(err) })
    } finally {
      setBusy(null)
    }
  }

  const handleSync = async () => {
    setBusy('sync')
    try {
      await syncNow({ eventId: event._id })
      toast.success('Sincronizando con Luma')
    } catch (err) {
      toast.error('No se pudo sincronizar', { description: errorMessage(err) })
    } finally {
      setBusy(null)
    }
  }

  const handleRetry = async () => {
    setBusy('retry')
    try {
      const n = await retryErrors({ eventId: event._id })
      toast.success(
        n === 1 ? 'Reintentando 1 invitado' : `Reintentando ${n} invitados`,
      )
    } catch (err) {
      toast.error('No se pudo reintentar', { description: errorMessage(err) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Luma
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
              {busy === 'retry' && (
                <Loader2 className="size-4 mr-2 animate-spin" />
              )}
              Reintentar
            </Button>
          </div>
        )}

        {linked && !editing && (
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
              onClick={() => setEditing(true)}
            >
              Cambiar evento vinculado
            </Button>
          </div>
        )}

        {editing && (
          <form onSubmit={handleLink} className="space-y-2">
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
                {busy === 'link' ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <Link2 className="size-4 mr-2" />
                )}
                Vincular
              </Button>
              {linked && (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11"
                  onClick={() => setEditing(false)}
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
              Podés pegar la dirección completa.
              {input && !parsedId && (
                <span className="block text-red-600 mt-1">
                  No encontramos un ID que empiece con evt-.
                </span>
              )}
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

// ── 1:1 settings ────────────────────────────────────────────────────────

const MEETING_LENGTHS = [15, 20, 30]

function OneOnOneCard({ event }: { event: AdminEvent }) {
  const updateEvent = useMutation(api.social.events.updateEvent)
  const start = epochToZoned(event.startAt, event.timezone)

  const [openTime, setOpenTime] = useState(
    event.meetingsOpenAt
      ? epochToZoned(event.meetingsOpenAt, event.timezone).time
      : '',
  )
  const [closeTime, setCloseTime] = useState(
    event.meetingsCloseAt
      ? epochToZoned(event.meetingsCloseAt, event.timezone).time
      : '',
  )
  const [minutes, setMinutes] = useState(String(event.meetingMinutes))
  const [prompt, setPrompt] = useState(event.matchingPrompt ?? '')
  const [saving, setSaving] = useState(false)

  const toEpoch = (time: string) =>
    time ? timeOnEventNight(start.date, start.time, time, event.timezone) : null
  const openAt = toEpoch(openTime)
  const closeAt = toEpoch(closeTime)
  const windowInvalid = openAt !== null && closeAt !== null && closeAt <= openAt

  const lengths = MEETING_LENGTHS.includes(event.meetingMinutes)
    ? MEETING_LENGTHS
    : [...MEETING_LENGTHS, event.meetingMinutes].sort((a, b) => a - b)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (windowInvalid || saving) return
    setSaving(true)
    try {
      await updateEvent({
        eventId: event._id,
        meetingsOpenAt: openAt,
        meetingsCloseAt: closeAt,
        meetingMinutes: Number(minutes),
        matchingPrompt: prompt,
      })
      toast.success('Configuración de 1:1 guardada')
    } catch (err) {
      toast.error('No se pudo guardar', { description: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>1:1</CardTitle>
        <CardDescription>
          Cuándo pueden pedirse reuniones los asistentes y cuánto dura cada una.
          Horarios en la hora del evento ({event.timezone.replace(/_/g, ' ')}
          ); los anteriores al inicio del evento cuentan como del día siguiente.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="meetings-open">Abren a las</Label>
              <Input
                id="meetings-open"
                type="time"
                value={openTime}
                onChange={(e) => setOpenTime(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="meetings-close">Cierran a las</Label>
              <Input
                id="meetings-close"
                type="time"
                value={closeTime}
                onChange={(e) => setCloseTime(e.target.value)}
                aria-invalid={windowInvalid || undefined}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="meetings-minutes">Duración de cada reunión</Label>
              <Select value={minutes} onValueChange={setMinutes}>
                <SelectTrigger id="meetings-minutes" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {lengths.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m} minutos
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {windowInvalid && (
            <p className="text-sm text-red-600">
              El cierre tiene que ser después de la apertura.
            </p>
          )}
          {!openTime && !closeTime && (
            <p className="text-xs text-muted-foreground">
              Sin horarios, los 1:1 quedan abiertos todo el tiempo que el evento
              esté publicado, también los días previos.
            </p>
          )}

          <div className="space-y-1">
            <Label htmlFor="matching-prompt">
              ¿Qué querés que la gente se lleve de esta noche?
            </Label>
            <Textarea
              id="matching-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              aria-describedby="matching-prompt-help"
              placeholder="Conectar a personas nuevas en AI safety con quienes ya trabajan en el área. Priorizá esos cruces por sobre juntar gente con perfiles parecidos."
            />
            <p
              id="matching-prompt-help"
              className="text-xs text-muted-foreground"
            >
              El asistente usa esto para sugerir quién debería conocerse y de
              qué hablar. La primera oración se muestra a los asistentes como el
              foco de la noche.
            </p>
          </div>

          <Button
            type="submit"
            className="min-h-11"
            disabled={windowInvalid || saving}
          >
            {saving ? (
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
