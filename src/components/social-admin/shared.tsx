import { Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { Building2, Shield } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import type { Doc } from '../../../convex/_generated/dataModel'
import { AuthHeader } from '~/components/layout/auth-header'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { useDotGridStyle } from '~/hooks/use-dot-grid-style'
import { errorText } from '~/lib/convex-error'

export const DEFAULT_EVENT_TIMEZONE = 'America/Argentina/Buenos_Aires'

export type EventStatus = Doc<'socialEvents'>['status']
export type GuestStatus = Doc<'socialEventGuests'>['status']

export type AdminEvent = FunctionReturnType<
  typeof api.social.events.getEventAdmin
>

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  draft: 'Borrador',
  published: 'Publicado',
  closed: 'Cerrado',
}

const EVENT_STATUS_COLORS: Record<EventStatus, string> = {
  draft: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  published: 'bg-green-50 text-green-700 border-green-200',
  closed: 'bg-slate-50 text-slate-600 border-slate-200',
}

export function EventStatusBadge({ status }: { status: EventStatus }) {
  return (
    <Badge variant="outline" className={EVENT_STATUS_COLORS[status]}>
      {EVENT_STATUS_LABELS[status]}
    </Badge>
  )
}

export const GUEST_STATUS_LABELS: Record<GuestStatus, string> = {
  approved: 'Aprobado',
  pending_approval: 'Pendiente',
  declined: 'Rechazado',
  waitlist: 'Lista de espera',
  invited: 'Invitado',
}

export const GUEST_STATUS_COLORS: Record<GuestStatus, string> = {
  approved: 'bg-green-50 text-green-700 border-green-200',
  pending_approval: 'bg-amber-50 text-amber-700 border-amber-200',
  declined: 'bg-red-50 text-red-700 border-red-200',
  waitlist: 'bg-slate-50 text-slate-600 border-slate-200',
  invited: 'bg-blue-50 text-blue-700 border-blue-200',
}

/**
 * Error handler for `useBusyAction` and catch blocks: a Spanish headline, with
 * the backend's ConvexError message (when there is one) underneath.
 */
export function toastError(title: string) {
  return (err: unknown) => {
    const detail = errorText(err, '')
    toast.error(title, { description: detail || undefined })
  }
}

// ── Page chrome ─────────────────────────────────────────────────────────

export function PageShell({ children }: { children: React.ReactNode }) {
  const dotGridStyle = useDotGridStyle()
  return (
    <div className="min-h-screen" style={dotGridStyle}>
      <AuthHeader />
      <main className="container mx-auto px-4 py-8">{children}</main>
    </div>
  )
}

/**
 * Resolves the org from the route slug and renders `children` only for its
 * admins, with the loading, not-found and not-admin screens around it.
 */
export function OrgAdminGate({
  slug,
  children,
}: {
  slug: string
  children: (org: Doc<'organizations'>) => React.ReactNode
}) {
  const org = useQuery(api.orgs.directory.getOrgBySlug, { slug }) as
    | Doc<'organizations'>
    | null
    | undefined
  const membership = useQuery(
    api.orgs.membership.getMembership,
    org ? { orgId: org._id } : 'skip',
  )

  if (org === undefined || (org && membership === undefined)) {
    return (
      <PageShell>
        <Spinner className="size-8 mx-auto" />
      </PageShell>
    )
  }

  if (!org) {
    return (
      <PageShell>
        <div className="max-w-lg mx-auto text-center py-12">
          <Building2 className="size-8 text-slate-400 mx-auto mb-4" />
          <h1 className="text-2xl font-display mb-4">
            No encontramos la organización
          </h1>
        </div>
      </PageShell>
    )
  }

  if (membership?.role !== 'admin') {
    return (
      <PageShell>
        <div className="max-w-lg mx-auto text-center py-12">
          <Shield className="size-8 text-slate-400 mx-auto mb-4" />
          <h1 className="text-2xl font-display mb-4">Necesitás ser admin</h1>
          <Button asChild>
            <Link to="/org/$slug" params={{ slug }}>
              Volver a la organización
            </Link>
          </Button>
        </div>
      </PageShell>
    )
  }

  return <>{children(org)}</>
}
