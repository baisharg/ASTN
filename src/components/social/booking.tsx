import { Link, useNavigate } from '@tanstack/react-router'
import { useConvexAuth, useMutation, useQuery } from 'convex/react'
import { ArrowRight, CalendarClock, CheckCircle2, X } from 'lucide-react'
import { useCallback, useId, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import {
  MAX_NOTE_LENGTH,
  MAX_PENDING_PROPOSALS,
  bookingStage,
} from '../../../convex/social/constants'
import { useNow, useSocialEvent } from './SocialEventContext'
import { PageSpinner } from './live'
import { Avatar, Panel, primaryButtonClass, secondaryButtonClass } from './ui'
import type { FunctionReturnType } from 'convex/server'
import type { BookingErrorCode } from '../../../convex/social/constants'
import type { SocialLang } from '~/lib/social-i18n'
import { Spinner } from '~/components/ui/spinner'
import { errorCode, errorText } from '~/lib/convex-error'
import {
  formatEventDate,
  formatTime,
  useCopy,
  useSocialLang,
} from '~/lib/social-i18n'
import { bookingsDueNow, openProposals } from '~/lib/social-live'
import { spotName } from '~/lib/social-spot'
import { useBusyAction } from '~/lib/use-busy-action'

/**
 * Booked 1:1s on the attendee pages of an event with booking on: the
 * viewer's agenda, proposing a time to someone, answering proposals, what to
 * do when a slot starts, and the notices about ones that fell through.
 * Everything here reads `useAgenda`, which asks the server nothing at an event with booking
 * off.
 */

export type Agenda = NonNullable<
  FunctionReturnType<typeof api.social.bookings.getMyAgenda>
>
export type AgendaBooking = Agenda['bookings'][number]
export type AgendaProposal = Agenda['incoming'][number]

/**
 * The viewer's agenda: undefined while it loads, null when there is none for
 * them (signed out, not a confirmed attendee, or booking is off). Every
 * caller passes the same args, so they share one subscription.
 */
export function useAgenda(): Agenda | null | undefined {
  const event = useSocialEvent()
  const { isAuthenticated } = useConvexAuth()
  const enabled = isAuthenticated && event.bookingEnabled
  const result = useQuery(
    api.social.bookings.getMyAgenda,
    enabled ? { eventId: event._id } : 'skip',
  )
  return enabled ? result : null
}

/** "17:20" in the event's timezone. */
export function useSlotTime(): (timestamp: number) => string {
  const event = useSocialEvent()
  const { lang } = useSocialLang()
  return useCallback(
    (timestamp: number) => formatTime(timestamp, event.timezone, lang),
    [event.timezone, lang],
  )
}

// ── Errors ──────────────────────────────────────────────────────────────

const genericError = {
  es: 'Algo salió mal. Probá de nuevo en un momento.',
  en: 'Something went wrong. Please try again in a moment.',
} satisfies Record<SocialLang, string>

const bookingErrorCopy = {
  es: {
    booking_off: 'En este evento no se pueden reservar 1:1.',
    not_attendee: 'Esto es solo para asistentes confirmados.',
    self: 'No podés reservar un 1:1 con vos mismo.',
    not_found: 'Eso ya no existe.',
    slot_invalid: 'Ese horario ya no existe. Elegí otro.',
    slot_past: 'Ese horario ya empezó. Elegí otro.',
    self_booked: 'Ya tenés un 1:1 en ese horario.',
    they_booked: 'Esta persona ya tiene un 1:1 en ese horario.',
    slot_full: 'Ese horario ya no tiene lugares libres. Elegí otro.',
    already_booked: 'Ya tienen un 1:1 reservado. Miralo en tu agenda.',
    limit: `Ya tenés ${MAX_PENDING_PROPOSALS} propuestas esperando respuesta. Retirá alguna para hacer otra.`,
    proposal_expired: 'Esta propuesta ya venció.',
    not_started: 'Este 1:1 todavía no empezó.',
    slot_over: 'El horario de este 1:1 ya terminó.',
    self_in_meeting: 'Primero terminá tu reunión actual.',
    they_in_meeting: 'Está en una reunión. Probá de nuevo cuando termine.',
    release_too_early:
      'Vas a poder liberarlo unos minutos después de avisar que llegaste.',
  },
  en: {
    booking_off: "1:1s can't be booked at this event.",
    not_attendee: 'This is only for confirmed attendees.',
    self: "You can't book a 1:1 with yourself.",
    not_found: 'That no longer exists.',
    slot_invalid: 'That time no longer exists. Pick another.',
    slot_past: 'That time has already started. Pick another.',
    self_booked: 'You already have a 1:1 at that time.',
    they_booked: 'They already have a 1:1 at that time.',
    slot_full: 'That time has no places left. Pick another.',
    already_booked: 'You two already have a 1:1 booked. Check your agenda.',
    limit: `You already have ${MAX_PENDING_PROPOSALS} proposals waiting. Take one back to make another.`,
    proposal_expired: 'This proposal has expired.',
    not_started: "This 1:1 hasn't started yet.",
    slot_over: 'The time for this 1:1 is over.',
    self_in_meeting: 'Finish your current meeting first.',
    they_in_meeting: "They're in a meeting. Try again when it ends.",
    release_too_early:
      "You can release it a few minutes after saying you're there.",
  },
} satisfies Record<SocialLang, Record<BookingErrorCode, string>>

/** Turns an error from a booking mutation into a message in the page language. */
export function useBookingErrorMessage() {
  const { lang } = useSocialLang()
  return (error: unknown) => {
    const code = errorCode<BookingErrorCode>(error)
    return code && code in bookingErrorCopy[lang]
      ? bookingErrorCopy[lang][code]
      : errorText(error, genericError[lang])
  }
}

// ── Copy ────────────────────────────────────────────────────────────────

const copy = {
  es: {
    propose: 'Proponer horario',
    proposeTitle: (name: string) => `Proponele un horario a ${name}`,
    proposeBody:
      'Elegí un horario en el que los dos estén libres. Si acepta, queda en la agenda de los dos con un lugar reservado.',
    noSlots: 'No quedan horarios para reservar en este evento.',
    noneFree: (name: string) =>
      `No queda ningún horario en el que vos y ${name} estén libres.`,
    slotTaken: 'ocupado',
    slotFull: 'sin lugar',
    noteLabel: 'Agregá una nota (opcional)',
    notePlaceholder: 'De qué te gustaría hablar',
    send: (time: string) => `Proponer las ${time}`,
    pickFirst: 'Elegí un horario',
    close: 'Cerrar',
    sent: (name: string, time: string) =>
      `Le propusiste las ${time} a ${name}.`,
    bookedNow: (name: string, time: string) =>
      `Listo: tenés un 1:1 con ${name} a las ${time}.`,
    bookedWith: (time: string) => `Tienen un 1:1 reservado a las ${time}`,
    seeAgenda: 'Ver agenda',
    youProposed: (name: string, time: string) =>
      `Le propusiste las ${time} a ${name}. Vence a esa hora si no responde.`,
    changeTime: 'Cambiar horario',
    withdraw: 'Retirar',
    withdrawn: 'Retiraste la propuesta.',
    theyProposed: (name: string, time: string) =>
      `${name} te propuso un 1:1 a las ${time}`,
    accept: 'Aceptar',
    decline: 'Rechazar',
    accepted: (time: string) => `Reservado para las ${time}.`,
    declined: 'Rechazaste la propuesta.',
    acceptLabel: (name: string) => `Aceptar la propuesta de ${name}`,
    declineLabel: (name: string) => `Rechazar la propuesta de ${name}`,
    proposedAt: (time: string, end: string) => `Propone de ${time} a ${end}`,
    proposalsTitle: (n: number) => `Te propusieron un horario (${n})`,
    dueTitle: (name: string) => `Tu 1:1 con ${name} empieza ahora`,
    dueNoSpot: 'Sin lugar reservado: busquen un rincón libre.',
    confirmHere: 'Ya estoy',
    confirmBody: (name: string) =>
      `Andá al lugar y avisá que llegaste. La reunión empieza cuando ${name} también avise.`,
    waitingFor: (name: string) => `Avisaste que llegaste. Esperando a ${name}.`,
    canRelease: (name: string) =>
      `${name} todavía no avisó que llegó. Podés seguir esperando o liberar este 1:1 y quedar libre.`,
    release: 'Liberar este 1:1',
    released: 'Liberaste el 1:1. Ya podés reunirte con otra persona.',
    inMeetingFirst: 'Terminá tu reunión actual para empezar este 1:1.',
    bannerOpen: 'Abrir',
    noticesLabel: 'Avisos sobre tus 1:1',
    noticeDeclined: (name: string, time: string) =>
      `${name} no puede a las ${time}.`,
    noticeExpired: (name: string, time: string) =>
      `Tu propuesta a ${name} para las ${time} venció sin concretarse.`,
    noticeCancelled: (name: string, time: string) =>
      `${name} canceló el 1:1 de las ${time}.`,
    noticeNoShow: (name: string, time: string) =>
      `No llegaste al 1:1 de las ${time} con ${name}, que liberó el horario.`,
    dismissNotice: (name: string) => `Descartar el aviso sobre ${name}`,
  },
  en: {
    propose: 'Propose a time',
    proposeTitle: (name: string) => `Propose a time to ${name}`,
    proposeBody:
      "Pick a time when you're both free. If they accept, it goes on both your agendas with a place reserved.",
    noSlots: 'There are no times left to book at this event.',
    noneFree: (name: string) =>
      `There's no time left when both you and ${name} are free.`,
    slotTaken: 'taken',
    slotFull: 'no place',
    noteLabel: 'Add a note (optional)',
    notePlaceholder: "What you'd like to talk about",
    send: (time: string) => `Propose ${time}`,
    pickFirst: 'Pick a time',
    close: 'Close',
    sent: (name: string, time: string) => `You proposed ${time} to ${name}.`,
    bookedNow: (name: string, time: string) =>
      `Done: you have a 1:1 with ${name} at ${time}.`,
    bookedWith: (time: string) => `You have a 1:1 booked at ${time}`,
    seeAgenda: 'See agenda',
    youProposed: (name: string, time: string) =>
      `You proposed ${time} to ${name}. It expires then if they don't answer.`,
    changeTime: 'Change time',
    withdraw: 'Take back',
    withdrawn: 'You took back the proposal.',
    theyProposed: (name: string, time: string) =>
      `${name} proposed a 1:1 at ${time}`,
    accept: 'Accept',
    decline: 'Decline',
    accepted: (time: string) => `Booked for ${time}.`,
    declined: 'You declined the proposal.',
    acceptLabel: (name: string) => `Accept ${name}'s proposal`,
    declineLabel: (name: string) => `Decline ${name}'s proposal`,
    proposedAt: (time: string, end: string) => `Proposes ${time} to ${end}`,
    proposalsTitle: (n: number) => `Times proposed to you (${n})`,
    dueTitle: (name: string) => `Your 1:1 with ${name} starts now`,
    dueNoSpot: 'No place reserved: find a free corner.',
    confirmHere: "I'm here",
    confirmBody: (name: string) =>
      `Go to the place and say you're there. The meeting starts once ${name} says so too.`,
    waitingFor: (name: string) => `You said you're there. Waiting for ${name}.`,
    canRelease: (name: string) =>
      `${name} hasn't said they're there yet. You can keep waiting, or release this 1:1 and be free.`,
    release: 'Release this 1:1',
    released: 'You released the 1:1. You can meet someone else now.',
    inMeetingFirst: 'Finish your current meeting to start this 1:1.',
    bannerOpen: 'Open',
    noticesLabel: 'Notices about your 1:1s',
    noticeDeclined: (name: string, time: string) =>
      `${name} can't make ${time}.`,
    noticeExpired: (name: string, time: string) =>
      `Your proposal to ${name} for ${time} expired without being booked.`,
    noticeCancelled: (name: string, time: string) =>
      `${name} cancelled the 1:1 at ${time}.`,
    noticeNoShow: (name: string, time: string) =>
      `You missed the 1:1 at ${time} with ${name}, who released the time.`,
    dismissNotice: (name: string) => `Dismiss the notice about ${name}`,
  },
}

const firstNameOf = (name: string) => name.split(' ')[0] ?? name

// ── Proposing ───────────────────────────────────────────────────────────

/**
 * "Proponer horario" for one person, and what already stands between the
 * viewer and them: a booked 1:1, a proposal waiting on either side. Renders
 * nothing until the agenda has loaded, or when there is no agenda.
 */
export function ProposeSlot({
  userId,
  firstName,
}: {
  userId: string
  firstName: string
}) {
  const event = useSocialEvent()
  const t = useCopy(copy)
  const time = useSlotTime()
  const now = useNow(15_000)
  const agenda = useAgenda()
  const errorMessage = useBookingErrorMessage()
  const withdraw = useMutation(api.social.bookings.withdrawProposal)
  const { busy, run } = useBusyAction<'withdraw'>()
  const [picking, setPicking] = useState(false)

  if (!agenda) return null

  const booked = agenda.bookings.find(
    (b) =>
      b.partner.userId === userId && b.status === 'booked' && b.slotEnd > now,
  )
  if (booked) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-[var(--baish-ok-bg)] px-3.5 py-2.5 text-sm font-semibold text-[var(--baish-ok)]">
        <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
        <span className="grow">{t.bookedWith(time(booked.slotStart))}</span>
        <Link
          to="/org/$slug/e/$eventSlug/agenda"
          params={{ slug: event.orgSlug, eventSlug: event.slug }}
          className="flex min-h-11 shrink-0 items-center underline-offset-2 hover:underline"
        >
          {t.seeAgenda}
        </Link>
      </div>
    )
  }

  const theirs = openProposals(agenda.incoming, now).filter(
    (p) => p.partner.userId === userId,
  )
  const mine = openProposals(agenda.outgoing, now).find(
    (p) => p.partner.userId === userId,
  )

  return (
    <div className="flex flex-col gap-2.5">
      {theirs.map((p) => (
        <ProposalAnswer key={p._id} proposal={p} />
      ))}
      {picking ? (
        <SlotPicker
          userId={userId}
          firstName={firstName}
          onClose={() => setPicking(false)}
        />
      ) : mine ? (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-background p-3.5">
          <p className="text-sm leading-normal">
            {t.youProposed(firstName, time(mine.slotStart))}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void run(
                  'withdraw',
                  async () => {
                    await withdraw({ bookingId: mine._id })
                    toast.success(t.withdrawn)
                  },
                  (error) => toast.error(errorMessage(error)),
                )
              }
              className={`${secondaryButtonClass} h-11 grow basis-0 text-sm`}
            >
              {busy ? <Spinner size="sm" /> : t.withdraw}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setPicking(true)}
              className={`${secondaryButtonClass} h-11 grow basis-0 text-sm`}
            >
              {t.changeTime}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className={`${secondaryButtonClass} h-11 w-full text-sm`}
        >
          <CalendarClock className="size-4" aria-hidden="true" />
          {t.propose}
        </button>
      )}
    </div>
  )
}

/** The slots the viewer and one person can still book, to pick one. */
function SlotPicker({
  userId,
  firstName,
  onClose,
}: {
  userId: string
  firstName: string
  onClose: () => void
}) {
  const event = useSocialEvent()
  const t = useCopy(copy)
  const { lang } = useSocialLang()
  const time = useSlotTime()
  const now = useNow(15_000)
  const errorMessage = useBookingErrorMessage()
  const slots = useQuery(api.social.bookings.getSlotsWith, {
    eventId: event._id,
    withUserId: userId,
  })
  const propose = useMutation(api.social.bookings.propose)
  const { busy, run } = useBusyAction<'send'>()
  const [picked, setPicked] = useState<number | null>(null)
  const [note, setNote] = useState('')

  const upcoming = (slots ?? []).filter((slot) => slot.start > now)
  const choice = upcoming.find(
    (slot) => slot.start === picked && slot.block === null,
  )

  const send = () => {
    if (!choice) return
    void run(
      'send',
      async () => {
        const { booked } = await propose({
          eventId: event._id,
          toUserId: userId,
          slotStart: choice.start,
          note: note.trim() || undefined,
        })
        toast.success(
          booked
            ? t.bookedNow(firstName, time(choice.start))
            : t.sent(firstName, time(choice.start)),
        )
        onClose()
      },
      (error) => toast.error(errorMessage(error)),
    )
  }

  const noteId = useId()
  return (
    <section
      aria-label={t.proposeTitle(firstName)}
      className="flex flex-col gap-3 rounded-xl border border-input bg-background p-3.5"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h3 className="text-[15px] font-semibold text-[var(--baish-strong)]">
            {t.proposeTitle(firstName)}
          </h3>
          <p className="text-[13px] leading-normal text-muted-foreground">
            {t.proposeBody}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.close}
          className="-mr-2 -mt-2 flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-[18px]" aria-hidden="true" />
        </button>
      </div>

      {slots === undefined ? (
        <PageSpinner />
      ) : upcoming.length === 0 ? (
        <p className="text-sm leading-normal">{t.noSlots}</p>
      ) : upcoming.every((slot) => slot.block !== null) ? (
        <p className="text-sm leading-normal">{t.noneFree(firstName)}</p>
      ) : (
        <>
          <p className="text-xs font-semibold text-muted-foreground">
            {formatEventDate(upcoming[0].start, event.timezone, lang)}
          </p>
          <ul className="grid grid-cols-3 gap-2">
            {upcoming.map((slot) => {
              const selected = slot.start === picked
              return (
                <li key={slot.start}>
                  <button
                    type="button"
                    disabled={slot.block !== null || busy !== null}
                    aria-pressed={selected}
                    onClick={() => setPicked(slot.start)}
                    className={
                      selected
                        ? 'flex h-12 w-full flex-col items-center justify-center rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground'
                        : 'flex h-12 w-full flex-col items-center justify-center rounded-xl border border-input bg-card text-[15px] font-semibold text-[var(--baish-strong)] hover:bg-muted disabled:border-border disabled:bg-muted disabled:font-normal disabled:text-muted-foreground'
                    }
                  >
                    {time(slot.start)}
                    {slot.block !== null && (
                      <span className="text-[11px] leading-none">
                        {slot.block === 'slot_full' ? t.slotFull : t.slotTaken}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
          <label
            htmlFor={noteId}
            className="text-sm font-semibold text-[var(--baish-strong)]"
          >
            {t.noteLabel}
          </label>
          <textarea
            id={noteId}
            rows={2}
            maxLength={MAX_NOTE_LENGTH}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t.notePlaceholder}
            className="resize-none rounded-xl border border-input bg-card px-3.5 py-3 text-[15px] text-[var(--baish-strong)] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="button"
            disabled={!choice || busy !== null}
            onClick={send}
            className={`${primaryButtonClass} h-12 text-[15px]`}
          >
            {busy ? (
              <Spinner size="sm" />
            ) : choice ? (
              t.send(time(choice.start))
            ) : (
              t.pickFirst
            )}
          </button>
        </>
      )}
    </section>
  )
}

/** A proposal the viewer received, with the buttons to answer it. */
export function ProposalAnswer({ proposal: p }: { proposal: AgendaProposal }) {
  const t = useCopy(copy)
  const time = useSlotTime()
  const errorMessage = useBookingErrorMessage()
  const respond = useMutation(api.social.bookings.respond)
  const { busy, run } = useBusyAction<'accept' | 'decline'>()
  const firstName = firstNameOf(p.partner.name)

  const answer = (accept: boolean) =>
    run(
      accept ? 'accept' : 'decline',
      async () => {
        await respond({ bookingId: p._id, accept })
        toast.success(accept ? t.accepted(time(p.slotStart)) : t.declined)
      },
      (error) => toast.error(errorMessage(error)),
    )

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-input bg-card p-4 shadow-[0_1px_2px_rgba(17,12,46,0.06),0_8px_24px_rgba(17,12,46,0.06)]">
      <div className="flex items-center gap-3">
        <Avatar initials={p.partner.initials} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-base font-semibold text-[var(--baish-strong)]">
            {t.theyProposed(firstName, time(p.slotStart))}
          </h3>
          <span className="text-[13px] text-muted-foreground">
            {t.proposedAt(time(p.slotStart), time(p.slotEnd))}
          </span>
        </div>
      </div>
      {p.note && (
        <p className="whitespace-pre-line break-words rounded-xl bg-background px-3 py-2.5 text-[15px] leading-normal">
          {p.note}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void answer(false)}
          aria-label={t.declineLabel(p.partner.name)}
          className={`${secondaryButtonClass} grow basis-0`}
        >
          {busy === 'decline' ? <Spinner size="sm" /> : t.decline}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void answer(true)}
          aria-label={t.acceptLabel(p.partner.name)}
          className={`${primaryButtonClass} h-12 grow basis-0 text-[15px]`}
        >
          {busy === 'accept' ? <Spinner size="sm" /> : t.accept}
        </button>
      </div>
    </article>
  )
}

// ── When the slot starts ────────────────────────────────────────────────

/**
 * A booked 1:1 whose slot is on: where to go, the button to say "I'm here",
 * and, when the other person doesn't come, the button to release it.
 * `inMeeting` is whether the viewer has a meeting in progress, which has to
 * end first.
 */
export function BookingDueCard({
  booking: b,
  inMeeting,
}: {
  booking: AgendaBooking
  inMeeting: boolean
}) {
  const event = useSocialEvent()
  const t = useCopy(copy)
  const { lang } = useSocialLang()
  const now = useNow(5_000)
  const navigate = useNavigate()
  const errorMessage = useBookingErrorMessage()
  const confirmHere = useMutation(api.social.bookings.confirmHere)
  const releaseNoShow = useMutation(api.social.bookings.releaseNoShow)
  const { busy, run } = useBusyAction<'here' | 'release'>()
  const firstName = firstNameOf(b.partner.name)
  const stage = bookingStage(
    { start: b.slotStart, end: b.slotEnd, selfReadyAt: b.selfReadyAt },
    now,
  )
  const onError = (error: unknown) => toast.error(errorMessage(error))

  const onHere = () =>
    run(
      'here',
      async () => {
        const meetingId = await confirmHere({ bookingId: b._id })
        if (meetingId) {
          void navigate({
            to: '/org/$slug/e/$eventSlug/meeting',
            params: { slug: event.orgSlug, eventSlug: event.slug },
          })
        }
      },
      onError,
    )
  const onRelease = () =>
    run(
      'release',
      async () => {
        await releaseNoShow({ bookingId: b._id })
        toast.success(t.released)
      },
      onError,
    )

  return (
    <Panel
      raised
      aria-label={t.dueTitle(firstName)}
      className="gap-3 border-[var(--baish-warn-dot)] bg-[var(--baish-warn-bg)] p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-[17px] font-semibold text-[var(--baish-strong)]">
          {t.dueTitle(firstName)}
        </h2>
        <p className="text-[15px] font-semibold text-[var(--baish-warn)]">
          {b.spot ? spotName(b.spot, lang) : t.dueNoSpot}
        </p>
      </div>
      {stage === 'confirm' ? (
        <>
          <p className="text-[15px] leading-normal">
            {inMeeting ? t.inMeetingFirst : t.confirmBody(firstName)}
          </p>
          <button
            type="button"
            disabled={busy !== null || inMeeting}
            onClick={() => void onHere()}
            className={primaryButtonClass}
          >
            {busy === 'here' ? <Spinner size="sm" /> : t.confirmHere}
          </button>
        </>
      ) : stage === 'waiting' ? (
        <p role="status" className="text-[15px] leading-normal">
          {t.waitingFor(firstName)}
        </p>
      ) : stage === 'can_release' ? (
        <>
          <p role="status" className="text-[15px] leading-normal">
            {t.canRelease(firstName)}
          </p>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void onRelease()}
            className={secondaryButtonClass}
          >
            {busy === 'release' ? <Spinner size="sm" /> : t.release}
          </button>
        </>
      ) : null}
    </Panel>
  )
}

/**
 * Pinned to the bottom of every event page while a booked 1:1 of the
 * viewer's is in its slot and hasn't started, leading to the agenda. Hidden
 * while they are in a meeting, whose own banner takes that place.
 */
export function BookingDueBanner({ hidden }: { hidden: boolean }) {
  const event = useSocialEvent()
  const t = useCopy(copy)
  const { lang } = useSocialLang()
  const now = useNow(5_000)
  const agenda = useAgenda()
  const due = hidden || !agenda ? [] : bookingsDueNow(agenda.bookings, now)
  const booking = due.at(0)
  return (
    <div role="status" aria-live="polite">
      {booking && (
        <>
          {/* Keeps the page's last content clear of the fixed banner. */}
          <div className="h-24" aria-hidden="true" />
          <div className="fixed inset-x-0 bottom-0 z-30 px-3 pb-3">
            <Link
              to="/org/$slug/e/$eventSlug/agenda"
              params={{ slug: event.orgSlug, eventSlug: event.slug }}
              className="mx-auto flex min-h-14 max-w-xl items-center gap-3 rounded-2xl bg-[var(--baish-strong)] px-4 py-3 text-white shadow-[0_8px_24px_rgba(17,12,46,0.25)] hover:bg-foreground"
            >
              <CalendarClock className="size-5 shrink-0" aria-hidden="true" />
              <span className="flex min-w-0 grow flex-col">
                <span className="text-[15px] font-semibold">
                  {t.dueTitle(firstNameOf(booking.partner.name))}
                </span>
                <span className="truncate text-[13px] text-white/80">
                  {booking.spot ? spotName(booking.spot, lang) : t.dueNoSpot}
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

/**
 * The proposals waiting for the viewer's answer, as a section of the
 * requests page. Renders nothing when there are none.
 */
export function IncomingProposals() {
  const t = useCopy(copy)
  const now = useNow(15_000)
  const agenda = useAgenda()
  const incoming = agenda ? openProposals(agenda.incoming, now) : []
  if (incoming.length === 0) return null
  return (
    <section aria-labelledby="proposals-title" className="flex flex-col gap-3">
      <h2
        id="proposals-title"
        className="text-sm font-semibold text-muted-foreground"
      >
        {t.proposalsTitle(incoming.length)}
      </h2>
      {incoming.map((p) => (
        <ProposalAnswer key={p._id} proposal={p} />
      ))}
    </section>
  )
}

// ── Notices ─────────────────────────────────────────────────────────────

/**
 * What the viewer hasn't been told yet about proposals and bookings that
 * fell through, one line each with a dismiss button.
 */
export function BookingNotices({ agenda }: { agenda: Agenda }) {
  const t = useCopy(copy)
  const time = useSlotTime()
  const errorMessage = useBookingErrorMessage()
  const dismiss = useMutation(api.social.bookings.dismissNotice)
  const { busy, run } = useBusyAction()
  if (agenda.notices.length === 0) return null

  const text = {
    declined: t.noticeDeclined,
    expired: t.noticeExpired,
    cancelled: t.noticeCancelled,
    no_show: t.noticeNoShow,
  }
  return (
    <ul aria-label={t.noticesLabel} className="flex flex-col gap-2">
      {agenda.notices.map((notice) => (
        <li
          key={notice._id}
          className="flex items-center gap-1 rounded-xl border border-border bg-muted py-1 pl-3.5 pr-1 text-sm leading-snug"
        >
          <span className="grow">
            {text[notice.kind](
              firstNameOf(notice.partner.name),
              time(notice.slotStart),
            )}
          </span>
          <button
            type="button"
            disabled={busy !== null}
            aria-label={t.dismissNotice(notice.partner.name)}
            onClick={() =>
              void run(
                notice._id,
                () => dismiss({ bookingId: notice._id }),
                (error) => toast.error(errorMessage(error)),
              )
            }
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-card hover:text-foreground disabled:opacity-60"
          >
            <X className="size-[18px]" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  )
}
