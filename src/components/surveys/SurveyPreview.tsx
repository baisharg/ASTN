import { Eye, X } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useState } from 'react'
import type { FormField } from '../../../convex/lib/formFields'
import { DynamicFormRenderer } from '~/components/opportunities/DynamicFormRenderer'
import { GradientBg } from '~/components/layout/GradientBg'
import { Button } from '~/components/ui/button'

interface SurveyPreviewProps {
  title: string
  description?: string
  /** Org name shown above the title, mirroring the respondent page header. */
  orgName?: string
  /** Opportunity title shown under the survey title. */
  opportunityTitle?: string
  formFields: Array<FormField>
  /** Trigger element (e.g. a Button). Defaults to an outline "Preview" button. */
  children?: React.ReactNode
}

/**
 * Full-screen, read-only preview of a feedback survey, rendered exactly as a
 * respondent sees it on the magic-link page (`/org/$slug/survey/...`) — same
 * GradientBg, container, header and DynamicFormRenderer. The form is
 * interactive so the admin can click through it, but nothing is submitted or
 * stored: responses live only in local component state.
 */
export function SurveyPreview({
  title,
  description,
  orgName,
  opportunityTitle,
  formFields,
  children,
}: SurveyPreviewProps) {
  // Local-only responses: the preview is interactive but never persisted.
  const [responses, setResponses] = useState<Record<string, unknown>>({})

  const validFields = formFields.filter((f) => f.label.trim())

  return (
    <DialogPrimitive.Root
      onOpenChange={(open) => {
        // Reset responses each time it closes so a re-open starts clean.
        if (!open) setResponses({})
      }}
    >
      <DialogPrimitive.Trigger asChild>
        {children ?? (
          <Button variant="outline" size="sm">
            <Eye className="size-4 mr-1" />
            Preview
          </Button>
        )}
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content className="fixed inset-0 z-50 overflow-y-auto outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0">
          {/* Preview chrome — a slim bar that is NOT part of what respondents see. */}
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-background/80 px-4 py-2 backdrop-blur">
            <span className="text-xs font-medium text-muted-foreground">
              Preview — this is exactly what respondents see. Responses are not
              saved.
            </span>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="sm" className="shrink-0">
                <X className="size-4 mr-1" />
                Close
              </Button>
            </DialogPrimitive.Close>
          </div>

          {/* Respondent page layout, replicated 1:1. */}
          <GradientBg>
            <main className="container mx-auto px-4 py-8">
              <div className="max-w-2xl mx-auto">
                <div className="mb-6">
                  {orgName && (
                    <p className="text-sm text-muted-foreground">{orgName}</p>
                  )}
                  <DialogPrimitive.Title asChild>
                    <h1 className="text-2xl font-display font-semibold text-foreground">
                      {title.trim() || 'Untitled survey'}
                    </h1>
                  </DialogPrimitive.Title>
                  {opportunityTitle && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {opportunityTitle}
                    </p>
                  )}
                  {description ? (
                    <DialogPrimitive.Description className="text-sm text-muted-foreground mt-2">
                      {description}
                    </DialogPrimitive.Description>
                  ) : (
                    <DialogPrimitive.Description className="sr-only">
                      Feedback survey preview
                    </DialogPrimitive.Description>
                  )}
                  <p className="text-sm text-foreground mt-2">
                    Responding as: <strong>Preview</strong>
                  </p>
                </div>

                {validFields.length === 0 ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    No questions yet. Add at least one field to preview the
                    form.
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
                    <div className="flex items-center justify-end gap-3 mt-6">
                      <Button size="lg" disabled>
                        Submit Feedback
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </main>
          </GradientBg>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
