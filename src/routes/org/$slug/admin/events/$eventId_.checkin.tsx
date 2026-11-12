import { Link, createFileRoute } from '@tanstack/react-router'
import { useConvexConnectionState, useMutation, useQuery } from 'convex/react'
import {
  ArrowLeft,
  Camera,
  CameraOff,
  CheckCircle2,
  Info,
  Loader2,
  RefreshCw,
  Search,
  Undo2,
  WifiOff,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../../../../convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '../../../../../../convex/_generated/dataModel'
import { QrScanner } from '~/components/social-admin/QrScanner'
import {
  GUEST_STATUS_COLORS,
  GUEST_STATUS_LABELS,
  OrgAdminGate,
  PageShell,
  toastError,
} from '~/components/social-admin/shared'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Spinner } from '~/components/ui/spinner'
import { matchesSearch } from '~/lib/search-text'
import { useBusyAction } from '~/lib/use-busy-action'

export const Route = createFileRoute(
  '/org/$slug/admin/events/$eventId_/checkin',
)({ component: CheckInRoute })

type CheckInData = FunctionReturnType<typeof api.social.checkin.listForCheckIn>
type Guest = CheckInData['guests'][number]

// The scanner keeps reading the QR of the person just let in. For this long
// after marking them here, that isn't reported as "already checked in".
const JUST_MARKED_MS = 20_000

function CheckInRoute() {
  const { slug, eventId } = Route.useParams()
  return (
    <OrgAdminGate slug={slug}>
      {() => (
        <CheckInPage slug={slug} eventId={eventId as Id<'socialEvents'>} />
      )}
    </OrgAdminGate>
  )
}

/** The `pk` of a Luma check-in URL, or the text itself for a bare code. */
function ticketKey(code: string): string {
  const text = code.trim()
  try {
    const url = new URL(text)
    return url.searchParams.get('pk') ?? text
  } catch {
    return text
  }
}

function findByCode(guests: Array<Guest>, scanned: string): Guest | null {
  const text = scanned.trim()
  if (!text) return null
  const exact = guests.find((g) => g.checkInCode === text)
  if (exact) return exact
  const key = ticketKey(text)
  return (
    guests.find((g) => g.checkInCode && ticketKey(g.checkInCode) === key) ??
    null
  )
}

function timeOf(ms: number) {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(ms)
}

function CheckInPage({
  slug,
  eventId,
}: {
  slug: string
  eventId: Id<'socialEvents'>
}) {
  const data = useQuery(api.social.checkin.listForCheckIn, { eventId })
  // The list changes at once and the server catches up, so a slow or dropped
  // connection never holds up the next guest.
  const setCheckedIn = useMutation(
    api.social.checkin.setCheckedIn,
  ).withOptimisticUpdate((localStore, { guestId, checkedIn }) => {
    const current = localStore.getQuery(api.social.checkin.listForCheckIn, {
      eventId,
    })
    if (current === undefined) return
    localStore.setQuery(
      api.social.checkin.listForCheckIn,
      { eventId },
      {
        ...current,
        guests: current.guests.map((g) =>
          g._id === guestId
            ? {
                ...g,
                checkedInAt: checkedIn ? Date.now() : null,
                checkInSource: checkedIn ? ('astn' as const) : null,
              }
            : g,
        ),
      },
    )
  })
  const syncLuma = useMutation(api.social.events.syncLumaNow)
  const offline = !useConvexConnectionState().isWebSocketConnected
  const { busy, run } = useBusyAction<'sync'>()

  const [scanning, setScanning] = useState(false)
  const [search, setSearch] = useState('')
  const [manualCode, setManualCode] = useState('')
  const [selectedId, setSelectedId] = useState<Id<'socialEventGuests'> | null>(
    null,
  )
  const [scanError, setScanError] = useState<string | null>(null)
  // Guests whose check-in (or undo) hasn't reached the server yet.
  const [saving, setSaving] = useState<ReadonlySet<string>>(() => new Set())
  // When each guest was marked from this device (see JUST_MARKED_MS).
  const markedHere = useRef(new Map<string, number>())

  if (data === undefined) {
    return (
      <PageShell>
        <Spinner className="size-8 mx-auto" />
      </PageShell>
    )
  }

  const guests = data.guests
  const selected = guests.find((g) => g._id === selectedId) ?? null
  const approved = guests.filter((g) => g.status === 'approved')
  const arrivedApproved = approved.filter((g) => g.checkedInAt !== null)
  const arrivedOthers = guests.filter(
    (g) => g.status !== 'approved' && g.checkedInAt !== null,
  )
  // Only guests who came through Luma have a ticket QR.
  const hasTickets = guests.some((g) => g.checkInCode !== null)

  const handleCode = (code: string) => {
    const guest = findByCode(guests, code)
    if (!guest) {
      toast.error('Este QR no es de ningún invitado de este evento', {
        description: data.lumaLinked
          ? 'Si se anotó hace un rato, probá “Actualizar desde Luma” o buscalo por nombre.'
          : undefined,
      })
      return
    }
    setSelectedId(guest._id)
    if (guest.checkedInAt !== null) {
      const markedAt = markedHere.current.get(guest._id)
      const justMarkedHere =
        markedAt !== undefined && Date.now() - markedAt < JUST_MARKED_MS
      if (!justMarkedHere) {
        toast.info(
          `${guest.name} ya hizo check-in a las ${timeOf(guest.checkedInAt)}`,
        )
      }
    }
  }

  const mark = async (guest: Guest, checkedIn: boolean) => {
    if (checkedIn) markedHere.current.set(guest._id, Date.now())
    else markedHere.current.delete(guest._id)
    setSaving((prev) => new Set(prev).add(guest._id))
    try {
      await setCheckedIn({ guestId: guest._id, checkedIn })
      if (checkedIn) toast.success(`Check-in: ${guest.name}`)
    } catch (err) {
      console.error(err)
      markedHere.current.delete(guest._id)
      toastError(
        checkedIn
          ? `No se pudo marcar el check-in de ${guest.name}`
          : `No se pudo deshacer el check-in de ${guest.name}`,
      )(err)
    } finally {
      setSaving((prev) => {
        const next = new Set(prev)
        next.delete(guest._id)
        return next
      })
    }
  }

  const searching = search.trim() !== ''
  const results = searching
    ? guests
        .filter((g) => matchesSearch(search, [g.name, g.email]))
        .sort((a, b) => a.name.localeCompare(b.name, 'es'))
        .slice(0, 30)
    : []

  return (
    <PageShell>
      <div className="max-w-xl mx-auto space-y-5">
        <div>
          <Link
            to="/org/$slug/admin/events/$eventId"
            params={{ slug, eventId }}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-slate-700 min-h-11"
          >
            <ArrowLeft className="size-4" />
            Volver al evento
          </Link>
          <h1 className="text-2xl font-display font-semibold text-foreground">
            Check-in: {data.title}
          </h1>
        </div>

        {offline && (
          <div
            className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
            role="status"
          >
            <WifiOff className="size-4 shrink-0 mt-0.5" />
            <span>
              Sin conexión. Podés seguir marcando check-ins: se guardan cuando
              vuelva. Hasta entonces no cierres ni recargues esta página.
            </span>
          </div>
        )}

        <Card className="p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Llegaron</p>
            <p
              className="text-4xl font-semibold tabular-nums"
              aria-live="polite"
            >
              {arrivedApproved.length}
              <span className="text-lg text-muted-foreground font-normal">
                {' '}
                / {approved.length} aprobados
              </span>
            </p>
            {arrivedOthers.length > 0 && (
              <p className="text-sm text-amber-800">
                + {arrivedOthers.length} sin aprobar
              </p>
            )}
          </div>
          {data.lumaLinked && (
            <Button
              variant="outline"
              className="min-h-11"
              disabled={busy !== null}
              onClick={() =>
                void run(
                  'sync',
                  async () => {
                    await syncLuma({ eventId })
                    toast.success('Actualizando invitados desde Luma')
                  },
                  toastError('No se pudo actualizar'),
                )
              }
            >
              <RefreshCw
                className={`size-4 mr-2 ${busy === 'sync' ? 'animate-spin' : ''}`}
              />
              Actualizar desde Luma
            </Button>
          )}
        </Card>

        <div
          className="flex gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900"
          role="note"
        >
          <Info className="size-4 shrink-0 mt-0.5" />
          <span>
            Los check-ins que hagas acá quedan solo en ASTN: Luma no tiene forma
            de recibirlos, así que no van a aparecer en la app ni en la lista de
            Luma. Los que se hagan en la app de Luma sí se ven acá.
          </span>
        </div>

        {selected && (
          <SelectedGuest
            guest={selected}
            saving={saving.has(selected._id)}
            onMark={(checkedIn) => void mark(selected, checkedIn)}
            onClose={() => setSelectedId(null)}
          />
        )}

        {hasTickets ? (
          <Card className="p-4 space-y-4">
            <Button
              className="w-full min-h-12 text-base"
              variant={scanning ? 'outline' : 'default'}
              onClick={() => {
                setScanError(null)
                setScanning((s) => !s)
              }}
            >
              {scanning ? (
                <>
                  <CameraOff className="size-5 mr-2" />
                  Cerrar la cámara
                </>
              ) : (
                <>
                  <Camera className="size-5 mr-2" />
                  Escanear el QR del ticket de Luma
                </>
              )}
            </Button>
            {scanning && (
              <QrScanner
                onScan={(code) => handleCode(code)}
                onError={(message) => {
                  setScanError(message)
                  setScanning(false)
                }}
              />
            )}
            {scanError && (
              <p className="text-sm text-red-700" role="alert">
                {scanError} Podés buscar por nombre o pegar el código abajo.
              </p>
            )}
            <form
              className="space-y-1"
              onSubmit={(e) => {
                e.preventDefault()
                handleCode(manualCode)
                setManualCode('')
              }}
            >
              <Label htmlFor="checkin-code">
                O ingresá el código del ticket
              </Label>
              <div className="flex gap-2">
                <Input
                  id="checkin-code"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="El enlace del QR o su código"
                  autoComplete="off"
                  className="min-h-11"
                />
                <Button
                  type="submit"
                  variant="outline"
                  className="min-h-11"
                  disabled={!manualCode.trim()}
                >
                  Buscar
                </Button>
              </div>
            </form>
          </Card>
        ) : (
          <Card className="p-4 text-sm text-muted-foreground">
            {data.lumaLinked
              ? 'Todavía no tenemos los QR de los tickets de Luma de este evento, así que no hay nada para escanear. Probá “Actualizar desde Luma”; mientras tanto, buscá a cada persona por nombre o email.'
              : 'Este evento no está vinculado con Luma, así que los invitados no tienen ticket con QR para escanear. Buscá a cada persona por nombre o email.'}
          </Card>
        )}

        <div className="space-y-3">
          <div className="relative">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o email"
              aria-label="Buscar invitados"
              className="pl-9 min-h-12 text-base"
              autoComplete="off"
            />
          </div>
          {searching && results.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No hay invitados con ese nombre o email.
            </p>
          )}
          <ul className="space-y-2">
            {results.map((g) => (
              <li key={g._id}>
                <GuestRow
                  guest={g}
                  saving={saving.has(g._id)}
                  onMark={(checkedIn) => void mark(g, checkedIn)}
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </PageShell>
  )
}

function StatusBadge({ guest }: { guest: Guest }) {
  return (
    <Badge variant="outline" className={GUEST_STATUS_COLORS[guest.status]}>
      {GUEST_STATUS_LABELS[guest.status]}
    </Badge>
  )
}

function CheckedInNote({ guest, saving }: { guest: Guest; saving: boolean }) {
  if (guest.checkedInAt === null) return null
  return (
    <span className="inline-flex items-center gap-1 text-sm text-green-700">
      <CheckCircle2 className="size-4" />
      Llegó {timeOf(guest.checkedInAt)}
      {guest.checkInSource === 'luma' ? ' (en Luma)' : ''}
      {saving && <span className="text-muted-foreground"> · guardando…</span>}
    </span>
  )
}

/**
 * Check a guest in, or undo it. Disabled only while this guest's own change
 * is on its way to the server, so a second tap can't undo the first.
 */
function MarkButton({
  guest,
  saving,
  onMark,
  large = false,
}: {
  guest: Guest
  saving: boolean
  onMark: (checkedIn: boolean) => void
  large?: boolean
}) {
  const checkedIn = guest.checkedInAt !== null
  // Check-ins made in Luma's app can only be undone there.
  if (checkedIn && guest.checkInSource !== 'astn') return null
  if (checkedIn) {
    return (
      <Button
        variant="ghost"
        className={large ? 'min-h-12' : 'min-h-11'}
        disabled={saving}
        onClick={() => onMark(false)}
      >
        {saving ? (
          <Loader2 className="size-4 mr-2 animate-spin" />
        ) : (
          <Undo2 className="size-4 mr-2" />
        )}
        Deshacer
      </Button>
    )
  }
  return (
    <Button
      className={large ? 'min-h-12 text-base w-full sm:w-auto' : 'min-h-11'}
      disabled={saving}
      onClick={() => onMark(true)}
    >
      {saving ? (
        <Loader2 className="size-4 mr-2 animate-spin" />
      ) : (
        <CheckCircle2 className="size-4 mr-2" />
      )}
      Marcar check-in
    </Button>
  )
}

function SelectedGuest({
  guest,
  saving,
  onMark,
  onClose,
}: {
  guest: Guest
  saving: boolean
  onMark: (checkedIn: boolean) => void
  onClose: () => void
}) {
  const notApproved = guest.status !== 'approved'
  return (
    <Card
      className={`p-4 space-y-3 border-2 ${notApproved ? 'border-amber-300' : 'border-green-300'}`}
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xl font-semibold truncate">{guest.name}</p>
          <p className="text-sm text-muted-foreground truncate">
            {guest.email}
          </p>
        </div>
        <StatusBadge guest={guest} />
      </div>
      {notApproved && (
        <p className="text-sm text-amber-800">
          No está aprobado para este evento. Podés dejarlo pasar igual, o
          aprobarlo primero desde la pestaña Invitados.
        </p>
      )}
      <CheckedInNote guest={guest} saving={saving} />
      <div className="flex flex-wrap gap-2">
        <MarkButton guest={guest} saving={saving} onMark={onMark} large />
        <Button variant="outline" className="min-h-12" onClick={onClose}>
          Listo
        </Button>
      </div>
    </Card>
  )
}

function GuestRow({
  guest,
  saving,
  onMark,
}: {
  guest: Guest
  saving: boolean
  onMark: (checkedIn: boolean) => void
}) {
  return (
    <Card className="p-3 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium truncate">{guest.name}</span>
          <StatusBadge guest={guest} />
        </div>
        <p className="text-sm text-muted-foreground truncate">{guest.email}</p>
        <CheckedInNote guest={guest} saving={saving} />
      </div>
      <MarkButton guest={guest} saving={saving} onMark={onMark} />
    </Card>
  )
}
