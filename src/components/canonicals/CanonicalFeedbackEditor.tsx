import { useMutation, useQuery } from 'convex/react'
import { ConvexError } from 'convex/values'
import { Loader2, Save } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { FormField } from '../../../convex/lib/formFields'
import { FormFieldsEditor } from '~/components/opportunities/FormFieldsEditor'
import { useUnsavedChangesWarning } from '~/hooks/use-unsaved-changes'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Spinner } from '~/components/ui/spinner'
import { Textarea } from '~/components/ui/textarea'

/**
 * The canonical feedback survey (the course one or the anonymous one): its
 * title, intro and questions. A new survey in an opportunity's Feedback tab
 * starts from it, with {{course}} and {{area}} filled.
 */
export function CanonicalFeedbackEditor({
  orgId,
  anonymous,
}: {
  orgId: Id<'organizations'>
  anonymous: boolean
}) {
  const kind = anonymous ? 'feedback_anonymous' : 'feedback'
  const canonical = useQuery(api.canonicalForms.get, { orgId, kind })
  const save = useMutation(api.canonicalForms.save)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [fields, setFields] = useState<Array<FormField>>([])
  const [loaded, setLoaded] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  if (canonical !== undefined && !loaded) {
    setTitle(canonical?.title ?? '')
    setDescription(canonical?.description ?? '')
    setFields((canonical?.formFields as Array<FormField> | undefined) ?? [])
    setLoaded(true)
  }

  const isDirty =
    canonical !== undefined &&
    (title !== (canonical?.title ?? '') ||
      description !== (canonical?.description ?? '') ||
      JSON.stringify(fields) !==
        JSON.stringify((canonical?.formFields as Array<FormField>) ?? []))
  useUnsavedChangesWarning(isDirty && !isSaving)

  if (canonical === undefined) return <Spinner className="size-6 mx-auto" />

  const validFields = fields.filter((f) => f.label.trim())

  const handleSave = async () => {
    if (isSaving) return
    setIsSaving(true)
    try {
      await save({ orgId, kind, formFields: validFields, title, description })
      toast.success('Canonical survey saved')
    } catch (err) {
      toast.error("Couldn't save the canonical survey", {
        description:
          err instanceof ConvexError && typeof err.data === 'string'
            ? err.data
            : 'Please try again.',
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {anonymous ? 'Anonymous feedback survey' : 'Course feedback survey'}
        </CardTitle>
        <CardDescription>
          {anonymous
            ? 'For feedback about the facilitators: one shared link, no record of who answered.'
            : 'The end-of-course survey, with a personal link per participant.'}{' '}
          {'{{course}}'} and {'{{area}}'} work here too.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor={`${kind}-title`}>Title</Label>
          <Input
            id={`${kind}-title`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Feedback sobre {{course}}"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${kind}-desc`}>Intro</Label>
          <Textarea
            id={`${kind}-desc`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Shown to respondents before the questions"
          />
        </div>

        <FormFieldsEditor fields={fields} onChange={setFields} />

        <Button
          type="button"
          onClick={() => void handleSave()}
          disabled={isSaving}
        >
          {isSaving ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <Save className="size-4 mr-2" />
          )}
          Save canonical survey
        </Button>
      </CardContent>
    </Card>
  )
}
