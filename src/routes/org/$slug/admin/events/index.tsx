import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { useState } from 'react'
import { CalendarDays, ChevronRight, Link2, Plus } from 'lucide-react'
import { api } from '../../../../../../convex/_generated/api'
import type { Doc } from '../../../../../../convex/_generated/dataModel'
import { CreateEventDialog } from '~/components/social-admin/CreateEventDialog'
import { LumaCalendarSection } from '~/components/social-admin/LumaCalendarSection'
import { useLastDefined, useNow } from '~/components/social-admin/luma-shared'
import {
  EventStatusBadge,
  OrgAdminGate,
  PageShell,
} from '~/components/social-admin/shared'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Spinner } from '~/components/ui/spinner'
import { formatEventDateTime } from '~/lib/zoned-time'

export const Route = createFileRoute('/org/$slug/admin/events/')({
  component: AdminEventsRoute,
})

function AdminEventsRoute() {
  const { slug } = Route.useParams()
  return (
    <OrgAdminGate slug={slug}>
      {(org) => <AdminEventsPage org={org} slug={slug} />}
    </OrgAdminGate>
  )
}

function AdminEventsPage({
  org,
  slug,
}: {
  org: Doc<'organizations'>
  slug: string
}) {
  const events = useQuery(api.social.events.listEvents, { orgId: org._id })
  // Whether the org is connected to Luma decides what "Crear evento" offers.
  const now = useNow()
  const luma = useLastDefined(
    useQuery(api.luma.admin.listLumaEvents, { orgId: org._id, now }),
    org._id,
  )
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <PageShell>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
          <Link
            to="/org/$slug/admin"
            params={{ slug }}
            className="hover:text-slate-700 transition-colors"
          >
            Admin
          </Link>
          <span>/</span>
          <span className="text-slate-700">Eventos</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-display font-semibold text-foreground">
              Eventos presenciales
            </h1>
            <p className="text-muted-foreground mt-1">
              Inscripciones, aprobación de invitados y 1:1 durante el evento
            </p>
          </div>
          <Button className="min-h-11" onClick={() => setDialogOpen(true)}>
            <Plus className="size-4 mr-2" />
            Crear evento
          </Button>
        </div>

        {events === undefined ? (
          <div className="py-12 text-center">
            <Spinner className="size-8 mx-auto" />
          </div>
        ) : events.length === 0 ? (
          <Card className="p-8 text-center">
            <CalendarDays className="size-8 text-slate-400 mx-auto mb-4" />
            <p className="text-muted-foreground mb-4">
              Todavía no hay eventos. Creá uno para abrir las inscripciones.
            </p>
            <Button className="min-h-11" onClick={() => setDialogOpen(true)}>
              <Plus className="size-4 mr-2" />
              Crear el primer evento
            </Button>
          </Card>
        ) : (
          <ul className="space-y-3">
            {events.map((event) => (
              <li key={event._id}>
                <Link
                  to="/org/$slug/admin/events/$eventId"
                  params={{ slug, eventId: event._id }}
                  className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Card className="px-4 py-3 hover:border-slate-300 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">
                            {event.title}
                          </span>
                          <EventStatusBadge status={event.status} />
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs text-muted-foreground">
                          <span className="first-letter:uppercase">
                            {formatEventDateTime(event.startAt, event.timezone)}
                          </span>
                          <span className="text-slate-300">|</span>
                          <span>
                            {event.approvedCount} aprobado
                            {event.approvedCount !== 1 ? 's' : ''}
                          </span>
                          {event.pendingCount > 0 && (
                            <>
                              <span className="text-slate-300">|</span>
                              <span className="text-amber-700 font-medium">
                                {event.pendingCount} pendiente
                                {event.pendingCount !== 1 ? 's' : ''}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      {event.lumaLinked && (
                        <Badge
                          variant="outline"
                          className="gap-1"
                          title="Vinculado con Luma"
                        >
                          <Link2 className="size-3" />
                          Luma
                        </Badge>
                      )}
                      <ChevronRight
                        className="size-4 text-muted-foreground shrink-0"
                        aria-hidden
                      />
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <LumaCalendarSection orgId={org._id} slug={slug} />

        <CreateEventDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          orgId={org._id}
          slug={slug}
          lumaConnected={luma?.connected}
        />
      </div>
    </PageShell>
  )
}
