import { SignInButton } from '@clerk/clerk-react'
import { Link, createFileRoute } from '@tanstack/react-router'
import {
  AuthLoading,
  Authenticated,
  Unauthenticated,
  useMutation,
  useQuery,
} from 'convex/react'
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  MapPin,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../../../../convex/_generated/api'
import { useSocialEvent } from '~/components/social/SocialEventContext'
import {
  Panel,
  primaryButtonClass,
  secondaryButtonClass,
} from '~/components/social/ui'
import { Spinner } from '~/components/ui/spinner'
import {
  formatEventDate,
  formatTime,
  useCopy,
  useSocialLang,
} from '~/lib/social-i18n'

export const Route = createFileRoute('/org/$slug/e/$eventSlug/')({
  component: EventRegistrationPage,
})

const copy = {
  es: {
    eyebrow: 'Social comunitario',
    people: (n: number) =>
      n > 0
        ? `${n} ${n === 1 ? 'persona confirmada' : 'personas confirmadas'}`
        : null,
    closed: 'La inscripción para este evento está cerrada.',
    signInTitle: 'Registrate una sola vez',
    signInBody:
      'Creá tu cuenta con Google, LinkedIn o tu email y anotate a este y a los próximos eventos de BAISH sin llenar formularios.',
    signInButton: 'Continuar',
    signInHint:
      'Si ya participaste en programas de BAISH, te reconocemos por tu mail y tu lugar se confirma al instante.',
    onList: 'Estás en la lista de invitados',
    onListBody:
      'Ya participaste en programas de BAISH, así que tu lugar se confirma al instante.',
    register: 'Registrarme',
    lumaNote:
      'También te sumamos a la lista de invitados de Luma. La entrada y el código QR para la puerta te llegan por mail desde Luma.',
    requestTitle: 'Pedí tu lugar',
    requestBody:
      'El equipo de BAISH revisa cada inscripción y te avisa por mail cuando te aprueban.',
    linkedinLabel: 'Tu LinkedIn',
    linkedinHint: 'Opcional. Nos ayuda a aprobarte más rápido.',
    requestButton: 'Pedir mi lugar',
    confirmed: 'Tu lugar está confirmado',
    confirmedLuma: 'Tu entrada de Luma está en camino a tu mail.',
    nextProfile: 'Siguiente: armá tu perfil',
    nextProfileBody:
      'Podés hacerlo ahora, antes del evento o durante. Lo usamos para sugerirte personas para conocer.',
    buildProfile: 'Armar perfil',
    profileReady: 'Tu perfil está listo para el matching.',
    seePeople: 'Ver quiénes van',
    editProfile: 'Editar perfil',
    pending: 'Inscripción pendiente',
    pendingBody: 'Te avisamos por mail cuando el equipo de BAISH la apruebe.',
    pendingProfile: 'Mientras tanto, armá tu perfil',
    pendingProfileBody:
      'Lo usamos para sugerirte personas para conocer si te aprueban.',
    declined: 'No pudimos confirmar tu lugar',
    declinedBody:
      'Esta vez no tenemos lugar para vos. Te avisamos de los próximos eventos.',
    waitlist: 'Estás en la lista de espera',
    waitlistBody: 'Si se libera un lugar te avisamos por mail.',
    invited: 'Te invitaron a este evento',
    invitedBody: 'Confirmá tu lugar desde la invitación de Luma.',
    openLuma: 'Abrir en Luma',
    howTitle: 'Cómo funcionan los 1:1',
    steps: [
      [
        'Armá tu perfil',
        'Pegá tu LinkedIn y respondé unas preguntas de nuestro asistente.',
      ],
      [
        'Recibí sugerencias',
        'Te sugerimos personas para conocer, cada una con un motivo y algunos temas.',
      ],
      [
        'Reunite en el momento',
        'Mandá una solicitud. Cuando la aceptan, les asignamos un lugar para reunirse.',
      ],
    ] as Array<[string, string]>,
    meetingsWindow: (from: string, to: string) => `1:1 de ${from} a ${to}`,
    registerFailed: 'No pudimos registrarte. Probá de nuevo.',
  },
  en: {
    eyebrow: 'Community social',
    people: (n: number) =>
      n > 0
        ? `${n} ${n === 1 ? 'person confirmed' : 'people confirmed'}`
        : null,
    closed: 'Registration for this event is closed.',
    signInTitle: 'Register once',
    signInBody:
      'Create your account with Google, LinkedIn or your email and sign up for this and future BAISH events without filling in forms.',
    signInButton: 'Continue',
    signInHint:
      "If you've taken part in BAISH programs before, we recognize your email and confirm your place straight away.",
    onList: "You're on the guest list",
    onListBody:
      "You've taken part in BAISH programs before, so your place is confirmed straight away.",
    register: 'Register',
    lumaNote:
      "We'll also add you to the Luma guest list. Your ticket and QR code for the door come from Luma by email.",
    requestTitle: 'Ask for a place',
    requestBody:
      'The BAISH team reviews every registration and emails you once you are approved.',
    linkedinLabel: 'Your LinkedIn',
    linkedinHint: 'Optional. It helps us approve you faster.',
    requestButton: 'Ask for a place',
    confirmed: 'Your place is confirmed',
    confirmedLuma: 'Your Luma ticket is on its way to your inbox.',
    nextProfile: 'Next: set up your profile',
    nextProfileBody:
      'Do it now, before the event or during it. We use it to suggest people for you to meet.',
    buildProfile: 'Set up profile',
    profileReady: 'Your profile is ready for matching.',
    seePeople: "See who's coming",
    editProfile: 'Edit profile',
    pending: 'Registration pending',
    pendingBody: "We'll email you once the BAISH team approves it.",
    pendingProfile: 'Meanwhile, set up your profile',
    pendingProfileBody:
      "We'll use it to suggest people for you to meet if you're approved.",
    declined: "We couldn't confirm your place",
    declinedBody:
      "We don't have room for you this time. We'll let you know about future events.",
    waitlist: "You're on the waitlist",
    waitlistBody: "We'll email you if a place opens up.",
    invited: "You've been invited to this event",
    invitedBody: 'Confirm your place from the Luma invitation.',
    openLuma: 'Open in Luma',
    howTitle: 'How 1:1s work',
    steps: [
      [
        'Set up your profile',
        'Paste your LinkedIn and answer a few questions from our assistant.',
      ],
      [
        'Get suggestions',
        'We suggest people to meet, each with a reason and a few topics.',
      ],
      [
        'Meet on the spot',
        "Send a request. When it's accepted, you both get a place to meet.",
      ],
    ] as Array<[string, string]>,
    meetingsWindow: (from: string, to: string) => `1:1s from ${from} to ${to}`,
    registerFailed: "We couldn't register you. Please try again.",
  },
}

function EventRegistrationPage() {
  const event = useSocialEvent()
  const t = useCopy(copy)
  const { lang } = useSocialLang()
  const peopleLine = t.people(event.approvedCount)

  return (
    <main className="flex flex-col gap-6 px-5 pb-10 pt-6">
      <section className="flex flex-col gap-3.5">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--baish-brand-text)]">
          {t.eyebrow}
        </p>
        <h1 className="baish-serif text-[38px] font-semibold leading-[1.08] text-[var(--baish-strong)]">
          {event.title}
        </h1>
        <div className="flex flex-col gap-2.5 text-[15px]">
          <InfoRow icon={CalendarDays}>
            {formatEventDate(event.startAt, event.timezone, lang)} ·{' '}
            {formatTime(event.startAt, event.timezone, lang)}
            {event.endAt
              ? `–${formatTime(event.endAt, event.timezone, lang)}`
              : ''}
          </InfoRow>
          {(event.venueName || event.venueAddress) && (
            <InfoRow icon={MapPin}>
              {[event.venueName, event.venueAddress].filter(Boolean).join(', ')}
            </InfoRow>
          )}
          {event.meetingsOpenAt && event.meetingsCloseAt && (
            <InfoRow icon={Clock3}>
              {t.meetingsWindow(
                formatTime(event.meetingsOpenAt, event.timezone, lang),
                formatTime(event.meetingsCloseAt, event.timezone, lang),
              )}
            </InfoRow>
          )}
          {peopleLine && <InfoRow icon={Users}>{peopleLine}</InfoRow>}
        </div>
        {event.description && (
          <p className="whitespace-pre-line text-[15px] leading-relaxed">
            {event.description}
          </p>
        )}
      </section>

      {event.status === 'closed' ? (
        <Panel>
          <p className="text-[15px]">{t.closed}</p>
        </Panel>
      ) : (
        <>
          <AuthLoading>
            <Panel raised className="items-center py-10">
              <Spinner />
            </Panel>
          </AuthLoading>
          <Unauthenticated>
            <SignInCard />
          </Unauthenticated>
          <Authenticated>
            <RegistrationCard />
          </Authenticated>
        </>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-[17px] font-semibold text-[var(--baish-strong)]">
          {t.howTitle}
        </h2>
        <ol className="flex flex-col gap-4">
          {t.steps.map(([title, body], i) => (
            <li key={title} className="flex gap-3.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-[var(--baish-brand-text)]">
                {i + 1}
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold text-[var(--baish-strong)]">
                  {title}
                </span>
                <span className="text-sm leading-normal text-muted-foreground">
                  {body}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}

function InfoRow({
  icon: Icon,
  children,
}: {
  icon: typeof MapPin
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon
        className="size-5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span>{children}</span>
    </div>
  )
}

function SignInCard() {
  const t = useCopy(copy)
  const redirect =
    typeof window !== 'undefined' ? window.location.href : undefined
  return (
    <Panel raised aria-label={t.signInTitle}>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[19px] font-semibold text-[var(--baish-strong)]">
          {t.signInTitle}
        </h2>
        <p className="text-[15px] leading-normal">{t.signInBody}</p>
      </div>
      <SignInButton
        mode="modal"
        forceRedirectUrl={redirect}
        signUpForceRedirectUrl={redirect}
      >
        <button type="button" className={primaryButtonClass}>
          {t.signInButton}
        </button>
      </SignInButton>
      <p className="text-[13px] leading-normal text-muted-foreground">
        {t.signInHint}
      </p>
    </Panel>
  )
}

function RegistrationCard() {
  const event = useSocialEvent()
  const t = useCopy(copy)
  const { slug, eventSlug } = Route.useParams()
  const registration = useQuery(api.social.events.getMyRegistration, {
    eventId: event._id,
  })
  const register = useMutation(api.social.events.register)
  const [linkedin, setLinkedin] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (registration === undefined) {
    return (
      <Panel raised className="items-center py-10">
        <Spinner />
      </Panel>
    )
  }
  if (registration === null) return null

  const onRegister = async () => {
    setSubmitting(true)
    try {
      await register({
        eventId: event._id,
        linkedinUrl: linkedin.trim() || undefined,
      })
    } catch (error) {
      console.error(error)
      toast.error(t.registerFailed)
    } finally {
      setSubmitting(false)
    }
  }

  const guest = registration.guest
  const profileReady = registration.profileMissing.length === 0
  const profileLink = (
    <Link
      to="/org/$slug/e/$eventSlug/profile"
      params={{ slug, eventSlug }}
      className={profileReady ? secondaryButtonClass : primaryButtonClass}
    >
      {profileReady ? t.editProfile : t.buildProfile}
      {!profileReady && (
        <ArrowRight className="size-[18px]" aria-hidden="true" />
      )}
    </Link>
  )

  if (!guest) {
    if (registration.onAllowlist) {
      return (
        <Panel raised aria-label={t.register}>
          <StatusLine tone="ok">{t.onList}</StatusLine>
          <p className="text-[15px] leading-normal">{t.onListBody}</p>
          <button
            type="button"
            onClick={onRegister}
            disabled={submitting}
            className={primaryButtonClass}
          >
            {submitting ? <Spinner className="size-5" /> : t.register}
          </button>
          {event.lumaUrl && (
            <p className="text-[13px] leading-normal text-muted-foreground">
              {t.lumaNote}
            </p>
          )}
        </Panel>
      )
    }
    return (
      <Panel raised aria-label={t.requestTitle}>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-[19px] font-semibold text-[var(--baish-strong)]">
            {t.requestTitle}
          </h2>
          <p className="text-[15px] leading-normal">{t.requestBody}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="linkedin"
            className="text-sm font-semibold text-[var(--baish-strong)]"
          >
            {t.linkedinLabel}
          </label>
          <input
            id="linkedin"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="linkedin.com/in/..."
            value={linkedin}
            onChange={(e) => setLinkedin(e.target.value)}
            className="h-12 rounded-xl border border-input bg-card px-3.5 text-[15px] text-[var(--baish-strong)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="text-[13px] text-muted-foreground">
            {t.linkedinHint}
          </span>
        </div>
        <button
          type="button"
          onClick={onRegister}
          disabled={submitting}
          className={primaryButtonClass}
        >
          {submitting ? <Spinner className="size-5" /> : t.requestButton}
        </button>
      </Panel>
    )
  }

  if (guest.status === 'approved') {
    return (
      <Panel raised aria-label={t.confirmed}>
        <div className="flex flex-col gap-1.5">
          <StatusLine tone="ok">{t.confirmed}</StatusLine>
          {event.lumaUrl && (
            <p className="text-[15px] leading-normal">{t.confirmedLuma}</p>
          )}
        </div>
        <div className="h-px bg-border" />
        {profileReady ? (
          <>
            <p className="text-[15px] leading-normal">{t.profileReady}</p>
            <Link
              to="/org/$slug/e/$eventSlug/people"
              params={{ slug, eventSlug }}
              className={primaryButtonClass}
            >
              {t.seePeople}
            </Link>
            {profileLink}
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <h2 className="text-[17px] font-semibold text-[var(--baish-strong)]">
                {t.nextProfile}
              </h2>
              <p className="text-[15px] leading-normal">{t.nextProfileBody}</p>
            </div>
            {profileLink}
          </>
        )}
      </Panel>
    )
  }

  if (guest.status === 'pending_approval') {
    return (
      <Panel raised aria-label={t.pending}>
        <div className="flex flex-col gap-1.5">
          <StatusLine tone="warn">{t.pending}</StatusLine>
          <p className="text-[15px] leading-normal">{t.pendingBody}</p>
        </div>
        <div className="h-px bg-border" />
        <div className="flex flex-col gap-1.5">
          <h2 className="text-[17px] font-semibold text-[var(--baish-strong)]">
            {t.pendingProfile}
          </h2>
          <p className="text-[15px] leading-normal">{t.pendingProfileBody}</p>
        </div>
        <Link
          to="/org/$slug/e/$eventSlug/profile"
          params={{ slug, eventSlug }}
          className={secondaryButtonClass}
        >
          {profileReady ? t.editProfile : t.buildProfile}
        </Link>
      </Panel>
    )
  }

  const [title, body] =
    guest.status === 'declined'
      ? [t.declined, t.declinedBody]
      : guest.status === 'waitlist'
        ? [t.waitlist, t.waitlistBody]
        : [t.invited, t.invitedBody]
  return (
    <Panel raised aria-label={title}>
      <h2 className="text-[17px] font-semibold text-[var(--baish-strong)]">
        {title}
      </h2>
      <p className="text-[15px] leading-normal">{body}</p>
      {guest.status === 'invited' && event.lumaUrl && (
        <a
          href={event.lumaUrl}
          target="_blank"
          rel="noreferrer"
          className={secondaryButtonClass}
        >
          {t.openLuma}
          <ExternalLink className="size-4" aria-hidden="true" />
        </a>
      )}
    </Panel>
  )
}

function StatusLine({
  tone,
  children,
}: {
  tone: 'ok' | 'warn'
  children: React.ReactNode
}) {
  const color =
    tone === 'ok' ? 'text-[var(--baish-ok)]' : 'text-[var(--baish-warn)]'
  const Icon = tone === 'ok' ? CheckCircle2 : Clock3
  return (
    <div className={`flex items-center gap-2 ${color}`}>
      <Icon className="size-5" aria-hidden="true" />
      <span className="text-base font-semibold">{children}</span>
    </div>
  )
}
