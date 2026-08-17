import { Link, createFileRoute } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import { ConvexError } from 'convex/values'
import {
  Building2,
  Calendar,
  Check,
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
  Users,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../../../../../convex/_generated/api'
import type { Doc, Id } from '../../../../../../../convex/_generated/dataModel'
import type { FormField } from '../../../../../../../convex/lib/formFields'
import { weekdayShort } from '../../../../../../../convex/lib/availabilityWeek'
import type { AvailabilityResponse } from '~/components/availability/AvailabilityHeatmap'
import { AvailabilityHeatmap } from '~/components/availability/AvailabilityHeatmap'
import { PollCreationForm } from '~/components/availability/PollCreationForm'
import { ScheduleAnalysis } from '~/components/availability/ScheduleAnalysis'
import { FormFieldsEditor } from '~/components/opportunities/FormFieldsEditor'
import { FormTemplateBar } from '~/components/opportunities/FormTemplateBar'
import { TagsInput } from '~/components/opportunities/TagsInput'
import { ApplicationsTable } from '~/components/opportunities/ApplicationsTable'
import { SurveyTab } from '~/components/surveys/SurveyTab'
import { EmailsTab } from '~/components/opportunities/EmailsTab'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Textarea } from '~/components/ui/textarea'

export const Route = createFileRoute('/org/$slug/admin/opportunities/$oppId/')({
  component: OpportunityEditPage,
})

type OpportunityType = 'course' | 'fellowship' | 'job' | 'other'
type OpportunityStatus = 'active' | 'closed' | 'draft'

// Details editor. State is initialized from `opportunity` props AT MOUNT
// (not via a post-mount useEffect). This matters: with the React Compiler on,
// injecting a Radix <Select>'s controlled `value` after mount left the trigger
// stuck showing nothing — e.g. Status rendered blank even though the saved
// status was "closed", which then failed to save. Initializing synchronously
// from props means `value` is correct on the first render. The parent mounts
// this with key={opportunity._id} so it re-inits when navigating opportunities.
function OpportunityDetailsForm({
  opportunity,
  redirectTargets,
  sourceOptions,
  existingTags,
}: {
  opportunity: Doc<'orgOpportunities'>
  redirectTargets: Array<Doc<'orgOpportunities'>>
  sourceOptions: Array<Doc<'orgOpportunities'>>
  existingTags: Array<string>
}) {
  const updateOpp = useMutation(api.orgOpportunities.update)

  const [title, setTitle] = useState(opportunity.title)
  const [description, setDescription] = useState(opportunity.description)
  const [type, setType] = useState<OpportunityType>(opportunity.type)
  const [status, setStatus] = useState<OpportunityStatus>(opportunity.status)
  const [tags, setTags] = useState<Array<string>>(opportunity.tags ?? [])
  const [deadlineStr, setDeadlineStr] = useState(
    opportunity.deadline
      ? new Date(opportunity.deadline).toISOString().split('T')[0]
      : '',
  )
  const [slugValue, setSlugValue] = useState(opportunity.slug ?? '')
  const [externalUrl, setExternalUrl] = useState(opportunity.externalUrl ?? '')
  const [featured, setFeatured] = useState(opportunity.featured)
  const [redirectOpportunityId, setRedirectOpportunityId] = useState<
    string | null
  >(opportunity.redirectOpportunityId ?? null)
  const [sourceOpportunityId, setSourceOpportunityId] = useState<string | null>(
    opportunity.sourceOpportunityId ?? null,
  )
  const [isSavingDetails, setIsSavingDetails] = useState(false)

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
        tags,
        slug: slugValue,
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
      // Show a clear, constant headline; surface the specific reason as a
      // sub-line only when the backend gave us a readable one (ConvexError).
      const reason =
        err instanceof ConvexError && typeof err.data === 'string'
          ? err.data
          : 'Something went wrong. Please check the fields and try again.'
      toast.error("Couldn't save the opportunity", { description: reason })
    } finally {
      setIsSavingDetails(false)
    }
  }

  return (
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
              <SelectItem value="fellowship">Fellowship</SelectItem>
              <SelectItem value="job">Job</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>Status</Label>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as OpportunityStatus)}
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
          <Label htmlFor="opp-deadline">Deadline (optional)</Label>
          <Input
            id="opp-deadline"
            type="date"
            value={deadlineStr}
            onChange={(e) => setDeadlineStr(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="opp-url">External URL (optional)</Label>
          <Input
            id="opp-url"
            value={externalUrl}
            onChange={(e) => setExternalUrl(e.target.value)}
            placeholder="https://..."
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="opp-slug">Application link</Label>
        <div className="flex items-center gap-1 text-sm">
          <span className="text-muted-foreground shrink-0 font-mono text-xs">
            /apply/
          </span>
          <Input
            id="opp-slug"
            value={slugValue}
            onChange={(e) => setSlugValue(e.target.value)}
            placeholder={opportunity._id}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          A readable name for the link you share. Leave it blank to fall back to
          the id. The old id link never stops working, so anything already sent
          out stays valid.
        </p>
      </div>

      <div className="space-y-1">
        <Label>Tags</Label>
        <TagsInput value={tags} onChange={setTags} suggestions={existingTags} />
        <p className="text-xs text-muted-foreground">
          Group related opportunities (e.g. &quot;TAIS Course&quot;, &quot;TAIS
          Projects&quot;). Used to filter the opportunities list.
        </p>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <Checkbox
          checked={featured}
          onCheckedChange={(checked) => setFeatured(checked === true)}
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
              setRedirectOpportunityId(!v || v === 'none' ? null : v)
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
            When set, visitors to this opportunity&apos;s apply page will see
            the target&apos;s form as an Expression of Interest.
          </p>
        </div>
      )}

      <div className="space-y-1">
        <Label>Pre-fill applicants from a previous opportunity</Label>
        <Select
          value={sourceOpportunityId ?? 'none'}
          onValueChange={(v) =>
            setSourceOpportunityId(!v || v === 'none' ? null : v)
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="No pre-fill source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No pre-fill source</SelectItem>
            {sourceOptions.map((t) => (
              <SelectItem key={t._id} value={t._id}>
                {t.title}
                {t.status !== 'active' ? ` (${t.status})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Applicants who previously applied to the source will have matching
          answers pre-filled here. They can review and edit before submitting.
          Only fields with the same key carry over; identity fields (name,
          email, location, LinkedIn) stay sourced from their ASTN profile.
        </p>
      </div>

      <Button type="submit" disabled={!canSaveDetails || isSavingDetails}>
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
  )
}

function OpportunityEditPage() {
  const { slug, oppId } = Route.useParams()

  const org = useQuery(api.orgs.directory.getOrgBySlug, { slug })
  const membership = useQuery(
    api.orgs.membership.getMembership,
    org ? { orgId: org._id } : 'skip',
  )
  // The URL segment is the readable slug or the raw id; both resolve, so old
  // bookmarks and links pasted in Slack keep working.
  const opportunity = useQuery(api.orgOpportunities.getByKey, {
    orgSlug: slug,
    key: oppId,
  })

  // Pending outbox drafts — shown as a count badge on the Emails tab.
  const outboxDrafts = useQuery(
    api.emails.outbox.listForOpportunity,
    opportunity && membership?.role === 'admin'
      ? { opportunityId: opportunity._id }
      : 'skip',
  )

  const updateOpp = useMutation(api.orgOpportunities.update)

  // Redirect target options: active opportunities in this org (excluding current)
  const activeOpportunities = useQuery(
    api.orgOpportunities.listByOrg,
    org ? { orgId: org._id } : 'skip',
  )
  const redirectTargets = (activeOpportunities ?? []).filter(
    (o) => o._id !== opportunity?._id,
  )

  // Source (pre-fill) options: all opportunities in this org (any status),
  // excluding the current one. Usually the source is a closed prior edition.
  // Gated on admin membership — listAllByOrg throws for non-admins.
  const allOpportunities = useQuery(
    api.orgOpportunities.listAllByOrg,
    org && membership?.role === 'admin' ? { orgId: org._id } : 'skip',
  )
  const sourceOptions = (allOpportunities ?? []).filter(
    (o) => o._id !== opportunity?._id,
  )

  // Tags already used anywhere in this org, offered as suggestions in the form.
  const existingTags = Array.from(
    new Set((allOpportunities ?? []).flatMap((o) => o.tags ?? [])),
  ).sort((a, b) => a.localeCompare(b))

  // Form state — form fields
  const [formFields, setFormFields] = useState<Array<FormField>>([])

  const [isSavingFields, setIsSavingFields] = useState(false)
  const [discardWarning, setDiscardWarning] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  const exportCsv = useAction(api.opportunityApplications.exportApplications)

  // Populate form-fields editor when opportunity loads. (Detail fields are
  // owned by OpportunityDetailsForm, which initializes from props at mount —
  // see the note there on why this must not go through a post-mount effect.)
  useEffect(() => {
    if (opportunity) {
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

  // Removing a question people already answered strands their answers, so the
  // backend refuses the first attempt and says how many. We surface that and
  // turn the button into an explicit "save anyway" rather than hiding it behind
  // a dialog nobody reads.
  const handleSaveFields = async (confirmDiscardsAnswers = false) => {
    setIsSavingFields(true)
    try {
      const validFields = formFields.filter((f) => f.label.trim())
      await updateOpp({
        id: opportunity._id,
        formFields: validFields.length > 0 ? validFields : undefined,
        ...(confirmDiscardsAnswers ? { confirmDiscardsAnswers: true } : {}),
      })
      toast.success('Form fields saved')
      setDiscardWarning(null)
    } catch (err) {
      console.error('Failed to save form fields:', err)
      if (err instanceof ConvexError && typeof err.data === 'string') {
        setDiscardWarning(err.data)
        toast.error('Some answers would be lost', { description: err.data })
      } else {
        toast.error('Failed to save form fields')
      }
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
                    const url = `${window.location.origin}/org/${slug}/apply/${opportunity.slug ?? oppId}`
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
              </div>
            </div>
          </div>

          <Tabs defaultValue="details">
            <TabsList>
              <TabsTrigger value="details" className="gap-2">
                <FileText className="size-4" />
                Details
              </TabsTrigger>
              <TabsTrigger value="applications" className="gap-2">
                <Users className="size-4" />
                Applications
              </TabsTrigger>
              <TabsTrigger value="availability" className="gap-2">
                <Calendar className="size-4" />
                Availability
              </TabsTrigger>
              <TabsTrigger value="emails" className="gap-2">
                <Mail className="size-4" />
                Emails
                {(outboxDrafts?.length ?? 0) > 0 && (
                  <span className="ml-1 rounded-full bg-primary/10 text-primary px-1.5 text-xs font-medium">
                    {outboxDrafts?.length}
                  </span>
                )}
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
                    {/* key by _id so the form re-initializes from props when
                        navigating between opportunities */}
                    <OpportunityDetailsForm
                      key={opportunity._id}
                      opportunity={opportunity}
                      redirectTargets={redirectTargets}
                      sourceOptions={sourceOptions}
                      existingTags={existingTags}
                    />
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
                    <FormTemplateBar
                      orgId={opportunity.orgId}
                      kind="application"
                      fields={formFields}
                      onLoad={setFormFields}
                    />

                    <FormFieldsEditor
                      fields={formFields}
                      onChange={setFormFields}
                    />

                    {discardWarning && (
                      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                        {discardWarning}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        onClick={() => void handleSaveFields()}
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

                      {discardWarning && (
                        <Button
                          type="button"
                          variant="outline"
                          className="text-red-600"
                          onClick={() => void handleSaveFields(true)}
                          disabled={isSavingFields}
                        >
                          Save anyway
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="applications" className="mt-6">
              <ApplicationsTable
                opportunityId={opportunity._id}
                opportunityTitle={opportunity.title}
                formFields={(opportunity.formFields ?? []) as Array<FormField>}
              />
            </TabsContent>

            <TabsContent value="availability" className="mt-6">
              <AvailabilityTab opportunityId={opportunity._id} slug={slug} />
            </TabsContent>

            <TabsContent value="emails" className="mt-6">
              <EmailsTab opportunity={opportunity} slug={slug} />
            </TabsContent>

            <TabsContent value="feedback" className="mt-6">
              <SurveyTab
                opportunityId={opportunity._id}
                orgId={opportunity.orgId}
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
      {/* Applicant emails (incl. the on-apply confirmation with this poll's
          link) live in the Emails tab (issue #20). */}
      <Card className="border-blue-200 bg-blue-50/50">
        <CardContent className="py-3">
          <p className="text-sm text-blue-900">
            Applicant emails for this opportunity are managed in the{' '}
            <span className="font-medium">Emails</span> tab (including the
            on-apply confirmation with this poll&apos;s link).
          </p>
        </CardContent>
      </Card>

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
        />
      )}
    </div>
  )
}
