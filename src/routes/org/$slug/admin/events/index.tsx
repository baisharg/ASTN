import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  Building2,
  CalendarDays,
  ChevronRight,
  Link2,
  Loader2,
  Plus,
  Shield,
} from 'lucide-react'
import { api } from '../../../../../../convex/_generated/api'
import type { Id } from '../../../../../../convex/_generated/dataModel'
import { AuthHeader } from '~/components/layout/auth-header'
import {
  EventStatusBadge,
  TimezoneSelect,
  DEFAULT_EVENT_TIMEZONE,
  errorMessage,
} from '~/components/social-admin/shared'
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
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Spinner } from '~/components/ui/spinner'
import { Textarea } from '~/components/ui/textarea'
import { useDotGridStyle } from '~/hooks/use-dot-grid-style'
import {
  differsFromBrowserZone,
  formatEventDateTime,
  timeOnEventNight,
  zonedToEpoch,
} from '~/lib/zoned-time'

export const Route = createFileRoute('/org/$slug/admin/events/')({
  component: AdminEventsPage,
})

function AdminEventsPage() {
  const { slug } = Route.useParams()
  const dotGridStyle = useDotGridStyle()

  const org = useQuery(api.orgs.directory.getOrgBySlug, { slug })
  const membership = useQuery(
    api.orgs.membership.getMembership,
    org ? { orgId: org._id } : 'skip',
  )
  const events = useQuery(
    api.social.events.listEvents,
    org && membership?.role === 'admin' ? { orgId: org._id } : 'skip',
  )
  const [dialogOpen, setDialogOpen] = useState(false)

  if (org === undefined || membership === undefined) {
    return (
      <div className="min-h-screen" style={dotGridStyle}>
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <Spinner className="size-8 mx-auto" />
        </main>
      </div>
    )
  }

  if (!org) {
    return (
      <div className="min-h-screen" style={dotGridStyle}>
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <Building2 className="size-8 text-slate-400 mx-auto mb-4" />
            <h1 className="text-2xl font-display mb-4">
              No encontramos la organización
            </h1>
          </div>
        </main>
      </div>
    )
  }

  if (!membership || membership.role !== 'admin') {
    return (
      <div className="min-h-screen" style={dotGridStyle}>
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <Shield className="size-8 text-slate-400 mx-auto mb-4" />
            <h1 className="text-2xl font-display mb-4">Necesitás ser admin</h1>
            <Button asChild>
              <Link to="/org/$slug" params={{ slug }}>
                Volver a la organización
              </Link>
            </Button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={dotGridStyle}>
      <AuthHeader />
      <main className="container mx-auto px-4 py-8">
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
                              {formatEventDateTime(
                                // listEvents does not return the event's
                                // timezone; nearly every event uses the default.
                                event.startAt,
                                DEFAULT_EVENT_TIMEZONE,
                              )}
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

          <CreateEventDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            orgId={org._id}
            slug={slug}
          />
        </div>
      </main>
    </div>
  )
}

function CreateEventDialog({
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
  const createEvent = useMutation(api.social.events.createEvent)
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('19:00')
  const [endTime, setEndTime] = useState('')
  const [timezone, setTimezone] = useState(DEFAULT_EVENT_TIMEZONE)
  const [venueName, setVenueName] = useState('')
  const [venueAddress, setVenueAddress] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const canSave = title.trim() !== '' && date !== '' && startTime !== ''

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSave || saving) return
    setSaving(true)
    try {
      const startAt = zonedToEpoch(date, startTime, timezone)
      const endAt = endTime
        ? timeOnEventNight(date, startTime, endTime, timezone)
        : undefined
      const { eventId } = await createEvent({
        orgId,
        title: title.trim(),
        startAt,
        endAt,
        timezone,
        venueName: venueName.trim() || undefined,
        venueAddress: venueAddress.trim() || undefined,
        description: description.trim() || undefined,
      })
      toast.success('Evento creado como borrador')
      onOpenChange(false)
      void navigate({
        to: '/org/$slug/admin/events/$eventId',
        params: { slug, eventId },
      })
    } catch (err) {
      toast.error('No se pudo crear el evento', {
        description: errorMessage(err),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Crear evento</DialogTitle>
          <DialogDescription>
            Empieza como borrador. Nadie lo ve hasta que lo publiques.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="new-event-title">Nombre</Label>
            <Input
              id="new-event-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="BAISH Social"
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="new-event-date">Fecha</Label>
              <Input
                id="new-event-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-event-start">Empieza</Label>
              <Input
                id="new-event-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-event-end">Termina (opcional)</Label>
              <Input
                id="new-event-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-event-tz">Zona horaria</Label>
            <TimezoneSelect
              id="new-event-tz"
              value={timezone}
              onChange={setTimezone}
            />
            {differsFromBrowserZone(timezone) && (
              <p className="text-xs text-muted-foreground">
                Los horarios se cargan en la hora del evento, no en la tuya.
              </p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="new-event-venue">Lugar</Label>
              <Input
                id="new-event-venue"
                value={venueName}
                onChange={(e) => setVenueName(e.target.value)}
                placeholder="Nombre del lugar"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-event-address">Dirección</Label>
              <Input
                id="new-event-address"
                value={venueAddress}
                onChange={(e) => setVenueAddress(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-event-desc">Descripción</Label>
            <Textarea
              id="new-event-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
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
              disabled={!canSave || saving}
            >
              {saving && <Loader2 className="size-4 mr-2 animate-spin" />}
              Crear evento
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
