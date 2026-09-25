import { SignInButton } from '@clerk/clerk-react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useConvexAuth, useMutation, useQuery } from 'convex/react'
import { ArrowRight, MapPin } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import { MAX_OUTGOING_PENDING } from '../../../convex/social/constants'
import { useNow, useSocialEvent } from './SocialEventContext'
import { Panel, primaryButtonClass, secondaryButtonClass } from './ui'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '../../../convex/_generated/dataModel'
import type { MeetingErrorCode } from '../../../convex/social/constants'
import type { AttendeeState } from './ui'
import type { SocialLang } from '~/lib/social-i18n'
import { Spinner } from '~/components/ui/spinner'
import { errorCode, errorText } from '~/lib/convex-error'
import { useCopy, useSocialLang } from '~/lib/social-i18n'

/** Live state for the signed-in attendee (see meetings.getLiveState). */
export type LiveState = NonNullable<
  FunctionReturnType<typeof api.social.meetings.getLiveState>
>
export type LiveMeeting = NonNullable<LiveState['meeting']>

const copy = {
  es: {
    signInTitle: 'Iniciá sesión para seguir',
    signInBody:
      'Esta parte es para asistentes confirmados. Entrá con la misma cuenta con la que te registraste.',
    signInButton: 'Iniciar sesión',
    notAttendeeTitle: 'Esta parte es para asistentes confirmados',
    notAttendeeBody:
      'Cuando confirmemos tu lugar vas a poder ver a los demás asistentes y pedir 1:1.',
    toRegistration: 'Ir a la inscripción',
    bannerSpot: (n: number) => `Tenés una reunión en el lugar ${n}`,
    bannerNoSpot: 'Tenés una reunión en curso',
    bannerWith: (name: string) => `con ${name}`,
    bannerOpen: 'Abrir',
  },
  en: {
    signInTitle: 'Sign in to continue',
    signInBody:
      'This part is for confirmed attendees. Sign in with the account you registered with.',
    signInButton: 'Sign in',
    notAttendeeTitle: 'This part is for confirmed attendees',
    notAttendeeBody:
      "Once your place is confirmed you'll be able to see the other attendees and ask for 1:1s.",
    toRegistration: 'Go to registration',
    bannerSpot: (n: number) => `You have a meeting at spot ${n}`,
    bannerNoSpot: 'You have a meeting in progress',
    bannerWith: (name: string) => `with ${name}`,
    bannerOpen: 'Open',
  },
}

/**
 * The viewer's live state, or undefined while it loads (null when signed out
 * or the event is gone). Every caller passes the same args, so the header
 * badge and the page share one subscription.
 */
export function useLiveState(): LiveState | null | undefined {
  const event = useSocialEvent()
  const { isAuthenticated } = useConvexAuth()
  const result = useQuery(
    api.social.meetings.getLiveState,
    isAuthenticated ? { eventId: event._id } : 'skip',
  )
  return isAuthenticated ? result : null
}

/** Whether 1:1s are open right now; re-checked every 30 seconds. */
export function useMeetingsOpen(): boolean {
  const event = useSocialEvent()
  const now = useNow()
  return (
    event.status === 'published' &&
    now >= event.meetingsOpenAt &&
    now <= event.meetingsCloseAt
  )
}

/** A card with a title, a body and a Clerk sign-in button. */
export function SignInPanel({
  title,
  body,
  buttonLabel,
  children,
  headingLevel = 'h2',
}: {
  title: string
  body: string
  buttonLabel?: string
  children?: React.ReactNode
  // h1 when the panel is the whole page (the attendee pages' sign-in gate).
  headingLevel?: 'h1' | 'h2'
}) {
  const Heading = headingLevel
  const t = useCopy(copy)
  const redirect =
    typeof window !== 'undefined' ? window.location.href : undefined
  return (
    <Panel raised aria-label={title}>
      <div className="flex flex-col gap-1.5">
        <Heading className="text-[19px] font-semibold text-[var(--baish-strong)]">
          {title}
        </Heading>
        <p className="text-[15px] leading-normal">{body}</p>
      </div>
      <SignInButton
        mode="modal"
        forceRedirectUrl={redirect}
        signUpForceRedirectUrl={redirect}
      >
        <button type="button" className={primaryButtonClass}>
          {buttonLabel ?? t.signInButton}
        </button>
      </SignInButton>
      {children}
    </Panel>
  )
}

/**
 * Renders `children` once the viewer is signed in; otherwise a loading or
 * sign-in screen. Use it for pages any signed-in person may open.
 */
export function SignedInGate({ children }: { children: React.ReactNode }) {
  const t = useCopy(copy)
  const { isAuthenticated, isLoading } = useConvexAuth()

  if (isLoading) return <PageSpinner />
  if (!isAuthenticated) {
    return (
      <main className="px-5 pb-10 pt-6">
        <SignInPanel
          title={t.signInTitle}
          body={t.signInBody}
          headingLevel="h1"
        />
      </main>
    )
  }
  return <>{children}</>
}

/**
 * Renders `children` with the live state once the viewer is signed in and an
 * approved attendee; otherwise a loading, sign-in or "not an attendee" screen.
 * Attendee-only queries live inside `children`, so they never run for others.
 */
export function AttendeeGate({
  children,
}: {
  children: (live: LiveState) => React.ReactNode
}) {
  return (
    <SignedInGate>
      <AttendeeOnly>{children}</AttendeeOnly>
    </SignedInGate>
  )
}

function AttendeeOnly({
  children,
}: {
  children: (live: LiveState) => React.ReactNode
}) {
  const event = useSocialEvent()
  const t = useCopy(copy)
  const live = useLiveState()

  if (live === undefined) return <PageSpinner />

  if (!live?.isAttendee) {
    return (
      <main className="px-5 pb-10 pt-6">
        <Panel raised>
          <h1 className="text-[19px] font-semibold text-[var(--baish-strong)]">
            {t.notAttendeeTitle}
          </h1>
          <p className="text-[15px] leading-normal">{t.notAttendeeBody}</p>
          <Link
            to="/org/$slug/e/$eventSlug"
            params={{ slug: event.orgSlug, eventSlug: event.slug }}
            className={secondaryButtonClass}
          >
            {t.toRegistration}
          </Link>
        </Panel>
      </main>
    )
  }

  return <>{children(live)}</>
}

export function PageSpinner() {
  return (
    <div className="flex justify-center px-5 py-16">
      <Spinner />
    </div>
  )
}

/**
 * Pinned to the bottom of the screen while the viewer has a meeting in
 * progress, so someone accepting their request elsewhere doesn't go unseen.
 */
export function MeetingBanner({ meeting }: { meeting: LiveMeeting | null }) {
  const event = useSocialEvent()
  const t = useCopy(copy)
  return (
    <div role="status" aria-live="polite">
      {meeting && (
        <>
          {/* Keeps the page's last content clear of the fixed banner. */}
          <div className="h-24" aria-hidden="true" />
          <div className="fixed inset-x-0 bottom-0 z-30 px-3 pb-3">
            <Link
              to="/org/$slug/e/$eventSlug/meeting"
              params={{ slug: event.orgSlug, eventSlug: event.slug }}
              className="mx-auto flex min-h-14 max-w-xl items-center gap-3 rounded-2xl bg-[var(--baish-strong)] px-4 py-3 text-white shadow-[0_8px_24px_rgba(17,12,46,0.25)] hover:bg-foreground"
            >
              <MapPin className="size-5 shrink-0" aria-hidden="true" />
              <span className="flex min-w-0 grow flex-col">
                <span className="text-[15px] font-semibold">
                  {meeting.spot
                    ? t.bannerSpot(meeting.spot.number)
                    : t.bannerNoSpot}
                </span>
                <span className="truncate text-[13px] text-white/80">
                  {t.bannerWith(meeting.partner.name)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-sm font-semibold">
                {t.bannerOpen}
                <ArrowRight className="size-4" aria-hidden="true" />
              </span>
            </Link>
          </div>
        </>
      )}
    </div>
  )
}

// ── Errors ──────────────────────────────────────────────────────────────

const genericError = {
  es: 'Algo salió mal. Probá de nuevo en un momento.',
  en: 'Something went wrong. Please try again in a moment.',
} satisfies Record<SocialLang, string>

const meetingErrorCopy = {
  es: {
    closed: 'Los 1:1 no están abiertos en este momento.',
    not_attendee: 'Esto es solo para asistentes confirmados.',
    self: 'No podés pedirte un 1:1 a vos mismo.',
    busy: 'Esta persona no está tomando solicitudes ahora.',
    limit: `Ya tenés ${MAX_OUTGOING_PENDING} solicitudes esperando. Cancelá alguna para mandar otra.`,
    self_in_meeting: 'Primero terminá tu reunión actual.',
    they_in_meeting: 'Está en una reunión. Probá de nuevo cuando termine.',
    ended: 'Esta reunión ya terminó.',
    not_found: 'Eso ya no existe.',
  },
  en: {
    closed: '1:1s are not open right now.',
    not_attendee: 'This is only for confirmed attendees.',
    self: "You can't ask yourself for a 1:1.",
    busy: "They're not taking requests right now.",
    limit: `You already have ${MAX_OUTGOING_PENDING} requests waiting. Cancel one to send another.`,
    self_in_meeting: 'Finish your current meeting first.',
    they_in_meeting: "They're in a meeting. Try again when it ends.",
    ended: 'This meeting has already ended.',
    not_found: 'That no longer exists.',
  },
} satisfies Record<SocialLang, Record<MeetingErrorCode, string>>

/** Turns an error from a 1:1 mutation into a message in the page language. */
export function useSocialErrorMessage() {
  const { lang } = useSocialLang()
  return (error: unknown) => {
    const code = errorCode<MeetingErrorCode>(error)
    return code && code in meetingErrorCopy[lang]
      ? meetingErrorCopy[lang][code]
      : errorText(error, genericError[lang])
  }
}

// ── Time ────────────────────────────────────────────────────────────────

/** "hace 3 min" / "3 min ago". */
export function timeAgo(from: number, now: number, lang: SocialLang): string {
  const seconds = Math.max(0, Math.round((now - from) / 1000))
  const amount =
    seconds < 60
      ? `${Math.max(seconds, 1)} s`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)} min`
        : `${Math.floor(seconds / 3600)} h`
  return lang === 'es' ? `hace ${amount}` : `${amount} ago`
}

/** "1 h 12 min", "12 min" or "<1 min". */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '<1 min'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

// ── Requests ────────────────────────────────────────────────────────────

export type RequestBlock = Extract<
  MeetingErrorCode,
  'closed' | 'busy' | 'limit' | 'self_in_meeting' | 'they_in_meeting'
>

/**
 * Why the viewer can't ask `otherUserId` to meet right now, or null if they
 * can. Mirrors the checks in requestMeeting: when the other person already
 * asked, sending accepts their request, which needs both people free.
 */
export function requestBlock(
  live: LiveState,
  meetingsOpen: boolean,
  otherUserId: string,
  otherState: AttendeeState,
): RequestBlock | null {
  if (!meetingsOpen) return 'closed'
  if (live.incoming.some((r) => r.from.userId === otherUserId)) {
    if (live.meeting) return 'self_in_meeting'
    if (otherState === 'in_meeting') return 'they_in_meeting'
    return null
  }
  if (otherState === 'busy') return 'busy'
  if (live.outgoing.length >= MAX_OUTGOING_PENDING) return 'limit'
  return null
}

export const requestBlockCopy = {
  es: {
    closed: () => 'Los 1:1 no están abiertos en este momento.',
    busy: (name: string) => `${name} no está tomando solicitudes ahora.`,
    limit: () =>
      `Tenés ${MAX_OUTGOING_PENDING} solicitudes esperando. Cancelá alguna para mandar otra.`,
    self_in_meeting: (name: string) =>
      `${name} te pidió un 1:1. Vas a poder aceptar cuando termine tu reunión.`,
    they_in_meeting: (name: string) =>
      `${name} te pidió un 1:1 y ahora está en una reunión. Vas a poder aceptar cuando termine.`,
  },
  en: {
    closed: () => '1:1s are not open right now.',
    busy: (name: string) => `${name} isn't taking requests right now.`,
    limit: () =>
      `You have ${MAX_OUTGOING_PENDING} requests waiting. Cancel one to send another.`,
    self_in_meeting: (name: string) =>
      `${name} asked you for a 1:1. You can accept once your meeting ends.`,
    they_in_meeting: (name: string) =>
      `${name} asked you for a 1:1 and is in a meeting now. You can accept once it ends.`,
  },
} satisfies Record<SocialLang, Record<RequestBlock, (name: string) => string>>

/**
 * Asking someone to meet and accepting a request can both start a meeting
 * (asking someone who already asked you accepts theirs). Either way, a
 * started meeting opens the meeting page.
 */
export function useStartMeeting() {
  const event = useSocialEvent()
  const navigate = useNavigate()
  const requestMeeting = useMutation(api.social.meetings.requestMeeting)
  const respondToRequest = useMutation(api.social.meetings.respondToRequest)

  const openIfStarted = (meetingId: Id<'socialMeetings'> | null) => {
    if (meetingId) {
      void navigate({
        to: '/org/$slug/e/$eventSlug/meeting',
        params: { slug: event.orgSlug, eventSlug: event.slug },
      })
    }
    return meetingId !== null
  }

  return {
    /** Resolves to true if this started a meeting. */
    request: async (toUserId: string, note?: string) => {
      const { meetingId } = await requestMeeting({
        eventId: event._id,
        toUserId,
        note,
      })
      return openIfStarted(meetingId)
    },
    accept: async (requestId: Id<'socialMeetingRequests'>) =>
      openIfStarted(await respondToRequest({ requestId, accept: true })),
  }
}
