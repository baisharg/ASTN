import { useMutation, useQuery } from 'convex/react'
import {
  CheckCircle2,
  ClipboardCopy,
  Edit3,
  Eye,
  Loader2,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  Rocket,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { FormField } from '../../../convex/lib/formFields'
import { FormFieldsEditor } from '~/components/opportunities/FormFieldsEditor'
import { FormTemplateBar } from '~/components/opportunities/FormTemplateBar'
import { SurveyPreview } from '~/components/surveys/SurveyPreview'
import { SurveyResultsTable } from '~/components/surveys/SurveyResultsTable'
import { AnonymousSurveyResults } from '~/components/surveys/AnonymousSurveyResults'
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
import { Textarea } from '~/components/ui/textarea'

const ALL_STATUSES = [
  { value: 'submitted', label: 'Submitted' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'waitlisted', label: 'Waitlisted' },
  { value: 'participated', label: 'Participated' },
] as const

interface SurveyTabProps {
  opportunityId: Id<'orgOpportunities'>
  orgId: Id<'organizations'>
  slug: string
  /** Passed to the respondent-faithful preview header. */
  orgName?: string
  opportunityTitle?: string
}

export function SurveyTab({
  opportunityId,
  orgId,
  slug,
  orgName,
  opportunityTitle,
}: SurveyTabProps) {
  const survey = useQuery(api.feedbackSurveys.getSurveyByOpportunity, {
    opportunityId,
  })

  if (survey === undefined) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        Loading survey...
      </div>
    )
  }

  if (!survey) {
    return (
      <CreateSurveyForm
        opportunityId={opportunityId}
        orgId={orgId}
        orgName={orgName}
        opportunityTitle={opportunityTitle}
      />
    )
  }

  return (
    <SurveyManagement
      surveyId={survey._id}
      orgId={orgId}
      slug={slug}
      accessToken={survey.accessToken}
      orgName={orgName}
      opportunityTitle={opportunityTitle}
    />
  )
}

function CreateSurveyForm({
  opportunityId,
  orgId,
  orgName,
  opportunityTitle,
}: {
  opportunityId: Id<'orgOpportunities'>
  orgId: Id<'organizations'>
  orgName?: string
  opportunityTitle?: string
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [formFields, setFormFields] = useState<Array<FormField>>([])
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(
    new Set(['accepted']),
  )
  const [anonymous, setAnonymous] = useState(false)
  const [isCreating, setIsCreating] = useState(false)

  const createSurvey = useMutation(api.feedbackSurveys.createSurvey)

  const toggleStatus = (status: string) => {
    setSelectedStatuses((prev) => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  const handleCreate = async () => {
    if (!title.trim()) {
      toast.error('Title is required')
      return
    }
    const validFields = formFields.filter((f) => f.label.trim())
    if (validFields.length === 0) {
      toast.error('Add at least one form field')
      return
    }
    // An anonymous survey has no recipient list, so the status filter is moot.
    if (!anonymous && selectedStatuses.size === 0) {
      toast.error('Select at least one applicant status')
      return
    }
    setIsCreating(true)
    try {
      await createSurvey({
        opportunityId,
        title: title.trim(),
        description: description.trim() || undefined,
        formFields: validFields,
        applicantStatuses: anonymous ? [] : Array.from(selectedStatuses),
        anonymous: anonymous || undefined,
      })
      toast.success('Survey created as draft — review and publish when ready')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create survey'
      toast.error(msg)
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create Feedback Survey</CardTitle>
          <CardDescription>
            The survey will be created as a draft. You can review and edit
            everything before publishing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="survey-title">
              Title <span className="text-red-500">*</span>
            </Label>
            <Input
              id="survey-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Course Feedback Survey"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="survey-desc">Description (optional)</Label>
            <Textarea
              id="survey-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Intro text shown to respondents before the form"
            />
          </div>
          <div className="space-y-2 rounded-md border border-input p-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox
                checked={anonymous}
                onCheckedChange={(c) => setAnonymous(c === true)}
                className="mt-0.5"
              />
              <span className="text-sm font-medium">Anonymous survey</span>
            </label>
            <p className="text-xs text-muted-foreground">
              One shared link instead of a personal link per applicant.
              Responses are saved with no record of who sent them, so results
              show how many arrived, not who answered. Cannot be changed after
              the survey is created.
            </p>
          </div>

          {!anonymous && (
            <div className="space-y-2">
              <Label>Include applicants with status</Label>
              <div className="flex flex-wrap gap-4">
                {ALL_STATUSES.map((s) => (
                  <label
                    key={s.value}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedStatuses.has(s.value)}
                      onCheckedChange={() => toggleStatus(s.value)}
                    />
                    <span className="text-sm">{s.label}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                These applicants get a personal survey link. Nothing is sent
                now — the link goes out when you email them with the survey
                link enabled.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Survey Questions</CardTitle>
          <CardDescription>
            Build the form fields for your survey. Supports text, ratings, NPS,
            and more.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormTemplateBar
            orgId={orgId}
            kind="feedback"
            fields={formFields}
            onLoad={setFormFields}
          />
          <FormFieldsEditor fields={formFields} onChange={setFormFields} />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <SurveyPreview
          title={title}
          description={description}
          orgName={orgName}
          opportunityTitle={opportunityTitle}
          formFields={formFields}
        >
          <Button variant="outline" size="lg">
            <Eye className="size-4 mr-2" />
            Preview
          </Button>
        </SurveyPreview>
        <Button onClick={handleCreate} disabled={isCreating} size="lg">
          {isCreating ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <Plus className="size-4 mr-2" />
              Create Draft Survey
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

function SurveyManagement({
  surveyId,
  orgId,
  slug,
  accessToken,
  orgName,
  opportunityTitle,
}: {
  surveyId: Id<'feedbackSurveys'>
  orgId: Id<'organizations'>
  slug: string
  accessToken: string
  orgName?: string
  opportunityTitle?: string
}) {
  const results = useQuery(api.feedbackSurveys.getSurveyResults, { surveyId })
  // Storage ids are meaningless on screen, so resolve the ones this survey
  // actually collected into urls the results view can render.
  const imageUrlList = useQuery(api.feedbackSurveys.getFormImageUrls, {
    surveyId,
  })
  const imageUrls = Object.fromEntries(
    (imageUrlList ?? []).map((i) => [i.storageId, i.url]),
  )
  const updateSurvey = useMutation(api.feedbackSurveys.updateSurvey)
  const deleteSurvey = useMutation(api.feedbackSurveys.deleteSurvey)
  const backfill = useMutation(api.feedbackSurveys.backfillRespondents)
  const removeRespondent = useMutation(api.feedbackSurveys.removeRespondent)

  const [isPublishing, setIsPublishing] = useState(false)
  const [isToggling, setIsToggling] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isBackfilling, setIsBackfilling] = useState(false)

  // Draft editing state — initialized lazily on edit-click, not synced from query
  const [isEditingMeta, setIsEditingMeta] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [isSavingMeta, setIsSavingMeta] = useState(false)

  const [isEditingFields, setIsEditingFields] = useState(false)
  const [editFormFields, setEditFormFields] = useState<Array<FormField>>([])
  const [isSavingFields, setIsSavingFields] = useState(false)

  if (!results) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        Loading results...
      </div>
    )
  }

  const {
    survey,
    respondents,
    anonymousResponses,
    responseCount,
    totalRespondents,
  } = results
  const isDraft = survey.status === 'draft'
  const isOpen = survey.status === 'open'
  const isAnonymous = survey.anonymous === true
  const genericLink = `${window.location.origin}/org/${slug}/survey/${accessToken}`

  const handlePublish = async () => {
    setIsPublishing(true)
    try {
      await updateSurvey({ surveyId, status: 'open' })
      toast.success('Survey published! Respondents can now fill it in.')
    } catch {
      toast.error('Failed to publish survey')
    } finally {
      setIsPublishing(false)
    }
  }

  const handleToggleStatus = async () => {
    setIsToggling(true)
    try {
      await updateSurvey({
        surveyId,
        status: isOpen ? 'closed' : 'open',
      })
      toast.success(isOpen ? 'Survey closed' : 'Survey reopened')
    } catch {
      toast.error('Failed to update survey status')
    } finally {
      setIsToggling(false)
    }
  }

  const handleSaveMeta = async () => {
    setIsSavingMeta(true)
    try {
      await updateSurvey({
        surveyId,
        title: editTitle.trim(),
        description: editDescription.trim() || undefined,
      })
      toast.success('Survey details updated')
      setIsEditingMeta(false)
    } catch {
      toast.error('Failed to save')
    } finally {
      setIsSavingMeta(false)
    }
  }

  const handleSaveFields = async () => {
    const validFields = editFormFields.filter((f) => f.label.trim())
    if (validFields.length === 0) {
      toast.error('Add at least one form field')
      return
    }
    setIsSavingFields(true)
    try {
      await updateSurvey({ surveyId, formFields: validFields })
      toast.success('Questions updated')
      setIsEditingFields(false)
    } catch {
      toast.error('Failed to save questions')
    } finally {
      setIsSavingFields(false)
    }
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      await deleteSurvey({ surveyId })
      toast.success('Survey deleted')
    } catch {
      toast.error('Failed to delete survey')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleBackfill = async () => {
    setIsBackfilling(true)
    try {
      const added = await backfill({ surveyId })
      if (added > 0) {
        toast.success(`Added ${added} new respondent${added !== 1 ? 's' : ''}`)
      } else {
        toast.info('No new applicants to add')
      }
    } catch {
      toast.error('Failed to backfill respondents')
    } finally {
      setIsBackfilling(false)
    }
  }

  const handleRemoveRespondent = async (
    respondentId: Id<'surveyRespondents'>,
    name: string,
  ) => {
    try {
      await removeRespondent({ surveyId, respondentId })
      toast.success(`Removed ${name}`)
    } catch {
      toast.error('Failed to remove respondent')
    }
  }

  const copyLink = () => {
    void navigator.clipboard.writeText(genericLink)
    toast.success('Link copied')
  }

  return (
    <div className="space-y-6">
      {/* Draft banner */}
      {isDraft && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-amber-900">
                This survey is a draft
              </p>
              <p className="text-sm text-amber-700 mt-1">
                Review the title, description, questions, and respondent list
                below. When ready, publish to allow respondents to fill it in.
              </p>
            </div>
            <Button
              onClick={handlePublish}
              disabled={isPublishing}
              className="bg-amber-600 hover:bg-amber-700 shrink-0"
            >
              {isPublishing ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Rocket className="size-4 mr-2" />
              )}
              Publish Survey
            </Button>
          </div>
        </div>
      )}

      {/* Status card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              {isEditingMeta ? (
                <div className="space-y-3">
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="Survey title"
                  />
                  <Textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={2}
                    placeholder="Description (optional)"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleSaveMeta}
                      disabled={isSavingMeta}
                    >
                      {isSavingMeta ? (
                        <Loader2 className="size-4 mr-1 animate-spin" />
                      ) : (
                        <Save className="size-4 mr-1" />
                      )}
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setIsEditingMeta(false)
                        setEditTitle(survey.title)
                        setEditDescription(survey.description ?? '')
                      }}
                    >
                      <X className="size-4 mr-1" />
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <div>
                    <CardTitle>{survey.title}</CardTitle>
                    {survey.description && (
                      <CardDescription className="mt-1 whitespace-pre-line">
                        {survey.description}
                      </CardDescription>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 h-7 w-7 p-0"
                    onClick={() => {
                      setEditTitle(survey.title)
                      setEditDescription(survey.description ?? '')
                      setIsEditingMeta(true)
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                </div>
              )}
            </div>
            <Badge
              variant={isDraft ? 'outline' : isOpen ? 'default' : 'secondary'}
              className={isDraft ? 'border-amber-400 text-amber-700' : ''}
            >
              {isDraft ? 'Draft' : isOpen ? 'Open' : 'Closed'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mb-4">
            {isAnonymous ? (
              <span>
                <strong className="text-foreground">{responseCount}</strong>{' '}
                anonymous response{responseCount !== 1 ? 's' : ''}
              </span>
            ) : (
              <span>
                <strong className="text-foreground">{responseCount}</strong> of{' '}
                {totalRespondents} responded
              </span>
            )}
            <span>
              Created {new Date(survey.createdAt).toLocaleDateString()}
            </span>
          </div>

          {isAnonymous && (
            <p className="text-xs text-muted-foreground mb-4">
              Responses are saved with no record of who sent them. The count is
              responses received, not people — the shared link can be used more
              than once.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {!isDraft && (
              <SurveyPreview
                title={survey.title}
                description={survey.description}
                orgName={orgName}
                opportunityTitle={opportunityTitle}
                formFields={survey.formFields as Array<FormField>}
              />
            )}

            {!isDraft && (
              <Button variant="outline" size="sm" onClick={copyLink}>
                <ClipboardCopy className="size-4 mr-1" />
                Copy Link
              </Button>
            )}

            {!isDraft && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleToggleStatus}
                disabled={isToggling}
              >
                {isToggling ? (
                  <Loader2 className="size-4 mr-1 animate-spin" />
                ) : isOpen ? (
                  <Lock className="size-4 mr-1" />
                ) : (
                  <LockOpen className="size-4 mr-1" />
                )}
                {isOpen ? 'Close Survey' : 'Reopen Survey'}
              </Button>
            )}

            {/* No roster to add anyone to on an anonymous survey. */}
            {!isAnonymous && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleBackfill}
                disabled={isBackfilling}
              >
                {isBackfilling ? (
                  <Loader2 className="size-4 mr-1 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4 mr-1" />
                )}
                Add New Applicants
              </Button>
            )}

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-red-600">
                  <Trash2 className="size-4 mr-1" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete survey?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the survey and all{' '}
                    {responseCount} response{responseCount !== 1 ? 's' : ''}.
                    This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    {isDeleting ? 'Deleting...' : 'Delete'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      {/* Editable questions (draft only) */}
      {isDraft && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Survey Questions</CardTitle>
              <div className="flex gap-2">
                <SurveyPreview
                  title={survey.title}
                  description={survey.description}
                  orgName={orgName}
                  opportunityTitle={opportunityTitle}
                  formFields={
                    isEditingFields
                      ? editFormFields
                      : (survey.formFields as Array<FormField>)
                  }
                />
                {!isEditingFields && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditFormFields(survey.formFields as Array<FormField>)
                      setIsEditingFields(true)
                    }}
                  >
                    <Edit3 className="size-4 mr-1" />
                    Edit Questions
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isEditingFields ? (
              <div className="space-y-4">
                <FormTemplateBar
                  orgId={orgId}
                  kind="feedback"
                  fields={editFormFields}
                  onLoad={setEditFormFields}
                />
                <FormFieldsEditor
                  fields={editFormFields}
                  onChange={setEditFormFields}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleSaveFields}
                    disabled={isSavingFields}
                  >
                    {isSavingFields ? (
                      <Loader2 className="size-4 mr-1 animate-spin" />
                    ) : (
                      <Save className="size-4 mr-1" />
                    )}
                    Save Questions
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setIsEditingFields(false)
                      setEditFormFields(survey.formFields as Array<FormField>)
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                {(survey.formFields as Array<FormField>).map((f, i) => (
                  <div key={f.key || i} className="text-sm flex gap-2">
                    <span className="text-muted-foreground">{i + 1}.</span>
                    <span>{f.label}</span>
                    <span className="text-muted-foreground">({f.kind})</span>
                    {f.required && (
                      <span className="text-red-500 text-xs">required</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isAnonymous ? (
        <AnonymousSurveyResults
          formFields={survey.formFields}
          responses={anonymousResponses}
          surveyTitle={survey.title}
          imageUrls={imageUrls}
        />
      ) : (
        /* Results table with remove buttons */
        <SurveyResultsTable
          formFields={survey.formFields}
          respondents={respondents}
          surveyTitle={survey.title}
          onRemoveRespondent={
            isDraft || isOpen ? handleRemoveRespondent : undefined
          }
          imageUrls={imageUrls}
        />
      )}
    </div>
  )
}
