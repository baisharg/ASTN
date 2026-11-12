import { useMutation, useQuery } from 'convex/react'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { RefreshCw, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { LumaBlastsCard } from './LumaBlastsCard'
import { LumaEventSettingsCard } from './LumaEventSettingsCard'
import { LumaGuestsDialog } from './LumaGuestsList'
import { LumaLinkCard } from './LumaLinkCard'
import { guestCountsText } from './luma-shared'
import type { LumaEventRow } from './luma-shared'
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
import { Spinner } from '~/components/ui/spinner'
import { useBusyAction } from '~/lib/use-busy-action'

/**
 * The Luma side of an ASTN event: its link to a Luma event and, once
 * linked, what Luma has for it (guest list, Luma-only settings).
 */
export function EventLumaTab({ event }: { event: AdminEvent }) {
  const { lumaEventId } = event
  return (
    <div className="space-y-6">
      <LumaLinkCard event={event} />
      {lumaEventId && (
        <LinkedLumaEvent orgId={event.orgId} lumaEventId={lumaEventId}>
          {(lumaEvent) => (
            <>
              <LumaGuestsCard orgId={event.orgId} lumaEvent={lumaEvent} />
              <LumaEventSettingsCard
                // A different linked event starts the card over.
                key={lumaEventId}
                orgId={event.orgId}
                lumaEventId={lumaEventId}
                settingsOnly
              />
            </>
          )}
        </LinkedLumaEvent>
      )}
    </div>
  )
}

/** Emails Luma sends to the guests of the linked Luma event. */
export function EventEmailsTab({ event }: { event: AdminEvent }) {
  const { lumaEventId } = event
  if (!lumaEventId) return null
  return (
    <LinkedLumaEvent orgId={event.orgId} lumaEventId={lumaEventId}>
      {(lumaEvent) => (
        <LumaBlastsCard
          key={lumaEventId}
          orgId={event.orgId}
          lumaEventId={lumaEventId}
          timezone={lumaEvent.timezone}
          counts={{
            approved: lumaEvent.approvedCount,
            pending: lumaEvent.pendingCount,
            checkedIn: lumaEvent.checkedInCount,
          }}
        />
      )}
    </LinkedLumaEvent>
  )
}

/**
 * Renders `children` with the linked Luma event as ASTN mirrors it. Guests,
 * settings and emails go through the org's Luma calendar, so an event that
 * isn't on it (or is run by another calendar) gets a note instead.
 */
function LinkedLumaEvent({
  orgId,
  lumaEventId,
  children,
}: {
  orgId: Id<'organizations'>
  lumaEventId: string
  children: (lumaEvent: LumaEventRow) => React.ReactNode
}) {
  const lumaEvent = useQuery(api.luma.admin.getLumaEvent, {
    orgId,
    lumaEventId,
  })
  if (lumaEvent === undefined) {
    return <Spinner className="size-6 mx-auto" />
  }
  if (lumaEvent === null) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        El evento vinculado (
        <span className="font-mono text-xs">{lumaEventId}</span>) no está en el
        calendario de Luma que lee ASTN, o todavía no se leyó: sus invitados en
        Luma, sus ajustes y sus emails no están disponibles acá. Probá
        “Sincronizar” en la lista de eventos.
      </Card>
    )
  }
  if (!lumaEvent.managedByCalendar) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        El evento vinculado lo organiza otro calendario de Luma: sus invitados
        en Luma, sus ajustes y sus emails no están disponibles acá.
      </Card>
    )
  }
  return <>{children(lumaEvent)}</>
}

/** Luma's own guest list for the event: counts, the list, and a re-read. */
function LumaGuestsCard({
  orgId,
  lumaEvent,
}: {
  orgId: Id<'organizations'>
  lumaEvent: LumaEventRow
}) {
  const refreshGuests = useMutation(api.luma.admin.refreshGuests)
  const { busy, run } = useBusyAction<'refresh'>()
  const [listOpen, setListOpen] = useState(false)
  const counts = guestCountsText(lumaEvent)

  const handleRefresh = () =>
    run(
      'refresh',
      async () => {
        await refreshGuests({ orgId, lumaEventId: lumaEvent.lumaEventId })
        toast.success('Actualizando invitados desde Luma')
      },
      toastError('No se pudo actualizar'),
    )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invitados en Luma</CardTitle>
        <CardDescription>
          La lista que tiene Luma, solo para consultarla: para aprobar o
          rechazar, usá la pestaña Invitados. Cada persona queda en su historial
          del CRM.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1 text-sm">
          <p>
            {counts ?? 'Invitados todavía sin leer'}
            {lumaEvent.lastGuestSyncAt &&
              ` · leídos ${formatDistanceToNow(lumaEvent.lastGuestSyncAt, {
                addSuffix: true,
                locale: es,
              })}`}
            {lumaEvent.guestSyncPending && ' · actualizando…'}
          </p>
          {lumaEvent.guestSyncError && (
            <p className="text-red-700">
              No se pudieron leer los invitados de Luma:{' '}
              {lumaEvent.guestSyncError}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => setListOpen(true)}
          >
            <Users className="size-4 mr-2" />
            Ver la lista de Luma
          </Button>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={busy !== null}
            onClick={() => void handleRefresh()}
            title="Volver a leer los invitados y actualizar el CRM"
          >
            <RefreshCw
              className={`size-4 mr-2 ${busy === 'refresh' ? 'animate-spin' : ''}`}
            />
            Actualizar CRM
          </Button>
        </div>
      </CardContent>
      <LumaGuestsDialog
        open={listOpen}
        onOpenChange={setListOpen}
        orgId={orgId}
        lumaEventId={lumaEvent.lumaEventId}
        title={lumaEvent.title}
        managed
      />
    </Card>
  )
}
