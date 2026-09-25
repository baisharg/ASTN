import { Link, Outlet, createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { convexQuery } from '@convex-dev/react-query'
import { useConvexAuth, useMutation, useQuery } from 'convex/react'
import { Inbox } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { api } from '../../../../../../convex/_generated/api'
import type { Id } from '../../../../../../convex/_generated/dataModel'
import {
  SocialEventProvider,
  useNow,
} from '~/components/social/SocialEventContext'
import { LangToggle, SocialLangProvider, useCopy } from '~/lib/social-i18n'

const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,500;8..60,600&display=swap'

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
    const title = event ? `${event.title} · ${event.orgName}` : 'Evento'
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
      links: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'stylesheet', href: FONTS_HREF },
      ],
    }
  },
  component: EventLayout,
})

const copy = {
  es: {
    notFoundTitle: 'Evento no encontrado',
    notFoundBody: 'El link puede estar mal o el evento ya no está publicado.',
    requests: 'Solicitudes',
    newRequests: (n: number) => `Solicitudes, ${n} nuevas`,
    draft: 'Borrador: solo lo ven admins',
  },
  en: {
    notFoundTitle: 'Event not found',
    notFoundBody: 'The link may be wrong or the event is no longer published.',
    requests: 'Requests',
    newRequests: (n: number) => `Requests, ${n} new`,
    draft: 'Draft: only admins can see this',
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
            <RequestsBadge eventId={event._id} />
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
        <Outlet />
      </div>
    </SocialEventProvider>
  )
}

/** Guests who registered on Luma get linked to their account on first visit. */
function LinkGuestOnLoad({ eventId }: { eventId: Id<'socialEvents'> }) {
  const { isAuthenticated } = useConvexAuth()
  const linkMyGuest = useMutation(api.social.events.linkMyGuest)
  const done = useRef(false)
  useEffect(() => {
    if (!isAuthenticated || done.current) return
    done.current = true
    void linkMyGuest({ eventId })
  }, [isAuthenticated, eventId, linkMyGuest])
  return null
}

function RequestsBadge({ eventId }: { eventId: Id<'socialEvents'> }) {
  const { slug, eventSlug } = Route.useParams()
  const t = useCopy(copy)
  const { isAuthenticated } = useConvexAuth()
  const now = useNow()
  const live = useQuery(
    api.social.meetings.getLiveState,
    isAuthenticated ? { eventId, now } : 'skip',
  )
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
