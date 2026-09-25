import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { Clock3, MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../../../../../convex/_generated/api'
import type { LiveState } from '~/components/social/live'
import { useNow } from '~/components/social/SocialEventContext'
import {
  AttendeeGate,
  timeAgo,
  useMeetingsOpen,
  useSocialErrorMessage,
  useStartMeeting,
} from '~/components/social/live'
import {
  Avatar,
  PageTitle,
  Panel,
  primaryButtonClass,
  secondaryButtonClass,
} from '~/components/social/ui'
import { Spinner } from '~/components/ui/spinner'
import { useCopy, useSocialLang } from '~/lib/social-i18n'
import { useBusyAction } from '~/lib/use-busy-action'

export const Route = createFileRoute('/org/$slug/e/$eventSlug/requests')({
  component: RequestsPage,
})

type Incoming = LiveState['incoming'][number]
type Outgoing = LiveState['outgoing'][number]

const copy = {
  es: {
    title: 'Solicitudes',
    incoming: (n: number) => `Te esperan (${n})`,
    outgoing: (n: number) => `Enviadas por vos (${n})`,
    wantsToMeet: 'Quiere reunirse ahora',
    accept: 'Aceptar',
    decline: 'Rechazar',
    declined: 'Rechazaste la solicitud.',
    cancel: 'Cancelar',
    cancelled: 'Cancelaste la solicitud.',
    inMeetingTitle: (spot: number | null) =>
      spot === null
        ? 'Estás en una reunión'
        : `Estás en una reunión en el lugar ${spot}`,
    inMeetingBody:
      'Las solicitudes nuevas esperan acá. Vas a poder aceptarlas cuando termine tu reunión.',
    openMeeting: 'Abrir reunión',
    waitingForYou: 'En espera. Podés aceptarla cuando termine tu reunión.',
    requesterInMeeting:
      'Está en una reunión. Vas a poder aceptar cuando termine.',
    closedHint: 'Los 1:1 no están abiertos en este momento.',
    noIncoming: 'Nadie te pidió un 1:1 todavía.',
    noOutgoing: 'No tenés solicitudes enviadas esperando respuesta.',
    findPeople: 'Buscar personas para conocer',
    waiting: 'Esperando',
    queue: (n: number) => `${n}.º en su fila`,
    theyInMeeting: 'en una reunión',
    theyBusy: 'no disponible por ahora',
    cancelLabel: (name: string) => `Cancelar solicitud a ${name}`,
    acceptLabel: (name: string) => `Aceptar a ${name}`,
    declineLabel: (name: string) => `Rechazar a ${name}`,
  },
  en: {
    title: 'Requests',
    incoming: (n: number) => `Waiting for you (${n})`,
    outgoing: (n: number) => `Sent by you (${n})`,
    wantsToMeet: 'Wants to meet now',
    accept: 'Accept',
    decline: 'Decline',
    declined: 'You declined the request.',
    cancel: 'Cancel',
    cancelled: 'You cancelled the request.',
    inMeetingTitle: (spot: number | null) =>
      spot === null
        ? "You're in a meeting"
        : `You're in a meeting at spot ${spot}`,
    inMeetingBody:
      'New requests wait here. You can accept them once your meeting ends.',
    openMeeting: 'Open meeting',
    waitingForYou: 'On hold. You can accept it once your meeting ends.',
    requesterInMeeting: "They're in a meeting. You can accept once it ends.",
    closedHint: '1:1s are not open right now.',
    noIncoming: 'Nobody has asked you for a 1:1 yet.',
    noOutgoing: "You don't have any sent requests waiting for an answer.",
    findPeople: 'Find people to meet',
    waiting: 'Waiting',
    queue: (n: number) => `#${n} in their queue`,
    theyInMeeting: 'in a meeting',
    theyBusy: 'not available for now',
    cancelLabel: (name: string) => `Cancel request to ${name}`,
    acceptLabel: (name: string) => `Accept ${name}`,
    declineLabel: (name: string) => `Decline ${name}`,
  },
}

function RequestsPage() {
  return (
    <AttendeeGate>{(live) => <RequestsContent live={live} />}</AttendeeGate>
  )
}

function RequestsContent({ live }: { live: LiveState }) {
  const { slug, eventSlug } = Route.useParams()
  const t = useCopy(copy)
  const now = useNow(15_000)
  const meetingsOpen = useMeetingsOpen()

  return (
    <main className="flex flex-col gap-[22px] px-5 pb-8 pt-4">
      <PageTitle>{t.title}</PageTitle>

      {live.meeting && (
        <Panel className="gap-2.5 border-[var(--baish-warn-dot)] bg-[var(--baish-warn-bg)] p-4">
          <div className="flex items-center gap-2 text-[var(--baish-warn)]">
            <MapPin className="size-5" aria-hidden="true" />
            <h2 className="text-base font-semibold">
              {t.inMeetingTitle(live.meeting.spot?.number ?? null)}
            </h2>
          </div>
          <p className="text-[15px] leading-normal">{t.inMeetingBody}</p>
          <Link
            to="/org/$slug/e/$eventSlug/meeting"
            params={{ slug, eventSlug }}
            className={`${primaryButtonClass} h-12 text-[15px]`}
          >
            {t.openMeeting}
          </Link>
        </Panel>
      )}

      <section aria-labelledby="incoming-title" className="flex flex-col gap-3">
        <h2
          id="incoming-title"
          className="text-sm font-semibold text-muted-foreground"
        >
          {t.incoming(live.incoming.length)}
        </h2>
        {live.incoming.length === 0 ? (
          <p className="text-[15px] text-muted-foreground">{t.noIncoming}</p>
        ) : (
          live.incoming.map((r) => (
            <IncomingCard
              key={r._id}
              live={live}
              meetingsOpen={meetingsOpen}
              request={r}
              now={now}
            />
          ))
        )}
      </section>

      <section aria-labelledby="outgoing-title" className="flex flex-col gap-3">
        <h2
          id="outgoing-title"
          className="text-sm font-semibold text-muted-foreground"
        >
          {t.outgoing(live.outgoing.length)}
        </h2>
        {live.outgoing.length === 0 ? (
          <p className="text-[15px] text-muted-foreground">{t.noOutgoing}</p>
        ) : (
          live.outgoing.map((r) => <OutgoingRow key={r._id} request={r} />)
        )}
      </section>

      {live.incoming.length === 0 && live.outgoing.length === 0 && (
        <Link
          to="/org/$slug/e/$eventSlug/people"
          params={{ slug, eventSlug }}
          className={secondaryButtonClass}
        >
          {t.findPeople}
        </Link>
      )}
    </main>
  )
}

function IncomingCard({
  live,
  meetingsOpen,
  request: r,
  now,
}: {
  live: LiveState
  meetingsOpen: boolean
  request: Incoming
  now: number
}) {
  const { slug, eventSlug } = Route.useParams()
  const t = useCopy(copy)
  const { lang } = useSocialLang()
  const errorMessage = useSocialErrorMessage()
  const startMeeting = useStartMeeting()
  const respond = useMutation(api.social.meetings.respondToRequest)
  const { busy, run } = useBusyAction<'accept' | 'decline'>()
  const onError = (error: unknown) => toast.error(errorMessage(error))

  const onAccept = () =>
    run('accept', () => startMeeting.accept(r._id), onError)
  const onDecline = () =>
    run(
      'decline',
      async () => {
        await respond({ requestId: r._id, accept: false })
        toast.success(t.declined)
      },
      onError,
    )

  const hint = live.meeting
    ? t.waitingForYou
    : !meetingsOpen
      ? t.closedHint
      : r.fromState === 'in_meeting'
        ? t.requesterInMeeting
        : null
  const canAccept = hint === null

  return (
    <article
      className={`flex flex-col gap-3 rounded-2xl border bg-card p-4 ${
        canAccept
          ? 'border-input shadow-[0_1px_2px_rgba(17,12,46,0.06),0_8px_24px_rgba(17,12,46,0.06)]'
          : 'border-border'
      }`}
    >
      <Link
        to="/org/$slug/e/$eventSlug/people/$userId"
        params={{ slug, eventSlug, userId: r.from.userId }}
        className="-m-1 flex items-center gap-3 rounded-xl p-1 hover:bg-muted"
      >
        <Avatar initials={r.from.initials} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-base font-semibold text-[var(--baish-strong)]">
            {r.from.name}
          </span>
          <span className="text-[13px] text-muted-foreground">
            {t.wantsToMeet} · {timeAgo(r.createdAt, now, lang)}
          </span>
        </span>
      </Link>
      {r.note && (
        <p className="whitespace-pre-line break-words rounded-xl bg-background px-3 py-2.5 text-[15px] leading-normal">
          {r.note}
        </p>
      )}
      {r.from.headline && (
        <p className="text-[13px] leading-normal text-muted-foreground">
          {r.from.headline}
        </p>
      )}
      {hint && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock3 className="size-[18px] shrink-0" aria-hidden="true" />
          {hint}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void onDecline()}
          aria-label={t.declineLabel(r.from.name)}
          className={`${secondaryButtonClass} grow basis-0`}
        >
          {busy === 'decline' ? <Spinner size="sm" /> : t.decline}
        </button>
        {canAccept && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void onAccept()}
            aria-label={t.acceptLabel(r.from.name)}
            className={`${primaryButtonClass} h-12 grow basis-0 text-[15px]`}
          >
            {busy === 'accept' ? <Spinner size="sm" /> : t.accept}
          </button>
        )}
      </div>
    </article>
  )
}

function OutgoingRow({ request: r }: { request: Outgoing }) {
  const { slug, eventSlug } = Route.useParams()
  const t = useCopy(copy)
  const errorMessage = useSocialErrorMessage()
  const cancelRequest = useMutation(api.social.meetings.cancelRequest)
  const { busy, run } = useBusyAction<'cancel'>()

  const onCancel = () =>
    run(
      'cancel',
      async () => {
        await cancelRequest({ requestId: r._id })
        toast.success(t.cancelled)
      },
      (error) => toast.error(errorMessage(error)),
    )

  const status = [
    t.waiting,
    t.queue(r.queuePosition),
    r.toState === 'in_meeting'
      ? t.theyInMeeting
      : r.toState === 'busy'
        ? t.theyBusy
        : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <article className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3.5">
      <Link
        to="/org/$slug/e/$eventSlug/people/$userId"
        params={{ slug, eventSlug, userId: r.to.userId }}
        className="-m-1 flex min-w-0 grow items-center gap-3 rounded-xl p-1 hover:bg-muted"
      >
        <Avatar initials={r.to.initials} size={40} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[15px] font-semibold text-[var(--baish-strong)]">
            {r.to.name}
          </span>
          <span className="text-[13px] text-muted-foreground">{status}</span>
        </span>
      </Link>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void onCancel()}
        aria-label={t.cancelLabel(r.to.name)}
        className="flex h-11 shrink-0 items-center justify-center rounded-xl border border-input bg-card px-3.5 text-sm font-semibold text-[var(--baish-brand-text)] hover:bg-muted disabled:opacity-60"
      >
        {busy ? <Spinner size="sm" /> : t.cancel}
      </button>
    </article>
  )
}
