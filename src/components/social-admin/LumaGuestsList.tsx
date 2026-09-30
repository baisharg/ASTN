import { useAction } from 'convex/react'
import { CheckCircle2, RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '../../../convex/_generated/dataModel'
import {
  LUMA_GUEST_STATUS_COLORS,
  LUMA_GUEST_STATUS_LABELS,
} from './luma-shared'
import type { LumaGuestStatus } from './luma-shared'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { errorText } from '~/lib/convex-error'

type Guest = FunctionReturnType<typeof api.luma.api.listGuests>[number]

const STATUS_ORDER: Array<LumaGuestStatus> = [
  'approved',
  'pending_approval',
  'waitlist',
  'invited',
  'declined',
]

/** A Luma event's guest list, read live from Luma. Read-only. */
export function LumaGuestsList({
  orgId,
  lumaEventId,
}: {
  orgId: Id<'organizations'>
  lumaEventId: string
}) {
  const listGuests = useAction(api.luma.api.listGuests)
  const [guests, setGuests] = useState<Array<Guest> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setGuests(await listGuests({ orgId, lumaEventId }))
    } catch (err) {
      setError(errorText(err, 'No se pudo leer la lista de Luma'))
    } finally {
      setLoading(false)
    }
  }, [listGuests, orgId, lumaEventId])

  useEffect(() => {
    void load()
  }, [load])

  if (guests === null) {
    return error ? (
      <div className="space-y-3 py-6 text-center">
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
      <div className="py-10 text-center">
        <Spinner className="size-6 mx-auto" />
      </div>
    )
  }

  const q = search.trim().toLowerCase()
  const visible = guests
    .filter(
      (g) => !q || g.email.includes(q) || g.name.toLowerCase().includes(q),
    )
    .sort(
      (a, b) =>
        STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
        a.name.localeCompare(b.name, 'es'),
    )
  const counts = new Map<LumaGuestStatus, number>()
  for (const g of guests) counts.set(g.status, (counts.get(g.status) ?? 0) + 1)
  const checkedIn = guests.filter((g) => g.checkedInAt !== null).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        {STATUS_ORDER.filter((s) => counts.get(s)).map((s) => (
          <span key={s}>
            {LUMA_GUEST_STATUS_LABELS[s]}: {counts.get(s)}
          </span>
        ))}
        <span>Con check-in en Luma: {checkedIn}</span>
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o email"
            aria-label="Buscar invitados"
            className="pl-9 min-h-11"
          />
        </div>
        <Button
          variant="outline"
          className="min-h-11"
          disabled={loading}
          onClick={() => void load()}
          aria-label="Volver a leer de Luma"
          title="Volver a leer de Luma"
        >
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          {guests.length === 0 ? 'Nadie se anotó todavía.' : 'Sin resultados.'}
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {visible.map((g) => (
            <li key={g.email} className="flex items-center gap-3 px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{g.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {g.email}
                </p>
              </div>
              {g.checkedInAt !== null && (
                <CheckCircle2
                  className="size-4 text-green-600 shrink-0"
                  aria-label="Hizo check-in"
                />
              )}
              <Badge
                variant="outline"
                className={`shrink-0 ${LUMA_GUEST_STATUS_COLORS[g.status]}`}
              >
                {LUMA_GUEST_STATUS_LABELS[g.status]}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function LumaGuestsDialog({
  open,
  onOpenChange,
  orgId,
  lumaEventId,
  title,
  managed,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: Id<'organizations'>
  lumaEventId: string
  title: string
  managed: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Invitados en Luma</DialogTitle>
          <DialogDescription>
            {title}.{' '}
            {managed
              ? 'Para aprobar o rechazar gente, usá la pestaña Invitados del evento en ASTN.'
              : 'Solo lectura: para aprobar gente desde ASTN, gestioná el evento en ASTN.'}
          </DialogDescription>
        </DialogHeader>
        {open && <LumaGuestsList orgId={orgId} lumaEventId={lumaEventId} />}
      </DialogContent>
    </Dialog>
  )
}
