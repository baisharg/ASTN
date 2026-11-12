import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import {
  Activity,
  CalendarDays,
  ExternalLink,
  ListChecks,
  ScanLine,
  Settings,
  Users,
} from 'lucide-react'
import { api } from '../../../../../../convex/_generated/api'
import type { Id } from '../../../../../../convex/_generated/dataModel'
import { AllowlistTab } from '~/components/social-admin/AllowlistTab'
import { EventSettingsTab } from '~/components/social-admin/EventSettingsTab'
import { GuestsTab } from '~/components/social-admin/GuestsTab'
import {
  KeptTabsContent,
  useKeptTabs,
} from '~/components/social-admin/KeptTabs'
import { LiveTab } from '~/components/social-admin/LiveTab'
import {
  EventStatusBadge,
  OrgAdminGate,
  PageShell,
} from '~/components/social-admin/shared'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { formatEventDateTime } from '~/lib/zoned-time'

export const Route = createFileRoute('/org/$slug/admin/events/$eventId')({
  component: AdminEventRoute,
})

function AdminEventRoute() {
  const { slug, eventId } = Route.useParams()
  return (
    <OrgAdminGate slug={slug}>
      {(org) => (
        <AdminEventPage
          orgId={org._id}
          slug={slug}
          eventId={eventId as Id<'socialEvents'>}
        />
      )}
    </OrgAdminGate>
  )
}

function AdminEventPage({
  orgId,
  slug,
  eventId,
}: {
  orgId: Id<'organizations'>
  slug: string
  eventId: Id<'socialEvents'>
}) {
  const event = useQuery(api.social.events.getEventAdmin, { eventId })
  // Panels stay mounted once opened: unsaved spots or details survive a look
  // at another tab.
  const { tab, openTab, visited } = useKeptTabs<
    'settings' | 'guests' | 'allowlist' | 'live'
  >('settings')

  if (event === undefined) {
    return (
      <PageShell>
        <Spinner className="size-8 mx-auto" />
      </PageShell>
    )
  }

  if (event === null || event.orgId !== orgId) {
    return (
      <PageShell>
        <div className="max-w-lg mx-auto text-center py-12">
          <CalendarDays className="size-8 text-slate-400 mx-auto mb-4" />
          <h1 className="text-2xl font-display mb-4">
            No encontramos el evento
          </h1>
          <Button asChild>
            <Link to="/org/$slug/admin/events" params={{ slug }}>
              Volver a eventos
            </Link>
          </Button>
        </div>
      </PageShell>
    )
  }

  const publicPath = `/org/${event.orgSlug ?? slug}/e/${event.slug}`

  return (
    <PageShell>
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
            <Link
              to="/org/$slug/admin"
              params={{ slug }}
              className="hover:text-slate-700 transition-colors"
            >
              Admin
            </Link>
            <span>/</span>
            <Link
              to="/org/$slug/admin/events"
              params={{ slug }}
              className="hover:text-slate-700 transition-colors"
            >
              Eventos
            </Link>
            <span>/</span>
            <span className="text-slate-700 truncate">{event.title}</span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-display font-semibold text-foreground">
                  {event.title}
                </h1>
                <EventStatusBadge status={event.status} />
              </div>
              <p className="text-muted-foreground mt-1 first-letter:uppercase">
                {formatEventDateTime(event.startAt, event.timezone)}
                {event.venueName ? ` · ${event.venueName}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button className="min-h-11" asChild>
                <Link
                  to="/org/$slug/admin/events/$eventId/checkin"
                  params={{ slug, eventId: event._id }}
                >
                  <ScanLine className="size-4 mr-2" />
                  Check-in en la puerta
                </Link>
              </Button>
              <Button variant="outline" className="min-h-11" asChild>
                <a href={publicPath} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4 mr-2" />
                  Ver página para asistentes
                </a>
              </Button>
            </div>
          </div>
        </div>

        <Tabs value={tab} onValueChange={openTab}>
          <div className="overflow-x-auto">
            <TabsList>
              <TabsTrigger value="settings" className="gap-2">
                <Settings className="size-4" />
                Configuración
              </TabsTrigger>
              <TabsTrigger value="guests" className="gap-2">
                <Users className="size-4" />
                Invitados
                {event.pendingCount > 0 && (
                  <span
                    className="ml-1 rounded-full bg-amber-100 text-amber-800 px-1.5 text-xs font-medium"
                    title={`${event.pendingCount} pendientes de aprobación`}
                  >
                    {event.pendingCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="allowlist" className="gap-2">
                <ListChecks className="size-4" />
                Preaprobados
              </TabsTrigger>
              <TabsTrigger value="live" className="gap-2">
                <Activity className="size-4" />
                En vivo
              </TabsTrigger>
            </TabsList>
          </div>

          <KeptTabsContent value="settings" visited={visited} className="mt-6">
            <EventSettingsTab event={event} />
          </KeptTabsContent>
          <KeptTabsContent value="guests" visited={visited} className="mt-6">
            <GuestsTab eventId={event._id} lumaLinked={!!event.lumaEventId} />
          </KeptTabsContent>
          <KeptTabsContent value="allowlist" visited={visited} className="mt-6">
            <AllowlistTab orgId={event.orgId} />
          </KeptTabsContent>
          <KeptTabsContent value="live" visited={visited} className="mt-6">
            <LiveTab eventId={event._id} />
          </KeptTabsContent>
        </Tabs>
      </div>
    </PageShell>
  )
}
