import { useMutation, useQuery } from 'convex/react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { Textarea } from '~/components/ui/textarea'

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
  const sets = useQuery(api.emails.templateLibrary.listSets, { orgId })

  if (canonical === undefined || sets === undefined) {
    return <Spinner className="size-6 mx-auto" />
  }

  const set = sets.find((s) => s._id === canonical.setId)

  return (
    <div className="space-y-6">
      <FooterCard orgId={orgId} footer={canonical.footer} />
      {set ? (
        <>
          <p className="text-sm text-muted-foreground">
            New course editions use these emails. Write {'{{course}}'} and{' '}
            {'{{area}}'} for the course; each edition fills them from its course
            tag. Opportunities created earlier keep the set they link.
          </p>
          {set.templates.map((t) => (
            <CanonicalEmailCard key={t._id} template={t} />
          ))}
        </>
      ) : (
        <CreateCanonicalCard
          orgId={orgId}
          sets={sets.map((s) => ({ _id: s._id, name: s.name }))}
        />
      )}
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

function CreateCanonicalCard({
  orgId,
  sets,
}: {
  orgId: Id<'organizations'>
  sets: Array<{ _id: Id<'emailTemplateSets'>; name: string }>
}) {
  const create = useMutation(api.emails.templateLibrary.createCanonical)
  const [fromSetId, setFromSetId] = useState<string>('none')
  const [isCreating, setIsCreating] = useState(false)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Canonical emails</CardTitle>
        <CardDescription>
          No canonical emails yet. Start from the emails of an existing set and
          adjust them.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <Select value={fromSetId} onValueChange={setFromSetId}>
          <SelectTrigger className="w-[240px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Blank emails</SelectItem>
            {sets.map((s) => (
              <SelectItem key={s._id} value={s._id}>
                Copy of {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          disabled={isCreating}
          onClick={async () => {
            setIsCreating(true)
            try {
              await create({
                orgId,
                fromSetId:
                  fromSetId === 'none'
                    ? undefined
                    : (fromSetId as Id<'emailTemplateSets'>),
              })
              toast.success('Canonical emails created')
            } catch (err) {
              toast.error("Couldn't create them", {
                description: errorText(err),
              })
            } finally {
              setIsCreating(false)
            }
          }}
        >
          {isCreating && <Loader2 className="size-4 mr-2 animate-spin" />}
          Create canonical emails
        </Button>
      </CardContent>
    </Card>
  )
}

function CanonicalEmailCard({
  template,
}: {
  template: {
    _id: Id<'emailTemplates'>
    kind: string
    enabled: boolean
    subject: string
    markdownBody: string
    includePollLink: boolean
    includeSurveyLink: boolean
  }
}) {
  const update = useMutation(api.emails.templateLibrary.updateTemplate)
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
              await update({
                templateId: template._id,
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
