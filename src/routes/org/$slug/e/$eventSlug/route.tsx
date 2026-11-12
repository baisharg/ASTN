import {
  Link,
  Outlet,
  createFileRoute,
  useLocation,
  useNavigate,
} from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAuth } from '@clerk/clerk-react'
import { convexQuery } from '@convex-dev/react-query'
import { useConvexAuth, useMutation } from 'convex/react'
import { Inbox } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { api } from '../../../../../../convex/_generated/api'
import type { Id } from '../../../../../../convex/_generated/dataModel'
import type { AlertsSeen } from '~/lib/social-live'
import { PersonalLinkSignIn } from '~/components/social/PersonalLinkSignIn'
import { SocialEventProvider } from '~/components/social/SocialEventContext'
import { MeetingBanner, useLiveState } from '~/components/social/live'
import { useHaptic } from '~/hooks/use-haptic'
import { LangToggle, SocialLangProvider, useCopy } from '~/lib/social-i18n'
import { liveAlerts, titleWithCount } from '~/lib/social-live'

export const Route = createFileRoute('/org/$slug/e/$eventSlug')({
  loader: async ({ context, params }) => {
    const event = await context.queryClient.ensureQueryData(
      convexQuery(api.social.events.getEventPage, {
        orgSlug: params.slug,
        eventSlug: params.eventSlug,
      }),
    )
    return { event }
  },
  head: ({ loaderData, params }) => {
    const event = loaderData?.event
    const title = event ? eventPageTitle(event) : 'Evento'
    const description =
      event?.description?.slice(0, 155) ??
      'Registrate y reunite 1:1 con otros asistentes.'
    const url = `https://safetytalent.org/org/${params.slug}/e/${params.eventSlug}`
    return {
      meta: [
        { title },
        { name: 'description', content: description },
        { property: 'og:url', content: url },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
      ],
    }
  },
  component: EventLayout,
})

/** The tab title of every page of an event. */
function eventPageTitle(event: { title: string; orgName: string }): string {
  return `${event.title} · ${event.orgName}`
}

const copy = {
  es: {
    notFoundTitle: 'Evento no encontrado',
    notFoundBody: 'El link puede estar mal o el evento ya no está publicado.',
    requests: 'Solicitudes',
    newRequests: (n: number) => `Solicitudes, ${n} nuevas`,
    draft: 'Borrador: solo lo ven admins',
    newRequest: (name: string) => `${name} quiere reunirse con vos`,
    seeRequest: 'Ver',
    meetingStarted: (name: string, spot: number | null) =>
      spot === null
        ? `${name} aceptó tu solicitud. Ya pueden reunirse.`
        : `${name} aceptó tu solicitud. Se reúnen en el lugar ${spot}.`,
  },
  en: {
    notFoundTitle: 'Event not found',
    notFoundBody: 'The link may be wrong or the event is no longer published.',
    requests: 'Requests',
    newRequests: (n: number) => `Requests, ${n} new`,
    draft: 'Draft: only admins can see this',
    newRequest: (name: string) => `${name} wants to meet you`,
    seeRequest: 'View',
    meetingStarted: (name: string, spot: number | null) =>
      spot === null
        ? `${name} accepted your request. You can meet now.`
        : `${name} accepted your request. Meet at spot ${spot}.`,
  },
}

function EventLayout() {
  return (
    <SocialLangProvider>
      <div className="baish-theme min-h-screen">
        <EventLayoutInner />
      </div>
    </SocialLangProvider>
  )
}

function EventLayoutInner() {
  const { slug, eventSlug } = Route.useParams()
  const t = useCopy(copy)
  const { data: event } = useSuspenseQuery(
    convexQuery(api.social.events.getEventPage, {
      orgSlug: slug,
      eventSlug,
    }),
  )

  if (!event) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-2 px-5 py-16 text-center">
        <h1 className="baish-serif text-2xl font-semibold">
          {t.notFoundTitle}
        </h1>
        <p className="text-muted-foreground">{t.notFoundBody}</p>
      </div>
    )
  }

  return (
    <SocialEventProvider value={event}>
      <LinkGuestOnLoad eventId={event._id} />
      <LiveAlerts eventId={event._id} title={eventPageTitle(event)} />
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3 px-5 py-2.5">
          <Link
            to="/org/$slug/e/$eventSlug"
            params={{ slug, eventSlug }}
            className="flex items-center gap-2.5 text-[var(--baish-strong)]"
          >
            <span className="size-7 rounded-lg bg-primary" aria-hidden="true" />
            <span className="text-[17px] font-bold tracking-[0.04em]">
              {event.orgSlug.length <= 8
                ? event.orgSlug.toUpperCase()
                : event.orgName}
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <RequestsBadge />
            <LangToggle />
          </div>
        </div>
        {event.status === 'draft' && (
          <p className="bg-[var(--baish-warn-bg)] px-5 py-1.5 text-center text-xs font-medium text-[var(--baish-warn)]">
            {t.draft}
          </p>
        )}
      </header>
      <div className="mx-auto max-w-xl">
        <PersonalLinkSignIn />
        <Outlet />
        <EventMeetingBanner />
      </div>
    </SocialEventProvider>
  )
}

/**
 * Guests who registered on Luma get linked to their account on first visit:
 * once per event and account, so a second event or a second account in the
 * same session is linked too.
 */
function LinkGuestOnLoad({ eventId }: { eventId: Id<'socialEvents'> }) {
  const { isAuthenticated } = useConvexAuth()
  const { userId } = useAuth()
  const linkMyGuest = useMutation(api.social.events.linkMyGuest)
  const linkedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!isAuthenticated || !userId) return
    const key = `${eventId}:${userId}`
    if (linkedFor.current === key) return
    linkedFor.current = key
    void linkMyGuest({ eventId })
  }, [isAuthenticated, userId, eventId, linkMyGuest])
  return null
}

/**
 * Alerts for the signed-in attendee on every page of the event: a toast, a
 * vibration (where the browser has one) and a count in the tab title for new
 * 1:1 requests, and a jump to the meeting page when a meeting starts. Nothing
 * alerts for what was already there when the page loaded.
 */
function LiveAlerts({
  eventId,
  title,
}: {
  eventId: Id<'socialEvents'>
  title: string
}) {
  const { slug, eventSlug } = Route.useParams()
  const t = useCopy(copy)
  const navigate = useNavigate()
  const pathname = useLocation({ select: (location) => location.pathname })
  const { userId } = useAuth()
  const { custom: vibrate } = useHaptic()
  const live = useLiveState()
  const seen = useRef<AlertsSeen | null>(null)

  useEffect(() => {
    // Still loading: keep the baseline from before.
    if (live === undefined) return
    if (!live?.isAttendee || !userId) {
      seen.current = null
      return
    }
    const alerts = liveAlerts(seen.current, `${eventId}:${userId}`, live)
    seen.current = alerts.seen

    for (const request of alerts.newIncoming) {
      toast(t.newRequest(request.from.name), {
        duration: 10_000,
        action: {
          label: t.seeRequest,
          onClick: () =>
            void navigate({
              to: '/org/$slug/e/$eventSlug/requests',
              params: { slug, eventSlug },
            }),
        },
      })
    }
    if (alerts.newIncoming.length > 0) vibrate(200)

    const meeting = alerts.startedMeeting
    if (meeting) {
      // The person who accepted is already on their way to the meeting
      // page; the one whose request was accepted needs telling.
      if (!meeting.viewerAccepted) {
        toast.success(
          t.meetingStarted(meeting.partner.name, meeting.spot?.number ?? null),
          { duration: 10_000 },
        )
        vibrate([200, 100, 200])
      }
      void navigate({
        to: '/org/$slug/e/$eventSlug/meeting',
        params: { slug, eventSlug },
      })
    }
  }, [live, userId, eventId, slug, eventSlug, t, navigate, vibrate])

  // The number of requests waiting, in the tab title. `pathname` is a
  // dependency so the count is written again after a page change.
  const waiting = live?.isAttendee ? live.incoming.length : 0
  useEffect(() => {
    if (waiting === 0) return
    const written = titleWithCount(title, waiting)
    document.title = written
    return () => {
      // Leave the title alone if the next page has already set its own.
      if (document.title === written) document.title = title
    }
  }, [title, waiting, pathname])

  return null
}

/**
 * The "you have a meeting" banner on every page of the event except the
 * meeting page itself, which already shows the meeting.
 */
function EventMeetingBanner() {
  const { slug, eventSlug } = Route.useParams()
  const pathname = useLocation({ select: (location) => location.pathname })
  const live = useLiveState()
  const onMeetingPage =
    pathname.replace(/\/$/, '') === `/org/${slug}/e/${eventSlug}/meeting`
  const meeting = live?.isAttendee && !onMeetingPage ? live.meeting : null
  return <MeetingBanner meeting={meeting} />
}

function RequestsBadge() {
  const { slug, eventSlug } = Route.useParams()
  const t = useCopy(copy)
  const live = useLiveState()
  if (!live?.isAttendee) return null
  const count = live.incoming.length
  return (
    <Link
      to="/org/$slug/e/$eventSlug/requests"
      params={{ slug, eventSlug }}
      aria-label={count > 0 ? t.newRequests(count) : t.requests}
      className="relative flex size-11 items-center justify-center rounded-xl text-foreground hover:bg-muted"
    >
      <Inbox className="size-[22px]" aria-hidden="true" />
      {count > 0 && (
        <span className="absolute right-1 top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">
          {count}
        </span>
      )}
    </Link>
  )
}
