import { useMutation, useQuery } from 'convex/react'
import { Loader2, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { errorMessage } from './shared'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-3xl font-semibold tabular-nums mt-1">{value ?? '–'}</p>
    </Card>
  )
}

export function LiveTab({ eventId }: { eventId: Id<'socialEvents'> }) {
  const overview = useQuery(api.social.meetings.getLiveOverview, { eventId })
  const generateAll = useMutation(api.social.suggestions.generateAllSuggestions)
  const [generating, setGenerating] = useState(false)

  const handleGenerate = async () => {
    setGenerating(true)
    try {
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
    } catch (err) {
      toast.error('No se pudieron generar las sugerencias', {
        description: errorMessage(err),
      })
    } finally {
      setGenerating(false)
    }
  }

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
            actualizan solas cuando cada asistente abre la app y hay gente
            nueva; usá esto después de cambiar la guía o antes de abrir los 1:1.
            Solo cuenta a quienes están aprobados y tienen el perfil completo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            className="min-h-11"
            disabled={generating}
            onClick={() => void handleGenerate()}
          >
            {generating ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="size-4 mr-2" />
            )}
            Generar sugerencias para todos
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
