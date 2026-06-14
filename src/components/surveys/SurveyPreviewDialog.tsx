import { Eye } from 'lucide-react'
import { useState } from 'react'
import type { FormField } from '../../../convex/lib/formFields'
import { DynamicFormRenderer } from '~/components/opportunities/DynamicFormRenderer'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog'

interface SurveyPreviewDialogProps {
  title: string
  description?: string
  /** Opportunity title shown under the survey title, mirroring the respondent page. */
  opportunityTitle?: string
  formFields: Array<FormField>
  /** Trigger element (e.g. a Button). Defaults to an outline "Preview" button. */
  children?: React.ReactNode
}

/**
 * Read-only preview of a feedback survey, rendered exactly as a respondent
 * sees it on the magic-link page (`/org/$slug/survey/...`). The form is
 * interactive so the admin can click through it, but nothing is submitted or
 * stored — responses live only in local component state.
 */
export function SurveyPreviewDialog({
  title,
  description,
  opportunityTitle,
  formFields,
  children,
}: SurveyPreviewDialogProps) {
  // Local-only responses: the preview is interactive but never persisted.
  const [responses, setResponses] = useState<Record<string, unknown>>({})

  const validFields = formFields.filter((f) => f.label.trim())

  return (
    <Dialog
      onOpenChange={(open) => {
        // Reset responses each time the dialog closes so a re-open starts clean.
        if (!open) setResponses({})
      }}
    >
      <DialogTrigger asChild>
        {children ?? (
          <Button variant="outline" size="sm">
            <Eye className="size-4 mr-1" />
            Preview
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Preview — this is exactly what respondents see. Responses are not
          saved.
        </div>

        {/* Header mirrors the respondent page (survey title + opportunity + intro). */}
        <div className="space-y-1">
          <DialogTitle className="text-2xl font-display font-semibold text-foreground">
            {title.trim() || 'Untitled survey'}
          </DialogTitle>
          {opportunityTitle && (
            <p className="text-sm text-muted-foreground">{opportunityTitle}</p>
          )}
          {description ? (
            <DialogDescription className="pt-1 text-sm text-muted-foreground">
              {description}
            </DialogDescription>
          ) : (
            <DialogDescription className="sr-only">
              Feedback survey preview
            </DialogDescription>
          )}
        </div>

        {validFields.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No questions yet. Add at least one field to preview the form.
          </p>
        ) : (
          <>
            <DynamicFormRenderer
              formFields={validFields}
              responses={responses}
              onChange={(key, value) =>
                setResponses((prev) => ({ ...prev, [key]: value }))
              }
            />
            <div className="flex justify-end pt-2">
              <Button size="lg" disabled>
                Submit Feedback
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
