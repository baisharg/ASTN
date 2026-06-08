import { useQuery } from 'convex/react'
import { format, subDays } from 'date-fns'
import { Calendar, Filter, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'

interface BookingHistoryProps {
  spaceId: Id<'coworkingSpaces'>
}

type StatusFilter = 'all' | 'confirmed' | 'cancelled' | 'rejected' | 'no_show'

type HistoryBooking = {
  _id: Id<'spaceBookings'>
  date: string
  startMinutes: number
  endMinutes: number
  status: 'confirmed' | 'pending' | 'cancelled' | 'rejected'
  bookingType: 'member' | 'guest'
  workingOn?: string
  interestedInMeeting?: string
  rejectionReason?: string
  approvedByName?: string
  noShow?: boolean
  profile?: {
    name?: string
    headline?: string
    email?: string
    isGuest: boolean
  } | null
}

// Format time range from minutes
function formatTimeRange(startMinutes: number, endMinutes: number): string {
  const formatTime = (minutes: number) => {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    const period = hours >= 12 ? 'PM' : 'AM'
    const displayHours = hours % 12 || 12
    return mins === 0
      ? `${displayHours} ${period}`
      : `${displayHours}:${mins.toString().padStart(2, '0')} ${period}`
  }
  return `${formatTime(startMinutes)} - ${formatTime(endMinutes)}`
}

export function BookingHistory({ spaceId }: BookingHistoryProps) {
  // Default: last 30 days
  const today = new Date()
  const defaultStart = format(subDays(today, 30), 'yyyy-MM-dd')
  const defaultEnd = format(today, 'yyyy-MM-dd')

  const [startDate, setStartDate] = useState(defaultStart)
  const [endDate, setEndDate] = useState(defaultEnd)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [allBookings, setAllBookings] = useState<Array<HistoryBooking>>([])
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  // Reset pagination when filters change
  useEffect(() => {
    setCursor(undefined)
    setAllBookings([])
  }, [startDate, endDate, statusFilter])

  const result = useQuery(
    api.spaceBookings.admin.getAdminBookingsForDateRange,
    {
      spaceId,
      startDate,
      endDate,
      status: statusFilter,
      limit: 50,
      cursor,
    },
  )

  // Merge new results when they arrive
  const bookings =
    cursor === undefined
      ? (result?.bookings ?? [])
      : [...allBookings, ...(result?.bookings ?? [])]

  const handleLoadMore = useCallback(() => {
    if (result?.nextCursor) {
      setIsLoadingMore(true)
      setAllBookings(bookings)
      setCursor(result.nextCursor)
    }
  }, [result?.nextCursor, bookings])

  // Reset loading state when new results arrive
  if (isLoadingMore && result !== undefined) {
    setIsLoadingMore(false)
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="startDate" className="text-sm">
                From
              </Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endDate" className="text-sm">
                To
              </Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status" className="text-sm">
                Status
              </Label>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as StatusFilter)}
              >
                <SelectTrigger id="status" className="w-36">
                  <Filter className="size-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="no_show">No-show</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Loading state (initial load only) */}
      {result === undefined && cursor === undefined && (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-slate-400" />
        </div>
      )}

      {/* Empty state */}
      {result && bookings.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="size-12 text-slate-300 mx-auto mb-4" />
            <p className="text-lg font-medium text-slate-600">
              No Bookings Found
            </p>
            <p className="text-sm text-slate-500">
              No bookings match the selected filters
            </p>
          </CardContent>
        </Card>
      )}

      {/* Booking list - newest first for history */}
      {bookings.length > 0 && (
        <div className="space-y-2">
          {bookings.map((booking) => (
            <HistoryBookingCard key={booking._id} booking={booking} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {result?.hasMore && (
        <div className="text-center pt-4">
          <Button
            variant="outline"
            onClick={handleLoadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Loading...
              </>
            ) : (
              'Load More'
            )}
          </Button>
        </div>
      )}
    </div>
  )
}

interface HistoryBookingCardProps {
  booking: {
    _id: Id<'spaceBookings'>
    date: string
    startMinutes: number
    endMinutes: number
    status: 'confirmed' | 'pending' | 'cancelled' | 'rejected'
    bookingType: 'member' | 'guest'
    workingOn?: string
    interestedInMeeting?: string
    rejectionReason?: string
    approvedByName?: string
    noShow?: boolean
    profile?: {
      name?: string
      headline?: string
      email?: string
      isGuest: boolean
    } | null
  }
}

function HistoryBookingCard({ booking }: HistoryBookingCardProps) {
  const dateObj = new Date(booking.date)

  // Status badge styling
  const statusVariant =
    booking.status === 'confirmed'
      ? 'default'
      : booking.status === 'cancelled'
        ? 'secondary'
        : booking.status === 'rejected'
          ? 'destructive'
          : 'outline'

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* Avatar placeholder */}
            <div className="size-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 font-medium text-sm">
              {booking.profile?.name
                ? booking.profile.name
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2)
                : '?'}
            </div>

            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">
                  {booking.profile?.name ?? 'Unknown'}
                </span>
                {booking.profile?.isGuest && (
                  <Badge variant="secondary" className="text-xs">
                    Guest
                  </Badge>
                )}
                <Badge variant={statusVariant} className="text-xs capitalize">
                  {booking.status}
                </Badge>
                {booking.noShow && (
                  <Badge variant="destructive" className="text-xs">
                    No-show
                  </Badge>
                )}
              </div>
              {booking.profile?.headline && (
                <p className="text-sm text-muted-foreground">
                  {booking.profile.headline}
                </p>
              )}
            </div>
          </div>

          <div className="text-right shrink-0">
            <p className="text-sm font-medium">
              {format(dateObj, 'MMM d, yyyy')}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatTimeRange(booking.startMinutes, booking.endMinutes)}
            </p>
          </div>
        </div>

        {/* Rejection reason */}
        {booking.status === 'rejected' && booking.rejectionReason && (
          <div className="mt-3 p-2 bg-red-50 rounded text-sm text-red-800 whitespace-pre-line">
            <span className="font-medium">Rejection reason:</span>{' '}
            {booking.rejectionReason}
          </div>
        )}

        {/* Approved by */}
        {booking.status === 'confirmed' && booking.approvedByName && (
          <p className="mt-2 text-xs text-muted-foreground">
            Approved by {booking.approvedByName}
          </p>
        )}

        {/* Tags */}
        {(booking.workingOn || booking.interestedInMeeting) && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {booking.workingOn && (
              <Badge variant="outline" className="text-xs font-normal">
                Can help with: {booking.workingOn}
              </Badge>
            )}
            {booking.interestedInMeeting && (
              <Badge variant="outline" className="text-xs font-normal">
                Looking for: {booking.interestedInMeeting}
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
