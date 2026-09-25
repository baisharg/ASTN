import { useUser } from '@clerk/clerk-react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { CheckCircle2, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../../../../../convex/_generated/api'
import { MAX_NOTE_LENGTH } from '../../../../../../../convex/social/constants'
import type { socialProfileView } from '../../../../../../../convex/social/lib'
import type { LiveState } from '~/components/social/live'
import type { AttendeeState } from '~/components/social/ui'
import type { Id } from '../../../../../../../convex/_generated/dataModel'
import { useSocialEvent } from '~/components/social/SocialEventContext'
import {
  MeetingBanner,
  PageSpinner,
  requestBlock,
  requestBlockCopy,
  SignedInGate,
  useLiveState,
  useMeetingsOpen,
  useSocialErrorMessage,
  useStartMeeting,
} from '~/components/social/live'
import {
  Avatar,
  BackLink,
  Chip,
  Eyebrow,
  Panel,
  StateLabel,
  primaryButtonClass,
  secondaryButtonClass,
} from '~/components/social/ui'
import { Spinner } from '~/components/ui/spinner'
import { useCopy } from '~/lib/social-i18n'
import { useBusyAction } from '~/lib/use-busy-action'

export const Route = createFileRoute('/org/$slug/e/$eventSlug/people/$userId')({
  component: PersonPage,
})

type ProfileView = ReturnType<typeof socialProfileView>

const copy = {
  es: {
    back: 'Volver a asistentes',
    backToEvent: 'Volver al evento',
    notFoundTitle: 'No encontramos a esta persona',
    notFoundBody:
      'Puede que ya no esté confirmada para este evento o que su perfil no sea visible para vos.',
    attendeesOnly: 'Los 1:1 son para asistentes confirmados del evento.',
    toRegistration: 'Ir a la inscripción',
    selfTitle: 'Este es tu perfil',
    selfBody: 'Así te ven los demás asistentes.',
    editProfile: 'Editar perfil',
    whyTitle: (name: string) => `Por qué conversar con ${name}`,
    topics: 'Temas para arrancar',
    seeking: 'Qué busca',
    canHelpWith: 'En qué puede ayudar',
    careerGoals: 'Objetivos',
    workHistory: 'Trayectoria',
    interests: 'Intereses',
    skills: 'Habilidades',
    present: 'hoy',
    visibility: (name: string, event: string) =>
      `El perfil de ${name} es visible para asistentes de ${event}.`,
    requestLabel: 'Pedir un 1:1',
    noteLabel: 'Agregá una nota (opcional)',
    notePlaceholder: 'Contale de qué te gustaría hablar',
    meetNow: 'Reunirse ahora',
    theyInMeetingHint: (name: string) =>
      `${name} está en una reunión. Tu solicitud queda en su fila y la ve cuando termine.`,
    sentTitle: 'Solicitud enviada',
    sentAvailable: (name: string) =>
      `${name} está disponible, así que la ve ahora. Si acepta, les asignamos un lugar para reunirse.`,
    sentInMeeting: (name: string) =>
      `${name} está en una reunión. Ve tu solicitud cuando termine.`,
    sentBusy: (name: string) =>
      `${name} no está tomando solicitudes ahora. La ve cuando vuelva a estar disponible.`,
    cancel: 'Cancelar solicitud',
    backShort: 'Volver',
    theyAskedTitle: (name: string) => `${name} quiere reunirse con vos`,
    accept: 'Aceptar',
    decline: 'Rechazar',
    sent: 'Solicitud enviada.',
    cancelled: 'Cancelaste la solicitud.',
    declined: 'Rechazaste la solicitud.',
  },
  en: {
    back: 'Back to attendees',
    backToEvent: 'Back to the event',
    notFoundTitle: "We couldn't find this person",
    notFoundBody:
      "They may no longer be confirmed for this event, or their profile isn't visible to you.",
    attendeesOnly: '1:1s are for confirmed attendees of the event.',
    toRegistration: 'Go to registration',
    selfTitle: 'This is your profile',
    selfBody: 'This is how other attendees see you.',
    editProfile: 'Edit profile',
    whyTitle: (name: string) => `Why talk to ${name}`,
    topics: 'Conversation starters',
    seeking: "What they're looking for",
    canHelpWith: 'What they can help with',
    careerGoals: 'Goals',
    workHistory: 'Experience',
    interests: 'Interests',
    skills: 'Skills',
    present: 'present',
    visibility: (name: string, event: string) =>
      `${name}'s profile is visible to ${event} attendees.`,
    requestLabel: 'Ask for a 1:1',
    noteLabel: 'Add a note (optional)',
    notePlaceholder: "Tell them what you'd like to talk about",
    meetNow: 'Meet now',
    theyInMeetingHint: (name: string) =>
      `${name} is in a meeting. Your request waits in their queue and they'll see it when it ends.`,
    sentTitle: 'Request sent',
    sentAvailable: (name: string) =>
      `${name} is available, so they'll see it now. If they accept, you both get a spot to meet.`,
    sentInMeeting: (name: string) =>
      `${name} is in a meeting. They'll see your request when it ends.`,
    sentBusy: (name: string) =>
      `${name} isn't taking requests right now. They'll see it when they're available again.`,
    cancel: 'Cancel request',
    backShort: 'Back',
    theyAskedTitle: (name: string) => `${name} wants to meet you`,
    accept: 'Accept',
    decline: 'Decline',
    sent: 'Request sent.',
    cancelled: 'You cancelled the request.',
    declined: 'You declined the request.',
  },
}

/**
 * Open to any signed-in person: attendees see each other, and others see a
 * profile when its owner widened its visibility. Only attendees get the 1:1
 * request card.
 */
function PersonPage() {
  return (
    <SignedInGate>
      <PersonContent />
    </SignedInGate>
  )
}

function PersonContent() {
  const event = useSocialEvent()
  const { slug, eventSlug, userId } = Route.useParams()
  const t = useCopy(copy)
  const { user } = useUser()
  const person = useQuery(api.social.meetings.getAttendeeProfile, {
    eventId: event._id,
    userId,
  })
  const live = useLiveState()
  // Both must agree before we offer 1:1 actions that depend on live state.
  const attendeeLive =
    person?.viewerIsAttendee && live?.isAttendee ? live : null

  const back = (
    <div className="-ml-3">
      {person?.viewerIsAttendee === false || live?.isAttendee === false ? (
        <BackLink
          to="/org/$slug/e/$eventSlug"
          params={{ slug, eventSlug }}
          label={t.backToEvent}
        />
      ) : (
        <BackLink
          to="/org/$slug/e/$eventSlug/people"
          params={{ slug, eventSlug }}
          label={t.back}
        />
      )}
    </div>
  )

  if (person === undefined) {
    return (
      <main className="px-5 pt-2">
        {back}
        <PageSpinner />
      </main>
    )
  }
  if (person === null) {
    return (
      <main className="flex flex-col gap-4 px-5 pb-8 pt-2">
        {back}
        <Panel>
          <h1 className="text-[19px] font-semibold text-[var(--baish-strong)]">
            {t.notFoundTitle}
          </h1>
          <p className="text-[15px]">{t.notFoundBody}</p>
        </Panel>
      </main>
    )
  }

  const profile = person.profile as ProfileView
  const firstName = profile.name.split(' ')[0] ?? profile.name
  const isSelf = user?.id === userId

  return (
    <main className="flex flex-col gap-[22px] px-5 pb-8 pt-2">
      {back}
      <section className="flex flex-col gap-3">
        <Avatar initials={person.initials} size={72} />
        <div className="flex flex-col gap-1">
          <h1 className="baish-serif text-[30px] font-semibold leading-tight text-[var(--baish-strong)]">
            {profile.name}
          </h1>
          {profile.headline && (
            <p className="text-[15px]">{profile.headline}</p>
          )}
          {profile.location && (
            <p className="text-sm text-muted-foreground">{profile.location}</p>
          )}
        </div>
        <div className="flex items-center gap-4">
          {person.viewerIsAttendee && <StateLabel state={person.state} />}
          {profile.linkedinUrl && (
            <a
              href={profile.linkedinUrl}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-11 items-center gap-1 text-sm font-semibold text-[var(--baish-brand-text)] underline-offset-2 hover:underline"
            >
              LinkedIn
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
      </section>

      {person.suggestion && (
        <section
          aria-labelledby="why-title"
          className="flex flex-col gap-3 rounded-2xl bg-muted p-4"
        >
          <h2
            id="why-title"
            className="text-base font-semibold text-[var(--baish-strong)]"
          >
            {t.whyTitle(firstName)}
          </h2>
          <p className="text-[15px] leading-normal">
            {person.suggestion.reason}
          </p>
          {person.suggestion.topics.length > 0 && (
            <div className="flex flex-col gap-2">
              <Eyebrow>{t.topics}</Eyebrow>
              <ul className="flex list-disc flex-col gap-1.5 pl-[18px] text-sm leading-snug">
                {person.suggestion.topics.map((topic) => (
                  <li key={topic}>{topic}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <ProfileSections profile={profile} />

      {person.viewerIsAttendee && (
        <p className="text-[13px] text-muted-foreground">
          {t.visibility(firstName, event.title)}
        </p>
      )}

      {isSelf ? (
        <Panel raised>
          <h2 className="text-base font-semibold text-[var(--baish-strong)]">
            {t.selfTitle}
          </h2>
          <p className="text-[15px]">{t.selfBody}</p>
          <Link
            to="/org/$slug/e/$eventSlug/profile"
            params={{ slug, eventSlug }}
            className={secondaryButtonClass}
          >
            {t.editProfile}
          </Link>
        </Panel>
      ) : !person.viewerIsAttendee ? (
        <Panel className="gap-3 p-4">
          <p className="text-[15px] leading-normal">{t.attendeesOnly}</p>
          <Link
            to="/org/$slug/e/$eventSlug"
            params={{ slug, eventSlug }}
            className={secondaryButtonClass}
          >
            {t.toRegistration}
          </Link>
        </Panel>
      ) : attendeeLive ? (
        <RequestCard
          live={attendeeLive}
          userId={userId}
          firstName={firstName}
          state={person.state}
          pendingRequestId={person.pendingRequestId}
          theyRequestedMe={person.theyRequestedMe}
        />
      ) : live === undefined ? (
        <PageSpinner />
      ) : null}

      <MeetingBanner meeting={attendeeLive?.meeting ?? null} />
    </main>
  )
}

function ProfileSections({ profile }: { profile: ProfileView }) {
  const t = useCopy(copy)
  const year = (ts: number | null) =>
    ts === null ? null : new Date(ts).getUTCFullYear().toString()

  const texts: Array<[string, string | null]> = [
    [t.seeking, profile.seeking],
    [t.canHelpWith, profile.canHelpWith],
    [t.careerGoals, profile.careerGoals],
  ]
  const chips: Array<[string, Array<string>]> = [
    [t.interests, profile.interests],
    [t.skills, profile.skills],
  ]

  return (
    <section className="flex flex-col gap-[18px]">
      {texts.map(([title, body]) =>
        body ? (
          <div key={title} className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {title}
            </h2>
            <p className="whitespace-pre-line text-[15px] leading-normal">
              {body}
            </p>
          </div>
        ) : null,
      )}
      {profile.workHistory.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            {t.workHistory}
          </h2>
          <ul className="flex flex-col gap-2">
            {profile.workHistory.map((job, i) => {
              const from = year(job.startDate)
              const to = job.current ? t.present : year(job.endDate)
              const span = from && to ? `${from} – ${to}` : (from ?? to)
              return (
                <li
                  key={`${job.organization}-${i}`}
                  className="flex flex-col gap-0.5"
                >
                  <span className="text-[15px] font-semibold text-[var(--baish-strong)]">
                    {job.title}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {[job.organization, span].filter(Boolean).join(' · ')}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {chips.map(([title, items]) =>
        items.length > 0 ? (
          <div key={title} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {title}
            </h2>
            <ul className="flex flex-wrap gap-1.5">
              {items.map((item) => (
                <li key={item}>
                  <Chip>{item}</Chip>
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </section>
  )
}

function RequestCard({
  live,
  userId,
  firstName,
  state,
  pendingRequestId,
  theyRequestedMe,
}: {
  live: LiveState
  userId: string
  firstName: string
  state: AttendeeState
  pendingRequestId: Id<'socialMeetingRequests'> | null
  theyRequestedMe: Id<'socialMeetingRequests'> | null
}) {
  const { slug, eventSlug } = Route.useParams()
  const t = useCopy(copy)
  const blockText = useCopy(requestBlockCopy)
  const errorMessage = useSocialErrorMessage()
  const startMeeting = useStartMeeting()
  const respondToRequest = useMutation(api.social.meetings.respondToRequest)
  const cancelRequest = useMutation(api.social.meetings.cancelRequest)
  const meetingsOpen = useMeetingsOpen()
  const [note, setNote] = useState('')
  const { busy, run: runBusy } = useBusyAction<
    'send' | 'accept' | 'decline' | 'cancel'
  >()
  const run = <T,>(key: NonNullable<typeof busy>, action: () => Promise<T>) =>
    runBusy(key, action, (error) => toast.error(errorMessage(error)))

  const block = requestBlock(live, meetingsOpen, userId, state)

  if (theyRequestedMe) {
    const requestId = theyRequestedMe
    return (
      <Panel raised aria-labelledby="request-title">
        <h2
          id="request-title"
          className="text-base font-semibold text-[var(--baish-strong)]"
        >
          {t.theyAskedTitle(firstName)}
        </h2>
        {block && (
          <p className="text-sm leading-normal text-muted-foreground">
            {blockText[block](firstName)}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void run('decline', async () => {
                await respondToRequest({ requestId, accept: false })
                toast.success(t.declined)
              })
            }
            className={`${secondaryButtonClass} grow basis-0`}
          >
            {busy === 'decline' ? <Spinner size="sm" /> : t.decline}
          </button>
          <button
            type="button"
            disabled={busy !== null || block !== null}
            onClick={() =>
              void run('accept', () => startMeeting.accept(requestId))
            }
            className={`${primaryButtonClass} h-12 grow basis-0 text-[15px]`}
          >
            {busy === 'accept' ? <Spinner size="sm" /> : t.accept}
          </button>
        </div>
      </Panel>
    )
  }

  if (pendingRequestId) {
    const requestId = pendingRequestId
    const body =
      state === 'available'
        ? t.sentAvailable(firstName)
        : state === 'in_meeting'
          ? t.sentInMeeting(firstName)
          : t.sentBusy(firstName)
    return (
      <Panel raised aria-labelledby="request-title">
        <div className="flex items-center gap-2 text-[var(--baish-ok)]">
          <CheckCircle2 className="size-5" aria-hidden="true" />
          <h2 id="request-title" className="text-base font-semibold">
            {t.sentTitle}
          </h2>
        </div>
        <p className="text-[15px] leading-normal">{body}</p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void run('cancel', async () => {
                await cancelRequest({ requestId })
                toast.success(t.cancelled)
              })
            }
            className={`${secondaryButtonClass} grow basis-0`}
          >
            {busy === 'cancel' ? <Spinner size="sm" /> : t.cancel}
          </button>
          <Link
            to="/org/$slug/e/$eventSlug/people"
            params={{ slug, eventSlug }}
            className="flex h-12 grow basis-0 items-center justify-center rounded-xl bg-muted px-4 text-[15px] font-semibold text-[var(--baish-brand-text)] hover:bg-secondary/70"
          >
            {t.backShort}
          </Link>
        </div>
      </Panel>
    )
  }

  const send = async () => {
    const started = await run('send', () =>
      startMeeting.request(userId, note.trim() || undefined),
    )
    if (started === false) {
      setNote('')
      toast.success(t.sent)
    }
  }

  return (
    <Panel raised aria-label={t.requestLabel} className="gap-2.5 p-4">
      <label
        htmlFor="request-note"
        className="text-sm font-semibold text-[var(--baish-strong)]"
      >
        {t.noteLabel}
      </label>
      <textarea
        id="request-note"
        rows={2}
        maxLength={MAX_NOTE_LENGTH}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t.notePlaceholder}
        aria-describedby="request-note-count"
        disabled={block !== null}
        className="resize-none rounded-xl border border-input bg-background px-3.5 py-3 text-[15px] text-[var(--baish-strong)] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      />
      <span
        id="request-note-count"
        className="self-end text-xs text-muted-foreground"
      >
        {note.length}/{MAX_NOTE_LENGTH}
      </span>
      {block ? (
        <p className="text-sm leading-normal text-muted-foreground">
          {blockText[block](firstName)}
        </p>
      ) : (
        state === 'in_meeting' && (
          <p className="text-sm leading-normal text-muted-foreground">
            {t.theyInMeetingHint(firstName)}
          </p>
        )
      )}
      <button
        type="button"
        disabled={busy !== null || block !== null}
        onClick={() => void send()}
        className={primaryButtonClass}
      >
        {busy === 'send' ? <Spinner size="sm" /> : t.meetNow}
      </button>
    </Panel>
  )
}
