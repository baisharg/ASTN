import { Link, createFileRoute } from '@tanstack/react-router'
import {
  AuthLoading,
  Authenticated,
  useConvexAuth,
  useQuery,
} from 'convex/react'
import {
  Building2,
  Calendar,
  CheckCircle2,
  ExternalLink,
  GraduationCap,
  MapPin,
  Settings,
  UserPlus,
  Users,
} from 'lucide-react'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { AuthHeader } from '~/components/layout/auth-header'
import { GradientBg } from '~/components/layout/GradientBg'
import { MemberDirectory } from '~/components/org/MemberDirectory'
import { Card } from '~/components/ui/card'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'

// Keep in sync with APPLICATION_EDIT_GRACE_MS in
// convex/opportunityApplications.ts and the apply route.
const APPLICATION_EDIT_GRACE_MS = 24 * 60 * 60 * 1000

export const Route = createFileRoute('/org/$slug/')({
  component: OrgDirectoryPage,
})

function OrgDirectoryPage() {
  const { slug } = Route.useParams()
  const org = useQuery(api.orgs.directory.getOrgBySlug, { slug })

  if (org === undefined) {
    return (
      <GradientBg>
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-5xl mx-auto">
            <div className="animate-pulse space-y-6">
              <div className="h-24 bg-slate-100 rounded-xl" />
              <div className="h-64 bg-slate-100 rounded-xl" />
            </div>
          </div>
        </main>
      </GradientBg>
    )
  }

  if (org === null) {
    return (
      <GradientBg>
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
      </GradientBg>
    )
  }

  return (
    <GradientBg>
      <AuthHeader />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-5xl mx-auto">
          <OrgHeader org={org} />
          <FeaturedOpportunity orgId={org._id} orgSlug={org.slug} />
          <MemberDirectory orgId={org._id} />
        </div>
      </main>
    </GradientBg>
  )
}

interface OrgHeaderProps {
  org: {
    _id: Id<'organizations'>
    name: string
    slug?: string
    logoUrl?: string
    lumaCalendarUrl?: string
    hasCoworkingSpace?: boolean
  }
}

function OrgHeader({ org }: OrgHeaderProps) {
  const memberCount = useQuery(api.orgs.directory.getMemberCount, {
    orgId: org._id,
  })

  return (
    <Card className="p-4 sm:p-6 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          {org.logoUrl ? (
            <img
              src={org.logoUrl}
              alt={org.name}
              className="size-12 sm:size-16 rounded-lg object-cover shrink-0"
            />
          ) : (
            <div className="size-12 sm:size-16 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Building2 className="size-6 sm:size-8 text-primary" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-display text-foreground truncate">
              {org.name}
            </h1>
            <div className="flex items-center gap-2 mt-1 text-slate-500 text-sm">
              <Users className="size-4 shrink-0" />
              <span>
                {memberCount === undefined
                  ? '...'
                  : `${memberCount} member${memberCount === 1 ? '' : 's'}`}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {org.hasCoworkingSpace && org.slug && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/org/$slug/space" params={{ slug: org.slug }}>
                <MapPin className="size-4 mr-1" />
                Space
              </Link>
            </Button>
          )}

          {org.lumaCalendarUrl && org.slug && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/org/$slug/events" params={{ slug: org.slug }}>
                <Calendar className="size-4 mr-1" />
                Events
              </Link>
            </Button>
          )}

          <Authenticated>
            <ProgramsButton orgId={org._id} orgSlug={org.slug} />
          </Authenticated>

          <AuthLoading>
            <Spinner className="size-5" />
          </AuthLoading>

          <Authenticated>
            <MembershipStatus orgId={org._id} orgSlug={org.slug} />
          </Authenticated>
        </div>
      </div>
    </Card>
  )
}

function ProgramsButton({
  orgId,
  orgSlug,
}: {
  orgId: Id<'organizations'>
  orgSlug?: string
}) {
  const myPrograms = useQuery(api.programs.getMyPrograms, { orgId })

  if (!myPrograms || myPrograms.length === 0 || !orgSlug) return null

  return (
    <Button variant="outline" size="sm" asChild>
      <Link to="/org/$slug/programs" params={{ slug: orgSlug }}>
        <GraduationCap className="size-4 mr-1" />
        Programs
      </Link>
    </Button>
  )
}

interface MembershipStatusProps {
  orgId: Id<'organizations'>
  orgSlug?: string
}

function MembershipStatus({ orgId, orgSlug }: MembershipStatusProps) {
  const membership = useQuery(api.orgs.membership.getMembership, { orgId })

  if (membership === undefined) {
    return <Spinner className="size-5" />
  }

  if (membership === null) {
    return (
      <Button variant="outline" size="sm" asChild>
        <Link
          to="/org/$slug/join"
          params={{ slug: orgSlug || 'unknown' }}
          search={{ token: '' }}
        >
          <UserPlus className="size-4 mr-1" />
          Join
        </Link>
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Badge variant="secondary">Member</Badge>
      {membership.role === 'admin' && orgSlug && (
        <Button variant="outline" size="sm" asChild>
          <Link to="/org/$slug/admin" params={{ slug: orgSlug }}>
            <Settings className="size-4 mr-1" />
            Admin
          </Link>
        </Button>
      )}
    </div>
  )
}

function FeaturedOpportunity({
  orgId,
  orgSlug,
}: {
  orgId: Id<'organizations'>
  orgSlug?: string
}) {
  const { isAuthenticated } = useConvexAuth()
  const featured = useQuery(api.orgOpportunities.getFeatured, { orgId })
  const myApplication = useQuery(
    api.opportunityApplications.getMyApplication,
    isAuthenticated && featured ? { opportunityId: featured._id } : 'skip',
  )

  if (!featured) return null

  // Only show active opportunities
  if (featured.status !== 'active') return null

  const hasApplied = isAuthenticated && !!myApplication
  const isWithinEditWindow =
    featured.deadline === undefined ||
    Date.now() <= featured.deadline + APPLICATION_EDIT_GRACE_MS

  return (
    <Card className="mb-6 overflow-hidden border-primary/20">
      <div className="bg-gradient-to-r from-primary/5 to-primary/10 p-4 sm:p-6">
        <div className="flex items-start gap-3 sm:gap-4">
          <div className="size-10 sm:size-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <GraduationCap className="size-5 sm:size-6 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-foreground truncate">
                {featured.title}
              </h3>
              <Badge variant="secondary" className="shrink-0 text-xs">
                Featured
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              {featured.description}
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              {hasApplied && (
                <Badge className="bg-green-50 text-green-700 border-green-200">
                  <CheckCircle2 className="size-3 mr-1" />
                  Application Submitted
                </Badge>
              )}
              {hasApplied && isWithinEditWindow && orgSlug && (
                <Button size="sm" variant="outline" asChild>
                  <Link
                    to="/org/$slug/apply/$opportunityId"
                    params={{ slug: orgSlug, opportunityId: featured.slug ?? featured._id }}
                  >
                    Edit application
                  </Link>
                </Button>
              )}
              {!hasApplied && orgSlug && (
                <Button size="sm" asChild>
                  <Link
                    to="/org/$slug/apply/$opportunityId"
                    params={{ slug: orgSlug, opportunityId: featured.slug ?? featured._id }}
                  >
                    Apply Now
                  </Link>
                </Button>
              )}
              {featured.externalUrl && (
                <a
                  href={featured.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Learn more
                  <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}
