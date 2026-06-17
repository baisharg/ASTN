import { Link, createFileRoute } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import {
  Building2,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  ClipboardList,
  Link2,
  Download,
  FileText,
  Loader2,
  Mail,
  Save,
  Shield,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../../../../../convex/_generated/api'
import type { Id } from '../../../../../../../convex/_generated/dataModel'
import type { FormField } from '../../../../../../../convex/lib/formFields'
import { weekdayShort } from '../../../../../../../convex/lib/availabilityWeek'
import type { AvailabilityResponse } from '~/components/availability/AvailabilityHeatmap'
import { AvailabilityHeatmap } from '~/components/availability/AvailabilityHeatmap'
import { PollCreationForm } from '~/components/availability/PollCreationForm'
import { ScheduleAnalysis } from '~/components/availability/ScheduleAnalysis'
import { FormFieldsEditor } from '~/components/opportunities/FormFieldsEditor'
import { SurveyTab } from '~/components/surveys/SurveyTab'
import { AuthHeader } from '~/components/layout/auth-header'
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
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { Checkbox } from '~/components/ui/checkbox'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Textarea } from '~/components/ui/textarea'

export const Route = createFileRoute('/org/$slug/admin/opportunities/$oppId/')({
  component: OpportunityEditPage,
})

type OpportunityType = 'course' | 'fellowship' | 'job' | 'other'
type OpportunityStatus = 'active' | 'closed' | 'draft'

function OpportunityEditPage() {
  const { slug, oppId } = Route.useParams()

  const org = useQuery(api.orgs.directory.getOrgBySlug, { slug })
  const membership = useQuery(
    api.orgs.membership.getMembership,
    org ? { orgId: org._id } : 'skip',
  )
  const opportunity = useQuery(api.orgOpportunities.get, {
    id: oppId as Id<'orgOpportunities'>,
  })

  const updateOpp = useMutation(api.orgOpportunities.update)

  // Form state — details
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<OpportunityType>('course')
  const [status, setStatus] = useState<OpportunityStatus>('draft')
  const [deadlineStr, setDeadlineStr] = useState('')
  const [externalUrl, setExternalUrl] = useState('')
  const [featured, setFeatured] = useState(false)
  const [redirectOpportunityId, setRedirectOpportunityId] = useState<
    string | null
  >(null)
  const [sourceOpportunityId, setSourceOpportunityId] = useState<string | null>(
    null,
  )

  // Redirect target options: active opportunities in this org (excluding current)
  const activeOpportunities = useQuery(
    api.orgOpportunities.listByOrg,
    org ? { orgId: org._id } : 'skip',
  )
  const redirectTargets = (activeOpportunities ?? []).filter(
    (o) => o._id !== oppId,
  )

  // Source (pre-fill) options: all opportunities in this org (any status),
  // excluding the current one. Usually the source is a closed prior edition.
  // Gated on admin membership — listAllByOrg throws for non-admins.
  const allOpportunities = useQuery(
    api.orgOpportunities.listAllByOrg,
    org && membership?.role === 'admin' ? { orgId: org._id } : 'skip',
  )
  const sourceOptions = (allOpportunities ?? []).filter((o) => o._id !== oppId)

  // Form state — form fields
  const [formFields, setFormFields] = useState<Array<FormField>>([])

  const [isSavingDetails, setIsSavingDetails] = useState(false)
  const [isSavingFields, setIsSavingFields] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  const exportCsv = useAction(api.opportunityApplications.exportApplications)

  // Populate form when opportunity loads
  useEffect(() => {
    if (opportunity) {
      setTitle(opportunity.title)
      setDescription(opportunity.description)
      setType(opportunity.type)
      setStatus(opportunity.status)
      setDeadlineStr(
        opportunity.deadline
          ? new Date(opportunity.deadline).toISOString().split('T')[0]
          : '',
      )
      setExternalUrl(opportunity.externalUrl ?? '')
      setFeatured(opportunity.featured)
      setRedirectOpportunityId(opportunity.redirectOpportunityId ?? null)
      setSourceOpportunityId(opportunity.sourceOpportunityId ?? null)
      setFormFields(
        (opportunity.formFields as Array<FormField> | undefined) ?? [],
      )
    }
  }, [opportunity])

  // Loading
  if (
    org === undefined ||
    membership === undefined ||
    opportunity === undefined
  ) {
    return (
      <div className="min-h-screen bg-slate-50">
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-3xl mx-auto">
            <Spinner className="size-8 mx-auto" />
          </div>
        </main>
      </div>
    )
  }

  if (!org) {
    return (
      <div className="min-h-screen bg-slate-50">
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
      <div className="min-h-screen bg-slate-50">
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

  if (!opportunity) {
    return (
      <div className="min-h-screen bg-slate-50">
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <FileText className="size-8 text-slate-400 mx-auto mb-4" />
            <h1 className="text-2xl font-display mb-4">
              Opportunity Not Found
            </h1>
            <Button asChild>
              <Link to="/org/$slug/admin/opportunities" params={{ slug }}>
                Back to Opportunities
              </Link>
            </Button>
          </div>
        </main>
      </div>
    )
  }

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const csv = await exportCsv({ opportunityId: opportunity._id })
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `applications-${opportunity.title.toLowerCase().replace(/\s+/g, '-')}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Export failed:', err)
      toast.error('Failed to export applications')
    } finally {
      setIsExporting(false)
    }
  }

  const canSaveDetails = title.trim() && description.trim()

  const handleSaveDetails = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSaveDetails || isSavingDetails) return
    setIsSavingDetails(true)
    try {
      const deadline = deadlineStr ? new Date(deadlineStr).getTime() : undefined
      await updateOpp({
        id: opportunity._id,
        title: title.trim(),
        description: description.trim(),
        type,
        status,
        deadline,
        externalUrl: externalUrl.trim() || undefined,
        featured,
        redirectOpportunityId: redirectOpportunityId
          ? (redirectOpportunityId as Id<'orgOpportunities'>)
          : null,
        sourceOpportunityId: sourceOpportunityId
          ? (sourceOpportunityId as Id<'orgOpportunities'>)
          : null,
      })
      toast.success('Opportunity details saved')
    } catch (err) {
      console.error('Failed to save opportunity details:', err)
      toast.error('Failed to save details')
    } finally {
      setIsSavingDetails(false)
    }
  }

  const handleSaveFields = async () => {
    setIsSavingFields(true)
    try {
      const validFields = formFields.filter((f) => f.label.trim())
      await updateOpp({
        id: opportunity._id,
        formFields: validFields.length > 0 ? validFields : undefined,
      })
      toast.success('Form fields saved')
    } catch (err) {
      console.error('Failed to save form fields:', err)
      toast.error('Failed to save form fields')
    } finally {
      setIsSavingFields(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <AuthHeader />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-3xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
              <Link
                to="/org/$slug/admin"
                params={{ slug }}
                className="hover:text-slate-700 transition-colors"
              >
                Admin
              </Link>
              <span>/</span>
              <Link
                to="/org/$slug/admin/opportunities"
                params={{ slug }}
                className="hover:text-slate-700 transition-colors"
              >
                Opportunities
              </Link>
              <span>/</span>
              <span className="text-slate-700">{opportunity.title}</span>
            </div>
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-display font-semibold text-foreground">
                Edit Opportunity
              </h1>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={async () => {
                    const url = `${window.location.origin}/org/${slug}/apply/${oppId}`
                    try {
                      await navigator.clipboard.writeText(url)
                      toast.success('Application link copied')
                    } catch {
                      toast.error('Failed to copy link')
                    }
                  }}
                >
                  <Link2 className="size-4 mr-2" />
                  Copy Link
                </Button>
                <Button
                  variant="outline"
                  onClick={handleExport}
                  disabled={isExporting}
                >
                  {isExporting ? (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="size-4 mr-2" />
                  )}
                  Export CSV
                </Button>
                <Button variant="outline" asChild>
                  <Link
                    to="/org/$slug/admin/opportunities/$oppId/email"
                    params={{ slug, oppId }}
                  >
                    <Mail className="size-4 mr-2" />
                    Email Applicants
                  </Link>
                </Button>
              </div>
            </div>
          </div>

          <Tabs defaultValue="details">
            <TabsList>
              <TabsTrigger value="details" className="gap-2">
                <FileText className="size-4" />
                Details
              </TabsTrigger>
              <TabsTrigger value="availability" className="gap-2">
                <Calendar className="size-4" />
                Availability
              </TabsTrigger>
              <TabsTrigger value="feedback" className="gap-2">
                <ClipboardList className="size-4" />
                Feedback
              </TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="mt-6">
              <div className="space-y-6">
                {/* Card 1: Opportunity Details */}
                <Card>
                  <CardHeader>
                    <CardTitle>Opportunity Details</CardTitle>
                    <CardDescription>
                      Basic information about this opportunity
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleSaveDetails} className="space-y-4">
                      <div className="space-y-1">
                        <Label htmlFor="opp-title">
                          Title <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id="opp-title"
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          placeholder="e.g. Technical AI Safety Course"
                        />
                      </div>

                      <div className="space-y-1">
                        <Label htmlFor="opp-desc">
                          Description <span className="text-red-500">*</span>
                        </Label>
                        <Textarea
                          id="opp-desc"
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          rows={3}
                          placeholder="Brief description shown on the apply page"
                        />
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label>Type</Label>
                          <Select
                            value={type}
                            onValueChange={(v) => setType(v as OpportunityType)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="course">Course</SelectItem>
                              <SelectItem value="fellowship">
                                Fellowship
                              </SelectItem>
                              <SelectItem value="job">Job</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1">
                          <Label>Status</Label>
                          <Select
                            value={status}
                            onValueChange={(v) =>
                              setStatus(v as OpportunityStatus)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="draft">Draft</SelectItem>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="closed">Closed</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label htmlFor="opp-deadline">
                            Deadline (optional)
                          </Label>
                          <Input
                            id="opp-deadline"
                            type="date"
                            value={deadlineStr}
                            onChange={(e) => setDeadlineStr(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="opp-url">
                            External URL (optional)
                          </Label>
                          <Input
                            id="opp-url"
                            value={externalUrl}
                            onChange={(e) => setExternalUrl(e.target.value)}
                            placeholder="https://..."
                          />
                        </div>
                      </div>

                      <label className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                          checked={featured}
                          onCheckedChange={(checked) =>
                            setFeatured(checked === true)
                          }
                        />
                        <span className="text-sm">
                          Featured opportunity (shown on org landing page)
                        </span>
                      </label>

                      {status === 'closed' && (
                        <div className="space-y-1">
                          <Label>Redirect to (Expression of Interest)</Label>
                          <Select
                            value={redirectOpportunityId ?? 'none'}
                            onValueChange={(v) =>
                              setRedirectOpportunityId(
                                !v || v === 'none' ? null : v,
                              )
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="No redirect" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No redirect</SelectItem>
                              {redirectTargets.map((t) => (
                                <SelectItem key={t._id} value={t._id}>
                                  {t.title}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            When set, visitors to this opportunity&apos;s apply
                            page will see the target&apos;s form as an
                            Expression of Interest.
                          </p>
                        </div>
                      )}

                      <div className="space-y-1">
                        <Label>
                          Pre-fill applicants from a previous opportunity
                        </Label>
                        <Select
                          value={sourceOpportunityId ?? 'none'}
                          onValueChange={(v) =>
                            setSourceOpportunityId(
                              !v || v === 'none' ? null : v,
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="No pre-fill source" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">
                              No pre-fill source
                            </SelectItem>
                            {sourceOptions.map((t) => (
                              <SelectItem key={t._id} value={t._id}>
                                {t.title}
                                {t.status !== 'active' ? ` (${t.status})` : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          Applicants who previously applied to the source will
                          have matching answers pre-filled here. They can review
                          and edit before submitting. Only fields with the same
                          key carry over; identity fields (name, email,
                          location, LinkedIn) stay sourced from their ASTN
                          profile.
                        </p>
                      </div>

                      <Button
                        type="submit"
                        disabled={!canSaveDetails || isSavingDetails}
                      >
                        {isSavingDetails ? (
                          <>
                            <Loader2 className="size-4 mr-2 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Save className="size-4 mr-2" />
                            Save Details
                          </>
                        )}
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                {/* Card 2: Application Form Fields */}
                <Card>
                  <CardHeader>
                    <CardTitle>Application Form Fields</CardTitle>
                    <CardDescription>
                      Define the fields applicants will fill out. Leave empty
                      for no in-app form.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormFieldsEditor
                      fields={formFields}
                      onChange={setFormFields}
                    />

                    <Button
                      type="button"
                      onClick={handleSaveFields}
                      disabled={isSavingFields}
                    >
                      {isSavingFields ? (
                        <>
                          <Loader2 className="size-4 mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="size-4 mr-2" />
                          Save Form Fields
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="availability" className="mt-6">
              <AvailabilityTab opportunityId={opportunity._id} slug={slug} />
            </TabsContent>

            <TabsContent value="feedback" className="mt-6">
              <SurveyTab
                opportunityId={opportunity._id}
                slug={slug}
                orgName={org?.name}
                opportunityTitle={opportunity.title}
              />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  )
}

// ─── Availability Tab ───

function AvailabilityTab({
  opportunityId,
  slug,
}: {
  opportunityId: Id<'orgOpportunities'>
  slug: string
}) {
  const poll = useQuery(api.availabilityPolls.getPollByOpportunity, {
    opportunityId,
  })

  const pollResults = useQuery(
    api.availabilityPolls.getPollResults,
    poll ? { pollId: poll._id } : 'skip',
  )

  const respondentLinks = useQuery(
    api.availabilityPolls.getRespondentLinks,
    poll ? { pollId: poll._id } : 'skip',
  )

  const updatePoll = useMutation(api.availabilityPolls.updatePoll)
  const finalizePoll = useMutation(api.availabilityPolls.finalizePoll)
  const deletePollMutation = useMutation(api.availabilityPolls.deletePoll)
  const backfillRespondents = useMutation(
    api.availabilityPolls.backfillRespondents,
  )
  const exportAvailability = useAction(api.availabilityPolls.exportAvailability)

  const [selectedSlot, setSelectedSlot] = useState<{
    day: number
    startMinutes: number
    endMinutes: number
  } | null>(null)
  const [isFinalizingPoll, setIsFinalizingPoll] = useState(false)
  const [isExportingAvailability, setIsExportingAvailability] = useState(false)
  const [sessionHours, setSessionHours] = useState('')
  const [copiedToken, setCopiedToken] = useState<string | null>(null)
  const [allCopied, setAllCopied] = useState(false)

  // Loading state
  if (poll === undefined) {
    return <Spinner className="size-8 mx-auto" />
  }

  // No poll yet — show creation form
  if (!poll) {
    return <PollCreationForm opportunityId={opportunityId} />
  }

  const baseUrl = `${window.location.origin}/org/${slug}/poll/${poll.accessToken}`

  const handleCopyRespondentLink = async (token: string, name: string) => {
    await navigator.clipboard.writeText(`${baseUrl}/${token}`)
    setCopiedToken(token)
    toast.success(`Link copied for ${name}`)
    setTimeout(() => setCopiedToken(null), 2000)
  }

  const handleCopyAllLinks = async () => {
    if (!respondentLinks?.length) return
    const text = respondentLinks
      .map((r) => `${r.respondentName}: ${baseUrl}/${r.respondentToken}`)
      .join('\n')
    await navigator.clipboard.writeText(text)
    setAllCopied(true)
    toast.success('All links copied')
    setTimeout(() => setAllCopied(false), 2000)
  }

  const handleToggleStatus = async () => {
    const newStatus = poll.status === 'open' ? 'closed' : 'open'
    try {
      await updatePoll({ pollId: poll._id, status: newStatus })
      toast.success(`Poll ${newStatus === 'open' ? 'reopened' : 'closed'}`)
    } catch (err) {
      console.error('Failed to update poll:', err)
      toast.error('Failed to update poll')
    }
  }

  const handleFinalize = async () => {
    if (!selectedSlot || isFinalizingPoll) return
    setIsFinalizingPoll(true)
    try {
      await finalizePoll({
        pollId: poll._id,
        finalizedSlot: selectedSlot,
      })
      toast.success('Time slot finalized')
      setSelectedSlot(null)
    } catch (err) {
      console.error('Failed to finalize poll:', err)
      toast.error('Failed to finalize')
    } finally {
      setIsFinalizingPoll(false)
    }
  }

  const handleCellClick = (day: number, startMinutes: number) => {
    if (poll.status === 'finalized') return
    setSelectedSlot({
      day,
      startMinutes,
      endMinutes: startMinutes + poll.slotDurationMinutes,
    })
  }

  const handleDeletePoll = async () => {
    try {
      await deletePollMutation({ pollId: poll._id })
      toast.success('Poll deleted')
    } catch (err) {
      console.error('Failed to delete poll:', err)
      toast.error('Failed to delete poll')
    }
  }

  const handleExportAvailability = async () => {
    setIsExportingAvailability(true)
    try {
      const blockMinutes = sessionHours
        ? parseFloat(sessionHours) * 60
        : undefined
      const csv = await exportAvailability({
        pollId: poll._id,
        blockDurationMinutes: blockMinutes,
      })
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `availability-${poll.title.toLowerCase().replace(/\s+/g, '-')}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Export failed:', err)
      toast.error('Failed to export availability data')
    } finally {
      setIsExportingAvailability(false)
    }
  }

  // Count total applicants for the denominator
  const totalRespondents = pollResults?.responses.length ?? 0

  return (
    <div className="space-y-6">
      {/* Poll info card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{poll.title}</CardTitle>
              <CardDescription>
                {poll.days.map((d) => weekdayShort(d)).join(', ')} ·{' '}
                {poll.timezone.replace(/_/g, ' ')} · {poll.slotDurationMinutes}{' '}
                min slots
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  poll.status === 'open'
                    ? 'bg-green-100 text-green-800'
                    : poll.status === 'closed'
                      ? 'bg-slate-100 text-slate-800'
                      : 'bg-blue-100 text-blue-800'
                }`}
              >
                {poll.status.charAt(0).toUpperCase() + poll.status.slice(1)}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Per-applicant links */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>
                Respondent Links
                {respondentLinks ? ` (${respondentLinks.length})` : ''}
              </Label>
              {respondentLinks && respondentLinks.length > 0 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        const count = await backfillRespondents({
                          pollId: poll._id,
                        })
                        if (count > 0) {
                          toast.success(
                            `Added ${count} new respondent link${count !== 1 ? 's' : ''}`,
                          )
                        } else {
                          toast.info('All applicants already have links')
                        }
                      } catch (err) {
                        console.error('Failed to sync links:', err)
                        toast.error('Failed to sync links')
                      }
                    }}
                  >
                    Sync New Applicants
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopyAllLinks}
                  >
                    {allCopied ? (
                      <>
                        <Check className="size-4 mr-1" />
                        Copied All
                      </>
                    ) : (
                      <>
                        <ClipboardCopy className="size-4 mr-1" />
                        Copy All Links
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
            {respondentLinks === undefined ? (
              <Spinner className="size-4" />
            ) : respondentLinks.length === 0 ? (
              <div className="flex items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  No respondent links yet.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      const count = await backfillRespondents({
                        pollId: poll._id,
                      })
                      toast.success(
                        `Generated ${count} respondent link${count !== 1 ? 's' : ''}`,
                      )
                    } catch (err) {
                      console.error('Failed to generate links:', err)
                      toast.error('Failed to generate links')
                    }
                  }}
                >
                  Generate Links
                </Button>
              </div>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto rounded-md border p-2">
                {respondentLinks.map((r) => (
                  <div
                    key={r.respondentToken}
                    className="flex items-center justify-between gap-2 py-1 px-1 rounded hover:bg-slate-50"
                  >
                    <span className="text-sm truncate">{r.respondentName}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 h-7 px-2"
                      onClick={() =>
                        handleCopyRespondentLink(
                          r.respondentToken,
                          r.respondentName,
                        )
                      }
                    >
                      {copiedToken === r.respondentToken ? (
                        <Check className="size-3.5" />
                      ) : (
                        <ClipboardCopy className="size-3.5" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Poll controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                step="0.5"
                min="0.5"
                placeholder="Session hrs"
                value={sessionHours}
                onChange={(e) => setSessionHours(e.target.value)}
                className="w-28 h-8 text-sm"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportAvailability}
                disabled={isExportingAvailability}
              >
                {isExportingAvailability ? (
                  <Loader2 className="size-4 mr-1 animate-spin" />
                ) : (
                  <Download className="size-4 mr-1" />
                )}
                Export CSV
              </Button>
            </div>
            {poll.status !== 'finalized' && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleToggleStatus}
                >
                  {poll.status === 'open' ? 'Close Poll' : 'Reopen Poll'}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="size-4 mr-1" />
                      Delete Poll
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this poll?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete the poll and all{' '}
                        {totalRespondents} response
                        {totalRespondents !== 1 ? 's' : ''}. This cannot be
                        undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDeletePoll}
                        className="bg-red-600 hover:bg-red-700"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                {selectedSlot && (
                  <Button
                    size="sm"
                    onClick={handleFinalize}
                    disabled={isFinalizingPoll}
                  >
                    {isFinalizingPoll ? (
                      <>
                        <Loader2 className="size-4 mr-1 animate-spin" />
                        Finalizing...
                      </>
                    ) : (
                      <>
                        <Check className="size-4 mr-1" />
                        Finalize Selected Slot
                      </>
                    )}
                  </Button>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Heatmap */}
      {pollResults && (
        <Card>
          <CardHeader>
            <CardTitle>Responses</CardTitle>
          </CardHeader>
          <CardContent>
            <AvailabilityHeatmap
              days={poll.days}
              startMinutes={poll.startMinutes}
              endMinutes={poll.endMinutes}
              slotDurationMinutes={poll.slotDurationMinutes}
              timezone={poll.timezone}
              responses={
                pollResults.responses as unknown as Array<AvailabilityResponse>
              }
              totalRespondents={totalRespondents}
              onCellClick={
                poll.status !== 'finalized' ? handleCellClick : undefined
              }
              selectedSlot={selectedSlot}
              finalizedSlot={poll.finalizedSlot ?? null}
            />
          </CardContent>
        </Card>
      )}

      {/* Schedule Analysis */}
      {pollResults && pollResults.responses.length > 0 && (
        <ScheduleAnalysis
          days={poll.days}
          startMinutes={poll.startMinutes}
          endMinutes={poll.endMinutes}
          slotDurationMinutes={poll.slotDurationMinutes}
          responses={
            pollResults.responses as unknown as Array<AvailabilityResponse>
          }
          totalRespondents={totalRespondents}
          qualityScores={
            respondentLinks
              ? Object.fromEntries(
                  respondentLinks
                    .filter((r) => r.qualityScore !== undefined)
                    .map((r) => [r.respondentName, r.qualityScore!]),
                )
              : undefined
          }
        />
      )}

      {/* Auto-Email Config */}
      <AutoEmailConfigSection opportunityId={opportunityId} />
    </div>
  )
}

// ─── Auto-Email Config Section ───

const TRIGGER_OPTIONS = [
  { value: 'new_application', label: 'New application' },
  { value: 'status:accepted', label: 'Accepted' },
  { value: 'status:under_review', label: 'Under Review' },
  { value: 'status:rejected', label: 'Rejected' },
  { value: 'status:waitlisted', label: 'Waitlisted' },
] as const

type TemplateState = {
  subject: string
  markdownBody: string
  requiresPoll: boolean
}

const emptyTemplate: TemplateState = {
  subject: '',
  markdownBody: '',
  requiresPoll: false,
}

function AutoEmailConfigSection({
  opportunityId,
}: {
  opportunityId: Id<'orgOpportunities'>
}) {
  const config = useQuery(api.autoEmailConfig.getConfig, { opportunityId })
  const logEntries = useQuery(api.autoEmailConfig.getLog, { opportunityId })
  const saveConfig = useMutation(api.autoEmailConfig.saveConfig)

  const [enabled, setEnabled] = useState(false)
  const [templates, setTemplates] = useState<
    Partial<Record<string, TemplateState>>
  >({})
  const [isSaving, setIsSaving] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [initialized, setInitialized] = useState(false)

  // Reset when opportunity changes
  useEffect(() => {
    setInitialized(false)
  }, [opportunityId])

  // Populate form when config loads
  useEffect(() => {
    if (config && !initialized) {
      setEnabled(config.enabled)
      const tplMap: Record<string, TemplateState> = {}
      for (const t of config.templates) {
        tplMap[t.trigger] = {
          subject: t.subject,
          markdownBody: t.markdownBody,
          requiresPoll: t.requiresPoll,
        }
      }
      setTemplates(tplMap)
      setInitialized(true)
    } else if (config === null && !initialized) {
      setInitialized(true)
    }
  }, [config, initialized])

  const updateTemplate = (
    trigger: string,
    field: keyof TemplateState,
    value: string | boolean,
  ) => {
    setTemplates((prev) => ({
      ...prev,
      [trigger]: {
        ...(prev[trigger] ?? emptyTemplate),
        [field]: value,
      },
    }))
  }

  const configuredCount = Object.values(templates).filter((t) =>
    t?.subject.trim(),
  ).length

  const handleSave = async () => {
    setIsSaving(true)
    try {
      // Only include templates with a non-empty subject
      const templatesToSave = TRIGGER_OPTIONS.flatMap((opt) => {
        const tpl = templates[opt.value]
        if (!tpl?.subject.trim()) return []
        return [
          {
            trigger: opt.value,
            subject: tpl.subject,
            markdownBody: tpl.markdownBody,
            requiresPoll: tpl.requiresPoll,
          },
        ]
      })
      await saveConfig({
        opportunityId,
        enabled,
        templates: templatesToSave,
      })
      toast.success('Auto-email config saved')
    } catch (err) {
      console.error('Failed to save auto-email config:', err)
      toast.error('Failed to save config')
    } finally {
      setIsSaving(false)
    }
  }

  if (config === undefined) return null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Mail className="size-5" />
              Auto-Email
            </CardTitle>
            <CardDescription>
              Configure a different email template for each trigger
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-block size-2 rounded-full ${enabled ? 'bg-green-500' : 'bg-slate-300'}`}
            />
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-xs text-muted-foreground">
          Variables: <code>{'{{applicant_name}}'}</code>,{' '}
          <code>{'{{poll_link}}'}</code>
        </p>

        {/* Per-trigger template sections */}
        {TRIGGER_OPTIONS.map((opt) => {
          const tpl = templates[opt.value] ?? emptyTemplate
          const isConfigured = tpl.subject.trim().length > 0
          return (
            <div key={opt.value} className="space-y-2 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block size-2 rounded-full ${isConfigured ? 'bg-green-500' : 'bg-slate-300'}`}
                />
                <span className="text-sm font-medium">{opt.label}</span>
              </div>

              <div className="space-y-1">
                <Label htmlFor={`subject-${opt.value}`}>Subject</Label>
                <Input
                  id={`subject-${opt.value}`}
                  value={tpl.subject}
                  onChange={(e) =>
                    updateTemplate(opt.value, 'subject', e.target.value)
                  }
                  placeholder="Leave empty to skip this trigger"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor={`body-${opt.value}`}>Body (Markdown)</Label>
                <Textarea
                  id={`body-${opt.value}`}
                  value={tpl.markdownBody}
                  onChange={(e) =>
                    updateTemplate(opt.value, 'markdownBody', e.target.value)
                  }
                  rows={4}
                  placeholder="Write your email body in markdown..."
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={tpl.requiresPoll}
                  onCheckedChange={(checked) =>
                    updateTemplate(opt.value, 'requiresPoll', checked === true)
                  }
                />
                <span className="text-xs text-muted-foreground">
                  Only send when an open availability poll exists
                </span>
              </label>
            </div>
          )
        })}

        {/* Save */}
        <Button
          onClick={handleSave}
          disabled={isSaving || configuredCount === 0}
        >
          {isSaving ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="size-4 mr-2" />
              Save Auto-Email Config
              {configuredCount > 0 && (
                <span className="ml-1 text-xs opacity-70">
                  ({configuredCount} trigger
                  {configuredCount !== 1 ? 's' : ''})
                </span>
              )}
            </>
          )}
        </Button>

        {/* Send log */}
        {logEntries && logEntries.length > 0 && (
          <div className="pt-2 border-t">
            <button
              type="button"
              className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setLogOpen(!logOpen)}
            >
              {logOpen ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
              Send Log ({logEntries.length})
            </button>
            {logOpen && (
              <div className="mt-2 space-y-1 max-h-48 overflow-y-auto rounded-md border p-2">
                {logEntries.map((entry) => (
                  <div
                    key={entry._id}
                    className="flex items-center justify-between gap-2 py-1 px-1 text-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`inline-block size-1.5 rounded-full shrink-0 ${
                          entry.status === 'sent'
                            ? 'bg-green-500'
                            : 'bg-red-500'
                        }`}
                      />
                      <span className="truncate">
                        {entry.recipientName} ({entry.recipientEmail})
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground shrink-0">
                      <span className="text-xs">{entry.trigger}</span>
                      <span className="text-xs">
                        {new Date(entry.sentAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
