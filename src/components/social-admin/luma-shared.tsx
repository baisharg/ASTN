import { useEffect, useState } from 'react'
import type { FunctionReturnType } from 'convex/server'
import type { api } from '../../../convex/_generated/api'
import { Badge } from '~/components/ui/badge'

/** Shared bits of the Luma calendar screens. */

export type LumaEventRow = FunctionReturnType<
  typeof api.luma.admin.listLumaEvents
>['upcoming'][number]

export type LumaVisibility = 'public' | 'members-only' | 'private'

export const VISIBILITY_LABELS: Record<LumaVisibility, string> = {
  public: 'Público',
  'members-only': 'Solo miembros',
  private: 'Privado',
}

export function VisibilityBadge({ visibility }: { visibility: string }) {
  if (visibility === 'public') return null
  return (
    <Badge variant="outline" className="bg-slate-50 text-slate-600">
      {VISIBILITY_LABELS[visibility as LumaVisibility] ?? visibility}
    </Badge>
  )
}

export type LumaGuestStatus =
  | 'approved'
  | 'pending_approval'
  | 'declined'
  | 'waitlist'
  | 'invited'

export const LUMA_GUEST_STATUS_LABELS: Record<LumaGuestStatus, string> = {
  approved: 'Aprobado',
  pending_approval: 'Pendiente',
  declined: 'Rechazado',
  waitlist: 'Lista de espera',
  invited: 'Invitado',
}

export const LUMA_GUEST_STATUS_COLORS: Record<LumaGuestStatus, string> = {
  approved: 'bg-green-50 text-green-700 border-green-200',
  pending_approval: 'bg-amber-50 text-amber-700 border-amber-200',
  declined: 'bg-red-50 text-red-700 border-red-200',
  waitlist: 'bg-slate-50 text-slate-600 border-slate-200',
  invited: 'bg-blue-50 text-blue-700 border-blue-200',
}

/** "12 aprobados · 3 con check-in · 2 pendientes", or null before a sync. */
export function guestCountsText(e: {
  approvedCount: number | null
  checkedInCount: number | null
  pendingCount: number | null
}): string | null {
  if (e.approvedCount === null) return null
  const parts = [
    `${e.approvedCount} aprobado${e.approvedCount !== 1 ? 's' : ''}`,
  ]
  if (e.checkedInCount) parts.push(`${e.checkedInCount} con check-in`)
  if (e.pendingCount) {
    parts.push(`${e.pendingCount} pendiente${e.pendingCount !== 1 ? 's' : ''}`)
  }
  return parts.join(' · ')
}

/** The current time, refreshed every minute (for queries that take `now`). */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => roundTo(Date.now(), intervalMs))
  useEffect(() => {
    const id = setInterval(
      () => setNow(roundTo(Date.now(), intervalMs)),
      intervalMs,
    )
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

// Rounded so the query's arguments (and cache) stay stable within a minute.
function roundTo(ms: number, step: number) {
  return Math.floor(ms / step) * step
}
