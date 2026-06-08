import { useMutation } from 'convex/react'
import { format } from 'date-fns'
import { Clock, Users, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent } from '~/components/ui/card'
import { Spinner } from '~/components/ui/spinner'

interface BookingCardProps {
  booking: {
    _id: Id<'spaceBookings'>
    date: string
    startMinutes: number
    endMinutes: number
    bookingType: 'member' | 'guest'
    status: 'confirmed' | 'cancelled' | 'pending' | 'rejected'
    workingOn?: string
    interestedInMeeting?: string
    rejectionReason?: string
    profile: {
      name: string
      headline?: string
    } | null
  }
  showCancelButton?: boolean
  onCancelled?: () => void
}

// Format minutes to display time
function formatTime(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  const period = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
  return `${displayHours}:${mins.toString().padStart(2, '0')} ${period}`
}

// Status badge variants
const statusVariants: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  confirmed: 'default',
  cancelled: 'secondary',
  pending: 'outline',
  rejected: 'destructive',
}

const statusLabels: Record<string, string> = {
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  pending: 'Pending',
  rejected: 'Rejected',
}

export function BookingCard({
  booking,
  showCancelButton = false,
  onCancelled,
}: BookingCardProps) {
  const [isCancelling, setIsCancelling] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  const adminCancelBooking = useMutation(
    api.spaceBookings.admin.adminCancelBooking,
  )

  const canCancel =
    showCancelButton &&
    (booking.status === 'confirmed' || booking.status === 'pending')

  const handleCancel = async () => {
    setIsCancelling(true)
    try {
      await adminCancelBooking({ bookingId: booking._id })
      toast.success('Booking cancelled')
      setDialogOpen(false)
      onCancelled?.()
    } catch (error) {
      console.error('Failed to cancel booking:', error)
      toast.error(
        error instanceof Error ? error.message : 'Failed to cancel booking',
      )
    } finally {
      setIsCancelling(false)
    }
  }

  const dateObj = new Date(booking.date)
  const profileName = booking.profile?.name ?? 'Unknown'

  // Get initials for avatar
  const initials = profileName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          {/* Left side: Avatar and info */}
          <div className="flex items-start gap-3 min-w-0 flex-1">
            {/* Avatar */}
            <div className="size-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 font-medium text-sm">
              {initials || '?'}
            </div>

            <div className="min-w-0 flex-1">
              {/* Name and badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium truncate">{profileName}</span>
                {booking.bookingType === 'guest' && (
                  <Badge variant="secondary" className="text-xs shrink-0">
                    Guest
                  </Badge>
                )}
                <Badge
                  variant={statusVariants[booking.status]}
                  className="text-xs shrink-0"
                >
                  {statusLabels[booking.status]}
                </Badge>
              </div>

              {/* Headline */}
              {booking.profile?.headline && (
                <p className="text-sm text-muted-foreground truncate">
                  {booking.profile.headline}
                </p>
              )}

              {/* Time range */}
              <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
                <Clock className="size-3" />
                <span>
                  {formatTime(booking.startMinutes)} -{' '}
                  {formatTime(booking.endMinutes)}
                </span>
              </div>
            </div>
          </div>

          {/* Right side: Cancel button */}
          {canCancel && (
            <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                  disabled={isCancelling}
                >
                  {isCancelling ? (
                    <Spinner className="size-4" />
                  ) : (
                    <X className="size-4" />
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel Booking</AlertDialogTitle>
                  <AlertDialogDescription>
                    Cancel {profileName}&apos;s booking for{' '}
                    {format(dateObj, 'MMMM d, yyyy')}? This action cannot be
                    undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep Booking</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleCancel}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {isCancelling ? <Spinner className="size-4 mr-2" /> : null}
                    Cancel Booking
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {/* Tags */}
        {(booking.workingOn || booking.interestedInMeeting) && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {booking.workingOn && (
              <Badge variant="outline" className="text-xs font-normal">
                <Users className="size-3 mr-1" />
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

        {/* Rejection reason */}
        {booking.status === 'rejected' && booking.rejectionReason && (
          <div className="mt-3 p-2 bg-destructive/10 rounded-md">
            <p className="text-sm text-destructive whitespace-pre-line">
              <span className="font-medium">Rejection reason:</span>{' '}
              {booking.rejectionReason}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
