import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { ConvexError } from 'convex/values'
import { Shield } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { ACCESS_COURSES } from '../../../../../convex/lib/courses'
import { AuthHeader } from '~/components/layout/auth-header'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'

export const Route = createFileRoute('/org/$slug/admin/permissions')({
  component: CourseAccessPage,
})

type Level = 'read' | 'edit'
const NONE = 'none'

/**
 * Which courses each admin opens: owners and admins with all courses open
 * every course; admins with chosen courses open the ones ticked here.
 * Nothing on this page makes someone an admin or a member: that is Members.
 */
function CourseAccessPage() {
  const { slug } = Route.useParams()
  const org = useQuery(api.orgs.directory.getOrgBySlug, { slug })
  const access = useQuery(
    api.courseAccess.myAccess,
    org ? { orgId: org._id } : 'skip',
  )

  if (org === undefined || (org && access === undefined)) {
    return (
      <div className="min-h-screen bg-slate-50">
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <Spinner className="size-8 mx-auto" />
        </main>
      </div>
    )
  }

  if (!org || !access?.canManage) {
    return (
      <div className="min-h-screen bg-slate-50">
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <Shield className="size-8 text-slate-400 mx-auto mb-4" />
            <h1 className="text-2xl font-display mb-4">Owners only</h1>
            <p className="text-slate-600 mb-6">
              Only the organization&apos;s owners manage course access.
            </p>
            <Button asChild>
              <Link to="/org/$slug/admin" params={{ slug }}>
                Back to Admin
              </Link>
            </Button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <AuthHeader />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto space-y-6">
          <div>
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
              <Link
                to="/org/$slug/admin"
                params={{ slug }}
                className="hover:text-slate-700 transition-colors"
              >
                Admin
              </Link>
              <span>/</span>
              <span className="text-slate-700">Course access</span>
            </div>
            <h1 className="text-2xl font-display font-semibold text-foreground">
              Course access
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Choose which courses each admin opens. View lets them see
              applications, availability and surveys; Edit also lets them change
              statuses, send emails and create editions. Everything else (CRM,
              events, members) is open to every admin.
            </p>
          </div>
          <CourseAccessEditor orgId={org._id} slug={slug} />
        </div>
      </main>
    </div>
  )
}

function CourseAccessEditor({
  orgId,
  slug,
}: {
  orgId: Id<'organizations'>
  slug: string
}) {
  const members = useQuery(api.orgs.admin.getAllMembersWithProfiles, { orgId })
  const me = useQuery(api.orgs.membership.getMembership, { orgId })
  const grants = useQuery(api.courseAccess.list, { orgId })
  const setAccess = useMutation(api.courseAccess.setAccess)
  const setOwner = useMutation(api.courseAccess.setOwner)
  const setScope = useMutation(api.courseAccess.setScope)

  if (members === undefined || grants === undefined) {
    return <Spinner className="size-6 mx-auto" />
  }

  type Member = (typeof members)[number]
  const nameOf = (m: Member) => m.profile?.name || m.email || 'Unnamed member'

  // The team is the org's admins; members get courses once made admins.
  const rows = members
    .filter((m) => m.membership.role === 'admin')
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
  const levelOf = (userId: string, course: string): Level | typeof NONE =>
    grants.find((g) => g.userId === userId && g.course === course)?.level ??
    NONE

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action()
      toast.success(success)
    } catch (err) {
      toast.error("Couldn't save", {
        description:
          err instanceof ConvexError && typeof err.data === 'string'
            ? err.data
            : 'Please try again.',
      })
    }
  }

  type Scope = 'owner' | 'all' | 'some'
  const scopeOf = (m: Member): Scope =>
    m.membership.isOwner === true
      ? 'owner'
      : m.membership.courseScope === 'chosen'
        ? 'some'
        : 'all'

  // Moves an admin between owner, all courses and chosen courses. None of
  // these changes whether they are an admin.
  const changeScope = (m: Member, next: Scope) => {
    const id = m.membership._id
    const current = scopeOf(m)
    void run(
      async () => {
        if (next === 'owner') {
          return setOwner({ orgId, membershipId: id, owner: true })
        }
        if (current === 'owner') {
          await setOwner({ orgId, membershipId: id, owner: false })
        }
        return setScope({
          orgId,
          membershipId: id,
          scope: next === 'some' ? 'chosen' : 'all',
        })
      },
      next === 'owner'
        ? `${nameOf(m)} is now an owner.`
        : next === 'all'
          ? `${nameOf(m)} now opens every course.`
          : `${nameOf(m)} now opens only the courses you tick.`,
    )
  }

  const changeCourse = (
    m: Member,
    course: string,
    value: Level | typeof NONE,
  ) =>
    void run(
      () =>
        setAccess({
          orgId,
          userId: m.membership.userId,
          course,
          level: value === NONE ? null : value,
        }),
      value === NONE
        ? `${nameOf(m)} can no longer open ${course}.`
        : `${nameOf(m)} can now ${value === 'edit' ? 'edit' : 'view'} ${course}.`,
    )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Admins</CardTitle>
        <CardDescription>
          Owners open every course, edit the canonicals and manage this page. To
          give someone courses, first make them an admin in{' '}
          <Link
            to="/org/$slug/admin/members"
            params={{ slug }}
            className="underline"
          >
            Members
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Person</th>
                <th className="py-2 px-1 font-medium">Access</th>
                {ACCESS_COURSES.map((c) => (
                  <th key={c} className="py-2 px-1 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((m) => (
                <tr key={m.membership._id}>
                  <td className="py-2 pr-3 min-w-40">
                    <div>{nameOf(m)}</div>
                    {m.email && (
                      <div className="text-xs text-muted-foreground">
                        {m.email}
                      </div>
                    )}
                  </td>
                  <td className="py-2 px-1">
                    <Select
                      value={scopeOf(m)}
                      onValueChange={(value) => changeScope(m, value as Scope)}
                      // Your own access is changed by another owner, so a
                      // misclick can't lock you out of this page.
                      disabled={m.membership.userId === me?.userId}
                    >
                      <SelectTrigger
                        className="h-8 w-36 text-xs"
                        aria-label={`${nameOf(m)}: access`}
                        title={
                          m.membership.userId === me?.userId
                            ? 'Another owner can change your access.'
                            : undefined
                        }
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="owner">Owner</SelectItem>
                        <SelectItem value="all">All courses</SelectItem>
                        <SelectItem value="some">Chosen courses</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  {scopeOf(m) !== 'some' ? (
                    <td
                      colSpan={ACCESS_COURSES.length}
                      className="py-2 px-1 text-xs text-muted-foreground"
                    >
                      Every course (edit)
                    </td>
                  ) : (
                    ACCESS_COURSES.map((c) => (
                      <td key={c} className="py-2 px-1">
                        <Select
                          value={levelOf(m.membership.userId, c)}
                          onValueChange={(value) =>
                            changeCourse(m, c, value as Level | typeof NONE)
                          }
                        >
                          <SelectTrigger
                            className="h-8 w-24 text-xs"
                            aria-label={`${nameOf(m)}: ${c}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>—</SelectItem>
                            <SelectItem value="read">View</SelectItem>
                            <SelectItem value="edit">Edit</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                    ))
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          A course is the opportunity&apos;s course tag (e.g. &quot;TAIS
          Course&quot;); Other covers opportunities without one. A new course
          opens for owners and admins with all courses, not for chosen courses.
        </p>
      </CardContent>
    </Card>
  )
}
