import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import {
  Briefcase,
  Building2,
  Calendar,
  ChevronLeft,
  Clock,
  Eye,
  EyeOff,
  GraduationCap,
  History,
  MapPin,
  MessageSquare,
  Shield,
  Star,
  Target,
  User,
  Wrench,
} from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import { api } from '../../../../../../convex/_generated/api'
import type { EngagementLevel } from '~/components/engagement/EngagementBadge'
import { EngagementBadge } from '~/components/engagement/EngagementBadge'
import { AuthHeader } from '~/components/layout/auth-header'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Separator } from '~/components/ui/separator'

export const Route = createFileRoute('/org/$slug/admin/members/$userId')({
  component: MemberProfilePage,
})

function MemberProfilePage() {
  const { slug, userId } = Route.useParams()

  const org = useQuery(api.orgs.directory.getOrgBySlug, { slug })
  const membership = useQuery(
    api.orgs.membership.getMembership,
    org ? { orgId: org._id } : 'skip',
  )

  const memberProfile = useQuery(
    api.orgs.members.getMemberProfileForAdmin,
    org && membership?.role === 'admin' ? { orgId: org._id, userId } : 'skip',
  )

  const attendanceHistory = useQuery(
    api.orgs.members.getMemberAttendanceHistory,
    org && membership?.role === 'admin' ? { orgId: org._id, userId } : 'skip',
  )

  const engagementHistory = useQuery(
    api.orgs.members.getMemberEngagementHistory,
    org && membership?.role === 'admin' ? { orgId: org._id, userId } : 'skip',
  )

  // Loading state
  if (
    org === undefined ||
    membership === undefined ||
    memberProfile === undefined
  ) {
    return (
      <div className="min-h-screen bg-slate-50">
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-4xl mx-auto">
            <div className="animate-pulse space-y-6">
              <div className="h-8 bg-slate-100 rounded w-1/4" />
              <div className="h-48 bg-slate-100 rounded-xl" />
              <div className="h-64 bg-slate-100 rounded-xl" />
            </div>
          </div>
        </main>
      </div>
    )
  }

  // Org not found
  if (org === null) {
    return <NotFound message="Organization not found" />
  }

  // Not an admin
  if (!membership || membership.role !== 'admin') {
    return <AccessDenied slug={slug} />
  }

  // Member not found
  if (memberProfile === null) {
    return <NotFound message="Member not found" />
  }

  // Type assertion - TypeScript narrowing doesn't work with Convex query return types
  const profile = memberProfile.profile as ProfileData
  const email = memberProfile.email
  const memberMembership = memberProfile.membership as {
    _id: string
    joinedAt: number
    role: string
    directoryVisibility: string
  }
  const visibleSections = memberProfile.visibleSections as VisibleSections

  return (
    <div className="min-h-screen bg-slate-50">
      <AuthHeader />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <BackButton slug={slug} orgName={org.name} />

          {/* Profile Header */}
          <Card className="mt-6">
            <CardContent className="py-6">
              <div className="flex items-start gap-6">
                <div className="size-20 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                  <User className="size-10 text-slate-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h1 className="text-2xl font-display text-foreground">
                    {profile.name ?? 'No name'}
                  </h1>
                  {visibleSections.basicInfo && profile.headline && (
                    <p className="text-lg text-slate-600 mt-1">
                      {profile.headline}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-3 mt-3">
                    {visibleSections.basicInfo && profile.location && (
                      <span className="flex items-center gap-1 text-sm text-slate-500">
                        <MapPin className="size-4" />
                        {profile.location}
                      </span>
                    )}
                    {email && (
                      <span className="text-sm text-slate-500">{email}</span>
                    )}
                    <Badge
                      variant={
                        memberMembership.role === 'admin'
                          ? 'default'
                          : 'secondary'
                      }
                    >
                      {memberMembership.role === 'admin' && (
                        <Shield className="size-3 mr-1" />
                      )}
                      {memberMembership.role}
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-400 mt-2">
                    Joined{' '}
                    {format(
                      new Date(memberMembership.joinedAt),
                      'MMMM d, yyyy',
                    )}
                  </p>
                </div>
                {engagementHistory?.current && (
                  <div className="shrink-0">
                    <EngagementBadge
                      level={engagementHistory.current.level as EngagementLevel}
                      hasOverride={engagementHistory.current.hasOverride}
                      adminExplanation={
                        engagementHistory.current.adminExplanation
                      }
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 mt-6 lg:grid-cols-2">
            {/* Profile Details */}
            <ProfileDetailsCard
              profile={profile}
              visibleSections={visibleSections}
            />

            {/* Engagement Card */}
            <EngagementCard history={engagementHistory} />
          </div>

          {/* Attendance History */}
          <AttendanceHistoryCard history={attendanceHistory} />
        </div>
      </main>
    </div>
  )
}

function BackButton({ slug, orgName }: { slug: string; orgName: string }) {
  return (
    <div className="flex items-center gap-2 text-slate-500 text-sm">
      <Link
        to="/org/$slug"
        params={{ slug }}
        className="hover:text-slate-700 transition-colors"
      >
        {orgName}
      </Link>
      <span>/</span>
      <Link
        to="/org/$slug/admin/members"
        params={{ slug }}
        className="hover:text-slate-700 transition-colors flex items-center gap-1"
      >
        <ChevronLeft className="size-4" />
        Members
      </Link>
    </div>
  )
}

function NotFound({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <AuthHeader />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-lg mx-auto text-center py-12">
          <Building2 className="size-16 text-slate-300 mx-auto mb-4" />
          <h1 className="text-2xl font-display text-foreground mb-4">
            {message}
          </h1>
          <Button asChild>
            <Link to="/">Go Home</Link>
          </Button>
        </div>
      </main>
    </div>
  )
}

function AccessDenied({ slug }: { slug: string }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <AuthHeader />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-lg mx-auto text-center py-12">
          <Shield className="size-16 text-slate-300 mx-auto mb-4" />
          <h1 className="text-2xl font-display text-foreground mb-4">
            Admin Access Required
          </h1>
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

// Profile type from the query
type ProfileData = {
  name: string | null
  headline: string | null
  location: string | null
  pronouns: string | null
  education: Array<{
    institution: string
    degree?: string
    field?: string
    startYear?: number
    endYear?: number
  }> | null
  workHistory: Array<{
    organization: string
    title: string
    startDate?: string
    endDate?: string
    current?: boolean
  }> | null
  skills: Array<string> | null
  careerGoals: string | null
  seeking: Array<string> | null
  aiSafetyInterests: Array<string> | null
  enrichmentSummary: string | null
}

type VisibleSections = {
  basicInfo: boolean
  education: boolean
  workHistory: boolean
  skills: boolean
  careerGoals: boolean
}

function ProfileDetailsCard({
  profile,
  visibleSections,
}: {
  profile: ProfileData
  visibleSections: VisibleSections
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="size-5" />
          Profile Details
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Education */}
        <Section
          title="Education"
          icon={<GraduationCap className="size-4" />}
          visible={visibleSections.education}
        >
          {profile.education && profile.education.length > 0 ? (
            <ul className="space-y-2">
              {profile.education.map((edu, idx) => (
                <li key={idx} className="text-sm">
                  <div className="font-medium text-foreground">
                    {edu.institution}
                  </div>
                  {(edu.degree || edu.field) && (
                    <div className="text-slate-500">
                      {[edu.degree, edu.field].filter(Boolean).join(' in ')}
                    </div>
                  )}
                  {(edu.startYear || edu.endYear) && (
                    <div className="text-slate-400 text-xs">
                      {edu.startYear} - {edu.endYear ?? 'Present'}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400 italic">No education listed</p>
          )}
        </Section>

        <Separator />

        {/* Work History */}
        <Section
          title="Work History"
          icon={<Briefcase className="size-4" />}
          visible={visibleSections.workHistory}
        >
          {profile.workHistory && profile.workHistory.length > 0 ? (
            <ul className="space-y-2">
              {profile.workHistory.map((work, idx) => (
                <li key={idx} className="text-sm">
                  <div className="font-medium text-foreground">
                    {work.title}
                  </div>
                  <div className="text-slate-500">{work.organization}</div>
                  {(work.startDate || work.endDate) && (
                    <div className="text-slate-400 text-xs">
                      {work.startDate} -{' '}
                      {work.current ? 'Present' : work.endDate}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400 italic">
              No work history listed
            </p>
          )}
        </Section>

        <Separator />

        {/* Skills */}
        <Section
          title="Skills"
          icon={<Wrench className="size-4" />}
          visible={visibleSections.skills}
        >
          {profile.skills && profile.skills.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {profile.skills.map((skill) => (
                <Badge key={skill} variant="secondary" className="text-xs">
                  {skill}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400 italic">No skills listed</p>
          )}
        </Section>

        <Separator />

        {/* Career Goals */}
        <Section
          title="Career Goals"
          icon={<Target className="size-4" />}
          visible={visibleSections.careerGoals}
        >
          {profile.careerGoals ? (
            <p className="text-sm text-slate-700 whitespace-pre-line">
              {profile.careerGoals}
            </p>
          ) : profile.seeking && profile.seeking.length > 0 ? (
            <div className="space-y-2">
              <div className="text-sm text-slate-600">Seeking:</div>
              <div className="flex flex-wrap gap-1.5">
                {profile.seeking.map((item) => (
                  <Badge key={item} variant="outline" className="text-xs">
                    {item}
                  </Badge>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400 italic">
              No career goals listed
            </p>
          )}

          {profile.aiSafetyInterests &&
            profile.aiSafetyInterests.length > 0 && (
              <div className="mt-3">
                <div className="text-sm text-slate-600 mb-1">
                  AI Safety Interests:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {profile.aiSafetyInterests.map((interest) => (
                    <Badge
                      key={interest}
                      variant="secondary"
                      className="text-xs"
                    >
                      {interest}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

          {profile.enrichmentSummary && (
            <div className="mt-3 p-3 bg-slate-50 rounded-lg">
              <div className="text-xs text-slate-500 mb-1">AI Summary</div>
              <p className="text-sm text-slate-700">
                {profile.enrichmentSummary}
              </p>
            </div>
          )}
        </Section>
      </CardContent>
    </Card>
  )
}

function Section({
  title,
  icon,
  visible,
  children,
}: {
  title: string
  icon: React.ReactNode
  visible: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm font-medium text-slate-700">{title}</span>
        {visible ? (
          <Eye className="size-3 text-green-500" />
        ) : (
          <EyeOff className="size-3 text-slate-400" />
        )}
      </div>
      {visible ? (
        children
      ) : (
        <p className="text-sm text-slate-400 italic">Hidden by member</p>
      )}
    </div>
  )
}

type EngagementHistoryData =
  | {
      current: {
        level: string
        computedLevel: string
        adminExplanation: string
        userExplanation: string
        signals: Record<string, unknown>
        hasOverride: boolean
        overrideNotes?: string
        overrideExpiresAt?: number
        computedAt: number
      } | null
      history: Array<{
        _id: string
        action: string
        previousLevel: string
        newLevel: string
        notes?: string
        adminName: string
        performedAt: number
      }>
    }
  | null
  | undefined

function EngagementCard({ history }: { history: EngagementHistoryData }) {
  if (!history?.current) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-5" />
            Engagement
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <Clock className="size-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">
              Engagement data will be computed soon
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const { current, history: overrideHistory } = history

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-5" />
          Engagement
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current Status */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">
              Current Level
            </span>
            <EngagementBadge
              level={current.level as EngagementLevel}
              hasOverride={current.hasOverride}
            />
          </div>

          {current.hasOverride && (
            <div className="p-2 bg-amber-50 rounded text-xs text-amber-700">
              <span className="font-medium">Manual Override</span>
              {current.overrideNotes && <span> - {current.overrideNotes}</span>}
              {current.overrideExpiresAt && (
                <span className="block mt-1 text-amber-600">
                  Expires{' '}
                  {formatDistanceToNow(new Date(current.overrideExpiresAt), {
                    addSuffix: true,
                  })}
                </span>
              )}
            </div>
          )}

          <div className="text-sm text-slate-600">
            <p>{current.adminExplanation}</p>
          </div>

          <p className="text-xs text-slate-400">
            Last computed{' '}
            {formatDistanceToNow(new Date(current.computedAt), {
              addSuffix: true,
            })}
          </p>
        </div>

        {/* Signals */}
        {Object.keys(current.signals).length > 0 && (
          <>
            <Separator />
            <div>
              <div className="text-sm font-medium text-slate-700 mb-2">
                Signals
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {Object.entries(current.signals).map(([key, value]) => (
                  <div
                    key={key}
                    className="flex justify-between p-2 bg-slate-50 rounded"
                  >
                    <span className="text-slate-500">
                      {formatSignalKey(key)}
                    </span>
                    <span className="font-medium text-slate-700">
                      {typeof value === 'number' ? value : String(value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Override History */}
        {overrideHistory.length > 0 && (
          <>
            <Separator />
            <div>
              <div className="text-sm font-medium text-slate-700 mb-2">
                Override History
              </div>
              <ul className="space-y-2">
                {overrideHistory.map((record) => (
                  <li
                    key={record._id}
                    className="text-xs p-2 bg-slate-50 rounded"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-700">
                        {record.action === 'set'
                          ? 'Set Override'
                          : 'Cleared Override'}
                      </span>
                      <span className="text-slate-400">
                        {format(new Date(record.performedAt), 'MMM d, yyyy')}
                      </span>
                    </div>
                    <div className="text-slate-500 mt-1">
                      {record.previousLevel} &rarr; {record.newLevel}
                    </div>
                    {record.notes && (
                      <div className="text-slate-600 mt-1 italic">
                        "{record.notes}"
                      </div>
                    )}
                    <div className="text-slate-400 mt-1">
                      by {record.adminName}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function formatSignalKey(key: string): string {
  // Convert camelCase to Title Case
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim()
}

type AttendanceHistoryData =
  | Array<{
      _id: string
      status: string
      respondedAt?: number
      feedbackRating?: number
      feedbackText?: string
      createdAt: number
      event: {
        _id: string
        title: string
        startAt: number
        location?: string
        isVirtual: boolean
      } | null
    }>
  | null
  | undefined

function AttendanceHistoryCard({
  history,
}: {
  history: AttendanceHistoryData
}) {
  if (!history || history.length === 0) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="size-5" />
            Attendance History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <Calendar className="size-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">No attendance records yet</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="size-5" />
          Attendance History
          <Badge variant="secondary" className="ml-2">
            {history.length} events
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-slate-50">
                <th className="text-left text-xs font-medium text-slate-500 px-3 py-2">
                  Event
                </th>
                <th className="text-left text-xs font-medium text-slate-500 px-3 py-2">
                  Date
                </th>
                <th className="text-left text-xs font-medium text-slate-500 px-3 py-2">
                  Status
                </th>
                <th className="text-left text-xs font-medium text-slate-500 px-3 py-2">
                  Feedback
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {history.map((record) => (
                <tr key={record._id} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    {record.event ? (
                      <div>
                        <div className="font-medium text-foreground text-sm">
                          {record.event.title}
                        </div>
                        <div className="text-xs text-slate-500 flex items-center gap-1">
                          {record.event.isVirtual ? (
                            <Badge variant="outline" className="text-xs">
                              Virtual
                            </Badge>
                          ) : record.event.location ? (
                            <>
                              <MapPin className="size-3" />
                              {record.event.location}
                            </>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <span className="text-slate-400 italic">
                        Event deleted
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-sm text-slate-600">
                    {record.event
                      ? format(new Date(record.event.startAt), 'MMM d, yyyy')
                      : '-'}
                  </td>
                  <td className="px-3 py-2">
                    <AttendanceStatusBadge status={record.status} />
                  </td>
                  <td className="px-3 py-2">
                    {record.feedbackRating ? (
                      <div className="flex items-center gap-1">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={`size-4 ${
                              i < record.feedbackRating!
                                ? 'text-yellow-400 fill-yellow-400'
                                : 'text-slate-200'
                            }`}
                          />
                        ))}
                        {record.feedbackText && (
                          <span title={record.feedbackText}>
                            <MessageSquare className="size-4 text-slate-400 ml-1" />
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-400 text-sm">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function AttendanceStatusBadge({ status }: { status: string }) {
  const variants: Record<
    string,
    {
      variant: 'default' | 'secondary' | 'outline' | 'destructive'
      label: string
    }
  > = {
    attended: { variant: 'default', label: 'Attended' },
    did_not_attend: { variant: 'secondary', label: 'Did Not Attend' },
    skipped: { variant: 'outline', label: 'Skipped' },
    pending: { variant: 'outline', label: 'Pending' },
  }

  const config = variants[status] ?? {
    variant: 'outline' as const,
    label: status,
  }

  return (
    <Badge variant={config.variant} className="text-xs">
      {config.label}
    </Badge>
  )
}
