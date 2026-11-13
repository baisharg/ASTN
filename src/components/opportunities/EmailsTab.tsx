import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import {
  CalendarClock,
  Check,
  History,
  Inbox,
  Loader2,
  Mail,
  MessageSquare,
  Pencil,
  RotateCcw,
  Send,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useUnsavedChangesWarning } from '~/hooks/use-unsaved-changes'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { Textarea } from '~/components/ui/textarea'

// Emails tab for an opportunity. Three sections:
//   Outbox    — pending decision-email drafts; review, edit, send explicitly
//   History   — unified log of every email sent (or blocked) for this opp
//   Templates — the opportunity's own six emails, copied from the canonical
// Changing an application status never sends anything; it lands here first.

export const KIND_LABELS: Record<string, string> = {
  application_received: 'Application received',
  accepted: 'Accepted',
  next_edition: 'Next edition',
  rejected: 'Rejected',
  redirected: 'Fit for another course',
  waitlisted: 'Waitlisted',
  availability_received: 'Availability received',
  availability_link: 'Availability link',
  availability: 'Availability (legacy)',
  broadcast: 'Broadcast',
}

export const KIND_COLORS: Record<string, string> = {
  application_received: 'bg-blue-50 text-blue-700 border-blue-200',
  accepted: 'bg-green-50 text-green-700 border-green-200',
  next_edition: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  redirected: 'bg-orange-50 text-orange-700 border-orange-200',
  waitlisted: 'bg-purple-50 text-purple-700 border-purple-200',
}

export function EmailsTab({
  opportunity,
  slug,
}: {
  opportunity: {
    _id: Id<'orgOpportunities'>
    slug?: string
  }
  slug: string
}) {
  return (
    <Tabs defaultValue="outbox">
      <div className="flex items-center justify-between">
        <TabsList>
          <TabsTrigger value="outbox" className="gap-2">
            <Inbox className="size-4" />
            Outbox
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="size-4" />
            History
          </TabsTrigger>
          <TabsTrigger value="templates" className="gap-2">
            <Mail className="size-4" />
            Templates
          </TabsTrigger>
        </TabsList>
        {/* One-off/free-form mail (reminders etc.) — logged in History too. */}
        <Button variant="outline" size="sm" asChild>
          <Link
            to="/org/$slug/admin/opportunities/$oppId/email"
            params={{ slug, oppId: opportunity.slug ?? opportunity._id }}
          >
            <Pencil className="size-4 mr-2" />
            Compose broadcast
          </Link>
        </Button>
      </div>

      <TabsContent value="outbox" className="mt-6">
        <OutboxSection opportunityId={opportunity._id} />
      </TabsContent>
      <TabsContent value="history" className="mt-6">
        <HistorySection opportunityId={opportunity._id} />
      </TabsContent>
      <TabsContent value="templates" className="mt-6">
        <TemplatesSection opportunityId={opportunity._id} />
      </TabsContent>
    </Tabs>
  )
}

// ── Outbox ──────────────────────────────────────────────────────────────────

type Draft = {
  _id: Id<'emailOutbox'>
  applicationId: Id<'opportunityApplications'>
  kind: 'accepted' | 'next_edition' | 'rejected' | 'redirected' | 'waitlisted'
  subject: string
  markdownBody: string
  includePollLink: boolean
  includeSurveyLink: boolean
  recipientName: string
  recipientEmail: string | null
  editedByAdmin?: boolean
  templateHasChanged?: boolean
}

function OutboxSection({
  opportunityId,
}: {
  opportunityId: Id<'orgOpportunities'>
}) {
  const drafts = useQuery(api.emails.outbox.listForOpportunity, {
    opportunityId,
  })
  const sendDrafts = useAction(api.emails.outboxSend.sendDrafts)
  const deleteDraft = useMutation(api.emails.outbox.deleteDraft)
  const resetDraft = useMutation(api.emails.outbox.resetDraftToTemplate)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<Draft | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isSending, setIsSending] = useState(false)

  if (drafts === undefined) {
    return (
      <div className="py-12 text-center">
        <Spinner className="size-8 mx-auto" />
      </div>
    )
  }

  const sendable = drafts.filter((d) => d.recipientEmail !== null)
  const needsEmail = drafts.filter((d) => d.recipientEmail === null)
  const selectedDrafts = sendable.filter((d) => selected.has(d._id))

  const byKind = new Map<string, Array<Draft>>()
  for (const d of sendable) {
    const list = byKind.get(d.kind) ?? []
    list.push(d as Draft)
    byKind.set(d.kind, list)
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleGroup = (kind: string) => {
    const group = byKind.get(kind) ?? []
    const allSelected = group.every((d) => selected.has(d._id))
    setSelected((prev) => {
      const next = new Set(prev)
      for (const d of group) {
        if (allSelected) next.delete(d._id)
        else next.add(d._id)
      }
      return next
    })
  }

  const handleSend = async () => {
    setIsSending(true)
    try {
      const result = await sendDrafts({
        opportunityId,
        draftIds: selectedDrafts.map((d) => d._id),
      })
      setSelected(new Set())
      setConfirmOpen(false)
      if (result.sent > 0) {
        toast.success(
          `Sent ${result.sent} email${result.sent !== 1 ? 's' : ''}`,
        )
      }
      if (result.blocked > 0) {
        toast.warning(
          `${result.blocked} draft${result.blocked !== 1 ? 's' : ''} blocked: they include a poll/feedback link but there is no open poll/survey. They stay in the outbox.`,
        )
      }
      if (result.alreadySent > 0) {
        toast.info(`${result.alreadySent} skipped (already sent earlier)`)
      }
      if (result.failed > 0) {
        toast.error(`${result.failed} failed to send — see History`)
      }
      if (
        result.sent === 0 &&
        result.blocked === 0 &&
        result.alreadySent === 0 &&
        result.failed === 0
      ) {
        toast.info('Nothing was sent')
      }
    } catch (err) {
      console.error('Send failed:', err)
      toast.error('Failed to send')
    } finally {
      setIsSending(false)
    }
  }

  const selectedByKind = new Map<string, number>()
  for (const d of selectedDrafts) {
    selectedByKind.set(d.kind, (selectedByKind.get(d.kind) ?? 0) + 1)
  }

  return (
    <div className="space-y-6">
      {drafts.length === 0 ? (
        <Card className="p-8 text-center">
          <Inbox className="size-8 text-slate-400 mx-auto mb-4" />
          <p className="text-muted-foreground">
            No pending emails. Changing an application's status queues its
            decision email here — nothing is sent until you review and send it.
          </p>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {drafts.length} pending draft{drafts.length !== 1 ? 's' : ''}.
              Nothing is sent until you press Send.
            </p>
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={selectedDrafts.length === 0 || isSending}
            >
              <Send className="size-4 mr-2" />
              Send {selectedDrafts.length > 0 ? selectedDrafts.length : ''}{' '}
              selected
            </Button>
          </div>

          {[...byKind.entries()].map(([kind, group]) => (
            <Card key={kind}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={group.every((d) => selected.has(d._id))}
                    onCheckedChange={() => toggleGroup(kind)}
                  />
                  <Badge variant="outline" className={KIND_COLORS[kind]}>
                    {KIND_LABELS[kind] ?? kind}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {group.length} recipient{group.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-1">
                {group.map((draft) => (
                  <div
                    key={draft._id}
                    className="flex items-center gap-3 px-2 py-2 rounded hover:bg-slate-50"
                  >
                    <Checkbox
                      checked={selected.has(draft._id)}
                      onCheckedChange={() => toggle(draft._id)}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {draft.recipientName}{' '}
                        <span className="text-muted-foreground font-normal">
                          &lt;{draft.recipientEmail}&gt;
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {draft.subject}
                      </p>
                      {draft.templateHasChanged && (
                        <p className="text-xs text-amber-700 mt-0.5 flex items-center gap-1">
                          <span>
                            Edited by hand — the template has changed since.
                          </span>
                          <button
                            type="button"
                            className="underline underline-offset-2 hover:text-amber-900"
                            onClick={async () => {
                              try {
                                await resetDraft({ draftId: draft._id })
                                toast.success('Rebuilt from the template')
                              } catch (err) {
                                toast.error(
                                  err instanceof Error
                                    ? err.message
                                    : 'Could not rebuild the draft',
                                )
                              }
                            }}
                          >
                            Use the new one
                          </button>
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      {draft.includePollLink && (
                        <CalendarClock className="size-4" />
                      )}
                      {draft.includeSurveyLink && (
                        <MessageSquare className="size-4" />
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(draft as Draft)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          await deleteDraft({ draftId: draft._id })
                          toast.success('Draft removed')
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </>
      )}

      {needsEmail.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-amber-800">
              Needs email address ({needsEmail.length})
            </CardTitle>
            <CardDescription>
              We could not find an email for these applicants anywhere — not on
              their profile, not in the form they filled in — so their drafts
              cannot be sent. Type an address below to unlock them. It is saved
              on the application, so it applies to future emails too.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {needsEmail.map((d) => (
              <NeedsEmailRow key={d._id} draft={d as Draft} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Send confirmation */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Send {selectedDrafts.length} email
              {selectedDrafts.length !== 1 ? 's' : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1">
                {[...selectedByKind.entries()].map(([kind, count]) => (
                  <p key={kind}>
                    {count} × {KIND_LABELS[kind] ?? kind}
                  </p>
                ))}
                <p className="pt-2">
                  Names and poll/feedback links are filled in per recipient. If
                  someone already received this email, they are skipped
                  automatically — no duplicates.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSend} disabled={isSending}>
              {isSending ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Send className="size-4 mr-2" />
              )}
              Send
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {editing && (
        // Keyed so opening a different draft remounts the dialog — its fields
        // init from props at mount (see OpportunityDetailsForm note).
        <DraftEditDialog
          key={editing._id}
          draft={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function DraftEditDialog({
  draft,
  onClose,
}: {
  draft: Draft
  onClose: () => void
}) {
  const updateDraft = useMutation(api.emails.outbox.updateDraft)
  const [subject, setSubject] = useState(draft.subject)
  const [body, setBody] = useState(draft.markdownBody)
  const [pollLink, setPollLink] = useState(draft.includePollLink)
  const [surveyLink, setSurveyLink] = useState(draft.includeSurveyLink)
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await updateDraft({
        draftId: draft._id,
        subject,
        markdownBody: body,
        includePollLink: pollLink,
        includeSurveyLink: surveyLink,
      })
      toast.success('Draft updated')
      onClose()
    } catch (err) {
      toast.error(
        err instanceof Error && err.message.includes('variable')
          ? 'Unknown {{variable}}: use {{applicant_name}}, {{course}} or {{area}}'
          : 'Failed to save draft',
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* Bounded height with a scrolling middle row: however long the email is,
          the footer stays on screen. Without this the dialog just grew past the
          viewport (it is centred with translate-y, so it overflows both ends). */}
      <DialogContent className="max-w-lg max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Edit email for {draft.recipientName}</DialogTitle>
          <DialogDescription>
            Only this draft changes — the template stays as is.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-1 -mx-1">
          <TemplateFields
            subject={subject}
            body={body}
            pollLink={pollLink}
            surveyLink={surveyLink}
            onSubject={setSubject}
            onBody={setBody}
            onPollLink={setPollLink}
            onSurveyLink={setSurveyLink}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="size-4 mr-2 animate-spin" />}
            Save draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── History ─────────────────────────────────────────────────────────────────

function HistorySection({
  opportunityId,
}: {
  opportunityId: Id<'orgOpportunities'>
}) {
  const log = useQuery(api.emails.outbox.listLogForOpportunity, {
    opportunityId,
  })

  if (log === undefined) {
    return (
      <div className="py-12 text-center">
        <Spinner className="size-8 mx-auto" />
      </div>
    )
  }

  if (log.length === 0) {
    return (
      <Card className="p-8 text-center">
        <History className="size-8 text-slate-400 mx-auto mb-4" />
        <p className="text-muted-foreground">
          Every email sent for this opportunity will be recorded here — who
          received what, when, and how.
        </p>
      </Card>
    )
  }

  return (
    <div className="space-y-2">
      {log.map((entry) => (
        <Card key={entry._id} className="px-4 py-3">
          <div className="flex items-center gap-3">
            {entry.status === 'sent' ? (
              <Check className="size-4 text-green-600 shrink-0" />
            ) : (
              <span className="size-4 text-red-600 shrink-0 text-center leading-4">
                ✕
              </span>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">
                <span className="font-medium">{entry.recipientName}</span>{' '}
                <span className="text-muted-foreground">
                  &lt;{entry.recipientEmail}&gt;
                </span>
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {entry.subject}
              </p>
              {entry.error && (
                <p className="text-xs text-red-600 mt-0.5">{entry.error}</p>
              )}
            </div>
            <Badge variant="outline" className={KIND_COLORS[entry.kind] ?? ''}>
              {KIND_LABELS[entry.kind] ?? entry.kind}
            </Badge>
            <span className="text-xs text-muted-foreground w-24 text-right shrink-0">
              {entry.source === 'auto' ? 'automatic' : entry.source}
            </span>
            <span className="text-xs text-muted-foreground w-28 text-right shrink-0">
              {new Date(entry.sentAt).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        </Card>
      ))}
    </div>
  )
}

// ── Templates ───────────────────────────────────────────────────────────────

type OpportunityEmail = FunctionReturnType<
  typeof api.emails.templateLibrary.getOpportunityEmails
>[number]

function TemplatesSection({
  opportunityId,
}: {
  opportunityId: Id<'orgOpportunities'>
}) {
  const emails = useQuery(api.emails.templateLibrary.getOpportunityEmails, {
    opportunityId,
  })

  if (emails === undefined) {
    return (
      <div className="py-12 text-center">
        <Spinner className="size-8 mx-auto" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        These emails belong to this opportunity. They started as a copy of the
        canonical emails (Admin → Canonicals), and editing them here changes
        nothing else. Each one sends only while its switch is on; the
        &quot;Application received&quot; email goes out on its own when someone
        applies, the others wait in the Outbox until you send them.
      </p>
      {emails.map((email) => (
        // Keyed on updatedAt so a save or a revert remounts the card and its
        // fields re-init from what is now stored.
        <TemplateCard
          key={`${email.kind}:${email.updatedAt}`}
          opportunityId={opportunityId}
          email={email}
        />
      ))}
    </div>
  )
}

// A switch can add or remove a dozen drafts at once. Say which, so the Outbox
// never changes size behind the admin's back.
function queueEffect(r: {
  queued: number
  discarded: number
  keptEdited: number
}): string | undefined {
  if (r.queued > 0)
    return `${r.queued} draft${r.queued === 1 ? '' : 's'} queued for decisions already made`
  if (r.discarded > 0) {
    const kept =
      r.keptEdited > 0 ? ` ${r.keptEdited} you had edited stayed.` : ''
    return `${r.discarded} unsent draft${r.discarded === 1 ? '' : 's'} removed.${kept}`
  }
  if (r.keptEdited > 0)
    return `${r.keptEdited} draft${r.keptEdited === 1 ? '' : 's'} you had edited stayed in the Outbox`
  return undefined
}

function TemplateCard({
  opportunityId,
  email,
}: {
  opportunityId: Id<'orgOpportunities'>
  email: OpportunityEmail
}) {
  const save = useMutation(api.emails.templateLibrary.saveOpportunityEmail)
  const revert = useMutation(api.emails.templateLibrary.revertOpportunityEmail)

  const [subject, setSubject] = useState(email.subject)
  const [body, setBody] = useState(email.markdownBody)
  const [enabled, setEnabled] = useState(email.enabled)
  const [pollLink, setPollLink] = useState(email.includePollLink)
  const [surveyLink, setSurveyLink] = useState(email.includeSurveyLink)
  const [isSaving, setIsSaving] = useState(false)

  const dirty =
    subject !== email.subject ||
    body !== email.markdownBody ||
    enabled !== email.enabled ||
    pollLink !== email.includePollLink ||
    surveyLink !== email.includeSurveyLink
  useUnsavedChangesWarning(dirty && !isSaving)

  const varError = (msg: string) =>
    msg.includes('variable')
      ? 'Unknown {{variable}}: use {{applicant_name}}, {{course}} or {{area}}'
      : 'Failed to save'

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const result = await save({
        opportunityId,
        kind: email.kind,
        subject,
        markdownBody: body,
        enabled,
        includePollLink: pollLink,
        includeSurveyLink: surveyLink,
      })
      toast.success('Saved', { description: queueEffect(result) })
    } catch (err) {
      toast.error(varError(err instanceof Error ? err.message : ''))
    } finally {
      setIsSaving(false)
    }
  }

  const handleRevert = async () => {
    setIsSaving(true)
    try {
      const result = await revert({ opportunityId, kind: email.kind })
      toast.success('Back to the canonical text', {
        description: queueEffect(result),
      })
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not revert this email',
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card className={enabled ? '' : 'opacity-70'}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={KIND_COLORS[email.kind]}>
              {KIND_LABELS[email.kind]}
            </Badge>
            {email.differsFromCanonical && (
              <Badge variant="secondary">Edited for this opportunity</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {enabled
                ? email.kind === 'application_received'
                  ? 'Sent when someone applies'
                  : 'Sends email'
                : email.kind === 'application_received'
                  ? 'No confirmation on apply'
                  : 'No email for this decision'}
            </span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
        {email.kind === 'application_received' && (
          <CardDescription>
            Future applications only: switching it never emails people who
            already applied.
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <TemplateFields
          subject={subject}
          body={body}
          pollLink={pollLink}
          surveyLink={surveyLink}
          onSubject={setSubject}
          onBody={setBody}
          onPollLink={setPollLink}
          onSurveyLink={setSurveyLink}
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={!dirty || isSaving}>
            {isSaving && <Loader2 className="size-4 mr-2 animate-spin" />}
            Save
          </Button>
          {email.differsFromCanonical && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleRevert}
              disabled={isSaving}
            >
              <RotateCcw className="size-4 mr-2" />
              Revert to canonical
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/** One applicant in the "Needs email address" group, with an inline fix. */
function NeedsEmailRow({ draft }: { draft: Draft }) {
  const setRecipientEmail = useMutation(api.emails.outbox.setRecipientEmail)
  const [email, setEmail] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async () => {
    if (isSaving || !email.trim()) return
    setIsSaving(true)
    try {
      await setRecipientEmail({ draftId: draft._id, email })
      toast.success(`Address saved for ${draft.recipientName}`)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not save the address',
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-amber-900 min-w-40 flex-1">
        {draft.recipientName}{' '}
        <span className="text-amber-700">
          — {KIND_LABELS[draft.kind] ?? draft.kind}
        </span>
      </span>
      <Input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="name@example.com"
        className="w-56 bg-white"
        onKeyDown={(e) => {
          if (e.key === 'Enter') void handleSave()
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={handleSave}
        disabled={isSaving || !email.trim()}
      >
        {isSaving && <Loader2 className="size-4 mr-1 animate-spin" />}
        Save
      </Button>
    </div>
  )
}

// Shared subject/body/link-toggle fields for template cards and draft edits.
export function TemplateFields({
  subject,
  body,
  pollLink,
  surveyLink,
  onSubject,
  onBody,
  onPollLink,
  onSurveyLink,
}: {
  subject: string
  body: string
  pollLink: boolean
  surveyLink: boolean
  onSubject: (v: string) => void
  onBody: (v: string) => void
  onPollLink: (v: boolean) => void
  onSurveyLink: (v: boolean) => void
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">Subject</Label>
        <Input value={subject} onChange={(e) => onSubject(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">
          Body (markdown — {'{{applicant_name}}'} for the name, {'{{course}}'}{' '}
          and {'{{area}}'} for the course)
        </Label>
        {/* The base Textarea sets `field-sizing-content`, which overrides `rows`
            and lets the box grow with the body. Inside the draft dialog that
            pushed Cancel/Save past the bottom of the screen with no way to
            reach them. Cap the height and let the textarea scroll on its own. */}
        <Textarea
          value={body}
          onChange={(e) => onBody(e.target.value)}
          rows={5}
          className="max-h-[45vh] overflow-y-auto"
        />
      </div>
      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={pollLink} onCheckedChange={onPollLink} />
          <CalendarClock className="size-4 text-muted-foreground" />
          Include availability poll link
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={surveyLink} onCheckedChange={onSurveyLink} />
          <MessageSquare className="size-4 text-muted-foreground" />
          Include feedback link
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Links are added automatically at the end of the email, personalized per
        recipient. If the poll/survey isn't open at send time, the email is
        blocked instead of going out without its link.
      </p>
    </div>
  )
}
