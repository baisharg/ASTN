import { Link, createFileRoute } from '@tanstack/react-router'
import { useAction, useQuery } from 'convex/react'
import DOMPurify from 'dompurify'
import {
  Building2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Mail,
  Send,
  Shield,
} from 'lucide-react'
import { marked } from 'marked'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../../../../../convex/_generated/api'
import type { Id } from '../../../../../../../convex/_generated/dataModel'
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
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Checkbox } from '~/components/ui/checkbox'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Spinner } from '~/components/ui/spinner'
import { Textarea } from '~/components/ui/textarea'

export const Route = createFileRoute(
  '/org/$slug/admin/opportunities/$oppId/email',
)({
  component: EmailComposePage,
})

type ApplicationStatus =
  | 'submitted'
  | 'under_review'
  | 'accepted'
  | 'rejected'
  | 'waitlisted'

const ALL_STATUSES: Array<{
  value: ApplicationStatus
  label: string
}> = [
  { value: 'submitted', label: 'Submitted' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'waitlisted', label: 'Waitlisted' },
]

/** Extract applicant name from form responses (mirrors backend logic in convex/lib/applicantName.ts) */
function extractNameFromResponses(responses: unknown): string | null {
  if (!responses || typeof responses !== 'object' || Array.isArray(responses))
    return null
  const normalize = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '')
  const byKey = new Map(
    Object.entries(responses as Record<string, unknown>).map(([k, v]) => [
      normalize(k),
      v,
    ]),
  )
  const toName = (v: unknown): string | null => {
    if (typeof v !== 'string') return null
    const t = v.replace(/\s+/g, ' ').trim()
    if (!t || t.length > 120 || t.split(' ').length > 8) return null
    return t
  }
  const find = (keys: Array<string>) => {
    for (const k of keys) {
      const v = toName(byKey.get(k))
      if (v) return v
    }
    return null
  }
  const first = find([
    'firstname',
    'givenname',
    'forename',
    'nombre',
    'nombres',
  ])
  const last = find([
    'lastname',
    'familyname',
    'surname',
    'apellido',
    'apellidos',
  ])
  if (first || last) return [first, last].filter(Boolean).join(' ')
  return find([
    'fullname',
    'name',
    'applicantname',
    'candidatename',
    'displayname',
    'respondentname',
    'nombre',
  ])
}

/**
 * Render a recognized template variable as a highlighted example link, so the
 * admin can visually confirm the variable was understood (a literal
 * `{{survey_link}}` left in the preview means it was NOT recognized).
 */
function exampleLinkPill(url: string): string {
  return `<a href="${url}" class="inline rounded bg-emerald-100 px-1 py-0.5 font-mono text-[0.85em] font-medium text-emerald-700 no-underline break-all">${url}</a>`
}

/** Replace recognized `{{poll_link}}`/`{{survey_link}}` with highlighted example links. */
function substituteExampleLinks(
  markdown: string,
  pollExampleLink: string | null,
  surveyExampleLink: string | null,
): string {
  let out = markdown
  if (pollExampleLink) {
    out = out.replaceAll('{{poll_link}}', exampleLinkPill(pollExampleLink))
  }
  if (surveyExampleLink) {
    out = out.replaceAll('{{survey_link}}', exampleLinkPill(surveyExampleLink))
  }
  return out
}

function RecipientList({
  recipients,
  maxHeight = 'max-h-48',
}: {
  recipients: Array<{ id: string; name: string; email: string }>
  maxHeight?: string
}) {
  if (recipients.length === 0) return null
  return (
    <div
      className={`${maxHeight} overflow-y-auto rounded-md border divide-y text-sm`}
    >
      {recipients.map((r) => (
        <div
          key={r.id}
          className="px-3 py-1.5 flex items-center justify-between gap-2"
        >
          <span className="font-medium truncate">{r.name}</span>
          {r.email && (
            <span className="text-muted-foreground text-xs shrink-0">
              {r.email}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

function EmailComposePage() {
  const { slug, oppId } = Route.useParams()

  const org = useQuery(api.orgs.directory.getOrgBySlug, { slug })
  const membership = useQuery(
    api.orgs.membership.getMembership,
    org ? { orgId: org._id } : 'skip',
  )
  const opportunity = useQuery(api.orgOpportunities.get, {
    id: oppId as Id<'orgOpportunities'>,
  })
  // Fetch all applications (no status filter) for client-side filtering
  const allApplications = useQuery(
    api.opportunityApplications.listByOpportunity,
    opportunity ? { opportunityId: opportunity._id } : 'skip',
  )
  // Check for active poll (for {{poll_link}} support)
  const activePoll = useQuery(
    api.availabilityPolls.getPollByOpportunity,
    opportunity ? { opportunityId: opportunity._id } : 'skip',
  )
  // Check for active survey (for {{survey_link}} support)
  const activeSurvey = useQuery(
    api.feedbackSurveys.getSurveyByOpportunity,
    opportunity ? { opportunityId: opportunity._id } : 'skip',
  )
  // Current admin's profile — used to prefill the test-email address
  const myProfile = useQuery(api.profiles.getOrCreateProfile, {})

  const [selectedStatuses, setSelectedStatuses] = useState<
    Set<ApplicationStatus>
  >(new Set(ALL_STATUSES.map((s) => s.value)))
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [hasSent, setHasSent] = useState(false)
  const [showRecipientList, setShowRecipientList] = useState(true)
  const [testEmail, setTestEmail] = useState('')
  const [testEmailTouched, setTestEmailTouched] = useState(false)
  const [isSendingTest, setIsSendingTest] = useState(false)

  // Prefill the test-email field with the admin's own email once it loads,
  // unless they've already edited it.
  useEffect(() => {
    if (!testEmailTouched && myProfile?.email) setTestEmail(myProfile.email)
  }, [myProfile, testEmailTouched])

  const sendBroadcast = useAction(
    api.emails.adminBroadcastAction.sendBroadcastToApplicants,
  )
  const sendTest = useAction(api.emails.adminBroadcastAction.sendTestEmail)

  // Illustrative example links shown in the preview / test email. Only built
  // when the poll/survey is actually live, so an unrecognized variable stays
  // visible as literal `{{...}}` text.
  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://safetytalent.org'
  const pollExampleLink =
    activePoll && activePoll.status !== 'finalized'
      ? `${origin}/org/${slug}/poll/example`
      : null
  const surveyExampleLink =
    activeSurvey && activeSurvey.status === 'open'
      ? `${origin}/org/${slug}/survey/example`
      : null

  const filteredRecipients = useMemo(() => {
    if (!allApplications) return []
    const seen = new Set<string>()
    const recipients: Array<{
      id: string
      name: string
      email: string
    }> = []
    for (const app of allApplications) {
      if (!selectedStatuses.has(app.status as ApplicationStatus)) continue
      const key = app.guestEmail ?? app.userId ?? app._id
      if (seen.has(key)) continue
      seen.add(key)
      const name =
        extractNameFromResponses(app.responses) ??
        app.guestEmail ??
        'Unknown applicant'
      recipients.push({
        id: app._id,
        name,
        email: app.guestEmail ?? '',
      })
    }
    return recipients
  }, [allApplications, selectedStatuses])

  const recipientCount = filteredRecipients.length

  const previewHtml = useMemo(() => {
    if (!body.trim()) return ''
    const withLinks = substituteExampleLinks(
      body,
      pollExampleLink,
      surveyExampleLink,
    )
    return DOMPurify.sanitize(
      marked.parse(withLinks, { async: false, breaks: true, gfm: true }),
    )
  }, [body, pollExampleLink, surveyExampleLink])

  const toggleStatus = (status: ApplicationStatus) => {
    setSelectedStatuses((prev) => {
      const next = new Set(prev)
      if (next.has(status)) {
        next.delete(status)
      } else {
        next.add(status)
      }
      return next
    })
  }

  const handleSend = async () => {
    if (!opportunity || isSending || hasSent) return
    setIsSending(true)
    try {
      const result = await sendBroadcast({
        opportunityId: opportunity._id,
        statuses: Array.from(selectedStatuses),
        subject: subject.trim(),
        markdownBody: body,
        pollId: activePoll?._id,
        pollLinkBase: activePoll
          ? `${window.location.origin}/org/${slug}/poll/${activePoll.accessToken}`
          : undefined,
        surveyId: activeSurvey?._id,
        surveyLinkBase: activeSurvey
          ? `${window.location.origin}/org/${slug}/survey/${activeSurvey.accessToken}`
          : undefined,
      })
      if (result.failed === 0) {
        toast.success(
          `Email sent to ${result.sent} recipient${result.sent !== 1 ? 's' : ''}`,
        )
      } else {
        toast.warning(
          `Sent to ${result.sent}, failed for ${result.failed} recipient${result.failed !== 1 ? 's' : ''}`,
        )
      }
      setHasSent(true)
    } catch (err) {
      console.error('Broadcast send failed:', err)
      toast.error('Failed to send emails')
    } finally {
      setIsSending(false)
    }
  }

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail.trim())
  const canSendTest = Boolean(body.trim()) && isValidEmail && !isSendingTest

  const handleSendTest = async () => {
    if (!opportunity || !canSendTest) return
    setIsSendingTest(true)
    try {
      await sendTest({
        opportunityId: opportunity._id,
        subject: subject.trim(),
        markdownBody: body,
        toEmail: testEmail.trim(),
        pollExampleLink: pollExampleLink ?? undefined,
        surveyExampleLink: surveyExampleLink ?? undefined,
      })
      toast.success(`Test email sent to ${testEmail.trim()}`)
    } catch (err) {
      console.error('Test email send failed:', err)
      toast.error('Failed to send test email')
    } finally {
      setIsSendingTest(false)
    }
  }

  if (
    org === undefined ||
    membership === undefined ||
    opportunity === undefined
  ) {
    return (
      <div className="min-h-screen bg-slate-50">
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-4xl mx-auto">
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
            <Mail className="size-8 text-slate-400 mx-auto mb-4" />
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

  const canSend =
    subject.trim() &&
    body.trim() &&
    selectedStatuses.size > 0 &&
    recipientCount > 0 &&
    !hasSent

  return (
    <div className="min-h-screen bg-slate-50">
      <AuthHeader />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
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
            <Link
              to="/org/$slug/admin/opportunities"
              params={{ slug }}
              className="hover:text-slate-700 transition-colors"
            >
              Opportunities
            </Link>
            <span>/</span>
            <Link
              to="/org/$slug/admin/opportunities/$oppId"
              params={{ slug, oppId }}
              className="hover:text-slate-700 transition-colors"
            >
              {opportunity.title}
            </Link>
            <span>/</span>
            <span className="text-slate-700">Email</span>
          </div>

          <h1 className="text-2xl font-display font-semibold text-foreground mb-6">
            Email Applicants
          </h1>

          {/* Status filter */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">Recipients</CardTitle>
            </CardHeader>
            <CardContent>
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
              {allApplications === undefined ? (
                <p className="text-sm text-muted-foreground mt-3">
                  Loading recipients...
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setShowRecipientList((v) => !v)}
                    className="flex items-center gap-1 text-sm text-muted-foreground mt-3 hover:text-foreground transition-colors"
                  >
                    {recipientCount} recipient
                    {recipientCount !== 1 ? 's' : ''} selected
                    {recipientCount > 0 &&
                      (showRecipientList ? (
                        <ChevronUp className="size-3.5" />
                      ) : (
                        <ChevronDown className="size-3.5" />
                      ))}
                  </button>
                  {showRecipientList && (
                    <div className="mt-2">
                      <RecipientList recipients={filteredRecipients} />
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Compose + Preview */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Compose */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Compose</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="email-subject">Subject</Label>
                  <Input
                    id="email-subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="e.g. Welcome to the AI Safety Course"
                    disabled={hasSent}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="email-body">Body (Markdown)</Label>
                  <Textarea
                    id="email-body"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={12}
                    placeholder="Write your message here... Markdown is supported."
                    disabled={hasSent}
                  />
                  {activePoll && activePoll.status !== 'finalized' && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Use{' '}
                      <code className="bg-slate-100 px-1 rounded text-[11px]">
                        {'{{poll_link}}'}
                      </code>{' '}
                      to include each applicant&apos;s unique availability poll
                      link.
                    </p>
                  )}
                  {activeSurvey && activeSurvey.status === 'open' && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Use{' '}
                      <code className="bg-slate-100 px-1 rounded text-[11px]">
                        {'{{survey_link}}'}
                      </code>{' '}
                      to include each applicant&apos;s unique feedback survey
                      link.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Preview */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Preview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-gray-100 rounded-lg p-4">
                  <div className="bg-white rounded-lg p-6 max-w-xl mx-auto shadow-sm">
                    {/* Logo */}
                    <div className="text-center mb-4">
                      <img
                        src="/logo.png"
                        alt="ASTN"
                        className="h-10 mx-auto"
                      />
                    </div>
                    {/* Greeting */}
                    <p className="text-lg font-semibold text-gray-900 mb-2">
                      Hi Jane,
                    </p>
                    {previewHtml ? (
                      <div
                        className="max-w-none text-gray-700 [&_p]:my-3 break-words"
                        dangerouslySetInnerHTML={{ __html: previewHtml }}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground italic">
                        Start typing to see a preview...
                      </p>
                    )}
                    {/* Footer */}
                    <hr className="my-4 border-gray-200" />
                    <p className="text-xs text-gray-400 text-center">
                      AI Safety Talent Network
                    </p>
                    <p className="text-xs text-gray-400 text-center">
                      safetytalent.org
                    </p>
                  </div>
                </div>
                {(pollExampleLink || surveyExampleLink) && (
                  <p className="text-xs text-muted-foreground mt-3">
                    Recognized variables show as a{' '}
                    <span className="rounded bg-emerald-100 px-1 py-0.5 font-mono text-[11px] font-medium text-emerald-700">
                      green example link
                    </span>
                    . If a variable still appears as plain{' '}
                    <code className="bg-slate-100 px-1 rounded text-[11px]">
                      {'{{…}}'}
                    </code>{' '}
                    text, it wasn&apos;t recognized — check the spelling. Each
                    applicant gets their own unique link when sent.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Test email */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-base">Send a test email</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">
                Send yourself a copy to see exactly how it looks in an inbox.
                Variables use example links and the subject is prefixed with{' '}
                <code className="bg-slate-100 px-1 rounded text-[11px]">
                  [TEST]
                </code>
                .
              </p>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                <div className="flex-1 space-y-1">
                  <Label htmlFor="test-email">Your email</Label>
                  <Input
                    id="test-email"
                    type="email"
                    value={testEmail}
                    onChange={(e) => {
                      setTestEmail(e.target.value)
                      setTestEmailTouched(true)
                    }}
                    placeholder="you@example.com"
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={handleSendTest}
                  disabled={!canSendTest}
                >
                  {isSendingTest ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="size-4 mr-2" />
                      Send test email
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Send */}
          <div className="mt-6 flex justify-end">
            {hasSent ? (
              <Button disabled>
                <Mail className="size-4 mr-2" />
                Sent
              </Button>
            ) : (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={!canSend || isSending}>
                    {isSending ? (
                      <>
                        <Loader2 className="size-4 mr-2 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Mail className="size-4 mr-2" />
                        Send to {recipientCount} applicant
                        {recipientCount !== 1 ? 's' : ''}
                      </>
                    )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Send email?</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-3">
                        <p>
                          This will send &quot;{subject}&quot; to{' '}
                          {recipientCount} applicant
                          {recipientCount !== 1 ? 's' : ''}. This action cannot
                          be undone.
                        </p>
                        <RecipientList
                          recipients={filteredRecipients}
                          maxHeight="max-h-40"
                        />
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleSend}>
                      Send
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
