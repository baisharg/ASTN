import { useMutation, useQuery } from 'convex/react'
import { Check, Linkedin, Loader2, Search, X } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { GUEST_STATUS_COLORS, GUEST_STATUS_LABELS, toastError } from './shared'
import type { GuestStatus } from './shared'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { useBusyAction } from '~/lib/use-busy-action'

const SOURCE_LABELS = { app: 'App', luma: 'Luma', admin: 'Admin' } as const

const LUMA_SYNC_LABELS = {
  not_linked: '—',
  pending: 'Sincronizando',
  synced: 'Sincronizado',
  error: 'Error',
} as const

type StatusFilter = 'all' | GuestStatus

export function GuestsTab({ eventId }: { eventId: Id<'socialEvents'> }) {
  const guests = useQuery(api.social.events.listGuests, { eventId })
  const setGuestStatus = useMutation(api.social.events.setGuestStatus)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const { busy, run } = useBusyAction()

  if (guests === undefined) {
    return (
      <div className="py-12 text-center">
        <Spinner className="size-8 mx-auto" />
      </div>
    )
  }

  const decide = (
    guestId: Id<'socialEventGuests'>,
    status: 'approved' | 'declined',
  ) =>
    run(
      `${guestId}:${status}`,
      () => setGuestStatus({ guestId, status }),
      toastError(
        status === 'approved' ? 'No se pudo aprobar' : 'No se pudo rechazar',
      ),
    )

  const pending = guests
    .filter((g) => g.status === 'pending_approval')
    .sort((a, b) => a.registeredAt - b.registeredAt)

  const q = search.trim().toLowerCase()
  const visible = guests
    .filter((g) => statusFilter === 'all' || g.status === statusFilter)
    .filter(
      (g) =>
        !q || g.email.includes(q) || (g.name ?? '').toLowerCase().includes(q),
    )
    .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email, 'es'))

  const statusCounts = new Map<GuestStatus, number>()
  for (const g of guests) {
    statusCounts.set(g.status, (statusCounts.get(g.status) ?? 0) + 1)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Pendientes de aprobación ({pending.length})</CardTitle>
          <CardDescription>
            Aprobar o rechazar acá también lo actualiza en Luma. Aprobar a
            alguien lo suma a la lista de preaprobados.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay nadie esperando aprobación.
            </p>
          ) : (
            <ul className="divide-y">
              {pending.map((g) => (
                <li
                  key={g._id}
                  className="flex flex-col sm:flex-row sm:items-center gap-3 py-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{g.name ?? g.email}</p>
                    <p className="text-sm text-muted-foreground truncate">
                      {g.email} · se anotó por{' '}
                      {g.source === 'app' ? 'la app' : SOURCE_LABELS[g.source]}
                      {g.linkedinUrl && (
                        <>
                          {' · '}
                          <a
                            href={g.linkedinUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
                          >
                            <Linkedin className="size-3" aria-hidden />
                            LinkedIn
                          </a>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="min-h-11 flex-1 sm:flex-none"
                      disabled={busy !== null}
                      onClick={() => void decide(g._id, 'declined')}
                    >
                      {busy === `${g._id}:declined` ? (
                        <Loader2 className="size-4 mr-2 animate-spin" />
                      ) : (
                        <X className="size-4 mr-2" />
                      )}
                      Rechazar
                    </Button>
                    <Button
                      className="min-h-11 flex-1 sm:flex-none"
                      disabled={busy !== null}
                      onClick={() => void decide(g._id, 'approved')}
                    >
                      {busy === `${g._id}:approved` ? (
                        <Loader2 className="size-4 mr-2 animate-spin" />
                      ) : (
                        <Check className="size-4 mr-2" />
                      )}
                      Aprobar
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Todos los invitados ({guests.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre o email"
                aria-label="Buscar invitados"
                className="pl-9"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as StatusFilter)}
            >
              <SelectTrigger
                className="sm:w-56"
                aria-label="Filtrar por estado"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                {(Object.keys(GUEST_STATUS_LABELS) as Array<GuestStatus>).map(
                  (s) => (
                    <SelectItem key={s} value={s}>
                      {GUEST_STATUS_LABELS[s]} ({statusCounts.get(s) ?? 0})
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {guests.length === 0
                ? 'Todavía no se anotó nadie.'
                : 'Nadie coincide con la búsqueda.'}
            </p>
          ) : (
            <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Nombre</th>
                    <th className="py-2 pr-3 font-medium">Email</th>
                    <th className="py-2 pr-3 font-medium">Origen</th>
                    <th className="py-2 pr-3 font-medium">Estado</th>
                    <th className="py-2 pr-3 font-medium">Perfil</th>
                    <th className="py-2 pr-3 font-medium">Cuenta</th>
                    <th className="py-2 pr-3 font-medium">Luma</th>
                    <th className="py-2 font-medium">Check-in</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((g) => (
                    <tr key={g._id} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium whitespace-nowrap">
                        {g.name ?? '—'}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {g.email}
                      </td>
                      <td className="py-2 pr-3">{SOURCE_LABELS[g.source]}</td>
                      <td className="py-2 pr-3">
                        <Badge
                          variant="outline"
                          className={GUEST_STATUS_COLORS[g.status]}
                        >
                          {GUEST_STATUS_LABELS[g.status]}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {g.profileReady ? (
                          <span className="text-green-700">Listo</span>
                        ) : (
                          <span className="text-muted-foreground">
                            Sin completar
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {g.hasAccount ? 'Sí' : 'No'}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {g.lumaSync === 'error' ? (
                          <span
                            className="text-red-700 underline decoration-dotted underline-offset-2 cursor-help"
                            title={g.lumaSyncError ?? 'Error sin detalle'}
                          >
                            Error
                            <span className="sr-only">
                              : {g.lumaSyncError ?? 'sin detalle'}
                            </span>
                          </span>
                        ) : (
                          <span
                            className={
                              g.lumaSync === 'synced'
                                ? 'text-green-700'
                                : 'text-muted-foreground'
                            }
                          >
                            {LUMA_SYNC_LABELS[g.lumaSync]}
                          </span>
                        )}
                      </td>
                      <td className="py-2">
                        {g.checkedIn ? (
                          <Check
                            className="size-4 text-green-700"
                            aria-label="Hizo check-in"
                          />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
