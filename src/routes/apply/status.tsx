import { Link, createFileRoute } from '@tanstack/react-router'
import {
  AuthLoading,
  Authenticated,
  Unauthenticated,
  useMutation,
  useQuery,
} from 'convex/react'
import { formatDistanceToNow } from 'date-fns'
import {
  Building2,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { UnauthenticatedRedirect } from '~/components/auth/unauthenticated-redirect'
import { AuthHeader } from '~/components/layout/auth-header'
import { GradientBg } from '~/components/layout/GradientBg'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Spinner } from '~/components/ui/spinner'

export const Route = createFileRoute('/apply/status')({
  component: ApplicationStatusPage,
})

function ApplicationStatusPage() {
  return (
    <GradientBg>
      <AuthHeader />
      <main className="container mx-auto px-4 py-8">
        <AuthLoading>
          <div className="flex items-center justify-center min-h-[60vh]">
            <Spinner />
          </div>
        </AuthLoading>
        <Unauthenticated>
          <UnauthenticatedRedirect />
        </Unauthenticated>
        <Authenticated>
          <StatusContent />
        </Authenticated>
      </main>
    </GradientBg>
  )
}

function StatusContent() {
  const applications = useQuery(api.orgApplications.getMyApplications)

  if (applications === undefined) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-display font-semibold text-foreground">
          Your Applications
        </h1>
        <p className="text-muted-foreground mt-1">
          Track the status of your organization applications.
        </p>
      </div>

      {applications.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="size-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <FileText className="size-8 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-medium text-foreground mb-2">
              No applications yet
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              Submit an application to register your organization on ASTN.
            </p>
            <Button asChild>
              <Link to="/apply">Apply Now</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {applications.map((app) => (
            <ApplicationCard key={app._id} application={app} />
          ))}
          <div className="text-center pt-4">
            <Button variant="outline" asChild>
              <Link to="/apply">Submit Another Application</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

type ApplicationStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn'

interface Application {
  _id: Id<'orgApplications'>
  orgName: string
  status: ApplicationStatus
  createdAt: number
  rejectionReason?: string
  orgSlug?: string | null
}

const statusConfig: Record<
  ApplicationStatus,
  {
    label: string
    variant: 'outline' | 'default' | 'destructive' | 'secondary'
    icon: React.ComponentType<{ className?: string }>
  }
> = {
  pending: { label: 'Pending', variant: 'outline', icon: Clock },
  approved: { label: 'Approved', variant: 'default', icon: CheckCircle2 },
  rejected: { label: 'Rejected', variant: 'destructive', icon: XCircle },
  withdrawn: { label: 'Withdrawn', variant: 'secondary', icon: FileText },
}

function ApplicationCard({ application }: { application: Application }) {
  const [showWithdrawDialog, setShowWithdrawDialog] = useState(false)
  const withdrawApplication = useMutation(api.orgApplications.withdraw)
  const [isWithdrawing, setIsWithdrawing] = useState(false)

  const config = statusConfig[application.status]
  const StatusIcon = config.icon

  const handleWithdraw = async () => {
    setIsWithdrawing(true)
    try {
      await withdrawApplication({ applicationId: application._id })
      toast.success('Application withdrawn')
      setShowWithdrawDialog(false)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to withdraw application',
      )
    } finally {
      setIsWithdrawing(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Building2 className="size-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">{application.orgName}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Submitted{' '}
                  {formatDistanceToNow(application.createdAt, {
                    addSuffix: true,
                  })}
                </p>
              </div>
            </div>
            <Badge variant={config.variant}>
              <StatusIcon className="size-3 mr-1" />
              {config.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {application.status === 'rejected' && application.rejectionReason && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 mb-3">
              <p className="text-sm text-destructive font-medium mb-1">
                Rejection Reason
              </p>
              <p className="text-sm text-muted-foreground whitespace-pre-line">
                {application.rejectionReason}
              </p>
            </div>
          )}

          {application.status === 'approved' && application.orgSlug && (
            <Button size="sm" asChild>
              <Link
                to="/org/$slug/admin"
                params={{ slug: application.orgSlug }}
              >
                Configure your organization
              </Link>
            </Button>
          )}

          {application.status === 'pending' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowWithdrawDialog(true)}
            >
              Withdraw Application
            </Button>
          )}
        </CardContent>
      </Card>

      <Dialog open={showWithdrawDialog} onOpenChange={setShowWithdrawDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw Application</DialogTitle>
            <DialogDescription>
              Are you sure you want to withdraw your application for &quot;
              {application.orgName}&quot;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowWithdrawDialog(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleWithdraw}
              disabled={isWithdrawing}
            >
              {isWithdrawing ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Withdrawing...
                </>
              ) : (
                'Withdraw'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
