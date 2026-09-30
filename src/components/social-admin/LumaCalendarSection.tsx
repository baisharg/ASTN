import { Link, useNavigate } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  AlertTriangle,
  CalendarPlus,
  ExternalLink,
  Loader2,
  RefreshCw,
  Settings2,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { LumaGuestsDialog } from './LumaGuestsList'
import {
  EMPTY_LUMA_EVENT,
  LumaEventFields,
  lumaArgs,
  useLumaEventForm,
} from './LumaEventForm'
import { VisibilityBadge, guestCountsText, useNow } from './luma-shared'
import type { LumaEventRow } from './luma-shared'
import { toastError } from './shared'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Spinner } from '~/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { useBusyAction } from '~/lib/use-busy-action'
import { formatEventDateTime } from '~/lib/zoned-time'

const PAST_PAGE = 20

/**
 * Every event on the org's Luma calendar (mirrored through Luma's API),
 * upcoming and past, with guest counts and what can be done with each.
 */
export function LumaCalendarSection({
  orgId,
  slug,
}: {
  orgId: Id<'organizations'>
  slug: string
}) {
  const now = useNow()
  const data = useQuery(api.luma.admin.listLumaEvents, { orgId, now })
  const status = useQuery(api.luma.admin.getSyncStatus, { orgId })
  const syncNow = useMutation(api.luma.admin.syncNow)
  const { busy, run } = useBusyAction<'sync'>()
  const [createOpen, setCreateOpen] = useState(false)
  const [guestsFor, setGuestsFor] = useState<LumaEventRow | null>(null)
  const [pastShown, setPastShown] = useState(PAST_PAGE)

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
    <section className="mt-12" aria-labelledby="luma-calendar-heading">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-4">
        <div>
          <h2
            id="luma-calendar-heading"
            className="text-xl font-display font-semibold text-foreground"
          >
            Calendario de Luma
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Todos los eventos del calendario, con sus invitados. La asistencia
            de cada persona queda en su historial del CRM.
          </p>
          {status && (
            <p className="text-xs text-muted-foreground mt-1">
              {status.lastEventsSyncAt
                ? `Actualizado ${formatDistanceToNow(status.lastEventsSyncAt, {
                    addSuffix: true,
                    locale: es,
                  })}`
                : 'Todavía no se sincronizó'}
              {status.guestSyncRunning && ' · leyendo invitados…'}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="min-h-11"
            disabled={busy !== null || data?.connected === false}
            onClick={() => void handleSync()}
          >
            {busy === 'sync' ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="size-4 mr-2" />
            )}
            Sincronizar
          </Button>
          <Button
            className="min-h-11"
            disabled={data?.connected === false}
            onClick={() => setCreateOpen(true)}
          >
            <CalendarPlus className="size-4 mr-2" />
            Crear evento en Luma
          </Button>
        </div>
      </div>

      {status?.lastEventsSyncError && (
        <div
          role="alert"
          className="mb-4 flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>
            La última sincronización falló: {status.lastEventsSyncError}
          </span>
        </div>
      )}

      {data === undefined ? (
        <div className="py-12 text-center">
          <Spinner className="size-8 mx-auto" />
        </div>
      ) : !data.connected ? (
        <Card className="p-6 text-sm text-muted-foreground">
          Luma no está conectado para esta organización. La clave de la API de
          Luma es de un solo calendario: se usa en la organización cuyo
          calendario de Luma (en los ajustes) coincide con ese.
        </Card>
      ) : data.upcoming.length + data.past.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          No hay eventos de Luma todavía. Si ya los hay en Luma, revisá que el
          calendario esté configurado en los ajustes de la organización y
          sincronizá.
        </Card>
      ) : (
        <Tabs defaultValue={data.upcoming.length > 0 ? 'upcoming' : 'past'}>
          <TabsList>
            <TabsTrigger value="upcoming">
              Próximos ({data.upcoming.length})
            </TabsTrigger>
            <TabsTrigger value="past">Pasados ({data.past.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="upcoming" className="mt-4">
            {data.upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                No hay eventos próximos en Luma.
              </p>
            ) : (
              <EventList
                events={data.upcoming}
                orgId={orgId}
                slug={slug}
                onGuests={setGuestsFor}
              />
            )}
          </TabsContent>
          <TabsContent value="past" className="mt-4">
            <EventList
              events={data.past.slice(0, pastShown)}
              orgId={orgId}
              slug={slug}
              onGuests={setGuestsFor}
            />
            {data.past.length > pastShown && (
              <Button
                variant="ghost"
                className="min-h-11 mt-3"
                onClick={() => setPastShown((n) => n + PAST_PAGE)}
              >
                Ver más ({data.past.length - pastShown})
              </Button>
            )}
          </TabsContent>
        </Tabs>
      )}

      {guestsFor && (
        <LumaGuestsDialog
          open
          onOpenChange={(open) => !open && setGuestsFor(null)}
          orgId={orgId}
          lumaEventId={guestsFor.lumaEventId}
          title={guestsFor.title}
          managed={guestsFor.socialEventId !== null}
        />
      )}
      <CreateLumaEventDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        orgId={orgId}
        slug={slug}
      />
    </section>
  )
}

function EventList({
  events,
  orgId,
  slug,
  onGuests,
}: {
  events: Array<LumaEventRow>
  orgId: Id<'organizations'>
  slug: string
  onGuests: (event: LumaEventRow) => void
}) {
  return (
    <ul className="space-y-3">
      {events.map((event) => (
        <li key={event._id}>
          <LumaEventCard
            event={event}
            orgId={orgId}
            slug={slug}
            onGuests={() => onGuests(event)}
          />
        </li>
      ))}
    </ul>
  )
}

function LumaEventCard({
  event,
  orgId,
  slug,
  onGuests,
}: {
  event: LumaEventRow
  orgId: Id<'organizations'>
  slug: string
  onGuests: () => void
}) {
  const manage = useMutation(api.luma.admin.manageInAstn)
  const navigate = useNavigate()
  const { busy, run } = useBusyAction<'manage'>()
  const counts = guestCountsText(event)

  const handleManage = () =>
    run(
      'manage',
      async () => {
        const { eventId, created } = await manage({
          orgId,
          lumaEventId: event.lumaEventId,
        })
        if (created) {
          toast.success(
            'Evento creado en ASTN como borrador. Estamos trayendo los invitados de Luma.',
          )
        }
        void navigate({
          to: '/org/$slug/admin/events/$eventId',
          params: { slug, eventId },
        })
      },
      toastError('No se pudo gestionar en ASTN'),
    )

  return (
    <Card className="px-4 py-3">
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {event.managedByCalendar ? (
              <Link
                to="/org/$slug/admin/events/luma/$lumaEventId"
                params={{ slug, lumaEventId: event.lumaEventId }}
                className="font-medium truncate hover:underline underline-offset-2"
              >
                {event.title}
              </Link>
            ) : (
              <span className="font-medium truncate">{event.title}</span>
            )}
            <VisibilityBadge visibility={event.visibility} />
            {event.socialEventId && (
              <Badge
                variant="outline"
                className="bg-green-50 text-green-700 border-green-200"
              >
                Gestionado en ASTN
              </Badge>
            )}
            {!event.managedByCalendar && (
              <Badge variant="outline" title="Lo organiza otro calendario">
                Solo listado
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs text-muted-foreground">
            <span className="first-letter:uppercase">
              {formatEventDateTime(event.startAt, event.timezone)}
            </span>
            {counts && (
              <>
                <span className="text-slate-300">|</span>
                <span>{counts}</span>
              </>
            )}
            {event.guestSyncError && (
              <>
                <span className="text-slate-300">|</span>
                <span className="text-red-700">
                  No se pudieron leer los invitados
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="min-h-11" asChild>
            <a href={event.url} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4 mr-1.5" />
              Luma
            </a>
          </Button>
          {event.managedByCalendar && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="min-h-11"
                onClick={onGuests}
              >
                <Users className="size-4 mr-1.5" />
                Invitados
              </Button>
              <Button variant="outline" size="sm" className="min-h-11" asChild>
                <Link
                  to="/org/$slug/admin/events/luma/$lumaEventId"
                  params={{ slug, lumaEventId: event.lumaEventId }}
                >
                  <Settings2 className="size-4 mr-1.5" />
                  Editar y emails
                </Link>
              </Button>
              {event.socialEventId ? (
                <Button size="sm" className="min-h-11" asChild>
                  <Link
                    to="/org/$slug/admin/events/$eventId"
                    params={{ slug, eventId: event.socialEventId }}
                  >
                    Ver en ASTN
                  </Link>
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="min-h-11"
                  disabled={busy !== null}
                  onClick={() => void handleManage()}
                  title="Inscripciones, aprobaciones, 1:1 y check-in desde ASTN"
                >
                  {busy === 'manage' && (
                    <Loader2 className="size-4 mr-1.5 animate-spin" />
                  )}
                  Gestionar en ASTN
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  )
}

function CreateLumaEventDialog({
  open,
  onOpenChange,
  orgId,
  slug,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: Id<'organizations'>
  slug: string
}) {
  const createEvent = useAction(api.luma.api.createEvent)
  const navigate = useNavigate()
  const form = useLumaEventForm(EMPTY_LUMA_EVENT)
  const { busy, run } = useBusyAction<'create'>()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.canSave || busy) return
    const result = await run(
      'create',
      () => createEvent({ orgId, ...lumaArgs(form.values) }),
      toastError('No se pudo crear el evento en Luma'),
    )
    if (!result) return
    toast.success('Evento creado en Luma')
    onOpenChange(false)
    form.setValues(EMPTY_LUMA_EVENT)
    void navigate({
      to: '/org/$slug/admin/events/luma/$lumaEventId',
      params: { slug, lumaEventId: result.lumaEventId },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Crear evento en Luma</DialogTitle>
          <DialogDescription>
            Se publica en el calendario de Luma de la organización con la
            visibilidad que elijas. Después podés gestionarlo en ASTN.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <LumaEventFields form={form} idPrefix="new-luma-event" />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="min-h-11"
              disabled={!form.canSave || busy !== null}
            >
              {busy && <Loader2 className="size-4 mr-2 animate-spin" />}
              Crear en Luma
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
