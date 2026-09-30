import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  CalendarDays,
  ExternalLink,
  Loader2,
  Mail,
  RefreshCw,
  Save,
  Settings,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../../../../convex/_generated/api'
import type { Id } from '../../../../../../convex/_generated/dataModel'
import { LumaBlastsCard } from '~/components/social-admin/LumaBlastsCard'
import {
  LumaEventFields,
  SuppressEmailCheckbox,
  lumaArgs,
  useLumaEventForm,
  valuesFromLuma,
} from '~/components/social-admin/LumaEventForm'
import type { LumaEventValues } from '~/components/social-admin/LumaEventForm'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { errorText } from '~/lib/convex-error'
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

  const handleManage = () =>
    run(
      'manage',
      async () => {
        const { eventId } = await manage({ orgId, lumaEventId })
        toast.success(
          'Evento creado en ASTN como borrador. Estamos trayendo los invitados de Luma.',
        )
        void navigate({
          to: '/org/$slug/admin/events/$eventId',
          params: { slug, eventId },
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
              {event.socialEventId ? (
                <Button className="min-h-11" asChild>
                  <Link
                    to="/org/$slug/admin/events/$eventId"
                    params={{ slug, eventId: event.socialEventId }}
                  >
                    Ver en ASTN
                  </Link>
                </Button>
              ) : (
                event.managedByCalendar && (
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
                )
              )}
            </div>
          </div>
          {!event.socialEventId && event.managedByCalendar && (
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
          <Tabs defaultValue="guests">
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
            <TabsContent value="guests" className="mt-6">
              <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div>
                    <CardTitle>Invitados en Luma</CardTitle>
                    <CardDescription>
                      {event.socialEventId
                        ? 'Solo lectura. Para aprobar o rechazar, usá el evento en ASTN.'
                        : 'Solo lectura. Para aprobar desde ASTN, gestioná el evento en ASTN.'}{' '}
                      Cada persona queda en su historial del CRM.
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
            </TabsContent>
            <TabsContent value="settings" className="mt-6">
              <EditLumaEventCard
                orgId={orgId}
                slug={slug}
                lumaEventId={lumaEventId}
                socialEventId={event.socialEventId}
              />
            </TabsContent>
            <TabsContent value="emails" className="mt-6">
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
            </TabsContent>
          </Tabs>
        )}
      </div>
    </PageShell>
  )
}

/** Loads the event's settings live from Luma, then shows the form. */
function EditLumaEventCard({
  orgId,
  slug,
  lumaEventId,
  socialEventId,
}: {
  orgId: Id<'organizations'>
  slug: string
  lumaEventId: string
  socialEventId: Id<'socialEvents'> | null
}) {
  const getForEdit = useAction(api.luma.api.getEventForEdit)
  const [initial, setInitial] = useState<LumaEventValues | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setInitial(valuesFromLuma(await getForEdit({ orgId, lumaEventId })))
    } catch (err) {
      setError(errorText(err, 'No se pudieron leer los datos de Luma'))
    }
  }, [getForEdit, orgId, lumaEventId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Datos en Luma</CardTitle>
        <CardDescription>
          {socialEventId ? (
            <>
              El nombre, horario, lugar y descripción se editan en{' '}
              <Link
                to="/org/$slug/admin/events/$eventId"
                params={{ slug, eventId: socialEventId }}
                className="underline underline-offset-2"
              >
                el evento en ASTN
              </Link>{' '}
              y se copian a Luma. Acá quedan los ajustes que solo existen en
              Luma.
            </>
          ) : (
            'Los cambios se guardan directamente en Luma.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {initial ? (
          <EditLumaEventForm
            key={JSON.stringify(initial)}
            orgId={orgId}
            lumaEventId={lumaEventId}
            initial={initial}
            settingsOnly={socialEventId !== null}
            onSaved={() => void load()}
          />
        ) : error ? (
          <div className="space-y-3">
            <p className="text-sm text-red-700">{error}</p>
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => void load()}
            >
              Reintentar
            </Button>
          </div>
        ) : (
          <Spinner className="size-6 mx-auto" />
        )}
      </CardContent>
    </Card>
  )
}

function EditLumaEventForm({
  orgId,
  lumaEventId,
  initial,
  settingsOnly,
  onSaved,
}: {
  orgId: Id<'organizations'>
  lumaEventId: string
  initial: LumaEventValues
  settingsOnly: boolean
  onSaved: () => void
}) {
  const updateEvent = useAction(api.luma.api.updateEvent)
  const form = useLumaEventForm(initial)
  const [suppressEmail, setSuppressEmail] = useState(false)
  const { busy, run } = useBusyAction<'save'>()

  const next = lumaArgs(form.values)
  const before = lumaArgs(initial)
  const timeChanged =
    next.startAt !== before.startAt ||
    next.endAt !== before.endAt ||
    next.timezone !== before.timezone
  const changes = {
    ...(next.name !== before.name ? { name: next.name } : {}),
    ...(timeChanged
      ? { startAt: next.startAt, endAt: next.endAt, timezone: next.timezone }
      : {}),
    ...(next.descriptionMd !== before.descriptionMd
      ? { descriptionMd: next.descriptionMd }
      : {}),
    ...(next.address !== before.address ? { address: next.address } : {}),
    ...(next.visibility !== before.visibility
      ? { visibility: next.visibility }
      : {}),
    ...(next.maxCapacity !== before.maxCapacity
      ? { maxCapacity: next.maxCapacity }
      : {}),
    ...(next.requireApproval !== before.requireApproval
      ? { requireApproval: next.requireApproval }
      : {}),
  }
  const hasChanges = Object.keys(changes).length > 0
  const notifiesGuests =
    'name' in changes || 'startAt' in changes || 'address' in changes

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.canSave || !hasChanges || busy) return
    await run(
      'save',
      async () => {
        await updateEvent({ orgId, lumaEventId, ...changes, suppressEmail })
        toast.success('Guardado en Luma')
        onSaved()
      },
      toastError('No se pudo guardar en Luma'),
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <LumaEventFields
        form={form}
        idPrefix="luma-edit"
        settingsOnly={settingsOnly}
        editing
      />
      {notifiesGuests && (
        <SuppressEmailCheckbox
          id="luma-edit-suppress"
          checked={suppressEmail}
          onChange={setSuppressEmail}
        />
      )}
      <Button
        type="submit"
        className="min-h-11"
        disabled={!form.canSave || !hasChanges || busy !== null}
      >
        {busy ? (
          <Loader2 className="size-4 mr-2 animate-spin" />
        ) : (
          <Save className="size-4 mr-2" />
        )}
        Guardar en Luma
      </Button>
    </form>
  )
}
