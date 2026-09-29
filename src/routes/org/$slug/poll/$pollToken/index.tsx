import { useUser } from '@clerk/clerk-react'
import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ConvexError } from 'convex/values'
import { useMutation } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { CheckCircle2, Clock, Loader2, Lock, Mail } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../../../../../convex/_generated/api'
import { AvailabilityGrid } from '~/components/availability/AvailabilityGrid'
import { GradientBg } from '~/components/layout/GradientBg'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'

export const Route = createFileRoute('/org/$slug/poll/$pollToken/')({
  loader: async ({ context, params }) => {
    const pollData = await context.queryClient.ensureQueryData(
      convexQuery(api.availabilityPolls.getPollByToken, {
        accessToken: params.pollToken,
      }),
    )
    return { pollData }
  },
  component: PollOpenLinkPage,
})

type SlotStatus = 'available' | 'maybe'

/**
 * The poll's shareable link. When the admin turned on "accept availability
 * without an application", anyone with the link can give their availability
 * with just a name and an email. Otherwise it points people to the personal
 * link they got by email, as it always did.
 */
function PollOpenLinkPage() {
  const { pollToken, slug } = Route.useParams()

  const { data: pollData } = useSuspenseQuery(
    convexQuery(api.availabilityPolls.getPollByToken, {
      accessToken: pollToken,
    }),
  )

  if (!pollData) {
    return (
      <Notice
        icon={<Clock className="size-8 text-slate-400 mx-auto mb-4" />}
        title="Poll Not Found"
        body="This poll link may be invalid or expired."
      />
    )
  }

  const { poll } = pollData
  if (poll.status !== 'open') {
    return (
      <Notice
        icon={<Lock className="size-8 text-slate-400 mx-auto mb-4" />}
        title="Poll Closed"
        body="This availability poll is no longer accepting responses."
      />
    )
  }

  if (!poll.acceptsOpenResponses) {
    return (
      <Notice
        icon={<Clock className="size-8 text-slate-400 mx-auto mb-4" />}
        title={poll.title}
        body="This poll uses individual links. Please check your email for your personal poll link, or contact the organizer."
        slug={slug}
      />
    )
  }

  return <OpenAvailabilityForm pollToken={pollToken} pollData={pollData} />
}

function OpenAvailabilityForm({
  pollToken,
  pollData,
}: {
  pollToken: string
  pollData: NonNullable<
    FunctionReturnType<typeof api.availabilityPolls.getPollByToken>
  >
}) {
  const { poll, opportunity, org } = pollData
  const { user } = useUser()
  const submit = useMutation(api.availabilityPolls.submitOpenResponse)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [identityFilled, setIdentityFilled] = useState(false)
  // Logged-in people get their name and email filled in once Clerk loads;
  // they can still edit them.
  if (user && !identityFilled) {
    setFirstName((v) => v || user.firstName || '')
    setLastName((v) => v || user.lastName || '')
    setEmail((v) => v || user.primaryEmailAddress?.emailAddress || '')
    setIdentityFilled(true)
  }
  const [slots, setSlots] = useState<Record<string, SlotStatus>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<'saved' | 'emailed_link' | null>(null)

  // Say what is missing instead of silently disabling the button.
  const missing = [
    !firstName.trim() && 'your first name',
    !lastName.trim() && 'your last name',
    !email.trim() && 'your email',
    Object.keys(slots).length === 0 && 'at least one time on the grid',
  ].filter((m): m is string => typeof m === 'string')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    if (missing.length > 0) {
      setError(`Add ${missing.join(', ')}.`)
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      setOutcome(
        await submit({
          accessToken: pollToken,
          firstName,
          lastName,
          email,
          slots,
        }),
      )
    } catch (err) {
      setError(
        err instanceof ConvexError && typeof err.data === 'string'
          ? err.data
          : 'Could not save your availability. Please try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (outcome) {
    return (
      <Notice
        icon={
          outcome === 'saved' ? (
            <CheckCircle2 className="size-8 text-green-600 mx-auto mb-4" />
          ) : (
            <Mail className="size-8 text-blue-600 mx-auto mb-4" />
          )
        }
        title={outcome === 'saved' ? 'Availability saved' : 'Check your email'}
        body={
          outcome === 'saved'
            ? `Thanks! We emailed ${email.trim()} a personal link to review or change your availability later.`
            : `${email.trim()} already shared an availability for this poll, so we did not change it. We emailed that address a personal link to update it.`
        }
      />
    )
  }

  return (
    <GradientBg>
      <main className="container mx-auto px-4 py-8">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
          <div className="mb-6">
            <p className="text-sm text-muted-foreground">{org.name}</p>
            <h1 className="text-2xl font-display font-semibold text-foreground">
              {poll.title}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {opportunity.title} · Timezone: {poll.timezone.replace(/_/g, ' ')}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3 mb-6">
            <div className="space-y-1">
              <Label htmlFor="firstName">First name</Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lastName">Last name</Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
          </div>

          <AvailabilityGrid
            days={poll.days}
            startMinutes={poll.startMinutes}
            endMinutes={poll.endMinutes}
            slotDurationMinutes={poll.slotDurationMinutes}
            timezone={poll.timezone}
            slots={slots}
            onSlotsChange={setSlots}
          />

          <div className="flex flex-col items-end gap-2 mt-4">
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="size-4 mr-2 animate-spin" />}
              Send availability
            </Button>
          </div>
        </form>
      </main>
    </GradientBg>
  )
}

function Notice({
  icon,
  title,
  body,
  slug,
}: {
  icon: React.ReactNode
  title: string
  body: string
  slug?: string
}) {
  return (
    <GradientBg>
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-lg mx-auto text-center py-12">
          {icon}
          <h1 className="text-2xl font-display text-foreground mb-4">
            {title}
          </h1>
          <p className="text-muted-foreground mb-6">{body}</p>
          {slug && (
            <Button asChild variant="outline">
              <Link to="/org/$slug" params={{ slug }}>
                Visit Organization
              </Link>
            </Button>
          )}
        </div>
      </main>
    </GradientBg>
  )
}
