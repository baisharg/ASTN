import { useMutation } from 'convex/react'
import { Loader2, Save } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import { DEFAULT_EVENT_HOURS } from '../../../convex/social/constants'
import { toastError } from './shared'
import type { AdminEvent } from './shared'
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
  eventEndAt,
  meetingsWindowProblem,
  resolveMeetingsClose,
  resolveMeetingsOpen,
} from '~/lib/meetings-window'
import type { MeetingsWindowProblem } from '~/lib/meetings-window'
import { useBusyAction } from '~/lib/use-busy-action'
import { epochToZoned, formatEventDateTime } from '~/lib/zoned-time'

const MEETING_LENGTHS = [15, 20, 30]

const WINDOW_PROBLEMS: Record<MeetingsWindowProblem, string> = {
  closes_before_opening: 'El cierre tiene que ser después de la apertura.',
  opens_after_event:
    'Con estos horarios los 1:1 abren cuando el evento ya terminó, así que nunca están abiertos durante el evento.',
  closes_before_event:
    'Con estos horarios los 1:1 cierran antes de que empiece el evento.',
}

/**
 * When attendees can ask for 1:1s, how long each lasts and what the
 * assistant should aim for. Each field shows the stored value until the
 * admin edits it, and only edited fields are saved.
 */
export function OneOnOneCard({ event }: { event: AdminEvent }) {
  const updateEvent = useMutation(api.social.events.updateEvent)
  const { busy, run } = useBusyAction<'save'>()
  const tz = event.timezone

  // null: not edited. The field then shows, and keeps, the stored value.
  const [openEdit, setOpenEdit] = useState<string | null>(null)
  const [closeEdit, setCloseEdit] = useState<string | null>(null)
  const [minutesEdit, setMinutesEdit] = useState<string | null>(null)
  const [promptEdit, setPromptEdit] = useState<string | null>(null)

  const storedOpen = event.meetingsOpenAt ?? null
  const storedClose = event.meetingsCloseAt ?? null
  const storedPrompt = event.matchingPrompt ?? ''

  const openTime =
    openEdit ?? (storedOpen === null ? '' : epochToZoned(storedOpen, tz).time)
  const closeTime =
    closeEdit ??
    (storedClose === null ? '' : epochToZoned(storedClose, tz).time)
  // A stored time keeps its day; a typed one gets the day it means now.
  const openAt =
    openEdit === null
      ? storedOpen
      : openEdit
        ? resolveMeetingsOpen(openEdit, event)
        : null
  const closeAt =
    closeEdit === null
      ? storedClose
      : closeEdit
        ? resolveMeetingsClose(closeEdit, event)
        : null
  const minutes = minutesEdit ?? String(event.meetingMinutes)
  const prompt = promptEdit ?? storedPrompt

  const changes = {
    ...(openAt !== storedOpen ? { meetingsOpenAt: openAt } : {}),
    ...(closeAt !== storedClose ? { meetingsCloseAt: closeAt } : {}),
    ...(Number(minutes) !== event.meetingMinutes
      ? { meetingMinutes: Number(minutes) }
      : {}),
    ...(prompt.trim() !== storedPrompt ? { matchingPrompt: prompt } : {}),
  }
  const hasChanges = Object.keys(changes).length > 0
  const windowChanged =
    'meetingsOpenAt' in changes || 'meetingsCloseAt' in changes
  const problem = meetingsWindowProblem(event, openAt, closeAt)
  // A window that was already saved that way doesn't block other edits.
  const blocked = problem !== null && windowChanged

  // A stored time that falls on another day than the one it would get now
  // (e.g. "18:30" saved as the day after an event that starts at 19:00).
  const openFix =
    openEdit === null && storedOpen !== null
      ? resolveMeetingsOpen(openTime, event)
      : null
  const closeFix =
    closeEdit === null && storedClose !== null
      ? resolveMeetingsClose(closeTime, event)
      : null

  const lengths = MEETING_LENGTHS.includes(event.meetingMinutes)
    ? MEETING_LENGTHS
    : [...MEETING_LENGTHS, event.meetingMinutes].sort((a, b) => a - b)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (blocked || !hasChanges || busy) return
    const saved = { openEdit, closeEdit, minutesEdit, promptEdit }
    await run(
      'save',
      async () => {
        await updateEvent({ eventId: event._id, ...changes })
        // Back to following the stored values, unless edited again meanwhile.
        setOpenEdit((cur) => (cur === saved.openEdit ? null : cur))
        setCloseEdit((cur) => (cur === saved.closeEdit ? null : cur))
        setMinutesEdit((cur) => (cur === saved.minutesEdit ? null : cur))
        setPromptEdit((cur) => (cur === saved.promptEdit ? null : cur))
        toast.success('Configuración de 1:1 guardada')
      },
      toastError('No se pudo guardar'),
    )
  }

  const when = (ms: number) => formatEventDateTime(ms, tz)

  return (
    <Card>
      <CardHeader>
        <CardTitle>1:1</CardTitle>
        <CardDescription>
          Cuándo pueden pedirse reuniones los asistentes y cuánto dura cada una.
          Horarios en la hora del evento ({tz.replace(/_/g, ' ')}). Debajo de
          cada horario está el día que le corresponde.
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
                onChange={(e) => setOpenEdit(e.target.value)}
                aria-describedby="meetings-open-when"
                aria-invalid={problem !== null || undefined}
              />
              <p
                id="meetings-open-when"
                className="text-xs text-muted-foreground"
              >
                {openAt === null
                  ? `Vacío: abren cuando empieza el evento (${when(event.startAt)}).`
                  : `Abren el ${when(openAt)}.`}
              </p>
              {openFix !== null && openFix !== storedOpen && (
                <Button
                  type="button"
                  variant="link"
                  className="h-auto min-h-11 p-0 text-xs whitespace-normal text-left"
                  onClick={() => setOpenEdit(openTime)}
                >
                  Pasar al {when(openFix)}
                </Button>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="meetings-close">Cierran a las</Label>
              <Input
                id="meetings-close"
                type="time"
                value={closeTime}
                onChange={(e) => setCloseEdit(e.target.value)}
                aria-describedby="meetings-close-when"
                aria-invalid={problem !== null || undefined}
              />
              <p
                id="meetings-close-when"
                className="text-xs text-muted-foreground"
              >
                {closeAt !== null
                  ? `Cierran el ${when(closeAt)}.`
                  : event.endAt === undefined
                    ? `Vacío: cierran ${DEFAULT_EVENT_HOURS} horas después del inicio (${when(eventEndAt(event))}), porque el evento no tiene hora de fin.`
                    : `Vacío: cierran cuando termina el evento (${when(event.endAt)}).`}
              </p>
              {closeFix !== null && closeFix !== storedClose && (
                <Button
                  type="button"
                  variant="link"
                  className="h-auto min-h-11 p-0 text-xs whitespace-normal text-left"
                  onClick={() => setCloseEdit(closeTime)}
                >
                  Pasar al {when(closeFix)}
                </Button>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="meetings-minutes">Duración de cada reunión</Label>
              <Select value={minutes} onValueChange={setMinutesEdit}>
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
          {problem !== null && (
            <p className="text-sm text-red-600" role="alert">
              {WINDOW_PROBLEMS[problem]}
            </p>
          )}

          <div className="space-y-1">
            <Label htmlFor="matching-prompt">
              ¿Qué querés que la gente se lleve de esta noche?
            </Label>
            <Textarea
              id="matching-prompt"
              value={prompt}
              onChange={(e) => setPromptEdit(e.target.value)}
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
            disabled={blocked || !hasChanges || busy !== null}
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
