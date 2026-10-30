import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { ConvexError } from 'convex/values'
import { Shield, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { COURSE_TAGS } from '../../../../../convex/lib/courses'
import { AuthHeader } from '~/components/layout/auth-header'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'

export const Route = createFileRoute('/org/$slug/admin/permissions')({
  component: PermissionsPage,
})

type Level = 'read' | 'edit'

const LEVEL_LABELS: Record<Level, string> = {
  read: 'Read',
  edit: 'Edit',
}

/**
 * Who can reach each course. Admins reach everything; anyone else only the
 * courses granted here: Read shows the course's opportunities, applications,
 * answers and availability; Edit also changes statuses, emails, polls and
 * custom forms.
 */
function PermissionsPage() {
  const { slug } = Route.useParams()
  const org = useQuery(api.orgs.directory.getOrgBySlug, { slug })
  const membership = useQuery(
    api.orgs.membership.getMembership,
    org ? { orgId: org._id } : 'skip',
  )

  if (org === undefined || membership === undefined) {
    return (
      <div className="min-h-screen bg-slate-50">
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <Spinner className="size-8 mx-auto" />
        </main>
      </div>
    )
  }

  if (!org || !membership || membership.role !== 'admin') {
    return (
      <div className="min-h-screen bg-slate-50">
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <Shield className="size-8 text-slate-400 mx-auto mb-4" />
            <h1 className="text-2xl font-display mb-4">
              Admin Access Required
            </h1>
            <Button asChild>
              <Link to="/">Go Home</Link>
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
        <div className="max-w-3xl mx-auto space-y-6">
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
              <span className="text-slate-700">Course permissions</span>
            </div>
            <h1 className="text-2xl font-display font-semibold text-foreground">
              Course permissions
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Admins reach every course. Anyone else reaches only the courses
              granted here. <strong>Read</strong> shows a course&apos;s
              opportunities, applications, answers and availability;{' '}
              <strong>Edit</strong> also changes statuses, emails, polls and
              custom forms. Creating or deleting opportunities, canonical forms,
              members and settings stay with admins. A course is the
              opportunity&apos;s course tag.
            </p>
          </div>
          <PermissionsEditor orgId={org._id} slug={slug} />
        </div>
      </main>
    </div>
  )
}

function PermissionsEditor({
  orgId,
  slug,
}: {
  orgId: Id<'organizations'>
  slug: string
}) {
  const members = useQuery(api.orgs.admin.getAllMembersWithProfiles, { orgId })
  const grants = useQuery(api.courseAccess.list, { orgId })
  const setAccess = useMutation(api.courseAccess.setAccess)

  const [search, setSearch] = useState('')
  const [userId, setUserId] = useState<string>('')
  const [course, setCourse] = useState<string>(COURSE_TAGS[0])
  const [level, setLevel] = useState<Level>('read')
  const [isSaving, setIsSaving] = useState(false)

  if (members === undefined || grants === undefined) {
    return <Spinner className="size-6 mx-auto" />
  }

  const nameOf = (m: (typeof members)[number]) =>
    m.profile?.name || m.email || 'Unnamed member'
  const admins = members.filter((m) => m.membership.role === 'admin')
  const candidates = members
    .filter((m) => m.membership.role !== 'admin')
    .filter((m) => {
      const q = search.trim().toLowerCase()
      if (!q) return true
      return (
        nameOf(m).toLowerCase().includes(q) ||
        (m.email ?? '').toLowerCase().includes(q)
      )
    })
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))

  const save = async (
    target: string,
    targetCourse: string,
    targetLevel: Level | null,
  ) => {
    setIsSaving(true)
    try {
      await setAccess({
        orgId,
        userId: target,
        course: targetCourse,
        level: targetLevel,
      })
      toast.success(targetLevel === null ? 'Access removed' : 'Access saved')
    } catch (err) {
      toast.error("Couldn't change the access", {
        description:
          err instanceof ConvexError && typeof err.data === 'string'
            ? err.data
            : 'Please try again.',
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Admins</CardTitle>
          <CardDescription>
            They reach every course and manage these permissions. Make someone
            an admin, or take it away, in{' '}
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
          <ul className="text-sm space-y-1">
            {admins.map((m) => (
              <li key={m.membership._id}>
                {nameOf(m)}
                {m.email && (
                  <span className="text-muted-foreground"> · {m.email}</span>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Give access to a course</CardTitle>
          <CardDescription>
            Only members who are not admins are listed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members by name or email"
          />
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a member…" />
              </SelectTrigger>
              <SelectContent>
                {candidates.slice(0, 100).map((m) => (
                  <SelectItem
                    key={m.membership._id}
                    value={m.membership.userId}
                  >
                    {nameOf(m)}
                    {m.email ? ` · ${m.email}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={course} onValueChange={setCourse}>
              <SelectTrigger className="sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COURSE_TAGS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={level}
              onValueChange={(value) => setLevel(value as Level)}
            >
              <SelectTrigger className="sm:w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read">Read</SelectItem>
                <SelectItem value="edit">Edit</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              disabled={!userId || isSaving}
              onClick={() => void save(userId, course, level)}
            >
              Give access
            </Button>
          </div>
          {candidates.length > 100 && (
            <p className="text-xs text-muted-foreground">
              Showing the first 100 matches; search to narrow them down.
            </p>
          )}
        </CardContent>
      </Card>

      {COURSE_TAGS.map((c) => {
        const rows = grants.filter((g) => g.course === c)
        return (
          <Card key={c}>
            <CardHeader>
              <CardTitle>{c}</CardTitle>
              <CardDescription>
                {rows.length === 0
                  ? 'Only admins reach this course.'
                  : `${rows.length} ${rows.length === 1 ? 'person' : 'people'} besides the admins.`}
              </CardDescription>
            </CardHeader>
            {rows.length > 0 && (
              <CardContent>
                <ul className="divide-y">
                  {rows.map((g) => (
                    <li
                      key={g.userId}
                      className="flex flex-wrap items-center gap-2 py-2 text-sm"
                    >
                      <span className="flex-1 min-w-40">
                        {g.name || g.email || g.userId}
                        {g.name && g.email && (
                          <span className="text-muted-foreground">
                            {' '}
                            · {g.email}
                          </span>
                        )}
                      </span>
                      <Select
                        value={g.level}
                        onValueChange={(value) =>
                          void save(g.userId, c, value as Level)
                        }
                        disabled={isSaving}
                      >
                        <SelectTrigger className="w-28">
                          <SelectValue>{LEVEL_LABELS[g.level]}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="read">Read</SelectItem>
                          <SelectItem value="edit">Edit</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isSaving}
                        onClick={() => void save(g.userId, c, null)}
                        aria-label={`Remove ${g.name ?? 'this person'} from ${c}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            )}
          </Card>
        )
      })}
    </>
  )
}
