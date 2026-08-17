import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConvexError } from 'convex/values'
import {
  Archive,
  ArchiveRestore,
  Building2,
  Copy,
  FileText,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Search,
  Shield,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { api } from '../../../../../../convex/_generated/api'
import type { Id } from '../../../../../../convex/_generated/dataModel'
import { OpportunityFormDialog } from '~/components/opportunities/OpportunityFormDialog'
import { AuthHeader } from '~/components/layout/auth-header'
import { Card } from '~/components/ui/card'
import { Button } from '~/components/ui/button'
import { Badge } from '~/components/ui/badge'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Input } from '~/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { useDotGridStyle } from '~/hooks/use-dot-grid-style'

export const Route = createFileRoute('/org/$slug/admin/opportunities/')({
  component: AdminOpportunitiesPage,
})

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-50 text-green-700 border-green-200',
  closed: 'bg-slate-50 text-slate-600 border-slate-200',
  draft: 'bg-yellow-50 text-yellow-700 border-yellow-200',
}

const TYPE_LABELS: Record<string, string> = {
  course: 'Course',
  fellowship: 'Fellowship',
  job: 'Job',
  other: 'Other',
}

type SortKey = 'recent' | 'deadline' | 'title' | 'status'
type StatusFilter = 'all' | 'active' | 'draft' | 'closed' | 'archived'

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'All statuses',
  active: 'Active',
  draft: 'Draft',
  closed: 'Closed',
  archived: 'Archived',
}

const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Newest first',
  deadline: 'Deadline (soonest)',
  title: 'Title (A–Z)',
  status: 'Status',
}

// Order for the "status" sort: live ones first, then drafts, then closed.
const STATUS_ORDER: Record<string, number> = { active: 0, draft: 1, closed: 2 }

// Preferred display order for the tag filter chips. Tags not listed here fall
// after these, sorted alphabetically.
const TAG_ORDER = [
  'TAIS Course',
  'TAIS Projects',
  'EOI',
  'Governance',
  'Feedback',
  'Intensive',
  'Part-time',
]
const tagRank = (tag: string) => {
  const i = TAG_ORDER.indexOf(tag)
  return i === -1 ? TAG_ORDER.length : i
}

function AdminOpportunitiesPage() {
  const { slug } = Route.useParams()
  const dotGridStyle = useDotGridStyle()

  const org = useQuery(api.orgs.directory.getOrgBySlug, { slug })
  const membership = useQuery(
    api.orgs.membership.getMembership,
    org ? { orgId: org._id } : 'skip',
  )
  const opportunities = useQuery(
    api.orgOpportunities.listAllByOrg,
    org && membership?.role === 'admin'
      ? { orgId: org._id, includeArchived: true }
      : 'skip',
  )

  const navigate = useNavigate()
  const duplicateOpp = useMutation(api.orgOpportunities.duplicate)
  const setArchived = useMutation(api.orgOpportunities.setArchived)
  const removeOpp = useMutation(api.orgOpportunities.remove)
  // Which row's delete dialog is open, and why the backend refused (if it did).
  const [confirmDelete, setConfirmDelete] = useState<{
    id: Id<'orgOpportunities'>
    title: string
  } | null>(null)
  const [deleteBlocked, setDeleteBlocked] = useState<string | null>(null)
  const [confirmDuplicate, setConfirmDuplicate] = useState<{
    id: Id<'orgOpportunities'>
    title: string
  } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedTags, setSelectedTags] = useState<Array<string>>([])

  // All tags in use across the org's opportunities, in the preferred order.
  const allTags = Array.from(
    new Set((opportunities ?? []).flatMap((o) => o.tags ?? [])),
  ).sort((a, b) => tagRank(a) - tagRank(b) || a.localeCompare(b))

  const toggleTag = (tag: string) =>
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    )

  // Filter (search + selected tags) then sort.
  const q = search.trim().toLowerCase()
  const visibleOpportunities = (opportunities ?? [])
    .filter((opp) => {
      // Archived is a separate axis from status: hidden everywhere except when
      // explicitly asked for.
      const isArchived = opp.archivedAt !== undefined
      if (statusFilter === 'archived') {
        if (!isArchived) return false
      } else {
        if (isArchived) return false
        if (statusFilter !== 'all' && opp.status !== statusFilter) return false
      }
      if (q) {
        const haystack = [opp.title, opp.description, ...(opp.tags ?? [])]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(q)) return false
      }
      if (selectedTags.length > 0) {
        const tags = opp.tags ?? []
        if (!selectedTags.some((t) => tags.includes(t))) return false
      }
      return true
    })
    .sort((a, b) => {
      switch (sort) {
        case 'deadline': {
          // Soonest first; opportunities without a deadline sink to the bottom.
          const ad = a.deadline ?? Infinity
          const bd = b.deadline ?? Infinity
          return ad - bd
        }
        case 'title':
          return a.title.localeCompare(b.title)
        case 'status':
          return (
            (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
            a.title.localeCompare(b.title)
          )
        case 'recent':
        default:
          return b._creationTime - a._creationTime
      }
    })

  // Loading
  if (org === undefined || membership === undefined) {
    return (
      <div className="min-h-screen" style={dotGridStyle}>
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-5xl mx-auto">
            <Spinner className="size-8 mx-auto" />
          </div>
        </main>
      </div>
    )
  }

  if (!org) {
    return (
      <div className="min-h-screen" style={dotGridStyle}>
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <Building2 className="size-8 text-slate-400 mx-auto mb-4" />
            <h1 className="text-2xl font-display mb-4">
              Organization Not Found
            </h1>
          </div>
        </main>
      </div>
    )
  }

  if (!membership || membership.role !== 'admin') {
    return (
      <div className="min-h-screen" style={dotGridStyle}>
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <Shield className="size-8 text-slate-400 mx-auto mb-4" />
            <h1 className="text-2xl font-display mb-4">
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

  return (
    <div className="min-h-screen" style={dotGridStyle}>
      <AuthHeader />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-5xl mx-auto">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
            <Link
              to="/org/$slug/admin"
              params={{ slug }}
              className="hover:text-slate-700 transition-colors"
            >
              Admin
            </Link>
            <span>/</span>
            <span className="text-slate-700">Opportunities</span>
          </div>

          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-display font-semibold text-foreground">
                Opportunities
              </h1>
              <p className="text-muted-foreground mt-1">
                Manage your organization&apos;s opportunities and application
                forms
              </p>
            </div>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="size-4 mr-2" />
              New Opportunity
            </Button>
          </div>

          {/* Search · sort · tag filters (only once there are opportunities) */}
          {opportunities && opportunities.length > 0 && (
            <div className="mb-4 space-y-3">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by title, description or tag…"
                    className="pl-9"
                  />
                </div>
                <Select
                  value={statusFilter}
                  onValueChange={(v) => setStatusFilter(v as StatusFilter)}
                >
                  <SelectTrigger className="sm:w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.keys(STATUS_FILTER_LABELS) as Array<StatusFilter>
                    ).map((k) => (
                      <SelectItem key={k} value={k}>
                        {STATUS_FILTER_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={sort}
                  onValueChange={(v) => setSort(v as SortKey)}
                >
                  <SelectTrigger className="sm:w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SORT_LABELS) as Array<SortKey>).map((k) => (
                      <SelectItem key={k} value={k}>
                        Sort: {SORT_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {allTags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {allTags.map((tag) => {
                    const active = selectedTags.includes(tag)
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={`text-xs rounded-full border px-2.5 py-1 transition-colors ${
                          active
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                      >
                        {tag}
                      </button>
                    )
                  })}
                  {selectedTags.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedTags([])}
                      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                    >
                      <X className="size-3" /> Clear
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* List */}
          {opportunities === undefined ? (
            <div className="py-12 text-center">
              <Spinner className="size-8 mx-auto" />
            </div>
          ) : opportunities.length === 0 ? (
            <Card className="p-8 text-center">
              <FileText className="size-8 text-slate-400 mx-auto mb-4" />
              <p className="text-muted-foreground mb-4">
                No opportunities yet. Create one to start receiving
                applications.
              </p>
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="size-4 mr-2" />
                Create First Opportunity
              </Button>
            </Card>
          ) : visibleOpportunities.length === 0 ? (
            <Card className="p-8 text-center">
              <Search className="size-8 text-slate-400 mx-auto mb-4" />
              <p className="text-muted-foreground">
                No opportunities match your search or filters.
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {visibleOpportunities.map((opp) => {
                const fieldCount = Array.isArray(opp.formFields)
                  ? (opp.formFields as Array<unknown>).length
                  : 0
                return (
                  <Card key={opp._id} className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">
                            {opp.title}
                          </span>
                          {opp.featured && (
                            <Star className="size-3.5 text-amber-500 fill-amber-500 shrink-0" />
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <span>{TYPE_LABELS[opp.type] ?? opp.type}</span>
                          <span className="text-slate-300">|</span>
                          <span>
                            {fieldCount} form field
                            {fieldCount !== 1 ? 's' : ''}
                          </span>
                          {opp.deadline && (
                            <>
                              <span className="text-slate-300">|</span>
                              <span>
                                Deadline:{' '}
                                {new Date(opp.deadline).toLocaleDateString()}
                              </span>
                            </>
                          )}
                        </div>
                        {opp.tags && opp.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {opp.tags.map((t) => (
                              <Badge
                                key={t}
                                variant="secondary"
                                className="text-[10px] px-1.5 py-0 font-normal"
                              >
                                {t}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>

                      <Badge
                        variant="outline"
                        className={STATUS_COLORS[opp.status] ?? ''}
                      >
                        {opp.status}
                      </Badge>

                      <Button
                        variant="ghost"
                        size="sm"
                        title="Copy application link"
                        onClick={async () => {
                          const url = `${window.location.origin}/org/${slug}/apply/${opp.slug ?? opp._id}`
                          try {
                            await navigator.clipboard.writeText(url)
                            toast.success('Application link copied')
                          } catch {
                            toast.error('Failed to copy link')
                          }
                        }}
                      >
                        <Link2 className="size-4" />
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        title={
                          opp.archivedAt
                            ? 'Unarchive — put it back in the list'
                            : 'Archive — take it out of the list, nothing is lost'
                        }
                        onClick={async () => {
                          try {
                            await setArchived({
                              id: opp._id,
                              archived: opp.archivedAt === undefined,
                            })
                            toast.success(
                              opp.archivedAt ? 'Unarchived' : 'Archived',
                            )
                          } catch {
                            toast.error("Couldn't archive the opportunity")
                          }
                        }}
                      >
                        {opp.archivedAt ? (
                          <ArchiveRestore className="size-4" />
                        ) : (
                          <Archive className="size-4" />
                        )}
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        title="Duplicate — copies the setup into a new draft"
                        disabled={duplicatingId === opp._id}
                        onClick={() =>
                          setConfirmDuplicate({
                            id: opp._id,
                            title: opp.title,
                          })
                        }
                      >
                        {duplicatingId === opp._id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Copy className="size-4" />
                        )}
                      </Button>

                      <Button variant="ghost" size="sm" asChild>
                        <Link
                          to="/org/$slug/admin/opportunities/$oppId"
                          params={{ slug, oppId: opp.slug ?? opp._id }}
                        >
                          <Pencil className="size-4" />
                        </Link>
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600"
                        title="Delete — only possible while nothing is attached"
                        onClick={() => {
                          setDeleteBlocked(null)
                          setConfirmDelete({ id: opp._id, title: opp.title })
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}

          {/* Duplicate confirmation. One misplaced click used to create a real
              copy silently, so this says what carries over and what does not —
              the two facts that decide whether you actually want it. */}
          <AlertDialog
            open={confirmDuplicate !== null}
            onOpenChange={(open) => !open && setConfirmDuplicate(null)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Duplicate &quot;{confirmDuplicate?.title}&quot;?
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2">
                    <p>
                      The copy starts as a draft, so nothing goes live until you
                      publish it.
                    </p>
                    <p>
                      <strong className="text-foreground">Copied:</strong> the
                      description, type, tags, the application form, the EOI
                      flag and the linked email template set.
                    </p>
                    <p>
                      <strong className="text-foreground">Not copied:</strong>{' '}
                      applications, availability polls, feedback surveys, the
                      deadline and the redirect target.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <Button
                  disabled={duplicatingId !== null}
                  onClick={async () => {
                    if (!confirmDuplicate) return
                    setDuplicatingId(confirmDuplicate.id)
                    try {
                      const newId = await duplicateOpp({
                        id: confirmDuplicate.id,
                      })
                      toast.success('Duplicated as a draft')
                      setConfirmDuplicate(null)
                      void navigate({
                        to: '/org/$slug/admin/opportunities/$oppId',
                        params: { slug, oppId: newId },
                      })
                    } catch (err) {
                      toast.error(
                        err instanceof Error
                          ? err.message
                          : 'Could not duplicate the opportunity',
                      )
                    } finally {
                      setDuplicatingId(null)
                    }
                  }}
                >
                  {duplicatingId !== null && (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  )}
                  Duplicate
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Delete confirmation. The backend refuses whenever anything is
              attached, so the dialog shows that reason instead of guessing. */}
          <AlertDialog
            open={confirmDelete !== null}
            onOpenChange={(open) => {
              if (!open) {
                setConfirmDelete(null)
                setDeleteBlocked(null)
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {deleteBlocked
                    ? 'This one cannot be deleted'
                    : `Delete "${confirmDelete?.title}"?`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {deleteBlocked ??
                    'Deleting only works while nothing is attached — no applications, surveys, extra polls or sent emails. If something is, you will be told and can archive it instead.'}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>
                  {deleteBlocked ? 'Close' : 'Cancel'}
                </AlertDialogCancel>
                {!deleteBlocked && (
                  <Button
                    variant="destructive"
                    disabled={isDeleting}
                    onClick={async () => {
                      if (!confirmDelete) return
                      setIsDeleting(true)
                      try {
                        await removeOpp({ id: confirmDelete.id })
                        toast.success('Opportunity deleted')
                        setConfirmDelete(null)
                      } catch (err) {
                        // Keep the dialog open and show why.
                        setDeleteBlocked(
                          err instanceof ConvexError &&
                            typeof err.data === 'string'
                            ? err.data
                            : 'Something went wrong deleting it.',
                        )
                      } finally {
                        setIsDeleting(false)
                      }
                    }}
                  >
                    {isDeleting ? (
                      <Loader2 className="size-4 mr-2 animate-spin" />
                    ) : null}
                    Delete
                  </Button>
                )}
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Create dialog */}
          <OpportunityFormDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            orgId={org._id}
            slug={slug}
          />
        </div>
      </main>
    </div>
  )
}
