import { Link, createFileRoute } from '@tanstack/react-router'
import { useAction, useQuery } from 'convex/react'
import DOMPurify from 'dompurify'
import {
  Building2,
  Check,
  Loader2,
  Mail,
  Minus,
  Send,
  Shield,
} from 'lucide-react'
import { marked } from 'marked'
import { emojify } from 'node-emoji'
import { Checkbox as CheckboxPrimitive } from 'radix-ui'
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
import { cn } from '~/lib/utils'

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
  | 'participated'

const ALL_STATUSES: Array<{
  value: ApplicationStatus
  label: string
}> = [
  { value: 'submitted', label: 'Submitted' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'waitlisted', label: 'Waitlisted' },
  { value: 'participated', label: 'Participated' },
]

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

type Recipient = {
  id: Id<'opportunityApplications'>
  name: string
  email: string
  status: ApplicationStatus
}

/** Tri-state checkbox for category headers (checked / indeterminate / unchecked). */
function GroupCheckbox({
  state,
  onToggle,
  disabled,
}: {
  state: boolean | 'indeterminate'
  onToggle: () => void
  disabled?: boolean
}) {
  return (
    <CheckboxPrimitive.Root
      checked={state}
      onCheckedChange={onToggle}
      disabled={disabled}
      className={cn(
        'peer border-input size-4 shrink-0 rounded-[4px] border shadow-xs outline-none transition-shadow',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary',
        'data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:border-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      <CheckboxPrimitive.Indicator className="grid place-content-center text-current">
        {state === 'indeterminate' ? (
          <Minus className="size-3.5" />
        ) : (
          <Check className="size-3.5" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
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
          {r.email ? (
            <span className="text-muted-foreground text-xs shrink-0">
              {r.email}
            </span>
          ) : (
            <span className="text-amber-600 text-xs shrink-0 font-medium">
              No email on file
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
  // Applicants with their resolved name + email (same 3-tier resolution as the
  // real send), for client-side status filtering.
  const recipientContacts = useQuery(
    api.opportunityApplications.listRecipientsByOpportunity,
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

  // Source of truth = the set of individually selected applications. Category
  // checkboxes are derived from this set and select/deselect their members.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [hasSent, setHasSent] = useState(false)
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

  // All applicants (every status), deduped by email — matching the real send's
  // dedupe; applicants with no email are kept individually so each stays visible.
  const allRecipients = useMemo<Array<Recipient>>(() => {
    if (!recipientContacts) return []
    const seen = new Set<string>()
    const out: Array<Recipient> = []
    for (const r of recipientContacts) {
      const key = r.email ? r.email.toLowerCase() : r.applicationId
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        id: r.applicationId,
        name: r.name,
        email: r.email,
        status: r.status as ApplicationStatus,
      })
    }
    return out
  }, [recipientContacts])

  // Grouped by status, in canonical order, hiding empty groups.
  const groups = useMemo(
    () =>
      ALL_STATUSES.map((s) => ({
        status: s,
        members: allRecipients.filter((r) => r.status === s.value),
      })).filter((g) => g.members.length > 0),
    [allRecipients],
  )

  const selectedRecipients = useMemo(
    () => allRecipients.filter((r) => r.email && selectedIds.has(r.id)),
    [allRecipients, selectedIds],
  )
  const selectedCount = selectedRecipients.length
  const totalEmailable = allRecipients.filter((r) => r.email).length
  const missingEmailTotal = allRecipients.length - totalEmailable

  const toggleRecipient = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Tri-state for a category, computed over its emailable members only.
  const groupCheckState = (
    members: Array<Recipient>,
  ): boolean | 'indeterminate' => {
    const emailable = members.filter((m) => m.email)
    if (emailable.length === 0) return false
    const selected = emailable.filter((m) => selectedIds.has(m.id)).length
    if (selected === 0) return false
    if (selected === emailable.length) return true
    return 'indeterminate'
  }

  // Clicking a category: select all its emailable members, or deselect them all
  // if they're already all selected.
  const toggleGroup = (members: Array<Recipient>) => {
    const emailable = members.filter((m) => m.email)
    const allSelected =
      emailable.length > 0 && emailable.every((m) => selectedIds.has(m.id))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const m of emailable) {
        if (allSelected) next.delete(m.id)
        else next.add(m.id)
      }
      return next
    })
  }

  const selectAll = () =>
    setSelectedIds(
      new Set(allRecipients.filter((r) => r.email).map((r) => r.id)),
    )
  const clearAll = () => setSelectedIds(new Set())

  const previewHtml = useMemo(() => {
    if (!body.trim()) return ''
    const withLinks = substituteExampleLinks(
      emojify(body),
      pollExampleLink,
      surveyExampleLink,
    )
    return DOMPurify.sanitize(
      marked.parse(withLinks, { async: false, breaks: true, gfm: true }),
    )
  }, [body, pollExampleLink, surveyExampleLink])

  const handleSend = async () => {
    if (!opportunity || isSending || hasSent) return
    setIsSending(true)
    try {
      const result = await sendBroadcast({
        opportunityId: opportunity._id,
        applicationIds: selectedRecipients.map((r) => r.id),
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
    Boolean(subject.trim()) &&
    Boolean(body.trim()) &&
    selectedCount > 0 &&
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
            Broadcast email
          </h1>

          {/* Recipients */}
          <Card className="mb-6">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Recipients</CardTitle>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={selectAll}
                  disabled={
                    totalEmailable === 0 || selectedCount === totalEmailable
                  }
                >
                  Select all
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAll}
                  disabled={selectedCount === 0}
                >
                  Clear all
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {recipientContacts === undefined ? (
                <p className="text-sm text-muted-foreground">
                  Loading recipients...
                </p>
              ) : allRecipients.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No applicants yet.
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground mb-3">
                    {selectedCount} recipient{selectedCount !== 1 ? 's' : ''}{' '}
                    selected
                    {totalEmailable > 0 && ` of ${totalEmailable} emailable`}.
                    Toggle a category to select everyone in it, or pick
                    individuals.
                  </p>
                  <div className="max-h-80 overflow-y-auto rounded-md border divide-y">
                    {groups.map((g) => {
                      const emailableInGroup = g.members.filter(
                        (m) => m.email,
                      ).length
                      return (
                        <div key={g.status.value}>
                          <label className="flex items-center gap-2 px-3 py-2 bg-muted cursor-pointer sticky top-0 z-10">
                            <GroupCheckbox
                              state={groupCheckState(g.members)}
                              onToggle={() => toggleGroup(g.members)}
                              disabled={emailableInGroup === 0}
                            />
                            <span className="text-sm font-semibold">
                              {g.status.label}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              ({g.members.length})
                            </span>
                          </label>
                          {g.members.map((m) => (
                            <label
                              key={m.id}
                              className={cn(
                                'flex items-center justify-between gap-2 px-3 py-1.5 pl-9',
                                m.email
                                  ? 'cursor-pointer hover:bg-muted/30'
                                  : 'cursor-not-allowed',
                              )}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <Checkbox
                                  checked={selectedIds.has(m.id)}
                                  onCheckedChange={() => toggleRecipient(m.id)}
                                  disabled={!m.email}
                                />
                                <span className="text-sm font-medium truncate">
                                  {m.name}
                                </span>
                              </div>
                              {m.email ? (
                                <span className="text-muted-foreground text-xs shrink-0">
                                  {m.email}
                                </span>
                              ) : (
                                <span className="text-amber-600 text-xs shrink-0 font-medium">
                                  No email on file
                                </span>
                              )}
                            </label>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                  {missingEmailTotal > 0 && (
                    <p className="text-sm text-amber-600 mt-2">
                      {missingEmailTotal} applicant
                      {missingEmailTotal !== 1 ? 's have' : ' has'} no email on
                      file and can&apos;t be selected.
                    </p>
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
                        Send to {selectedCount} applicant
                        {selectedCount !== 1 ? 's' : ''}
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
                          {selectedCount} selected applicant
                          {selectedCount !== 1 ? 's' : ''}. This action cannot
                          be undone.
                        </p>
                        <RecipientList
                          recipients={selectedRecipients}
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
