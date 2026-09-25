import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../../../../convex/_generated/api'
import type { LiveMeeting, LiveState } from '~/components/social/live'
import { useNow, useSocialEvent } from '~/components/social/SocialEventContext'
import { AttendeeGate, useSocialErrorMessage } from '~/components/social/live'
import { FloorPlan } from '~/components/social/FloorPlan'
import {
  BackLink,
  Eyebrow,
  PageTitle,
  Panel,
  primaryButtonClass,
  secondaryButtonClass,
} from '~/components/social/ui'
import { Spinner } from '~/components/ui/spinner'
import { useCopy } from '~/lib/social-i18n'

export const Route = createFileRoute('/org/$slug/e/$eventSlug/meeting')({
  component: MeetingPage,
})

const copy = {
  es: {
    back: 'Volver a asistentes',
    inMeeting: 'En reunión',
    meetingWith: 'Te reunís con',
    viewProfile: 'Ver perfil',
    spotSection: 'Lugar de la reunión',
    spot: (n: number) => `Lugar ${n}`,
    planLabel: (n: number, label: string | null) =>
      label
        ? `Plano del lugar con el lugar ${n} marcado: ${label}`
        : `Plano del lugar con el lugar ${n} marcado`,
    noSpotTitle: 'Sin lugar asignado',
    noSpotBody:
      'Todos los lugares están ocupados. Encuéntrense en algún rincón tranquilo.',
    timeSection: 'Tiempo restante',
    remaining: 'restantes',
    timeUp: 'Se terminó el tiempo',
    timeLeft: (clock: string) => `Quedan ${clock}`,
    addFive: 'Sumar 5 minutos',
    added: 'Sumamos 5 minutos.',
    end: 'Terminar reunión',
    topics: 'Temas para arrancar',
    endedTitle: 'Reunión terminada',
    endedWith: (name: string) => `Tu reunión con ${name} terminó.`,
    nextInQueue: (name: string) =>
      `Siguiente en tu fila: ${name} quiere reunirse.`,
    takeBreak: 'Tomarme un descanso',
    breakSet: 'Listo, te marcamos como no disponible.',
    breakFailed: 'No pudimos cambiar tu estado. Probá de nuevo.',
    seeRequest: 'Ver solicitud',
    findMore: 'Buscar a alguien más',
    noneTitle: 'No tenés una reunión en curso',
    noneBody:
      'Cuando alguien acepte tu solicitud, o vos aceptes una, acá vas a ver con quién y dónde se reúnen.',
    incomingPrompt: (n: number) =>
      n === 1
        ? 'Tenés 1 solicitud esperando respuesta.'
        : `Tenés ${n} solicitudes esperando respuesta.`,
    openRequests: 'Ver solicitudes',
    seePeople: 'Ver asistentes',
  },
  en: {
    back: 'Back to attendees',
    inMeeting: 'In a meeting',
    meetingWith: "You're meeting",
    viewProfile: 'View profile',
    spotSection: 'Meeting spot',
    spot: (n: number) => `Spot ${n}`,
    planLabel: (n: number, label: string | null) =>
      label
        ? `Floor plan with spot ${n} marked: ${label}`
        : `Floor plan with spot ${n} marked`,
    noSpotTitle: 'No spot assigned',
    noSpotBody: 'Every spot is taken. Find a quiet corner to meet.',
    timeSection: 'Time left',
    remaining: 'left',
    timeUp: "Time's up",
    timeLeft: (clock: string) => `${clock} left`,
    addFive: 'Add 5 minutes',
    added: 'Added 5 minutes.',
    end: 'End meeting',
    topics: 'Conversation starters',
    endedTitle: 'Meeting ended',
    endedWith: (name: string) => `Your meeting with ${name} has ended.`,
    nextInQueue: (name: string) => `Next in your queue: ${name} wants to meet.`,
    takeBreak: 'Take a break',
    breakSet: "Done, you're marked as not available.",
    breakFailed: "We couldn't change your status. Please try again.",
    seeRequest: 'See request',
    findMore: 'Find someone else',
    noneTitle: "You don't have a meeting in progress",
    noneBody:
      "When someone accepts your request, or you accept one, you'll see who you're meeting and where.",
    incomingPrompt: (n: number) =>
      n === 1
        ? 'You have 1 request waiting for an answer.'
        : `You have ${n} requests waiting for an answer.`,
    openRequests: 'See requests',
    seePeople: 'See attendees',
  },
}

function MeetingPage() {
  return <AttendeeGate>{(live) => <MeetingContent live={live} />}</AttendeeGate>
}

function MeetingContent({ live }: { live: LiveState }) {
  const { slug, eventSlug } = Route.useParams()
  const t = useCopy(copy)
  // The meeting that was on screen, so we can say it ended once it's gone.
  const [lastMeeting, setLastMeeting] = useState<LiveMeeting | null>(null)
  useEffect(() => {
    if (live.meeting) setLastMeeting(live.meeting)
  }, [live.meeting])

  const header = (
    <div className="-ml-3 flex items-center justify-between">
      <BackLink
        to="/org/$slug/e/$eventSlug/people"
        params={{ slug, eventSlug }}
        label={t.back}
      />
      {live.meeting && (
        <span className="flex items-center gap-1.5 rounded-full bg-[var(--baish-warn-bg)] px-3 py-1.5 text-[13px] font-semibold text-[var(--baish-warn)]">
          <span className="size-2 rounded-full bg-[var(--baish-warn-dot)]" />
          {t.inMeeting}
        </span>
      )}
    </div>
  )

  if (live.meeting) {
    return (
      <main className="flex flex-col gap-[22px] px-5 pb-8 pt-2">
        {header}
        <ActiveMeeting meeting={live.meeting} />
      </main>
    )
  }

  return (
    <main className="flex flex-col gap-[22px] px-5 pb-8 pt-2">
      {header}
      {lastMeeting ? (
        <EndedCard live={live} partnerName={lastMeeting.partner.name} />
      ) : (
        <NoMeeting live={live} />
      )}
    </main>
  )
}

function ActiveMeeting({ meeting }: { meeting: LiveMeeting }) {
  const { slug, eventSlug } = Route.useParams()
  const t = useCopy(copy)
  return (
    <>
      <section className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">{t.meetingWith}</p>
        <PageTitle>{meeting.partner.name}</PageTitle>
        {meeting.partner.headline && (
          <p className="text-[15px]">{meeting.partner.headline}</p>
        )}
        <Link
          to="/org/$slug/e/$eventSlug/people/$userId"
          params={{ slug, eventSlug, userId: meeting.partner.userId }}
          className="flex min-h-11 items-center self-start text-sm font-semibold text-[var(--baish-brand-text)] underline-offset-2 hover:underline"
        >
          {t.viewProfile}
        </Link>
      </section>

      {meeting.spot ? (
        <Panel aria-label={t.spotSection} className="gap-3 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[22px] font-bold text-[var(--baish-strong)]">
              {t.spot(meeting.spot.number)}
            </h2>
            {meeting.spot.label && (
              <span className="text-right text-sm text-muted-foreground">
                {meeting.spot.label}
              </span>
            )}
          </div>
          <FloorPlan
            x={meeting.spot.x}
            y={meeting.spot.y}
            number={meeting.spot.number}
            label={t.planLabel(meeting.spot.number, meeting.spot.label)}
          />
        </Panel>
      ) : (
        <Panel aria-label={t.spotSection} className="gap-1.5 p-4">
          <h2 className="text-[17px] font-semibold text-[var(--baish-strong)]">
            {t.noSpotTitle}
          </h2>
          <p className="text-[15px] leading-normal">{t.noSpotBody}</p>
        </Panel>
      )}

      <Countdown meeting={meeting} />

      {meeting.topics.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <h2>
            <Eyebrow>{t.topics}</Eyebrow>
          </h2>
          <ul className="flex list-disc flex-col gap-2 pl-[18px] text-[15px] leading-snug">
            {meeting.topics.map((topic) => (
              <li key={topic}>{topic}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

const RADIUS = 52
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function Countdown({ meeting }: { meeting: LiveMeeting }) {
  const t = useCopy(copy)
  const errorMessage = useSocialErrorMessage()
  const now = useNow(1000)
  const extendMeeting = useMutation(api.social.meetings.extendMeeting)
  const endMeeting = useMutation(api.social.meetings.endMeeting)
  const [busy, setBusy] = useState<'extend' | 'end' | null>(null)

  const total = Math.max(1, meeting.endsAt - meeting.startedAt)
  const remainingMs = Math.max(0, meeting.endsAt - now)
  const seconds = Math.ceil(remainingMs / 1000)
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  const fraction = Math.min(1, remainingMs / total)

  const run = async (kind: 'extend' | 'end', action: () => Promise<void>) => {
    setBusy(kind)
    try {
      await action()
    } catch (error) {
      console.error(error)
      toast.error(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel
      aria-label={t.timeSection}
      className="flex-row items-center gap-5 p-4"
    >
      <div
        className="relative size-[120px] shrink-0"
        role="timer"
        aria-label={remainingMs > 0 ? t.timeLeft(clock) : t.timeUp}
      >
        <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
          <circle
            cx="60"
            cy="60"
            r={RADIUS}
            fill="none"
            stroke="var(--border)"
            strokeWidth="8"
          />
          <circle
            cx="60"
            cy="60"
            r={RADIUS}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
            transform="rotate(-90 60 60)"
            className="transition-[stroke-dashoffset] duration-1000 ease-linear motion-reduce:transition-none"
          />
        </svg>
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
          aria-hidden="true"
        >
          {remainingMs > 0 ? (
            <>
              <span className="text-[26px] font-bold tabular-nums text-[var(--baish-strong)]">
                {clock}
              </span>
              <span className="text-xs text-muted-foreground">
                {t.remaining}
              </span>
            </>
          ) : (
            <span className="px-3 text-center text-sm font-semibold text-[var(--baish-strong)]">
              {t.timeUp}
            </span>
          )}
        </div>
      </div>
      <div className="flex grow flex-col gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void run('extend', async () => {
              await extendMeeting({ meetingId: meeting._id, minutes: 5 })
              toast.success(t.added)
            })
          }
          className="flex h-11 items-center justify-center rounded-xl border border-input bg-card px-3 text-sm font-semibold text-[var(--baish-brand-text)] hover:bg-muted disabled:opacity-60"
        >
          {busy === 'extend' ? <Spinner size="sm" /> : t.addFive}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void run('end', async () => {
              await endMeeting({ meetingId: meeting._id })
            })
          }
          className="flex h-11 items-center justify-center rounded-xl bg-muted px-3 text-sm font-semibold text-[var(--baish-strong)] hover:bg-secondary/70 disabled:opacity-60"
        >
          {busy === 'end' ? <Spinner size="sm" /> : t.end}
        </button>
      </div>
    </Panel>
  )
}

function EndedCard({
  live,
  partnerName,
}: {
  live: LiveState
  partnerName: string
}) {
  const event = useSocialEvent()
  const { slug, eventSlug } = Route.useParams()
  const t = useCopy(copy)
  const setAvailability = useMutation(api.social.meetings.setAvailability)
  const [saving, setSaving] = useState(false)
  const next = [...live.incoming].sort((a, b) => a.createdAt - b.createdAt)[0]

  const takeBreak = async () => {
    setSaving(true)
    try {
      await setAvailability({ eventId: event._id, availability: 'busy' })
      toast.success(t.breakSet)
    } catch (error) {
      console.error(error)
      toast.error(t.breakFailed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel raised role="status" className="gap-3 border-input p-4">
      <h1 className="text-[19px] font-semibold text-[var(--baish-strong)]">
        {t.endedTitle}
      </h1>
      <p className="text-[15px] leading-normal">
        {next ? t.nextInQueue(next.from.name) : t.endedWith(partnerName)}
      </p>
      <div className="flex gap-2">
        {live.availability === 'available' && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void takeBreak()}
            className={`${secondaryButtonClass} grow basis-0`}
          >
            {saving ? <Spinner size="sm" /> : t.takeBreak}
          </button>
        )}
        {next ? (
          <Link
            to="/org/$slug/e/$eventSlug/requests"
            params={{ slug, eventSlug }}
            className={`${primaryButtonClass} h-12 grow basis-0 text-[15px]`}
          >
            {t.seeRequest}
          </Link>
        ) : (
          <Link
            to="/org/$slug/e/$eventSlug/people"
            params={{ slug, eventSlug }}
            className={`${primaryButtonClass} h-12 grow basis-0 text-[15px]`}
          >
            {t.findMore}
          </Link>
        )}
      </div>
    </Panel>
  )
}

function NoMeeting({ live }: { live: LiveState }) {
  const { slug, eventSlug } = Route.useParams()
  const t = useCopy(copy)
  return (
    <>
      <div className="flex flex-col gap-2">
        <PageTitle>{t.noneTitle}</PageTitle>
        <p className="text-[15px] leading-normal">{t.noneBody}</p>
      </div>
      {live.incoming.length > 0 && (
        <Panel raised className="gap-3 p-4">
          <p className="text-[15px] font-semibold text-[var(--baish-strong)]">
            {t.incomingPrompt(live.incoming.length)}
          </p>
          <Link
            to="/org/$slug/e/$eventSlug/requests"
            params={{ slug, eventSlug }}
            className={`${primaryButtonClass} h-12 text-[15px]`}
          >
            {t.openRequests}
          </Link>
        </Panel>
      )}
      <Link
        to="/org/$slug/e/$eventSlug/people"
        params={{ slug, eventSlug }}
        className={secondaryButtonClass}
      >
        {t.seePeople}
      </Link>
    </>
  )
}
