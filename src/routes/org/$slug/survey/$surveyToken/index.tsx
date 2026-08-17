import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { CheckCircle2, ClipboardList, EyeOff, Loader2, Lock } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../../../../convex/_generated/api'
import { DynamicFormRenderer } from '~/components/opportunities/DynamicFormRenderer'
import { GradientBg } from '~/components/layout/GradientBg'
import { Button } from '~/components/ui/button'

export const Route = createFileRoute('/org/$slug/survey/$surveyToken/')({
  loader: async ({ context, params }) => {
    const surveyData = await context.queryClient.ensureQueryData(
      convexQuery(api.feedbackSurveys.getSurveyByToken, {
        accessToken: params.surveyToken,
      }),
    )
    return { surveyData }
  },
  head: ({ loaderData }) => {
    const data = loaderData?.surveyData
    return {
      meta: [
        {
          title: data
            ? `${data.survey.title} — ${data.org.name}`
            : 'Feedback Survey',
        },
        { name: 'description', content: 'Share your feedback.' },
      ],
    }
  },
  component: SurveyGenericLinkPage,
})

function SurveyGenericLinkPage() {
  const { surveyToken, slug } = Route.useParams()

  const { data: surveyData } = useSuspenseQuery(
    convexQuery(api.feedbackSurveys.getSurveyByToken, {
      accessToken: surveyToken,
    }),
  )

  const submitAnonymous = useMutation(
    api.feedbackSurveys.submitAnonymousResponse,
  )

  const [responses, setResponses] = useState<Record<string, unknown>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)

  const handleChange = useCallback((key: string, value: unknown) => {
    setResponses((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleSubmit = async () => {
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      await submitAnonymous({ accessToken: surveyToken, responses })
      setIsSubmitted(true)
      toast.success('Response submitted anonymously')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to submit response'
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Surveys with individual links: this generic URL is only a signpost.
  if (!surveyData || !surveyData.survey.anonymous) {
    return (
      <GradientBg>
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <ClipboardList className="size-8 text-slate-400 mx-auto mb-4" />
            <h1 className="text-2xl font-display text-foreground mb-4">
              {surveyData ? surveyData.survey.title : 'Feedback Survey'}
            </h1>
            <p className="text-muted-foreground mb-6">
              This survey uses individual links. Please check your email for
              your personal survey link, or contact the organizer.
            </p>
            <Button asChild variant="outline">
              <Link to="/org/$slug" params={{ slug }}>
                Visit Organization
              </Link>
            </Button>
          </div>
        </main>
      </GradientBg>
    )
  }

  const { survey, opportunity, org } = surveyData

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

  // Once sent there is nothing to come back to: an anonymous response cannot be
  // looked up or edited, precisely because nothing links it to the sender.
  if (isSubmitted) {
    return (
      <GradientBg>
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <CheckCircle2 className="size-8 text-green-600 mx-auto mb-4" />
            <h1 className="text-2xl font-display text-foreground mb-4">
              Thanks for your feedback
            </h1>
            <p className="text-muted-foreground">
              Your answers were submitted anonymously. They cannot be traced
              back to you, which also means they can no longer be edited.
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
            <div className="flex items-start gap-2 rounded-lg border border-input bg-muted/40 p-3 mt-4 text-sm">
              <EyeOff className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">
                This survey is anonymous. Your name and account are not
                recorded, and there is nothing stored alongside your answers
                that could identify you.
              </span>
            </div>
          </div>

          <DynamicFormRenderer
            formFields={survey.formFields}
            responses={responses}
            onChange={handleChange}
            uploadToken={surveyToken}
          />

          <div className="flex items-center justify-end gap-3 mt-6">
            <Button onClick={handleSubmit} disabled={isSubmitting} size="lg">
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Submit anonymously'
              )}
            </Button>
          </div>
        </div>
      </main>
    </GradientBg>
  )
}
