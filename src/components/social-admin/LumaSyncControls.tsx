import { useMutation, useQuery } from 'convex/react'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { toastError } from './shared'
import { Button } from '~/components/ui/button'
import { useBusyAction } from '~/lib/use-busy-action'

/** Re-reads the org's Luma calendar (events, then guests) now. */
export function LumaSyncButton({ orgId }: { orgId: Id<'organizations'> }) {
  const syncNow = useMutation(api.luma.admin.syncNow)
  const { busy, run } = useBusyAction<'sync'>()

  const handleSync = () =>
    run(
      'sync',
      async () => {
        await syncNow({ orgId })
        toast.success('Leyendo el calendario de Luma')
      },
      toastError('No se pudo sincronizar'),
    )

  return (
    <Button
      variant="outline"
      className="min-h-11"
      disabled={busy !== null}
      onClick={() => void handleSync()}
    >
      {busy === 'sync' ? (
        <Loader2 className="size-4 mr-2 animate-spin" />
      ) : (
        <RefreshCw className="size-4 mr-2" />
      )}
      Sincronizar
    </Button>
  )
}

/** When the Luma calendar was last read, and the error if that failed. */
export function LumaSyncStatus({ orgId }: { orgId: Id<'organizations'> }) {
  const status = useQuery(api.luma.admin.getSyncStatus, { orgId })
  if (!status) return null
  return (
    <div className="mb-4 space-y-2">
      <p className="text-xs text-muted-foreground">
        {status.lastEventsSyncAt
          ? `Calendario de Luma actualizado ${formatDistanceToNow(
              status.lastEventsSyncAt,
              { addSuffix: true, locale: es },
            )}`
          : 'El calendario de Luma todavía no se sincronizó'}
        {status.guestSyncRunning && ' · leyendo invitados…'}
      </p>
      {status.lastEventsSyncError && (
        <div
          role="alert"
          className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>
            La última sincronización con Luma falló:{' '}
            {status.lastEventsSyncError}
          </span>
        </div>
      )}
    </div>
  )
}
