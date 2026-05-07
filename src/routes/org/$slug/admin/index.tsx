import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { useState } from 'react'
import {
  Briefcase,
  Building2,
  Calendar,
  CalendarCheck,
  Database,
  FileText,
  FolderPlus,
  MapPin,
  Settings,
  Shield,
  UserPlus,
  Users,
  Wrench,
} from 'lucide-react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { AuthHeader } from '~/components/layout/auth-header'
import { GuestConversionCard } from '~/components/org/GuestConversionCard'
import { OnboardingChecklist } from '~/components/org/OnboardingChecklist'
import { OrgStats } from '~/components/org/OrgStats'
import { SpaceUtilizationCard } from '~/components/org/SpaceUtilizationCard'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { useDotGridStyle } from '~/hooks/use-dot-grid-style'

export const Route = createFileRoute('/org/$slug/admin/')({
  component: OrgAdminDashboard,
})

type TimeRange = '7d' | '30d' | '90d' | 'all'

function OrgAdminDashboard() {
  const { slug } = Route.useParams()
  const [timeRange, setTimeRange] = useState<TimeRange>('30d')
  const dotGridStyle = useDotGridStyle()

  const org = useQuery(api.orgs.directory.getOrgBySlug, { slug })
  const membership = useQuery(
    api.orgs.membership.getMembership,
    org ? { orgId: org._id } : 'skip',
  )
  const stats = useQuery(
    api.orgs.stats.getEnhancedOrgStats,
    org && membership?.role === 'admin'
      ? { orgId: org._id, timeRange }
      : 'skip',
  )
  const space = useQuery(
    api.coworkingSpaces.getSpaceByOrg,
    org && membership?.role === 'admin' ? { orgId: org._id } : 'skip',
  )
  const applicationCount = useQuery(
    api.opportunityApplications.getOrgApplicationCount,
    org && membership?.role === 'admin' ? { orgId: org._id } : 'skip',
  )

  // Loading state
  if (org === undefined || membership === undefined) {
    return (
      <div className="min-h-screen" style={dotGridStyle}>
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-5xl mx-auto">
            <div className="animate-pulse space-y-6">
              <div className="h-12 bg-slate-100 rounded-xl w-1/3" />
              <div className="grid gap-4 sm:grid-cols-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-24 bg-slate-100 rounded-xl" />
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>
    )
  }

  // Org not found
  if (org === null) {
    return (
      <div className="min-h-screen" style={dotGridStyle}>
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <div className="size-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
              <Building2 className="size-8 text-slate-400" />
            </div>
            <h1 className="text-2xl font-display text-foreground mb-4">
              Organization Not Found
            </h1>
            <p className="text-slate-600 mb-6">
              This organization doesn&apos;t exist or the link is incorrect.
            </p>
            <Button asChild>
              <Link to="/">Go Home</Link>
            </Button>
          </div>
        </main>
      </div>
    )
  }

  // Not an admin - redirect to org page
  if (!membership || membership.role !== 'admin') {
    return (
      <div className="min-h-screen" style={dotGridStyle}>
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <div className="size-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
              <Shield className="size-8 text-slate-400" />
            </div>
            <h1 className="text-2xl font-display text-foreground mb-4">
              Admin Access Required
            </h1>
            <p className="text-slate-600 mb-6">
              You need to be an admin of this organization to access this page.
            </p>
            <Button asChild>
              <Link to="/org/$slug" params={{ slug }}>
                Back to Organization
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
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
              <Link
                to="/org/$slug"
                params={{ slug }}
                className="hover:text-slate-700 transition-colors"
              >
                {org.name}
              </Link>
              <span>/</span>
              <span className="text-slate-700">Admin Dashboard</span>
            </div>
            <h1 className="text-2xl font-display font-semibold text-foreground">
              Admin Dashboard
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage members and view organization statistics
            </p>
          </div>

          {/* Onboarding Checklist */}
          <OnboardingChecklist orgId={org._id} orgSlug={slug} />

          {/* Quick Stats Cards */}
          <div className="grid gap-4 sm:grid-cols-5 mb-8">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-500">
                  Total Members
                </CardTitle>
                <Users className="size-4 text-slate-400" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-foreground">
                  {stats?.memberCount ?? <Spinner className="size-6" />}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-500">
                  Admins
                </CardTitle>
                <Shield className="size-4 text-slate-400" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-foreground">
                  {stats?.adminCount ?? <Spinner className="size-6" />}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-500">
                  {timeRange === '7d'
                    ? 'New This Week'
                    : timeRange === '30d'
                      ? 'New This Month'
                      : timeRange === '90d'
                        ? 'New (90 days)'
                        : 'Total Joined'}
                </CardTitle>
                <UserPlus className="size-4 text-slate-400" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-foreground">
                  {stats?.joinedThisMonth ?? <Spinner className="size-6" />}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-500">
                  Events
                </CardTitle>
                <Calendar className="size-4 text-slate-400" />
              </CardHeader>
              <CardContent>
                {org.lumaCalendarUrl ? (
                  <div className="flex items-center gap-2">
                    <div className="size-2 rounded-full bg-green-500" />
                    <span className="text-sm font-medium text-slate-700">
                      Connected
                    </span>
                  </div>
                ) : (
                  <Link
                    to="/org/$slug/admin/settings"
                    params={{ slug }}
                    className="text-sm text-primary hover:underline"
                  >
                    Not configured
                  </Link>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-500">
                  Applications
                </CardTitle>
                <FileText className="size-4 text-slate-400" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-foreground">
                  {applicationCount ?? <Spinner className="size-6" />}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Quick Actions */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
            <Button asChild className="h-auto py-4">
              <Link to="/org/$slug/admin/members" params={{ slug }}>
                <Users className="size-5 mr-2" />
                View Members
              </Link>
            </Button>

            <Button variant="outline" className="h-auto py-4" asChild>
              <Link to="/org/$slug/admin/applications" params={{ slug }}>
                <FileText className="size-5 mr-2" />
                Applications
              </Link>
            </Button>

            <Button variant="outline" className="h-auto py-4" asChild>
              <Link to="/org/$slug/admin/opportunities" params={{ slug }}>
                <Briefcase className="size-5 mr-2" />
                Opportunities
              </Link>
            </Button>

            <Button variant="outline" className="h-auto py-4" asChild>
              <Link to="/org/$slug/admin/programs" params={{ slug }}>
                <FolderPlus className="size-5 mr-2" />
                Programs
              </Link>
            </Button>

            <Button variant="outline" className="h-auto py-4" asChild>
              <Link to="/org/$slug/admin/crm" params={{ slug }}>
                <Database className="size-5 mr-2" />
                CRM
              </Link>
            </Button>

            <InviteLinkButton orgId={org._id} slug={slug} />

            <Button variant="outline" className="h-auto py-4" asChild>
              <Link to="/org/$slug/admin/setup" params={{ slug }}>
                <Wrench className="size-5 mr-2" />
                Setup
              </Link>
            </Button>

            <Button variant="outline" className="h-auto py-4" asChild>
              <Link to="/org/$slug/admin/space" params={{ slug }}>
                <MapPin className="size-5 mr-2" />
                Co-working
              </Link>
            </Button>

            <Button variant="outline" className="h-auto py-4" asChild>
              <Link to="/org/$slug/admin/bookings" params={{ slug }}>
                <CalendarCheck className="size-5 mr-2" />
                Bookings
              </Link>
            </Button>

            <Button variant="outline" className="h-auto py-4" asChild>
              <Link to="/org/$slug/admin/settings" params={{ slug }}>
                <Settings className="size-5 mr-2" />
                Settings
              </Link>
            </Button>
          </div>

          {/* Co-working Statistics */}
          {space && (
            <div className="mb-8">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    Co-working Statistics
                  </h2>
                  <p className="text-sm text-slate-500">
                    Space utilization and guest conversion tracking
                  </p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <SpaceUtilizationCard
                  spaceId={space._id}
                  spaceName={space.name}
                />
                <GuestConversionCard spaceId={space._id} />
              </div>
            </div>
          )}

          {/* Statistics Section Header with Time Range Selector */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Community Statistics
              </h2>
              <p className="text-sm text-slate-500">
                Overview of member engagement and skills
              </p>
            </div>
            <Select
              value={timeRange}
              onValueChange={(value: TimeRange) => setTimeRange(value)}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Time range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Statistics Visualization */}
          {stats && <OrgStats stats={stats} />}
        </div>
      </main>
    </div>
  )
}

// Separate component for invite link creation
function InviteLinkButton({
  orgId,
  slug,
}: {
  orgId: Id<'organizations'>
  slug: string
}) {
  const inviteLinks = useQuery(api.orgs.admin.getInviteLinks, { orgId })
  const createInvite = useMutation(api.orgs.admin.createInviteLink)
  const [isCreating, setIsCreating] = useState(false)

  // If there's an active invite link, show it
  const activeLink = inviteLinks?.[0]

  if (activeLink) {
    const inviteUrl = `${window.location.origin}/org/${slug}/join?token=${activeLink.token}`

    const copyToClipboard = () => {
      void navigator.clipboard.writeText(inviteUrl)
    }

    return (
      <Button
        variant="outline"
        className="h-auto py-4"
        onClick={copyToClipboard}
      >
        <UserPlus className="size-5 mr-2" />
        Copy Invite Link
      </Button>
    )
  }

  const handleCreate = async () => {
    setIsCreating(true)
    try {
      await createInvite({ orgId })
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <Button
      variant="outline"
      className="h-auto py-4"
      onClick={handleCreate}
      disabled={isCreating}
    >
      <UserPlus className="size-5 mr-2" />
      {isCreating ? 'Creating...' : 'Create Invite Link'}
    </Button>
  )
}
