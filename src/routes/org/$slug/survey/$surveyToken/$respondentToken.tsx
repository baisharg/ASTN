import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { CheckCircle2, ClipboardList, Loader2, Lock } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../../../../convex/_generated/api'
import { DynamicFormRenderer } from '~/components/opportunities/DynamicFormRenderer'
import { GradientBg } from '~/components/layout/GradientBg'
import { Button } from '~/components/ui/button'

export const Route = createFileRoute(
  '/org/$slug/survey/$surveyToken/$respondentToken',
)({
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(
      convexQuery(api.feedbackSurveys.getSurveyByRespondentToken, {
        respondentToken: params.respondentToken,
      }),
    )
    return { data }
  },
  head: ({ loaderData }) => {
    const data = loaderData?.data
    const title = data
      ? `${data.survey.title} — ${data.org.name}`
      : 'Feedback Survey'
    return {
      meta: [
        { title },
        {
          name: 'description',
          content: 'Share your feedback.',
        },
      ],
    }
  },
  component: RespondentSurveyPage,
})

function RespondentSurveyPage() {
  const { respondentToken } = Route.useParams()

  const { data } = useSuspenseQuery(
    convexQuery(api.feedbackSurveys.getSurveyByRespondentToken, {
      respondentToken,
    }),
  )

  const existingResponse = useQuery(
    api.feedbackSurveys.getResponseByRespondent,
    data
      ? { surveyId: data.survey._id, respondentId: data.respondentId }
      : 'skip',
  )

  const submitResponse = useMutation(api.feedbackSurveys.submitResponse)

  const [responses, setResponses] = useState<Record<string, unknown>>({})
  const [initialized, setInitialized] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)

  // Pre-populate from existing response
  if (!initialized && existingResponse !== undefined) {
    if (existingResponse) {
      setResponses(existingResponse.responses as Record<string, unknown>)
      setIsSubmitted(true)
    }
    setInitialized(true)
  }

  const handleChange = useCallback((key: string, value: unknown) => {
    setResponses((prev) => ({ ...prev, [key]: value }))
    setIsSubmitted(false) // Allow re-submission after edits
  }, [])

  const handleSubmit = async () => {
    if (!data || isSubmitting) return
    setIsSubmitting(true)
    try {
      await submitResponse({
        surveyId: data.survey._id,
        respondentId: data.respondentId,
        responses,
      })
      setIsSubmitted(true)
      toast.success('Response submitted!')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to submit response'
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!data) {
    return (
      <GradientBg>
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <ClipboardList className="size-8 text-slate-400 mx-auto mb-4" />
            <h1 className="text-2xl font-display text-foreground mb-4">
              Survey Not Found
            </h1>
            <p className="text-muted-foreground">
              This survey link may be invalid or expired.
            </p>
          </div>
        </main>
      </GradientBg>
    )
  }

  const { survey, opportunity, org, respondentName } = data

  // Not open (draft or closed)
  if (survey.status !== 'open') {
    return (
      <GradientBg>
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <Lock className="size-8 text-slate-400 mx-auto mb-4" />
            <h1 className="text-2xl font-display text-foreground mb-4">
              Survey Closed
            </h1>
            <p className="text-muted-foreground">
              {survey.status === 'draft'
                ? 'This survey is not yet published.'
                : 'This feedback survey is no longer accepting responses.'}
            </p>
          </div>
        </main>
      </GradientBg>
    )
  }

  return (
    <GradientBg>
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="mb-6">
            <p className="text-sm text-muted-foreground">{org.name}</p>
            <h1 className="text-2xl font-display font-semibold text-foreground">
              {survey.title}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {opportunity.title}
            </p>
            {survey.description && (
              <p className="text-sm text-muted-foreground mt-2 whitespace-pre-line">
                {survey.description}
              </p>
            )}
            <p className="text-sm text-foreground mt-2">
              Responding as: <strong>{respondentName}</strong>
            </p>
          </div>

          <DynamicFormRenderer
            formFields={survey.formFields}
            responses={responses}
            onChange={handleChange}
          />

          <div className="flex items-center justify-end gap-3 mt-6">
            {isSubmitted && (
              <span className="flex items-center gap-1.5 text-sm text-green-600">
                <CheckCircle2 className="size-4" />
                Response submitted
              </span>
            )}
            <Button onClick={handleSubmit} disabled={isSubmitting} size="lg">
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : isSubmitted ? (
                'Update Response'
              ) : (
                'Submit Feedback'
              )}
            </Button>
          </div>
        </div>
      </main>
    </GradientBg>
  )
}
