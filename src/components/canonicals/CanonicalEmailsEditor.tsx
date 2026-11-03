import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { ConvexError } from 'convex/values'
import { Loader2, Save } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import {
  KIND_COLORS,
  KIND_LABELS,
  TemplateFields,
} from '~/components/opportunities/EmailsTab'
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
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { Textarea } from '~/components/ui/textarea'

type CanonicalEmail = FunctionReturnType<
  typeof api.emails.templateLibrary.getCanonical
>['emails'][number]

const errorText = (err: unknown) =>
  err instanceof ConvexError && typeof err.data === 'string'
    ? err.data
    : 'Please try again.'

/**
 * The org's canonical emails: the decision emails every new course edition
 * links, and the footer that closes every email the org sends.
 */
export function CanonicalEmailsEditor({
  orgId,
}: {
  orgId: Id<'organizations'>
}) {
  const canonical = useQuery(api.emails.templateLibrary.getCanonical, {
    orgId,
  })

  if (canonical === undefined) {
    return <Spinner className="size-6 mx-auto" />
  }

  return (
    <div className="space-y-6">
      <FooterCard orgId={orgId} footer={canonical.footer} />
      {canonical.emails.map((email) => (
        <CanonicalEmailCard key={email.kind} orgId={orgId} email={email} />
      ))}
    </div>
  )
}

function FooterCard({
  orgId,
  footer,
}: {
  orgId: Id<'organizations'>
  footer: string
}) {
  const saveFooter = useMutation(api.emails.templateLibrary.saveFooter)
  const [text, setText] = useState(footer)
  const [isSaving, setIsSaving] = useState(false)
  useUnsavedChangesWarning(text !== footer && !isSaving)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Footer of every email</CardTitle>
        <CardDescription>
          Closes every email this organization sends to applicants: decisions,
          confirmations, availability and the ones written from the Email page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="max-h-[30vh] overflow-y-auto"
        />
        <Button
          size="sm"
          disabled={text === footer || isSaving}
          onClick={async () => {
            setIsSaving(true)
            try {
              await saveFooter({ orgId, footer: text })
              toast.success('Footer saved')
            } catch (err) {
              toast.error("Couldn't save the footer", {
                description: errorText(err),
              })
            } finally {
              setIsSaving(false)
            }
          }}
        >
          {isSaving ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <Save className="size-4 mr-2" />
          )}
          Save footer
        </Button>
      </CardContent>
    </Card>
  )
}

function CanonicalEmailCard({
  orgId,
  email: template,
}: {
  orgId: Id<'organizations'>
  email: CanonicalEmail
}) {
  const save = useMutation(api.emails.templateLibrary.saveCanonicalEmail)
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
  useUnsavedChangesWarning(dirty && !isSaving)

  return (
    <Card className={enabled ? '' : 'opacity-70'}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Badge variant="outline" className={KIND_COLORS[template.kind]}>
            {KIND_LABELS[template.kind] ?? template.kind}
          </Badge>
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
        <Button
          size="sm"
          disabled={!dirty || isSaving}
          onClick={async () => {
            setIsSaving(true)
            try {
              await save({
                orgId,
                kind: template.kind,
                subject,
                markdownBody: body,
                enabled,
                includePollLink: pollLink,
                includeSurveyLink: surveyLink,
              })
              toast.success('Saved')
            } catch (err) {
              toast.error("Couldn't save", { description: errorText(err) })
            } finally {
              setIsSaving(false)
            }
          }}
        >
          {isSaving && <Loader2 className="size-4 mr-2 animate-spin" />}
          Save
        </Button>
      </CardContent>
    </Card>
  )
}
