import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { CheckCircle2, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../../../../../convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import type { LiveState } from '~/components/social/live'
import type { AttendeeState } from '~/components/social/ui'
import { useNow, useSocialEvent } from '~/components/social/SocialEventContext'
import {
  AttendeeGate,
  MeetingBanner,
  PageSpinner,
  formatDuration,
  requestBlock,
  requestBlockCopy,
  useSocialErrorMessage,
} from '~/components/social/live'
import {
  Avatar,
  Chip,
  Eyebrow,
  PageTitle,
  Panel,
  StateLabel,
  primaryButtonClass,
  secondaryButtonClass,
} from '~/components/social/ui'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/utils'
import { formatTime, useCopy, useSocialLang } from '~/lib/social-i18n'

export const Route = createFileRoute('/org/$slug/e/$eventSlug/people/')({
  component: PeoplePage,
})

type Suggestion = FunctionReturnType<
  typeof api.social.suggestions.getMySuggestions
>[number]
type Attendee = FunctionReturnType<
  typeof api.social.meetings.listAttendees
>[number]
type RefreshResult = FunctionReturnType<
  typeof api.social.suggestions.refreshMySuggestions
>

const copy = {
  es: {
    openLeft: (left: string) => `1:1 abiertos · quedan ${left}`,
    open: '1:1 abiertos',
    opensAt: (time: string) => `Los 1:1 abren a las ${time}`,
    closed: 'Los 1:1 están cerrados',
    yourStatus: 'Tu estado',
    available: 'Disponible',
    busy: 'No disponible',
    statusFailed: 'No pudimos cambiar tu estado. Probá de nuevo.',
    focus: 'El foco de esta noche',
    tabsLabel: 'Asistentes',
    suggested: (n: number) => `Sugeridos (${n})`,
    everyone: (n: number) => `Todos (${n})`,
    why: 'Por qué conversar: ',
    viewProfile: 'Ver perfil',
    meetNow: 'Reunirse ahora',
    accept: 'Aceptar',
    requested: 'Solicitud enviada',
    sent: (name: string) =>
      `Le mandamos tu solicitud a ${name}. Si acepta, les asignamos un lugar.`,
    state: {
      available: 'Disponible',
      in_meeting: 'En reunión',
      busy: 'No disponible',
    },
    incompleteTitle: 'Completá tu perfil para recibir sugerencias',
    incompleteBody:
      'Te sugerimos personas según tu trayectoria, lo que buscás y en qué podés ayudar.',
    incompleteButton: 'Completar perfil',
    generatingTitle: 'Estamos armando tus sugerencias',
    generatingBody:
      'Aparecen acá en un minuto. Mientras tanto, podés ver a todos los asistentes.',
    seeEveryone: 'Ver a todos',
    nobody: 'Todavía no hay otros asistentes confirmados.',
  },
  en: {
    openLeft: (left: string) => `1:1s open · ${left} left`,
    open: '1:1s open',
    opensAt: (time: string) => `1:1s open at ${time}`,
    closed: '1:1s are closed',
    yourStatus: 'Your status',
    available: 'Available',
    busy: 'Not available',
    statusFailed: "We couldn't change your status. Please try again.",
    focus: "Tonight's focus",
    tabsLabel: 'Attendees',
    suggested: (n: number) => `Suggested (${n})`,
    everyone: (n: number) => `Everyone (${n})`,
    why: 'Why talk: ',
    viewProfile: 'View profile',
    meetNow: 'Meet now',
    accept: 'Accept',
    requested: 'Request sent',
    sent: (name: string) =>
      `We sent your request to ${name}. If they accept, you both get a spot.`,
    state: {
      available: 'Available',
      in_meeting: 'In a meeting',
      busy: 'Not available',
    },
    incompleteTitle: 'Complete your profile to get suggestions',
    incompleteBody:
      "We suggest people based on your background, what you're looking for and what you can help with.",
    incompleteButton: 'Complete profile',
    generatingTitle: "We're putting your suggestions together",
    generatingBody:
      'They show up here in a minute. Meanwhile, you can browse everyone.',
    seeEveryone: 'See everyone',
    nobody: 'No other confirmed attendees yet.',
  },
}

function PeoplePage() {
  return <AttendeeGate>{(live) => <PeopleContent live={live} />}</AttendeeGate>
}

type Tab = 'suggested' | 'everyone'

function PeopleContent({ live }: { live: LiveState }) {
  const event = useSocialEvent()
  const t = useCopy(copy)
  const [tab, setTab] = useState<Tab>('suggested')
  const suggestions = useQuery(api.social.suggestions.getMySuggestions, {
    eventId: event._id,
  })
  const attendees = useQuery(api.social.meetings.listAttendees, {
    eventId: event._id,
  })
  const refreshResult = useRefreshSuggestions(attendees?.length)

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'suggested', label: t.suggested(suggestions?.length ?? 0) },
    { id: 'everyone', label: t.everyone(attendees?.length ?? 0) },
  ]

  const onTabKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next: Tab = tab === 'suggested' ? 'everyone' : 'suggested'
    setTab(next)
    document.getElementById(`people-tab-${next}`)?.focus()
  }

  const stateById = new Map<string, AttendeeState>(
    (attendees ?? []).map((a) => [a.userId, a.state]),
  )

  return (
    <main className="flex flex-col gap-[18px] px-5 pb-8 pt-[18px]">
      <div className="flex flex-col gap-1">
        <PageTitle>{event.title}</PageTitle>
        <MeetingsWindowLine live={live} />
      </div>

      <AvailabilityToggle live={live} />

      {event.focus && (
        <section
          aria-label={t.focus}
          className="flex flex-col gap-1 rounded-[14px] bg-muted px-4 py-3.5"
        >
          <Eyebrow>{t.focus}</Eyebrow>
          <p className="text-sm leading-normal">{event.focus}</p>
        </section>
      )}

      <div
        role="tablist"
        aria-label={t.tabsLabel}
        className="flex border-b border-border"
      >
        {tabs.map(({ id, label }) => {
          const selected = tab === id
          return (
            <button
              key={id}
              id={`people-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`people-panel-${id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={onTabKeyDown}
              className={cn(
                'h-[46px] grow border-b-2 text-[15px] font-semibold',
                selected
                  ? 'border-primary text-[var(--baish-strong)]'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        id={`people-panel-${tab}`}
        aria-labelledby={`people-tab-${tab}`}
      >
        {tab === 'suggested' ? (
          <SuggestedPanel
            live={live}
            suggestions={suggestions}
            stateById={stateById}
            refreshResult={refreshResult}
            onSeeEveryone={() => setTab('everyone')}
          />
        ) : (
          <EveryonePanel attendees={attendees} />
        )}
      </div>

      <MeetingBanner meeting={live.meeting} />
    </main>
  )
}

/**
 * Asks for fresh suggestions on load and whenever more attendees show up.
 * The backend throttles this, so calling it often is fine.
 */
function useRefreshSuggestions(
  attendeeCount: number | undefined,
): RefreshResult | null {
  const event = useSocialEvent()
  const refresh = useMutation(api.social.suggestions.refreshMySuggestions)
  const [result, setResult] = useState<RefreshResult | null>(null)
  const lastCount = useRef(-1)
  useEffect(() => {
    if (attendeeCount === undefined || attendeeCount <= lastCount.current) {
      return
    }
    lastCount.current = attendeeCount
    refresh({ eventId: event._id })
      .then(setResult)
      .catch((error: unknown) => console.error(error))
  }, [attendeeCount, event._id, refresh])
  return result
}

function MeetingsWindowLine({ live }: { live: LiveState }) {
  const event = useSocialEvent()
  const t = useCopy(copy)
  const { lang } = useSocialLang()
  const now = useNow()
  let text: string
  if (live.meetingsOpen) {
    text =
      live.meetingsCloseAt !== null
        ? t.openLeft(formatDuration(live.meetingsCloseAt - now))
        : t.open
  } else if (live.meetingsOpenAt !== null && now < live.meetingsOpenAt) {
    text = t.opensAt(formatTime(live.meetingsOpenAt, event.timezone, lang))
  } else {
    text = t.closed
  }
  return <p className="text-sm text-muted-foreground">{text}</p>
}

function AvailabilityToggle({ live }: { live: LiveState }) {
  const event = useSocialEvent()
  const t = useCopy(copy)
  const setAvailability = useMutation(api.social.meetings.setAvailability)
  const [saving, setSaving] = useState(false)

  const choose = async (availability: 'available' | 'busy') => {
    if (availability === live.availability || saving) return
    setSaving(true)
    try {
      await setAvailability({ eventId: event._id, availability })
    } catch (error) {
      console.error(error)
      toast.error(t.statusFailed)
    } finally {
      setSaving(false)
    }
  }

  const options = [
    { value: 'available', label: t.available },
    { value: 'busy', label: t.busy },
  ] as const

  return (
    <div className="flex items-center justify-between gap-3">
      <span
        id="status-label"
        className="text-sm font-semibold text-[var(--baish-strong)]"
      >
        {t.yourStatus}
      </span>
      <div
        role="group"
        aria-labelledby="status-label"
        aria-busy={saving}
        className="flex gap-0.5 rounded-xl border border-border bg-muted p-[3px]"
      >
        {options.map(({ value, label }) => {
          const active = live.availability === value
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              disabled={saving}
              onClick={() => void choose(value)}
              className={cn(
                'h-11 rounded-[10px] px-3.5 text-sm font-semibold',
                active
                  ? 'bg-card shadow-[0_1px_2px_rgba(17,12,46,0.12)]'
                  : 'text-muted-foreground hover:text-foreground',
                active && value === 'available' && 'text-[var(--baish-ok)]',
                active && value === 'busy' && 'text-[var(--baish-strong)]',
              )}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SuggestedPanel({
  live,
  suggestions,
  stateById,
  refreshResult,
  onSeeEveryone,
}: {
  live: LiveState
  suggestions: Array<Suggestion> | undefined
  stateById: Map<string, AttendeeState>
  refreshResult: RefreshResult | null
  onSeeEveryone: () => void
}) {
  const { slug, eventSlug } = Route.useParams()
  const t = useCopy(copy)

  if (suggestions === undefined) return <PageSpinner />

  if (suggestions.length === 0) {
    if (!live.profileReady || refreshResult === 'profile_incomplete') {
      return (
        <Panel>
          <h2 className="text-[17px] font-semibold text-[var(--baish-strong)]">
            {t.incompleteTitle}
          </h2>
          <p className="text-[15px] leading-normal">{t.incompleteBody}</p>
          <Link
            to="/org/$slug/e/$eventSlug/profile"
            params={{ slug, eventSlug }}
            className={primaryButtonClass}
          >
            {t.incompleteButton}
          </Link>
        </Panel>
      )
    }
    return (
      <Panel>
        <div className="flex items-center gap-2.5">
          {refreshResult === 'scheduled' ? (
            <Spinner size="sm" />
          ) : (
            <Sparkles
              className="size-5 text-[var(--baish-brand-text)]"
              aria-hidden="true"
            />
          )}
          <h2 className="text-[17px] font-semibold text-[var(--baish-strong)]">
            {t.generatingTitle}
          </h2>
        </div>
        <p className="text-[15px] leading-normal">{t.generatingBody}</p>
        <button
          type="button"
          onClick={onSeeEveryone}
          className={secondaryButtonClass}
        >
          {t.seeEveryone}
        </button>
      </Panel>
    )
  }

  return (
    <div className="flex flex-col gap-3.5">
      {suggestions.map((s) => (
        <SuggestionCard
          key={s.userId}
          live={live}
          suggestion={s}
          state={stateById.get(s.userId) ?? 'available'}
        />
      ))}
    </div>
  )
}

function SuggestionCard({
  live,
  suggestion: s,
  state,
}: {
  live: LiveState
  suggestion: Suggestion
  state: AttendeeState
}) {
  const event = useSocialEvent()
  const { slug, eventSlug } = Route.useParams()
  const t = useCopy(copy)
  const blockText = useCopy(requestBlockCopy)
  const errorMessage = useSocialErrorMessage()
  const navigate = useNavigate()
  const requestMeeting = useMutation(api.social.meetings.requestMeeting)
  const [sending, setSending] = useState(false)

  const requested = live.outgoing.some((r) => r.to.userId === s.userId)
  const theyAsked = live.incoming.some((r) => r.from.userId === s.userId)
  const block = requested ? null : requestBlock(live, s.userId, state)
  const firstName = s.name.split(' ')[0] ?? s.name

  const onMeet = async () => {
    setSending(true)
    try {
      const result = await requestMeeting({
        eventId: event._id,
        toUserId: s.userId,
      })
      if (result.meetingId) {
        void navigate({
          to: '/org/$slug/e/$eventSlug/meeting',
          params: { slug, eventSlug },
        })
      } else {
        toast.success(t.sent(firstName))
      }
    } catch (error) {
      console.error(error)
      toast.error(errorMessage(error))
    } finally {
      setSending(false)
    }
  }

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(17,12,46,0.05)]">
      <div className="flex items-center gap-3">
        <Avatar initials={s.initials} />
        <div className="flex min-w-0 grow flex-col gap-0.5">
          <h3 className="text-base font-semibold text-[var(--baish-strong)]">
            {s.name}
          </h3>
          {s.headline && (
            <span className="text-[13px] text-muted-foreground">
              {s.headline}
            </span>
          )}
        </div>
      </div>
      <StateLabel state={state} copy={t.state} />
      <p className="text-sm leading-normal">
        <span className="font-semibold text-[var(--baish-strong)]">
          {t.why}
        </span>
        {s.reason}
      </p>
      {s.topics.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {s.topics.map((topic) => (
            <li key={topic}>
              <Chip>{topic}</Chip>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Link
          to="/org/$slug/e/$eventSlug/people/$userId"
          params={{ slug, eventSlug, userId: s.userId }}
          aria-label={`${t.viewProfile}: ${s.name}`}
          className="flex h-11 grow basis-0 items-center justify-center rounded-xl border border-input text-sm font-semibold text-[var(--baish-brand-text)] hover:bg-muted"
        >
          {t.viewProfile}
        </Link>
        {requested ? (
          <span className="flex h-11 grow basis-0 items-center justify-center gap-1.5 rounded-xl bg-[var(--baish-ok-bg)] text-sm font-semibold text-[var(--baish-ok)]">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            {t.requested}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void onMeet()}
            disabled={sending || block !== null}
            aria-label={`${theyAsked ? t.accept : t.meetNow}: ${s.name}`}
            className="flex h-11 grow basis-0 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {sending ? <Spinner size="sm" /> : theyAsked ? t.accept : t.meetNow}
          </button>
        )}
      </div>
      {block && block !== 'closed' && (
        <p className="text-[13px] leading-normal text-muted-foreground">
          {blockText[block](firstName)}
        </p>
      )}
    </article>
  )
}

function EveryonePanel({
  attendees,
}: {
  attendees: Array<Attendee> | undefined
}) {
  const { slug, eventSlug } = Route.useParams()
  const t = useCopy(copy)
  if (attendees === undefined) return <PageSpinner />
  if (attendees.length === 0) {
    return (
      <Panel>
        <p className="text-[15px]">{t.nobody}</p>
      </Panel>
    )
  }
  return (
    <ul className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
      {attendees.map((a) => (
        <li key={a.userId} className="border-b border-border last:border-b-0">
          <Link
            to="/org/$slug/e/$eventSlug/people/$userId"
            params={{ slug, eventSlug, userId: a.userId }}
            className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-muted"
          >
            <Avatar initials={a.initials} size={40} />
            <span className="flex min-w-0 grow flex-col gap-0.5">
              <span className="text-[15px] font-semibold text-[var(--baish-strong)]">
                {a.name}
              </span>
              {a.headline && (
                <span className="truncate text-[13px] text-muted-foreground">
                  {a.headline}
                </span>
              )}
            </span>
            <span className="shrink-0">
              <StateLabel state={a.state} copy={t.state} compact />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
