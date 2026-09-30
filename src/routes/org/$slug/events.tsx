import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import {
  Building2,
  Calendar,
  Clock,
  ExternalLink,
  MapPin,
  Video,
} from 'lucide-react'
import { api } from '../../../../convex/_generated/api'
import { AuthHeader } from '~/components/layout/auth-header'
import { GradientBg } from '~/components/layout/GradientBg'
import { formatEventDate } from '~/lib/format-event-date'
import { Card } from '~/components/ui/card'
import { Button } from '~/components/ui/button'

export const Route = createFileRoute('/org/$slug/events')({
  component: OrgEventsPage,
})

function EventCard({
  event,
}: {
  event: {
    title: string
    startAt: number
    endAt?: number
    timezone: string
    coverUrl?: string
    url: string
    location?: string
    isVirtual: boolean
  }
}) {
  // Older rows stored only the Luma slug; newer ones the full URL.
  const lumaUrl = /^https?:\/\//.test(event.url)
    ? event.url
    : `https://luma.com/${event.url}`

  return (
    <a
      href={lumaUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block group"
    >
      <Card className="overflow-hidden hover:shadow-md transition-shadow">
        <div className="flex gap-4 p-4">
          {event.coverUrl && (
            <img
              src={event.coverUrl}
              alt=""
              className="size-20 rounded-lg object-cover shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors truncate">
              {event.title}
            </h3>
            <div className="mt-1 flex items-center gap-1.5 text-sm text-slate-600">
              <Clock className="size-3.5 shrink-0" />
              <span>
                {formatEventDate(event.startAt, event.endAt, event.timezone)}
              </span>
            </div>
            {event.location && (
              <div className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                <MapPin className="size-3.5 shrink-0" />
                <span className="truncate">{event.location}</span>
              </div>
            )}
            {event.isVirtual && (
              <div className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                <Video className="size-3.5 shrink-0" />
                <span>Online event</span>
              </div>
            )}
          </div>
          <ExternalLink className="size-4 text-slate-400 shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </Card>
    </a>
  )
}

function OrgEventsPage() {
  const { slug } = Route.useParams()
  const org = useQuery(api.orgs.directory.getOrgBySlug, { slug })
  const events = useQuery(
    api.events.queries.getOrgEvents,
    org ? { orgId: org._id } : 'skip',
  )

  // Loading state
  if (org === undefined) {
    return (
      <GradientBg>
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-4xl mx-auto">
            <div className="animate-pulse space-y-6">
              <div className="h-16 bg-slate-100 rounded-xl" />
              <div className="h-[600px] bg-slate-100 rounded-xl" />
            </div>
          </div>
        </main>
      </GradientBg>
    )
  }

  // Not found state
  if (org === null) {
    return (
      <GradientBg>
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <div className="size-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
              <Building2 className="size-8 text-slate-400" />
            </div>
            <h1 className="text-2xl font-display text-foreground mb-4">
              Organization Not Found
            </h1>
            <p className="text-slate-600 mb-6">
              This organization doesn&apos;t exist or the link is incorrect.
            </p>
            <Button asChild>
              <Link to="/">Go Home</Link>
            </Button>
          </div>
        </main>
      </GradientBg>
    )
  }

  const hasEvents =
    events && (events.upcoming.length > 0 || events.past.length > 0)

  return (
    <GradientBg>
      <AuthHeader />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <Card className="p-6 mb-6">
            <div className="flex items-center gap-4">
              {org.logoUrl ? (
                <img
                  src={org.logoUrl}
                  alt={org.name}
                  className="size-12 rounded-lg object-cover"
                />
              ) : (
                <div className="size-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Building2 className="size-6 text-primary" />
                </div>
              )}
              <div className="flex-1">
                <div className="flex items-center gap-2 text-slate-500 text-sm mb-1">
                  <Link
                    to="/org/$slug"
                    params={{ slug }}
                    className="hover:text-slate-700 transition-colors"
                  >
                    {org.name}
                  </Link>
                  <span>/</span>
                  <span className="text-slate-700">Events</span>
                </div>
                <h1 className="text-xl font-display text-foreground">
                  <Calendar className="size-5 inline-block mr-2 -mt-0.5" />
                  Events Calendar
                </h1>
              </div>
              {org.lumaCalendarUrl && (
                <a
                  href={org.lumaCalendarUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-slate-500 hover:text-slate-700 transition-colors inline-flex items-center gap-1"
                >
                  View on lu.ma
                  <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          </Card>

          {/* Events content */}
          {events === undefined ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-24 bg-slate-100 rounded-xl animate-pulse"
                />
              ))}
            </div>
          ) : hasEvents ? (
            <div className="space-y-8">
              {events.upcoming.length > 0 && (
                <section>
                  <h2 className="text-lg font-semibold text-foreground mb-3">
                    Upcoming Events
                  </h2>
                  <div className="space-y-3">
                    {events.upcoming.map((event) => (
                      <EventCard key={event._id} event={event} />
                    ))}
                  </div>
                </section>
              )}

              {events.past.length > 0 && (
                <section>
                  <h2 className="text-lg font-semibold text-slate-500 mb-3">
                    Past Events
                  </h2>
                  <div className="space-y-3 opacity-75">
                    {events.past.map((event) => (
                      <EventCard key={event._id} event={event} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          ) : (
            <Card className="p-12 text-center">
              <div className="size-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                <Calendar className="size-8 text-slate-400" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-2">
                No Events Yet
              </h2>
              <p className="text-slate-600">
                This organization hasn&apos;t set up their event calendar yet.
              </p>
            </Card>
          )}
        </div>
      </main>
    </GradientBg>
  )
}
