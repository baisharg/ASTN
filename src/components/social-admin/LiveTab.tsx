import { useMutation, useQuery } from 'convex/react'
import { Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '../../../convex/_generated/dataModel'
import { toastError } from './shared'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { useBusyAction } from '~/lib/use-busy-action'

type SuggestionRun = NonNullable<
  FunctionReturnType<typeof api.social.suggestions.getSuggestionRun>
>

const RUN_TRIGGER_TEXT: Record<SuggestionRun['trigger'], string> = {
  admin: 'iniciada desde acá',
  attendee: 'iniciada cuando el primer asistente abrió la app',
  attendance: 'iniciada sola porque se sumó gente con el perfil completo',
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-3xl font-semibold tabular-nums mt-1">{value ?? '–'}</p>
    </Card>
  )
}

function formatRunTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('es-AR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Where the event's current or last suggestion run stands. */
function RunStatus({ run }: { run: SuggestionRun | null }) {
  if (!run) {
    return (
      <p className="text-sm text-muted-foreground">
        Todavía no se generaron sugerencias para este evento.
      </p>
    )
  }
  const failedText =
    run.failed > 0
      ? ` · ${run.failed} ${run.failed === 1 ? 'falló' : 'fallaron'}`
      : ''
  if (run.status === 'running') {
    const done = run.succeeded + run.failed + run.skipped
    return (
      <div className="space-y-2" role="status">
        <p className="text-sm">
          Generando: {done} de {run.total}{' '}
          {run.total === 1 ? 'persona' : 'personas'}
          {failedText}. Empezó a las{' '}
          {new Date(run.startedAt).toLocaleTimeString('es-AR', {
            hour: '2-digit',
            minute: '2-digit',
          })}
          ; las sugerencias aparecen para todos juntas al terminar.
        </p>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-1.5 bg-primary transition-[width]"
            style={{ width: `${(done / Math.max(run.total, 1)) * 100}%` }}
          />
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-1 text-sm">
      <p>
        Última generación: {formatRunTime(run.finishedAt ?? run.startedAt)},{' '}
        {RUN_TRIGGER_TEXT[run.trigger]}. Se generaron sugerencias para{' '}
        {run.succeeded} de {run.total}{' '}
        {run.total === 1 ? 'persona' : 'personas'}
        {failedText}.
      </p>
      {run.failed > 0 && (
        <p className="text-muted-foreground">
          Quienes fallaron ven un botón para reintentar en su página; también
          podés volver a generar para todos.
        </p>
      )}
    </div>
  )
}

export function LiveTab({ eventId }: { eventId: Id<'socialEvents'> }) {
  const overview = useQuery(api.social.meetings.getLiveOverview, { eventId })
  const suggestionRun = useQuery(api.social.suggestions.getSuggestionRun, {
    eventId,
  })
  const generateAll = useMutation(api.social.suggestions.generateAllSuggestions)
  const { busy, run } = useBusyAction<'generate'>()
  const starting = busy === 'generate'
  const running = suggestionRun?.status === 'running'

  const handleGenerate = () =>
    run(
      'generate',
      async () => {
        const n = await generateAll({ eventId })
        if (n === 0) {
          toast.info(
            'Nadie aprobado tiene cuenta y perfil completo todavía, así que no hay sugerencias para generar.',
          )
        } else {
          toast.success(
            `Generando sugerencias para ${n} persona${n !== 1 ? 's' : ''}`,
          )
        }
      },
      toastError('No se pudieron generar las sugerencias'),
    )

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Reuniones activas" value={overview?.activeMeetings} />
        <Stat
          label="Solicitudes pendientes"
          value={overview?.pendingRequests}
        />
        <Stat label="Reuniones en total" value={overview?.meetingsSoFar} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sugerencias</CardTitle>
          <CardDescription>
            Cada asistente recibe sugerencias de a quién conocer y de qué
            hablar, según los perfiles y la guía de la pestaña Configuración. Se
            generan para todos a la vez: cuando el primer asistente abre la app,
            y de nuevo (como mucho cada 15 minutos) cuando se suma gente con el
            perfil completo. Usá el botón después de cambiar la guía o antes de
            abrir los 1:1. Solo cuenta a quienes están aprobados y tienen el
            perfil completo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {suggestionRun !== undefined && <RunStatus run={suggestionRun} />}
          {/* Disabled until the run state loads, so a run under way is never
              asked for twice. */}
          <Button
            className="min-h-11"
            disabled={starting || running || suggestionRun === undefined}
            onClick={() => void handleGenerate()}
          >
            {starting || running ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="size-4 mr-2" />
            )}
            {running
              ? 'Generando sugerencias…'
              : 'Generar sugerencias para todos'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
