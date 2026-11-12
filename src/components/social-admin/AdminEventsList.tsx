import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import {
  CalendarDays,
  ChevronRight,
  ExternalLink,
  Loader2,
  Plus,
  Settings2,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '../../../convex/_generated/dataModel'
import { LumaGuestsDialog } from './LumaGuestsList'
import {
  VisibilityBadge,
  guestCountsText,
  useLastDefined,
  useNow,
} from './luma-shared'
import type { LumaEventRow } from './luma-shared'
import { EventStatusBadge, toastError } from './shared'
import type { AdminEventRow, EventPlace } from '~/lib/admin-events-list'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { eventPlace, mergeAdminEvents } from '~/lib/admin-events-list'
import { useBusyAction } from '~/lib/use-busy-action'
import { formatEventDateTime } from '~/lib/zoned-time'

type AstnEventRow = FunctionReturnType<
  typeof api.social.events.listEvents
>[number]

type EventRow = AdminEventRow<LumaEventRow, AstnEventRow>

export type AdminEvents = {
  // Whether the org's Luma calendar is the one ASTN has the API key for.
  lumaConnected: boolean
  hasLumaEvents: boolean
  upcoming: Array<EventRow>
  past: Array<EventRow>
}

const PAST_PAGE = 20

const PLACE_LABELS: Record<EventPlace, string> = {
  luma_and_astn: 'Luma y ASTN',
  astn: 'Solo ASTN',
  luma: 'Solo Luma',
}

const PLACE_TITLES: Record<EventPlace, string> = {
  luma_and_astn: 'Está en Luma y se gestiona en ASTN',
  astn: 'Existe solo en ASTN, no está en Luma',
  luma: 'Está en Luma y no se gestiona en ASTN',
}

/**
 * The org's events for the admin list: its Luma calendar (as mirrored) and
 * its ASTN events, merged. Undefined while loading. An org that isn't
 * connected to Luma only gets its ASTN events.
 */
export function useAdminEvents(
  orgId: Id<'organizations'>,
): AdminEvents | undefined {
  const now = useNow()
  // `now` changes every minute, which reloads the query: keep the last list
  // on screen meanwhile, so the page doesn't flash a spinner and reset.
  const luma = useLastDefined(
    useQuery(api.luma.admin.listLumaEvents, { orgId, now }),
    orgId,
  )
  const astn = useQuery(api.social.events.listEvents, { orgId })
  if (luma === undefined || astn === undefined) return undefined
  const lumaEvents = luma.connected ? [...luma.upcoming, ...luma.past] : []
  return {
    lumaConnected: luma.connected,
    hasLumaEvents: lumaEvents.length > 0,
    ...mergeAdminEvents({ luma: lumaEvents, astn, now }),
  }
}

/** Every event of the org, upcoming and past, with what can be done to each. */
export function AdminEventsList({
  events,
  orgId,
  slug,
  onCreate,
}: {
  events: AdminEvents
  orgId: Id<'organizations'>
  slug: string
  onCreate: () => void
}) {
  const [guestsFor, setGuestsFor] = useState<LumaEventRow | null>(null)
  const [pastShown, setPastShown] = useState(PAST_PAGE)
  const { upcoming, past } = events

  if (upcoming.length + past.length === 0) {
    return (
      <Card className="p-8 text-center">
        <CalendarDays className="size-8 text-slate-400 mx-auto mb-4" />
        <p className="text-muted-foreground mb-4">
          Todavía no hay eventos. Creá uno para abrir las inscripciones.
        </p>
        <Button className="min-h-11" onClick={onCreate}>
          <Plus className="size-4 mr-2" />
          Crear el primer evento
        </Button>
      </Card>
    )
  }

  const list = (rows: Array<EventRow>) => (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.key}>
          <EventCard
            row={row}
            orgId={orgId}
            slug={slug}
            onGuests={setGuestsFor}
          />
        </li>
      ))}
    </ul>
  )

  return (
    <>
      <Tabs defaultValue={upcoming.length > 0 ? 'upcoming' : 'past'}>
        <TabsList>
          <TabsTrigger value="upcoming">
            Próximos ({upcoming.length})
          </TabsTrigger>
          <TabsTrigger value="past">Pasados ({past.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming" className="mt-4">
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No hay eventos próximos.
            </p>
          ) : (
            list(upcoming)
          )}
        </TabsContent>
        <TabsContent value="past" className="mt-4">
          {past.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No hay eventos pasados.
            </p>
          ) : (
            list(past.slice(0, pastShown))
          )}
          {past.length > pastShown && (
            <Button
              variant="ghost"
              className="min-h-11 mt-3"
              onClick={() => setPastShown((n) => n + PAST_PAGE)}
            >
              Ver más ({past.length - pastShown})
            </Button>
          )}
        </TabsContent>
      </Tabs>

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
    </>
  )
}

function EventCard({
  row,
  orgId,
  slug,
  onGuests,
}: {
  row: EventRow
  orgId: Id<'organizations'>
  slug: string
  onGuests: (event: LumaEventRow) => void
}) {
  const manage = useMutation(api.luma.admin.manageInAstn)
  const navigate = useNavigate()
  const { busy, run } = useBusyAction<'manage'>()
  const { luma, astn, astnEventId } = row
  const place = eventPlace(row)
  // Luma events run by another calendar are only listed: ASTN can't read
  // their guests or change them.
  const lumaManageable = luma?.managedByCalendar === true
  const lumaCounts = luma ? guestCountsText(luma) : null

  const handleManage = (lumaEventId: string) =>
    run(
      'manage',
      async () => {
        const { eventId, created } = await manage({ orgId, lumaEventId })
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

  const titleClass = 'font-medium truncate hover:underline underline-offset-2'

  return (
    <Card className="px-4 py-3">
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {astnEventId ? (
              <Link
                to="/org/$slug/admin/events/$eventId"
                params={{ slug, eventId: astnEventId }}
                className={titleClass}
              >
                {row.title}
              </Link>
            ) : luma && lumaManageable ? (
              <Link
                to="/org/$slug/admin/events/luma/$lumaEventId"
                params={{ slug, lumaEventId: luma.lumaEventId }}
                className={titleClass}
              >
                {row.title}
              </Link>
            ) : (
              <span className="font-medium truncate">{row.title}</span>
            )}
            <Badge variant="outline" title={PLACE_TITLES[place]}>
              {PLACE_LABELS[place]}
            </Badge>
            {astn && <EventStatusBadge status={astn.status} />}
            {luma && <VisibilityBadge visibility={luma.visibility} />}
            {luma && !lumaManageable && (
              <Badge
                variant="outline"
                className="bg-slate-50 text-slate-600"
                title="Lo organiza otro calendario de Luma: acá solo se lista"
              >
                De otro calendario · solo lectura
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs text-muted-foreground">
            <span className="first-letter:uppercase">
              {formatEventDateTime(row.startAt, row.timezone)}
            </span>
            {astn ? (
              <>
                <span className="text-slate-300">|</span>
                <span>
                  {astn.approvedCount} aprobado
                  {astn.approvedCount !== 1 ? 's' : ''}
                </span>
                {astn.pendingCount > 0 && (
                  <>
                    <span className="text-slate-300">|</span>
                    <span className="text-amber-700 font-medium">
                      {astn.pendingCount} pendiente
                      {astn.pendingCount !== 1 ? 's' : ''}
                    </span>
                  </>
                )}
              </>
            ) : (
              lumaCounts && (
                <>
                  <span className="text-slate-300">|</span>
                  <span>{lumaCounts}</span>
                </>
              )
            )}
            {luma?.guestSyncError && (
              <>
                <span className="text-slate-300">|</span>
                <span className="text-red-700">
                  No se pudieron leer los invitados de Luma
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {luma && (
            <Button variant="outline" size="sm" className="min-h-11" asChild>
              <a href={luma.url} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4 mr-1.5" />
                Luma
              </a>
            </Button>
          )}
          {luma && lumaManageable && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="min-h-11"
                onClick={() => onGuests(luma)}
              >
                <Users className="size-4 mr-1.5" />
                Invitados en Luma
              </Button>
              <Button variant="outline" size="sm" className="min-h-11" asChild>
                <Link
                  to="/org/$slug/admin/events/luma/$lumaEventId"
                  params={{ slug, lumaEventId: luma.lumaEventId }}
                >
                  <Settings2 className="size-4 mr-1.5" />
                  Editar y emails
                </Link>
              </Button>
            </>
          )}
          {astnEventId ? (
            <Button size="sm" className="min-h-11" asChild>
              <Link
                to="/org/$slug/admin/events/$eventId"
                params={{ slug, eventId: astnEventId }}
              >
                Abrir
                <ChevronRight className="size-4 ml-1" aria-hidden />
              </Link>
            </Button>
          ) : (
            luma &&
            lumaManageable && (
              <Button
                size="sm"
                className="min-h-11"
                disabled={busy !== null}
                onClick={() => void handleManage(luma.lumaEventId)}
                title="Inscripciones, aprobaciones, 1:1 y check-in desde ASTN"
              >
                {busy === 'manage' && (
                  <Loader2 className="size-4 mr-1.5 animate-spin" />
                )}
                Gestionar en ASTN
              </Button>
            )
          )}
        </div>
      </div>
    </Card>
  )
}
