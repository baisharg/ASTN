import type { Doc } from '../../../convex/_generated/dataModel'
import { Badge } from '~/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'

export const DEFAULT_EVENT_TIMEZONE = 'America/Argentina/Buenos_Aires'

export type EventStatus = Doc<'socialEvents'>['status']
export type GuestStatus = Doc<'socialEventGuests'>['status']

/** What `api.social.events.getEventAdmin` returns (its validator is `any`). */
export type AdminEvent = Doc<'socialEvents'> & {
  orgSlug: string | null
  spots: Array<Doc<'socialEventSpots'>>
  floorPlanUrl: string | null
  approvedCount: number
  pendingCount: number
  lumaErrors: number
}

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

const COMMON_TIMEZONES = [
  'America/Argentina/Buenos_Aires',
  'America/Montevideo',
  'America/Santiago',
  'America/Sao_Paulo',
  'America/Bogota',
  'America/Mexico_City',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Berlin',
  'UTC',
]

export function TimezoneSelect({
  id,
  value,
  onChange,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
}) {
  const options = COMMON_TIMEZONES.includes(value)
    ? COMMON_TIMEZONES
    : [value, ...COMMON_TIMEZONES]
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((tz) => (
          <SelectItem key={tz} value={tz}>
            {tz.replace(/_/g, ' ')}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** The readable part of a Convex server error, for a toast description. */
export function errorMessage(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined
  const match = err.message.match(/Uncaught Error: ([^\n]+)/)
  return (match ? match[1] : err.message).replace(/\s+at \S+ \(.*$/, '')
}
