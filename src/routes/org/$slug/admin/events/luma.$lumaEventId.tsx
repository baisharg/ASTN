import {
  Link,
  Navigate,
  createFileRoute,
  useNavigate,
} from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  CalendarDays,
  ExternalLink,
  Loader2,
  Mail,
  RefreshCw,
  Settings,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../../../../../convex/_generated/api'
import type { Id } from '../../../../../../convex/_generated/dataModel'
import {
  KeptTabsContent,
  useKeptTabs,
} from '~/components/social-admin/KeptTabs'
import { LumaBlastsCard } from '~/components/social-admin/LumaBlastsCard'
import { LumaEventSettingsCard } from '~/components/social-admin/LumaEventSettingsCard'
import { LumaGuestsList } from '~/components/social-admin/LumaGuestsList'
import {
  VisibilityBadge,
  guestCountsText,
} from '~/components/social-admin/luma-shared'
import {
  OrgAdminGate,
  PageShell,
  toastError,
} from '~/components/social-admin/shared'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { Spinner } from '~/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { useBusyAction } from '~/lib/use-busy-action'
import { formatEventDateTime } from '~/lib/zoned-time'

export const Route = createFileRoute(
  '/org/$slug/admin/events/luma/$lumaEventId',
)({
  component: LumaEventRoute,
})

function LumaEventRoute() {
  const { slug, lumaEventId } = Route.useParams()
  return (
    <OrgAdminGate slug={slug}>
      {(org) => (
        <LumaEventPage orgId={org._id} slug={slug} lumaEventId={lumaEventId} />
      )}
    </OrgAdminGate>
  )
}

function LumaEventPage({
  orgId,
  slug,
  lumaEventId,
}: {
  orgId: Id<'organizations'>
  slug: string
  lumaEventId: string
}) {
  const event = useQuery(api.luma.admin.getLumaEvent, { orgId, lumaEventId })
  const manage = useMutation(api.luma.admin.manageInAstn)
  const refreshGuests = useMutation(api.luma.admin.refreshGuests)
  const navigate = useNavigate()
  const { busy, run } = useBusyAction<'manage' | 'refresh'>()
  // Panels stay mounted once opened: a half-written email or unsaved
  // settings survive a look at another tab.
  const { tab, openTab, visited } = useKeptTabs<
    'guests' | 'settings' | 'emails'
  >('guests')

  if (event === undefined) {
    return (
      <PageShell>
        <Spinner className="size-8 mx-auto" />
      </PageShell>
    )
  }
  if (event === null) {
    return (
      <PageShell>
        <div className="max-w-lg mx-auto text-center py-12">
          <CalendarDays className="size-8 text-slate-400 mx-auto mb-4" />
          <h1 className="text-2xl font-display mb-4">
            No encontramos el evento de Luma
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

  // An event managed in ASTN has one page, its ASTN page (guests, Luma
  // settings and emails are tabs there). This address still works for it:
  // it sends the admin there.
  if (event.socialEventId) {
    return (
      <Navigate
        to="/org/$slug/admin/events/$eventId"
        params={{ slug, eventId: event.socialEventId }}
        replace
      />
    )
  }

  const handleManage = () =>
    run(
      'manage',
      async () => {
        const { eventId } = await manage({ orgId, lumaEventId })
        toast.success(
          'Evento creado en ASTN como borrador. Estamos trayendo los invitados de Luma.',
        )
        // Replaces this page, like the redirect above does once the event
        // is managed, so "back" returns to the list.
        void navigate({
          to: '/org/$slug/admin/events/$eventId',
          params: { slug, eventId },
          replace: true,
        })
      },
      toastError('No se pudo gestionar en ASTN'),
    )

  const handleRefresh = () =>
    run(
      'refresh',
      async () => {
        await refreshGuests({ orgId, lumaEventId })
        toast.success('Actualizando invitados desde Luma')
      },
      toastError('No se pudo actualizar'),
    )

  const counts = guestCountsText(event)

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
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-display font-semibold text-foreground">
                  {event.title}
                </h1>
                <Badge variant="outline">Luma</Badge>
                <VisibilityBadge visibility={event.visibility} />
              </div>
              <p className="text-muted-foreground mt-1 first-letter:uppercase">
                {formatEventDateTime(event.startAt, event.timezone)}
                {event.location ? ` · ${event.location}` : ''}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {counts ?? 'Invitados todavía sin leer'}
                {event.lastGuestSyncAt &&
                  ` · leídos ${formatDistanceToNow(event.lastGuestSyncAt, {
                    addSuffix: true,
                    locale: es,
                  })}`}
                {event.guestSyncPending && ' · actualizando…'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="min-h-11" asChild>
                <a href={event.url} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4 mr-2" />
                  Abrir en Luma
                </a>
              </Button>
              {event.managedByCalendar && (
                <Button
                  className="min-h-11"
                  disabled={busy !== null}
                  onClick={() => void handleManage()}
                >
                  {busy === 'manage' && (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  )}
                  Gestionar en ASTN
                </Button>
              )}
            </div>
          </div>
          {event.managedByCalendar && (
            <p className="text-sm text-muted-foreground mt-3">
              Gestionarlo en ASTN crea un evento vinculado: inscripciones,
              aprobaciones, 1:1 y check-in en la puerta, sincronizados con Luma.
            </p>
          )}
        </div>

        {!event.managedByCalendar ? (
          <Card className="p-6 text-sm text-muted-foreground">
            Este evento está listado en el calendario, pero lo organiza otro
            calendario de Luma: sus invitados y ajustes no están disponibles
            acá.
          </Card>
        ) : (
          <Tabs value={tab} onValueChange={openTab}>
            <div className="overflow-x-auto">
              <TabsList>
                <TabsTrigger value="guests" className="gap-2">
                  <Users className="size-4" />
                  Invitados
                </TabsTrigger>
                <TabsTrigger value="settings" className="gap-2">
                  <Settings className="size-4" />
                  Editar
                </TabsTrigger>
                <TabsTrigger value="emails" className="gap-2">
                  <Mail className="size-4" />
                  Emails
                </TabsTrigger>
              </TabsList>
            </div>
            <KeptTabsContent value="guests" visited={visited} className="mt-6">
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div>
                    <CardTitle>Invitados en Luma</CardTitle>
                    <CardDescription>
                      Solo lectura. Para aprobar desde ASTN, gestioná el evento
                      en ASTN. Cada persona queda en su historial del CRM.
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    className="min-h-11 shrink-0"
                    disabled={busy !== null}
                    onClick={() => void handleRefresh()}
                    title="Volver a leer los invitados y actualizar el CRM"
                  >
                    <RefreshCw
                      className={`size-4 mr-2 ${busy === 'refresh' ? 'animate-spin' : ''}`}
                    />
                    Actualizar CRM
                  </Button>
                </CardHeader>
                <CardContent>
                  <LumaGuestsList orgId={orgId} lumaEventId={lumaEventId} />
                </CardContent>
              </Card>
            </KeptTabsContent>
            <KeptTabsContent
              value="settings"
              visited={visited}
              className="mt-6"
            >
              <LumaEventSettingsCard
                orgId={orgId}
                lumaEventId={lumaEventId}
                settingsOnly={false}
              />
            </KeptTabsContent>
            <KeptTabsContent value="emails" visited={visited} className="mt-6">
              <LumaBlastsCard
                orgId={orgId}
                lumaEventId={lumaEventId}
                timezone={event.timezone}
                counts={{
                  approved: event.approvedCount,
                  pending: event.pendingCount,
                  checkedIn: event.checkedInCount,
                }}
              />
            </KeptTabsContent>
          </Tabs>
        )}
      </div>
    </PageShell>
  )
}
