import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../../../../convex/_generated/api'
import type { LiveState } from '~/components/social/live'
import type { AgendaBooking, AgendaProposal } from '~/components/social/booking'
import { useNow, useSocialEvent } from '~/components/social/SocialEventContext'
import {
  BookingDueCard,
  BookingNotices,
  PrepNote,
  ProposalAnswer,
  useAgenda,
  useBookingErrorMessage,
  useSlotTime,
} from '~/components/social/booking'
import { AttendeeGate, PageSpinner } from '~/components/social/live'
import {
  Avatar,
  Chip,
  Eyebrow,
  PageTitle,
  Panel,
  secondaryButtonClass,
} from '~/components/social/ui'
import { Spinner } from '~/components/ui/spinner'
import { formatEventDate, useCopy, useSocialLang } from '~/lib/social-i18n'
import { bookingsDueNow, openProposals } from '~/lib/social-live'
import { useBusyAction } from '~/lib/use-busy-action'

export const Route = createFileRoute('/org/$slug/e/$eventSlug/agenda')({
  component: AgendaPage,
})

const copy = {
  es: {
    title: 'Tu agenda',
    offTitle: 'Este evento no tiene 1:1 con horario',
    offBody:
      'Acá los 1:1 se piden en el momento, desde la lista de asistentes.',
    toPeople: 'Ver asistentes',
    emptyTitle: 'Todavía no tenés 1:1 reservados',
    emptyBody:
      'Entrá al perfil de alguien y tocá "Proponer horario" para agendar un 1:1 a una hora fija.',
    findPeople: 'Buscar personas para conocer',
    booked: (n: number) => `Reservados (${n})`,
    incoming: (n: number) => `Te propusieron (${n})`,
    outgoing: (n: number) => `Propusiste (${n})`,
    past: 'Anteriores',
    spot: (n: number) => `Lugar ${n}`,
    noSpot: 'Sin lugar reservado',
    why: 'Por qué esta conversación',
    topics: 'Temas para arrancar',
    viewProfile: 'Ver perfil',
    cancel: 'Cancelar este 1:1',
    confirmCancel: 'Sí, cancelar',
    keep: 'No, mantener',
    cancelQuestion: (name: string) =>
      `¿Cancelar el 1:1? Le avisamos a ${name}.`,
    cancelled: 'Cancelaste el 1:1.',
    waitingAnswer: 'Esperando respuesta',
    withdraw: 'Retirar',
    withdrawn: 'Retiraste la propuesta.',
    withdrawLabel: (name: string) => `Retirar la propuesta a ${name}`,
    inProgress: 'En curso',
    openMeeting: 'Abrir reunión',
    done: 'Hecho',
    missed: 'No se hizo',
  },
  en: {
    title: 'Your agenda',
    offTitle: "This event doesn't have 1:1s at set times",
    offBody: 'Here 1:1s are asked for on the spot, from the attendee list.',
    toPeople: 'See attendees',
    emptyTitle: "You don't have any 1:1s booked yet",
    emptyBody:
      'Open someone\'s profile and tap "Propose a time" to book a 1:1 at a set time.',
    findPeople: 'Find people to meet',
    booked: (n: number) => `Booked (${n})`,
    incoming: (n: number) => `Proposed to you (${n})`,
    outgoing: (n: number) => `Proposed by you (${n})`,
    past: 'Earlier',
    spot: (n: number) => `Spot ${n}`,
    noSpot: 'No place reserved',
    why: 'Why this conversation',
    topics: 'Conversation starters',
    viewProfile: 'View profile',
    cancel: 'Cancel this 1:1',
    confirmCancel: 'Yes, cancel',
    keep: 'No, keep it',
    cancelQuestion: (name: string) => `Cancel the 1:1? We'll let ${name} know.`,
    cancelled: 'You cancelled the 1:1.',
    waitingAnswer: 'Waiting for an answer',
    withdraw: 'Take back',
    withdrawn: 'You took back the proposal.',
    withdrawLabel: (name: string) => `Take back the proposal to ${name}`,
    inProgress: 'In progress',
    openMeeting: 'Open meeting',
    done: 'Done',
    missed: "Didn't happen",
  },
}

function AgendaPage() {
  return <AttendeeGate>{(live) => <AgendaContent live={live} />}</AttendeeGate>
}

function AgendaContent({ live }: { live: LiveState }) {
  const { slug, eventSlug } = Route.useParams()
  const event = useSocialEvent()
  const t = useCopy(copy)
  const { lang } = useSocialLang()
  const now = useNow(15_000)
  // Null at an event with booking off: the page then says so.
  const agenda = useAgenda()

  if (agenda === undefined) return <PageSpinner />
  if (agenda === null) {
    return (
      <main className="flex flex-col gap-4 px-5 pb-8 pt-4">
        <Panel>
          <h1 className="text-[19px] font-semibold text-[var(--baish-strong)]">
            {t.offTitle}
          </h1>
          <p className="text-[15px] leading-normal">{t.offBody}</p>
          <Link
            to="/org/$slug/e/$eventSlug/people"
            params={{ slug, eventSlug }}
            className={secondaryButtonClass}
          >
            {t.toPeople}
          </Link>
        </Panel>
      </main>
    )
  }
  const due = bookingsDueNow(agenda.bookings, now)
  const upcoming = agenda.bookings.filter(
    (b) => b.status === 'booked' && b.slotStart > now,
  )
  const past = agenda.bookings.filter(
    (b) => b.status === 'started' || b.slotEnd <= now,
  )
  const incoming = openProposals(agenda.incoming, now)
  const outgoing = openProposals(agenda.outgoing, now)
  const empty =
    agenda.bookings.length === 0 &&
    incoming.length === 0 &&
    outgoing.length === 0

  return (
    <main className="flex flex-col gap-[22px] px-5 pb-8 pt-4">
      <div className="flex flex-col gap-1">
        <PageTitle>{t.title}</PageTitle>
        <p className="text-sm text-muted-foreground">
          {formatEventDate(event.meetingsOpenAt, event.timezone, lang)}
        </p>
      </div>

      <BookingNotices agenda={agenda} />

      {due.map((b) => (
        <BookingDueCard
          key={b._id}
          booking={b}
          inMeeting={live.meeting !== null}
        />
      ))}

      {empty && (
        <Panel>
          <h2 className="text-[17px] font-semibold text-[var(--baish-strong)]">
            {t.emptyTitle}
          </h2>
          <p className="text-[15px] leading-normal">{t.emptyBody}</p>
          <Link
            to="/org/$slug/e/$eventSlug/people"
            params={{ slug, eventSlug }}
            className={secondaryButtonClass}
          >
            {t.findPeople}
          </Link>
        </Panel>
      )}

      {incoming.length > 0 && (
        <section
          aria-labelledby="agenda-incoming"
          className="flex flex-col gap-3"
        >
          <h2
            id="agenda-incoming"
            className="text-sm font-semibold text-muted-foreground"
          >
            {t.incoming(incoming.length)}
          </h2>
          {incoming.map((p) => (
            <ProposalAnswer key={p._id} proposal={p} />
          ))}
        </section>
      )}

      {(due.length > 0 || upcoming.length > 0) && (
        <section
          aria-labelledby="agenda-booked"
          className="flex flex-col gap-3"
        >
          <h2
            id="agenda-booked"
            className="text-sm font-semibold text-muted-foreground"
          >
            {t.booked(due.length + upcoming.length)}
          </h2>
          {[...due, ...upcoming].map((b) => (
            <BookingCard key={b._id} booking={b} />
          ))}
        </section>
      )}

      {outgoing.length > 0 && (
        <section
          aria-labelledby="agenda-outgoing"
          className="flex flex-col gap-3"
        >
          <h2
            id="agenda-outgoing"
            className="text-sm font-semibold text-muted-foreground"
          >
            {t.outgoing(outgoing.length)}
          </h2>
          {outgoing.map((p) => (
            <OutgoingRow key={p._id} proposal={p} />
          ))}
        </section>
      )}

      {past.length > 0 && (
        <section aria-labelledby="agenda-past" className="flex flex-col gap-3">
          <h2
            id="agenda-past"
            className="text-sm font-semibold text-muted-foreground"
          >
            {t.past}
          </h2>
          {past.map((b) => (
            <PastRow
              key={b._id}
              booking={b}
              inProgress={
                b.meetingId !== null && live.meeting?._id === b.meetingId
              }
            />
          ))}
        </section>
      )}
    </main>
  )
}

/** "17:20 – 17:40 · Lugar 3 · Cerca de la barra". */
function WhenAndWhere({ booking: b }: { booking: AgendaBooking }) {
  const t = useCopy(copy)
  const time = useSlotTime()
  return (
    <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
      <span className="text-[19px] font-bold text-[var(--baish-strong)]">
        {time(b.slotStart)} – {time(b.slotEnd)}
      </span>
      <span className="text-sm font-semibold text-[var(--baish-brand-text)]">
        {b.spot
          ? [t.spot(b.spot.number), b.spot.label].filter(Boolean).join(' · ')
          : t.noSpot}
      </span>
    </p>
  )
}

function PersonLine({ partner }: { partner: AgendaBooking['partner'] }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar initials={partner.initials} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 className="text-base font-semibold text-[var(--baish-strong)]">
          {partner.name}
        </h3>
        {partner.headline && (
          <span className="text-[13px] text-muted-foreground">
            {partner.headline}
          </span>
        )}
      </div>
    </div>
  )
}

/** A booked 1:1 still to come: who, when, where, why, and the prep note. */
function BookingCard({ booking: b }: { booking: AgendaBooking }) {
  const { slug, eventSlug } = Route.useParams()
  const t = useCopy(copy)
  const errorMessage = useBookingErrorMessage()
  const cancelBooking = useMutation(api.social.bookings.cancelBooking)
  const { busy, run } = useBusyAction<'cancel'>()
  // Cancelling tells the other person, so it takes a second tap.
  const [confirming, setConfirming] = useState(false)
  const firstName = b.partner.name.split(' ')[0] ?? b.partner.name

  const onCancel = () =>
    run(
      'cancel',
      async () => {
        await cancelBooking({ bookingId: b._id })
        toast.success(t.cancelled)
      },
      (error) => toast.error(errorMessage(error)),
    )

  return (
    <article className="flex flex-col gap-3.5 rounded-2xl border border-border bg-card p-4">
      <WhenAndWhere booking={b} />
      <PersonLine partner={b.partner} />
      {b.why && (
        <div className="flex flex-col gap-1.5 rounded-xl bg-muted p-3">
          <Eyebrow>{t.why}</Eyebrow>
          <p className="text-sm leading-normal">{b.why}</p>
        </div>
      )}
      {b.topics.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Eyebrow>{t.topics}</Eyebrow>
          <ul className="flex flex-wrap gap-1.5">
            {b.topics.map((topic) => (
              <li key={topic}>
                <Chip>{topic}</Chip>
              </li>
            ))}
          </ul>
        </div>
      )}
      <PrepNote aboutUserId={b.partner.userId} />
      {confirming ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm leading-normal">
            {t.cancelQuestion(firstName)}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setConfirming(false)}
              className={`${secondaryButtonClass} h-11 grow basis-0 text-sm`}
            >
              {t.keep}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void onCancel()}
              className="flex h-11 grow basis-0 items-center justify-center rounded-xl bg-[var(--baish-strong)] px-4 text-sm font-semibold text-white hover:bg-foreground disabled:opacity-60"
            >
              {busy ? <Spinner size="sm" /> : t.confirmCancel}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Link
            to="/org/$slug/e/$eventSlug/people/$userId"
            params={{ slug, eventSlug, userId: b.partner.userId }}
            aria-label={`${t.viewProfile}: ${b.partner.name}`}
            className={`${secondaryButtonClass} h-11 grow basis-0 text-sm`}
          >
            {t.viewProfile}
          </Link>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="flex h-11 grow basis-0 items-center justify-center rounded-xl px-3 text-sm font-semibold text-muted-foreground hover:bg-muted"
          >
            {t.cancel}
          </button>
        </div>
      )}
    </article>
  )
}

/** A proposal the viewer sent that is waiting for an answer. */
function OutgoingRow({ proposal: p }: { proposal: AgendaProposal }) {
  const { slug, eventSlug } = Route.useParams()
  const t = useCopy(copy)
  const time = useSlotTime()
  const errorMessage = useBookingErrorMessage()
  const withdraw = useMutation(api.social.bookings.withdrawProposal)
  const { busy, run } = useBusyAction<'withdraw'>()

  const onWithdraw = () =>
    run(
      'withdraw',
      async () => {
        await withdraw({ bookingId: p._id })
        toast.success(t.withdrawn)
      },
      (error) => toast.error(errorMessage(error)),
    )

  return (
    <article className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3.5">
      <Link
        to="/org/$slug/e/$eventSlug/people/$userId"
        params={{ slug, eventSlug, userId: p.partner.userId }}
        className="-m-1 flex min-w-0 grow items-center gap-3 rounded-xl p-1 hover:bg-muted"
      >
        <Avatar initials={p.partner.initials} size={40} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[15px] font-semibold text-[var(--baish-strong)]">
            {p.partner.name}
          </span>
          <span className="text-[13px] text-muted-foreground">
            {time(p.slotStart)} – {time(p.slotEnd)} · {t.waitingAnswer}
          </span>
        </span>
      </Link>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void onWithdraw()}
        aria-label={t.withdrawLabel(p.partner.name)}
        className="flex h-11 shrink-0 items-center justify-center rounded-xl border border-input bg-card px-3.5 text-sm font-semibold text-[var(--baish-brand-text)] hover:bg-muted disabled:opacity-60"
      >
        {busy ? <Spinner size="sm" /> : t.withdraw}
      </button>
    </article>
  )
}

/** A booked 1:1 whose time has passed, or that turned into a meeting. */
function PastRow({
  booking: b,
  inProgress,
}: {
  booking: AgendaBooking
  inProgress: boolean
}) {
  const { slug, eventSlug } = Route.useParams()
  const t = useCopy(copy)
  const time = useSlotTime()
  const outcome = inProgress
    ? t.inProgress
    : b.status === 'started'
      ? t.done
      : t.missed
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-4 py-3.5">
      <div className="flex items-center gap-3">
        <Link
          to="/org/$slug/e/$eventSlug/people/$userId"
          params={{ slug, eventSlug, userId: b.partner.userId }}
          className="-m-1 flex min-w-0 grow items-center gap-3 rounded-xl p-1 hover:bg-muted"
        >
          <Avatar initials={b.partner.initials} size={40} />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[15px] font-semibold text-[var(--baish-strong)]">
              {b.partner.name}
            </span>
            <span className="text-[13px] text-muted-foreground">
              {time(b.slotStart)} – {time(b.slotEnd)} · {outcome}
            </span>
          </span>
        </Link>
        {inProgress && (
          <Link
            to="/org/$slug/e/$eventSlug/meeting"
            params={{ slug, eventSlug }}
            className="flex h-11 shrink-0 items-center justify-center rounded-xl border border-input bg-card px-3.5 text-sm font-semibold text-[var(--baish-brand-text)] hover:bg-muted"
          >
            {t.openMeeting}
          </Link>
        )}
      </div>
      <PrepNote aboutUserId={b.partner.userId} />
    </article>
  )
}
