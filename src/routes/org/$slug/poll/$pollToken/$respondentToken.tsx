import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { Check, CheckCircle2, Clock, Loader2, Lock } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../../../../convex/_generated/api'
import { weekdayLong } from '../../../../../../convex/lib/availabilityWeek'
import { AvailabilityGrid } from '~/components/availability/AvailabilityGrid'
import { GradientBg } from '~/components/layout/GradientBg'

export const Route = createFileRoute(
  '/org/$slug/poll/$pollToken/$respondentToken',
)({
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(
      convexQuery(api.availabilityPolls.getPollByRespondentToken, {
        respondentToken: params.respondentToken,
      }),
    )
    return { data }
  },
  head: ({ loaderData }) => {
    const data = loaderData?.data
    const title = data
      ? `${data.poll.title} — ${data.org.name}`
      : 'Availability Poll'
    return {
      meta: [
        { title },
        {
          name: 'description',
          content: 'Share your availability for scheduling.',
        },
      ],
    }
  },
  component: RespondentPollPage,
})

type SlotStatus = 'available' | 'maybe'

function RespondentPollPage() {
  const { respondentToken } = Route.useParams()

  const { data } = useSuspenseQuery(
    convexQuery(api.availabilityPolls.getPollByRespondentToken, {
      respondentToken,
    }),
  )

  const existingResponse = useQuery(
    api.availabilityPolls.getResponseByRespondent,
    data ? { pollId: data.poll._id, respondentId: data.respondentId } : 'skip',
  )

  const submitResponse = useMutation(api.availabilityPolls.submitResponse)

  const [slots, setSlots] = useState<Record<string, SlotStatus>>({})
  const [slotsInitialized, setSlotsInitialized] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>(
    'idle',
  )
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)
  const slotsRef = useRef(slots)
  slotsRef.current = slots
  const userHasEditedRef = useRef(false)

  // Pre-populate slots from existing response
  if (!slotsInitialized && existingResponse !== undefined) {
    if (existingResponse) {
      setSlots(existingResponse.slots as Record<string, SlotStatus>)
    }
    setSlotsInitialized(true)
  }

  const handleSlotsChange = useCallback(
    (newSlots: Record<string, SlotStatus>) => {
      userHasEditedRef.current = true
      setSlots(newSlots)
    },
    [],
  )

  const saveSlots = useCallback(
    async (slotsToSave: Record<string, SlotStatus>) => {
      if (!data) return
      setSaveStatus('saving')
      try {
        await submitResponse({
          pollId: data.poll._id,
          respondentId: data.respondentId,
          slots: slotsToSave,
        })
        setSaveStatus('saved')
      } catch (err) {
        console.error('Failed to save availability:', err)
        toast.error('Failed to save — try again')
        setSaveStatus('idle')
      }
    },
    [data, submitResponse],
  )

  // Auto-save with debounce when slots change
  useEffect(() => {
    if (!slotsInitialized || !userHasEditedRef.current) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void saveSlots(slotsRef.current)
    }, 800)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [slots, slotsInitialized, saveSlots])

  if (!data) {
    return (
      <GradientBg>
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <Clock className="size-8 text-slate-400 mx-auto mb-4" />
            <h1 className="text-2xl font-display text-foreground mb-4">
              Poll Not Found
            </h1>
            <p className="text-muted-foreground">
              This poll link may be invalid or expired.
            </p>
          </div>
        </main>
      </GradientBg>
    )
  }

  const { poll, opportunity, org, respondentName } = data

  // Finalized state
  if (poll.status === 'finalized' && poll.finalizedSlot) {
    return (
      <GradientBg>
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto">
            <div className="mb-6">
              <p className="text-sm text-muted-foreground">{org.name}</p>
              <h1 className="text-2xl font-display font-semibold text-foreground">
                {poll.title}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {opportunity.title}
              </p>
            </div>

            <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 mb-6">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="size-5 text-blue-600" />
                <span className="font-semibold text-blue-900">
                  Time Finalized
                </span>
              </div>
              <p className="text-blue-800">
                {weekdayLong(poll.finalizedSlot.day)} at{' '}
                {formatTime(poll.finalizedSlot.startMinutes)} –{' '}
                {formatTime(poll.finalizedSlot.endMinutes)} ({poll.timezone})
              </p>
            </div>

            <AvailabilityGrid
              days={poll.days}
              startMinutes={poll.startMinutes}
              endMinutes={poll.endMinutes}
              slotDurationMinutes={poll.slotDurationMinutes}
              timezone={poll.timezone}
              slots={slots}
              onSlotsChange={() => {}}
              readOnly
              finalizedSlot={poll.finalizedSlot}
            />
          </div>
        </main>
      </GradientBg>
    )
  }

  // Closed state
  if (poll.status === 'closed') {
    return (
      <GradientBg>
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <Lock className="size-8 text-slate-400 mx-auto mb-4" />
            <h1 className="text-2xl font-display text-foreground mb-4">
              Poll Closed
            </h1>
            <p className="text-muted-foreground">
              This availability poll is no longer accepting responses.
            </p>
          </div>
        </main>
      </GradientBg>
    )
  }

  return (
    <GradientBg>
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-3xl mx-auto">
          <div className="mb-6">
            <p className="text-sm text-muted-foreground">{org.name}</p>
            <h1 className="text-2xl font-display font-semibold text-foreground">
              {poll.title}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {opportunity.title} · Timezone: {poll.timezone.replace(/_/g, ' ')}
            </p>
            <p className="text-sm text-foreground mt-2">
              Responding as: <strong>{respondentName}</strong>
            </p>
          </div>

          <AvailabilityGrid
            days={poll.days}
            startMinutes={poll.startMinutes}
            endMinutes={poll.endMinutes}
            slotDurationMinutes={poll.slotDurationMinutes}
            timezone={poll.timezone}
            slots={slots}
            onSlotsChange={handleSlotsChange}
          />

          <div className="flex items-center justify-end mt-4 text-sm text-muted-foreground">
            {saveStatus === 'saving' && (
              <span className="flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" />
                Saving...
              </span>
            )}
            {saveStatus === 'saved' && (
              <span className="flex items-center gap-1.5 text-green-600">
                <Check className="size-3.5" />
                Saved
              </span>
            )}
          </div>
        </div>
      </main>
    </GradientBg>
  )
}

function formatTime(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return m === 0
    ? `${h12}:00 ${period}`
    : `${h12}:${String(m).padStart(2, '0')} ${period}`
}
