import { useUser } from '@clerk/clerk-react'
import { usePostHog } from '@posthog/react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { useConvexAuth, useMutation, useQuery } from 'convex/react'
import { useState } from 'react'
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  UserPlus,
} from 'lucide-react'
import { format } from 'date-fns'
import { api } from '../../../../../convex/_generated/api'
import {
  PROFILE_PREFILL_KEYS,
  sanitizeResponsesForForm,
  validateResponses,
} from '../../../../../convex/lib/formFields'
import type { FormField } from '../../../../../convex/lib/formFields'
import { AuthHeader } from '~/components/layout/auth-header'
import { GradientBg } from '~/components/layout/GradientBg'
import { DynamicFormRenderer } from '~/components/opportunities/DynamicFormRenderer'
import { Button } from '~/components/ui/button'
import { saveGuestApplicationEmail } from '~/lib/pendingGuestApplication'

// Keep in sync with APPLICATION_EDIT_GRACE_MS in
// convex/opportunityApplications.ts.
const APPLICATION_EDIT_GRACE_MS = 24 * 60 * 60 * 1000

export const Route = createFileRoute('/org/$slug/apply/$opportunityId')({
  loader: async ({ context, params }) => {
    const [org, result] = await Promise.all([
      context.queryClient.ensureQueryData(
        convexQuery(api.orgs.directory.getOrgBySlug, { slug: params.slug }),
      ),
      context.queryClient.ensureQueryData(
        // The URL segment is either the readable slug or the raw id; both
        // resolve, so links sent out before slugs existed keep working.
        convexQuery(api.orgOpportunities.getWithRedirectByKey, {
          orgSlug: params.slug,
          key: params.opportunityId,
        }),
      ),
    ])
    return { org, result }
  },
  head: ({ loaderData, params }) => {
    const org = loaderData?.org
    const result = loaderData?.result
    const opportunity = result?.opportunity
    const orgName = org?.name ?? 'Organization'
    const isRedirect = result?.kind === 'redirect'
    const title = opportunity
      ? isRedirect
        ? `Express Interest — ${opportunity.title} at ${orgName}`
        : `${opportunity.title} — Apply at ${orgName}`
      : `Apply — ${orgName}`
    const rawDesc = opportunity?.description ?? ''
    const description =
      rawDesc.length > 155 ? rawDesc.slice(0, 152) + '...' : rawDesc
    const fallback = isRedirect
      ? `Express interest in future cohorts at ${orgName} on AI Safety Talent Network.`
      : `Apply for this opportunity at ${orgName} on AI Safety Talent Network.`
    const url = `https://safetytalent.org/org/${params.slug}/apply/${params.opportunityId}`

    return {
      meta: [
        { title },
        { name: 'description', content: description || fallback },
        { property: 'og:url', content: url },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description || fallback },
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description || fallback },
      ],
    }
  },
  component: ApplyPage,
})

function ApplyPage() {
  const { slug, opportunityId } = Route.useParams()
  const navigate = useNavigate()
  const { isAuthenticated } = useConvexAuth()
  const { user } = useUser()
  const posthog = usePostHog()

  const { data: org } = useSuspenseQuery(
    convexQuery(api.orgs.directory.getOrgBySlug, { slug }),
  )
  const { data: result } = useSuspenseQuery(
    convexQuery(api.orgOpportunities.getWithRedirectByKey, {
      orgSlug: slug,
      key: opportunityId,
    }),
  )
  const isRedirect = result?.kind === 'redirect'
  const opportunity = result?.opportunity ?? null
  const originalTitle = isRedirect ? result.originalTitle : null
  const existingApplication = useQuery(
    api.opportunityApplications.getMyApplication,
    isAuthenticated && opportunity
      ? { opportunityId: opportunity._id }
      : 'skip',
  )
  const previousApplication = useQuery(
    api.opportunityApplications.getPreviousResponsesForOpportunity,
    isAuthenticated && opportunity
      ? { opportunityId: opportunity._id }
      : 'skip',
  )
  const profile = useQuery(
    api.profiles.getOrCreateProfile,
    isAuthenticated ? {} : 'skip',
  )
  const submitApplication = useMutation(api.opportunityApplications.submit)
  const submitGuestApplication = useMutation(
    api.opportunityApplications.submitGuest,
  )

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submittedAsGuest, setSubmittedAsGuest] = useState(false)
  const [wasEditingAtSubmit, setWasEditingAtSubmit] = useState(false)
  const [preFilled, setPreFilled] = useState(false)
  const [responses, setResponses] = useState<Record<string, unknown>>({})

  const formFields = (opportunity?.formFields ?? []) as Array<FormField>
  const deadline = opportunity?.deadline
  const editWindowEndsAt =
    deadline !== undefined ? deadline + APPLICATION_EDIT_GRACE_MS : undefined
  const isWithinEditWindow =
    editWindowEndsAt === undefined || Date.now() <= editWindowEndsAt
  const isEditing =
    isAuthenticated && !!existingApplication && isWithinEditWindow && !submitted

  // Wait for prior-application and existing-application queries to settle so
  // we only flip `preFilled` once; the profile query may legitimately resolve
  // to `null` for users who have signed up but not yet edited their profile —
  // we don't block on it.
  const previousReady = !isAuthenticated || previousApplication !== undefined
  const existingReady = !isAuthenticated || existingApplication !== undefined
  if (
    isAuthenticated &&
    user &&
    !preFilled &&
    formFields.length > 0 &&
    previousReady &&
    existingReady &&
    profile !== undefined
  ) {
    const updates: Record<string, unknown> = {}

    const priorResponses =
      (previousApplication?.responses as Record<string, unknown> | undefined) ??
      {}
    for (const [key, value] of Object.entries(priorResponses)) {
      if (!(key in responses)) updates[key] = value
    }

    if (profile) {
      const nameParts = (profile.name || user.fullName || '').split(' ')
      const profileData: Record<string, string> = {
        firstName: nameParts[0] || '',
        lastName: nameParts.slice(1).join(' ') || '',
        email: user.primaryEmailAddress?.emailAddress || '',
        location: profile.location || '',
        profileUrl: profile.linkedinUrl || '',
      }
      for (const key of PROFILE_PREFILL_KEYS) {
        if (profileData[key] && !responses[key]) {
          updates[key] = profileData[key]
        }
      }
    }

    // Editing an existing application: the user's own prior submission takes
    // precedence over everything else (profile, previous-opportunity carry-over).
    if (existingApplication?.responses) {
      const sanitized = sanitizeResponsesForForm(
        formFields,
        existingApplication.responses as Record<string, unknown>,
      )
      for (const [key, value] of Object.entries(sanitized)) {
        updates[key] = value
      }
    }

    if (Object.keys(updates).length > 0) {
      setResponses((prev) => ({ ...prev, ...updates }))
    }
    setPreFilled(true)
  }

  // Banner appears only after pre-fill actually ran so we never promise
  // carryover that didn't happen.
  const hasPreviousAppData = preFilled && previousApplication != null

  if (!org || !opportunity) {
    return (
      <GradientBg>
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <h1 className="text-2xl font-display text-foreground mb-4">
              Not Found
            </h1>
            <p className="text-slate-600 mb-6">
              This opportunity doesn&apos;t exist or has been removed.
            </p>
            <Button asChild>
              <Link to="/org/$slug" params={{ slug }}>
                Back to Organization
              </Link>
            </Button>
          </div>
        </main>
      </GradientBg>
    )
  }

  const showSuccessPage =
    (submitted && !submittedAsGuest) ||
    (!!existingApplication && !isWithinEditWindow)
  const justEdited = submitted && wasEditingAtSubmit
  const successHeading = justEdited
    ? 'Application Updated'
    : isRedirect
      ? 'Expression of Interest Submitted'
      : 'Application Submitted'
  const successBody = justEdited ? (
    <>
      Your updated application for <strong>{opportunity.title}</strong> has been
      saved.
    </>
  ) : isRedirect ? (
    <>
      You&apos;ve expressed interest in future cohorts of{' '}
      <strong>{originalTitle}</strong>. You&apos;ll be notified when the next
      cohort opens.
    </>
  ) : (
    <>
      Your application for <strong>{opportunity.title}</strong> has been
      submitted. You&apos;ll hear back from the organizers soon.
    </>
  )

  if (showSuccessPage) {
    return (
      <GradientBg>
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <div className="size-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="size-8 text-green-600" />
            </div>
            <h1 className="text-2xl font-display text-foreground mb-4">
              {successHeading}
            </h1>
            <p className="text-slate-600 mb-6">{successBody}</p>
            <Button asChild>
              <Link to="/org/$slug" params={{ slug }}>
                Back to {org.name}
              </Link>
            </Button>
          </div>
        </main>
      </GradientBg>
    )
  }

  // Guest success page: submitted as guest, prompt to create account
  if (submittedAsGuest) {
    const guestEmail =
      typeof responses.email === 'string' ? responses.email : ''
    return (
      <GradientBg>
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <div className="size-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="size-8 text-green-600" />
            </div>
            <h1 className="text-2xl font-display text-foreground mb-4">
              {successHeading}
            </h1>
            <p className="text-slate-600 mb-6">{successBody}</p>
            {guestEmail && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 mb-6 text-sm text-blue-800">
                <p className="font-medium mb-1">
                  Create an account to track your application
                </p>
                <p>
                  Sign up with the same email ({guestEmail}) to view your
                  application status and join {org.name}.
                </p>
              </div>
            )}
            <div className="flex flex-col gap-3">
              {guestEmail && (
                <Button
                  onClick={() => {
                    saveGuestApplicationEmail(guestEmail)
                    void navigate({ to: '/login' })
                  }}
                >
                  <UserPlus className="size-4 mr-2" />
                  Create Account
                </Button>
              )}
              <Button variant="ghost" asChild>
                <Link to="/org/$slug" params={{ slug }}>
                  Back to {org.name}
                </Link>
              </Button>
            </div>
          </div>
        </main>
      </GradientBg>
    )
  }

  // No form fields configured
  if (formFields.length === 0) {
    return (
      <GradientBg>
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <h1 className="text-2xl font-display text-foreground mb-4">
              Application Form Not Available
            </h1>
            <p className="text-slate-600 mb-6">
              The application form for this opportunity hasn&apos;t been
              configured yet. Please check back later.
            </p>
            <Button asChild>
              <Link to="/org/$slug" params={{ slug }}>
                Back to {org.name}
              </Link>
            </Button>
          </div>
        </main>
      </GradientBg>
    )
  }

  const validationErrors = validateResponses(formFields, responses)
  const isValid = validationErrors.length === 0

  const handleChange = (key: string, value: unknown) => {
    setResponses((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = async () => {
    if (!isValid || isSubmitting) return
    setIsSubmitting(true)
    const editingAtSubmit = isEditing
    setWasEditingAtSubmit(editingAtSubmit)
    try {
      let isGuest = false
      if (isAuthenticated) {
        await submitApplication({
          opportunityId: opportunity._id,
          responses,
        })
        setSubmitted(true)
      } else {
        const email = (
          typeof responses.email === 'string' ? responses.email : ''
        )
          .trim()
          .toLowerCase()
        if (!email) return
        await submitGuestApplication({
          opportunityId: opportunity._id,
          guestEmail: email,
          responses,
        })
        setSubmitted(true)
        setSubmittedAsGuest(true)
        isGuest = true
      }
      posthog.capture('opportunity_application_submitted', {
        opportunity_id: opportunity._id,
        opportunity_title: opportunity.title,
        org_slug: slug,
        org_name: org.name,
        is_guest: isGuest,
        is_redirect: isRedirect,
        is_edit: editingAtSubmit,
        ...(isRedirect && { original_opportunity_id: opportunityId }),
      })
    } catch (err) {
      console.error('Failed to submit application:', err)
      posthog.captureException(err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const hasPreFilledData =
    isAuthenticated &&
    preFilled &&
    PROFILE_PREFILL_KEYS.some((key) => responses[key])

  return (
    <GradientBg>
      <AuthHeader />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          {/* Back link */}
          <Link
            to="/org/$slug"
            params={{ slug }}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
          >
            <ArrowLeft className="size-4" />
            Back to {org.name}
          </Link>

          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-display font-semibold text-foreground">
              {opportunity.title}
            </h1>
            <p className="text-muted-foreground mt-1 whitespace-pre-line">
              {opportunity.description}
            </p>
            {opportunity.externalUrl && (
              <a
                href={opportunity.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-2"
              >
                Learn more
                <ExternalLink className="size-3" />
              </a>
            )}
          </div>

          {/* Redirect / EOI banner */}
          {isRedirect && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 mb-6">
              <h3 className="font-medium text-amber-900">
                Applications for {originalTitle} have closed
              </h3>
              <p className="text-sm text-amber-800 mt-1">
                Submit your interest below to be notified about future cohorts.
              </p>
            </div>
          )}

          {isEditing && existingApplication && (
            <div className="flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-200 p-3 mb-6 text-sm text-blue-800">
              <Info className="size-4 mt-0.5 shrink-0" />
              <span>
                You applied on{' '}
                <strong>{format(existingApplication.submittedAt, 'PP')}</strong>
                .{' '}
                {editWindowEndsAt !== undefined ? (
                  <>
                    You can update your responses until{' '}
                    <strong>{format(editWindowEndsAt, 'PPp')}</strong>.
                  </>
                ) : (
                  <>You can still update your responses.</>
                )}
              </span>
            </div>
          )}

          {!isEditing && (hasPreviousAppData || hasPreFilledData) && (
            <div className="flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-200 p-3 mb-6 text-sm text-blue-800">
              <Info className="size-4 mt-0.5 shrink-0" />
              <span>
                {hasPreviousAppData ? (
                  <>
                    Some answers have been pre-filled from your previous
                    application to{' '}
                    <strong>
                      {previousApplication?.sourceOpportunityTitle}
                    </strong>
                    . Review and update as needed.
                  </>
                ) : (
                  <>
                    Some fields have been pre-filled from your ASTN profile.
                    Review and edit as needed.
                  </>
                )}
              </span>
            </div>
          )}

          {/* Dynamic form */}
          <DynamicFormRenderer
            formFields={formFields}
            responses={responses}
            onChange={handleChange}
          />

          {/* Submit */}
          <div className="flex items-center justify-between pt-6 pb-8">
            <Button variant="ghost" asChild>
              <Link to="/org/$slug" params={{ slug }}>
                Cancel
              </Link>
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!isValid || isSubmitting}
              size="lg"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  {isEditing ? 'Updating...' : 'Submitting...'}
                </>
              ) : isEditing ? (
                'Update Application'
              ) : isRedirect ? (
                'Submit Expression of Interest'
              ) : (
                'Submit Application'
              )}
            </Button>
          </div>
        </div>
      </main>
    </GradientBg>
  )
}
