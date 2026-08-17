import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
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

// Emails tab for an opportunity (issue #20). Three sections:
//   Outbox    — pending decision-email drafts; review, edit, send explicitly
//   History   — unified log of every email sent (or blocked) for this opp
//   Templates — the set this opportunity inherits, with per-opp overrides
// Changing an application status never sends anything; it lands here first.

type EmailKind =
  | 'application_received'
  | 'accepted'
  | 'rejected'
  | 'redirected'
  | 'waitlisted'

const KIND_LABELS: Record<string, string> = {
  application_received: 'Application received',
  accepted: 'Accepted',
  rejected: 'Rejected',
  redirected: 'Fit for another course',
  waitlisted: 'Waitlisted',
  availability: 'Availability (legacy)',
  broadcast: 'Broadcast',
}

const KIND_COLORS: Record<string, string> = {
  application_received: 'bg-blue-50 text-blue-700 border-blue-200',
  accepted: 'bg-green-50 text-green-700 border-green-200',
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
    orgId: Id<'organizations'>
    emailTemplateSetId?: Id<'emailTemplateSets'>
    isEOI?: boolean
    sendApplicationReceivedEmail?: boolean
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
            params={{ slug, oppId: opportunity._id }}
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
        <TemplatesSection opportunity={opportunity} />
      </TabsContent>
    </Tabs>
  )
}

// ── Outbox ──────────────────────────────────────────────────────────────────

type Draft = {
  _id: Id<'emailOutbox'>
  applicationId: Id<'opportunityApplications'>
  kind: 'accepted' | 'rejected' | 'redirected' | 'waitlisted'
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
              These applicants have no resolvable email, so their drafts cannot
              be selected or sent. Add an email to their application to unlock
              them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {needsEmail.map((d) => (
              <p key={d._id} className="text-sm text-amber-900 py-0.5">
                {d.recipientName} —{' '}
                <span className="text-amber-700">
                  {KIND_LABELS[d.kind] ?? d.kind}
                </span>
              </p>
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
          ? 'Unknown {{variable}} — only {{applicant_name}} is supported'
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

function TemplatesSection({
  opportunity,
}: {
  opportunity: {
    _id: Id<'orgOpportunities'>
    orgId: Id<'organizations'>
    emailTemplateSetId?: Id<'emailTemplateSets'>
    isEOI?: boolean
    sendApplicationReceivedEmail?: boolean
  }
}) {
  const sets = useQuery(api.emails.templateLibrary.listSets, {
    orgId: opportunity.orgId,
  })
  const effective = useQuery(api.emails.templateLibrary.getEffectiveTemplates, {
    opportunityId: opportunity._id,
  })
  const linkSet = useMutation(
    api.emails.templateLibrary.setOpportunityTemplateSet,
  )
  const createSet = useMutation(api.emails.templateLibrary.createSet)
  const setOnApply = useMutation(
    api.emails.templateLibrary.setSendApplicationReceivedEmail,
  )

  const [newSetName, setNewSetName] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const linkedSetId = opportunity.emailTemplateSetId
  const onApplyEnabled =
    opportunity.sendApplicationReceivedEmail ?? !(opportunity.isEOI ?? false)

  const setTemplateIds = useMemo(() => {
    const map = new Map<string, Id<'emailTemplates'>>()
    const linked = sets?.find((s) => s._id === linkedSetId)
    for (const t of linked?.templates ?? []) map.set(t.kind, t._id)
    return map
  }, [sets, linkedSetId])

  if (sets === undefined) {
    return (
      <div className="py-12 text-center">
        <Spinner className="size-8 mx-auto" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Set selector */}
      <Card>
        <CardHeader>
          <CardTitle>Email template set</CardTitle>
          <CardDescription>
            Link a set (e.g. TAIS, Governance) and this opportunity inherits all
            its emails. Linking activates the outbox: every decision — past and
            future — gets a pending draft. Nothing is sent until you press Send,
            and applicants who already got an email are never re-queued.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Select
              value={linkedSetId ?? 'none'}
              onValueChange={async (val) => {
                await linkSet({
                  opportunityId: opportunity._id,
                  setId:
                    val === 'none'
                      ? undefined
                      : (val as Id<'emailTemplateSets'>),
                })
                toast.success(
                  val === 'none' ? 'Set unlinked' : 'Template set linked',
                )
              }}
            >
              <SelectTrigger className="w-[240px]">
                <SelectValue placeholder="No set linked" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No set (legacy emails)</SelectItem>
                {sets.map((s) => (
                  <SelectItem key={s._id} value={s._id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2">
              <Input
                placeholder="New set name…"
                value={newSetName}
                onChange={(e) => setNewSetName(e.target.value)}
                className="w-[180px]"
              />
              <Button
                variant="outline"
                disabled={!newSetName.trim() || isCreating}
                onClick={async () => {
                  setIsCreating(true)
                  try {
                    const setId = await createSet({
                      orgId: opportunity.orgId,
                      name: newSetName.trim(),
                    })
                    await linkSet({ opportunityId: opportunity._id, setId })
                    setNewSetName('')
                    toast.success('Set created and linked')
                  } catch {
                    toast.error('Failed to create set')
                  } finally {
                    setIsCreating(false)
                  }
                }}
              >
                {isCreating && <Loader2 className="size-4 mr-2 animate-spin" />}
                Create set
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {effective && (
        <>
          {/* On-apply confirmation switch */}
          <Card>
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="text-sm font-medium">
                  Confirmation email on apply
                </p>
                <p className="text-xs text-muted-foreground">
                  Sends the "Application received" template automatically when
                  someone applies. Applies to future applications only —
                  toggling never emails existing applicants.
                </p>
              </div>
              <Switch
                checked={onApplyEnabled}
                onCheckedChange={async (checked) => {
                  await setOnApply({
                    opportunityId: opportunity._id,
                    enabled: checked,
                  })
                  toast.success(
                    checked
                      ? 'Confirmation email on — future applications only'
                      : 'Confirmation email off',
                  )
                }}
              />
            </CardContent>
          </Card>

          {/* Template cards */}
          {effective.templates.map((t) => (
            // Key includes `overridden` so reverting to the set (or creating
            // an override) remounts the card and re-inits its fields from the
            // now-effective template.
            <TemplateCard
              key={`${t.kind}:${t.overridden}`}
              opportunityId={opportunity._id}
              setName={effective.setName}
              setTemplateId={setTemplateIds.get(t.kind) ?? null}
              template={t}
            />
          ))}
        </>
      )}
    </div>
  )
}

function TemplateCard({
  opportunityId,
  setName,
  setTemplateId,
  template,
}: {
  opportunityId: Id<'orgOpportunities'>
  setName: string
  setTemplateId: Id<'emailTemplates'> | null
  template: {
    kind: EmailKind
    enabled: boolean
    subject: string
    markdownBody: string
    includePollLink: boolean
    includeSurveyLink: boolean
    overridden: boolean
  }
}) {
  const upsertOverride = useMutation(
    api.emails.templateLibrary.upsertOpportunityTemplate,
  )
  const clearOverride = useMutation(
    api.emails.templateLibrary.clearOpportunityTemplate,
  )
  const updateSetTemplate = useMutation(
    api.emails.templateLibrary.updateTemplate,
  )

  const [subject, setSubject] = useState(template.subject)
  const [body, setBody] = useState(template.markdownBody)
  const [enabled, setEnabled] = useState(template.enabled)
  const [pollLink, setPollLink] = useState(template.includePollLink)
  const [surveyLink, setSurveyLink] = useState(template.includeSurveyLink)
  const [isSaving, setIsSaving] = useState(false)

  const dirty =
    subject !== template.subject ||
    body !== template.markdownBody ||
    enabled !== template.enabled ||
    pollLink !== template.includePollLink ||
    surveyLink !== template.includeSurveyLink

  const varError = (msg: string) =>
    msg.includes('variable')
      ? 'Unknown {{variable}} — only {{applicant_name}} is supported'
      : 'Failed to save'

  const saveOverride = async () => {
    setIsSaving(true)
    try {
      await upsertOverride({
        opportunityId,
        kind: template.kind,
        subject,
        markdownBody: body,
        enabled,
        includePollLink: pollLink,
        includeSurveyLink: surveyLink,
      })
      toast.success('Saved for this opportunity')
    } catch (err) {
      toast.error(varError(err instanceof Error ? err.message : ''))
    } finally {
      setIsSaving(false)
    }
  }

  const saveToSet = async () => {
    if (!setTemplateId) return
    setIsSaving(true)
    try {
      await updateSetTemplate({
        templateId: setTemplateId,
        subject,
        markdownBody: body,
        enabled,
        includePollLink: pollLink,
        includeSurveyLink: surveyLink,
      })
      toast.success(`Saved to the ${setName} set`)
    } catch (err) {
      toast.error(varError(err instanceof Error ? err.message : ''))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card className={enabled ? '' : 'opacity-70'}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={KIND_COLORS[template.kind]}>
              {KIND_LABELS[template.kind]}
            </Badge>
            {template.overridden && (
              <Badge variant="secondary">Customized for this opportunity</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {enabled ? 'Sends email' : 'No email for this decision'}
            </span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
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
          <Button
            size="sm"
            onClick={saveOverride}
            disabled={!dirty || isSaving}
          >
            {isSaving && <Loader2 className="size-4 mr-2 animate-spin" />}
            Save for this opportunity
          </Button>
          {!template.overridden && setTemplateId && (
            <Button
              size="sm"
              variant="outline"
              onClick={saveToSet}
              disabled={!dirty || isSaving}
            >
              Save to the {setName} set
            </Button>
          )}
          {template.overridden && (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await clearOverride({ opportunityId, kind: template.kind })
                toast.success(`Reverted to the ${setName} set`)
              }}
            >
              <RotateCcw className="size-4 mr-2" />
              Revert to set
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// Shared subject/body/link-toggle fields for template cards and draft edits.
function TemplateFields({
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
          Body (markdown — use {'{{applicant_name}}'} for the name)
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
