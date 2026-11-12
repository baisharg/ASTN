import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { CheckCircle2, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
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
  useMeetingsOpen,
  useSocialErrorMessage,
  useStartMeeting,
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
import { useBusyAction } from '~/lib/use-busy-action'
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
type SuggestionState = FunctionReturnType<
  typeof api.social.suggestions.getMySuggestionState
>

const copy = {
  es: {
    openLeft: (left: string) => `1:1 abiertos · quedan ${left}`,
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
    incompleteTitle: 'Completá tu perfil para recibir sugerencias',
    incompleteBody:
      'Te sugerimos personas según tu trayectoria, lo que buscás y en qué podés ayudar.',
    incompleteButton: 'Completar perfil',
    generatingTitle: 'Estamos armando tus sugerencias',
    generatingBody:
      'Puede tardar unos minutos. Aparecen acá solas cuando estén listas; mientras tanto, podés ver a todos los asistentes.',
    updating: 'Estamos actualizando tus sugerencias.',
    failedTitle: 'No pudimos armar tus sugerencias',
    failedBody:
      'Algo falló de nuestro lado. Probá de nuevo; mientras tanto, podés ver a todos los asistentes.',
    updateFailed: 'No pudimos actualizar tus sugerencias.',
    retry: 'Reintentar',
    nobodyTitle: 'Todavía no hay a quién sugerirte',
    nobodyBody:
      'Cuando se sumen más asistentes con el perfil completo, te sugerimos con quién conversar.',
    seeEveryone: 'Ver a todos',
    nobody: 'Todavía no hay otros asistentes confirmados.',
  },
  en: {
    openLeft: (left: string) => `1:1s open · ${left} left`,
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
    incompleteTitle: 'Complete your profile to get suggestions',
    incompleteBody:
      "We suggest people based on your background, what you're looking for and what you can help with.",
    incompleteButton: 'Complete profile',
    generatingTitle: "We're putting your suggestions together",
    generatingBody:
      'This can take a few minutes. They show up here on their own when ready; meanwhile, you can browse everyone.',
    updating: "We're updating your suggestions.",
    failedTitle: "We couldn't put your suggestions together",
    failedBody:
      'Something went wrong on our side. Try again; meanwhile, you can browse everyone.',
    updateFailed: "We couldn't update your suggestions.",
    retry: 'Try again',
    nobodyTitle: 'Nobody to suggest yet',
    nobodyBody:
      "When more attendees with a complete profile join, we'll suggest who to talk to.",
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
  const suggestionState = useQuery(
    api.social.suggestions.getMySuggestionState,
    {
      eventId: event._id,
    },
  )
  const refresh = useRefreshSuggestions()
  const meetingsOpen = useMeetingsOpen()

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
        <MeetingsWindowLine open={meetingsOpen} />
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
            meetingsOpen={meetingsOpen}
            suggestions={suggestions}
            suggestionState={suggestionState}
            stateById={stateById}
            refreshResult={refresh.result}
            onRetry={refresh.request}
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
 * Asks for fresh suggestions when the page opens, in the page's language. The
 * backend throttles this per person. `request` asks again (the retry after a
 * failed run); it rejects when the request itself doesn't go through.
 */
function useRefreshSuggestions(): {
  result: RefreshResult | null
  request: () => Promise<void>
} {
  const event = useSocialEvent()
  const { lang } = useSocialLang()
  const refresh = useMutation(api.social.suggestions.refreshMySuggestions)
  const [result, setResult] = useState<RefreshResult | null>(null)
  const request = useCallback(async () => {
    setResult(await refresh({ eventId: event._id, language: lang }))
  }, [event._id, lang, refresh])
  // Also re-runs on a language switch, which regenerates in that language.
  useEffect(() => {
    request().catch((error: unknown) => console.error(error))
  }, [request])
  return { result, request }
}

function MeetingsWindowLine({ open }: { open: boolean }) {
  const event = useSocialEvent()
  const t = useCopy(copy)
  const { lang } = useSocialLang()
  const now = useNow()
  const text = open
    ? t.openLeft(formatDuration(event.meetingsCloseAt - now))
    : now < event.meetingsOpenAt
      ? t.opensAt(formatTime(event.meetingsOpenAt, event.timezone, lang))
      : t.closed
  return <p className="text-sm text-muted-foreground">{text}</p>
}

function AvailabilityToggle({ live }: { live: LiveState }) {
  const event = useSocialEvent()
  const t = useCopy(copy)
  const setAvailability = useMutation(api.social.meetings.setAvailability)
  const { busy, run } = useBusyAction<'status'>()
  const saving = busy !== null

  const choose = async (availability: LiveState['availability']) => {
    if (availability === live.availability || saving) return
    await run(
      'status',
      () => setAvailability({ eventId: event._id, availability }),
      () => toast.error(t.statusFailed),
    )
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
  meetingsOpen,
  suggestions,
  suggestionState,
  stateById,
  refreshResult,
  onRetry,
  onSeeEveryone,
}: {
  live: LiveState
  meetingsOpen: boolean
  suggestions: Array<Suggestion> | undefined
  suggestionState: SuggestionState | undefined
  stateById: Map<string, AttendeeState>
  refreshResult: RefreshResult | null
  onRetry: () => Promise<void>
  onSeeEveryone: () => void
}) {
  const { slug, eventSlug } = Route.useParams()
  const t = useCopy(copy)
  const errorMessage = useSocialErrorMessage()
  const { busy, run } = useBusyAction<'retry'>()

  if (suggestions === undefined || suggestionState === undefined) {
    return <PageSpinner />
  }

  const status = suggestionState.status
  const retry = () =>
    run('retry', onRetry, (error) => toast.error(errorMessage(error)))
  const retryButton = (className: string) => (
    <button
      type="button"
      onClick={() => void retry()}
      disabled={busy !== null}
      className={className}
    >
      {busy ? <Spinner size="sm" /> : t.retry}
    </button>
  )
  const seeEveryoneButton = (
    <button
      type="button"
      onClick={onSeeEveryone}
      className={secondaryButtonClass}
    >
      {t.seeEveryone}
    </button>
  )

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
    if (status === 'failed') {
      return (
        <Panel>
          <h2 className="text-[17px] font-semibold text-[var(--baish-strong)]">
            {t.failedTitle}
          </h2>
          <p className="text-[15px] leading-normal">{t.failedBody}</p>
          {retryButton(primaryButtonClass)}
          {seeEveryoneButton}
        </Panel>
      )
    }
    // A finished run that left nothing to show: nobody was suggested, or
    // everyone suggested has since dropped out.
    if (status === 'nobody' || status === 'ready') {
      return (
        <Panel>
          <h2 className="text-[17px] font-semibold text-[var(--baish-strong)]">
            {t.nobodyTitle}
          </h2>
          <p className="text-[15px] leading-normal">{t.nobodyBody}</p>
          {seeEveryoneButton}
        </Panel>
      )
    }
    // Generating, or (idle) a request that is on its way.
    return (
      <Panel>
        <div className="flex items-center gap-2.5">
          {status === 'generating' || refreshResult === 'scheduled' ? (
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
        {seeEveryoneButton}
      </Panel>
    )
  }

  return (
    <div className="flex flex-col gap-3.5">
      {status === 'generating' && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Spinner size="sm" />
          {t.updating}
        </p>
      )}
      {status === 'failed' && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-[14px] bg-muted px-4 py-2.5"
        >
          <p className="text-sm">{t.updateFailed}</p>
          {retryButton(
            'flex h-11 shrink-0 items-center justify-center px-2 text-sm font-semibold text-[var(--baish-brand-text)] underline-offset-2 hover:underline disabled:opacity-60',
          )}
        </div>
      )}
      {suggestions.map((s) => (
        <SuggestionCard
          key={s.userId}
          live={live}
          meetingsOpen={meetingsOpen}
          suggestion={s}
          state={stateById.get(s.userId) ?? 'available'}
        />
      ))}
    </div>
  )
}

function SuggestionCard({
  live,
  meetingsOpen,
  suggestion: s,
  state,
}: {
  live: LiveState
  meetingsOpen: boolean
  suggestion: Suggestion
  state: AttendeeState
}) {
  const { slug, eventSlug } = Route.useParams()
  const t = useCopy(copy)
  const blockText = useCopy(requestBlockCopy)
  const errorMessage = useSocialErrorMessage()
  const startMeeting = useStartMeeting()
  const { busy, run } = useBusyAction<'send'>()

  const requested = live.outgoing.some((r) => r.to.userId === s.userId)
  const theyAsked = live.incoming.some((r) => r.from.userId === s.userId)
  const block = requested
    ? null
    : requestBlock(live, meetingsOpen, s.userId, state)
  const firstName = s.name.split(' ')[0] ?? s.name

  const onMeet = async () => {
    const started = await run(
      'send',
      () => startMeeting.request(s.userId),
      (error) => toast.error(errorMessage(error)),
    )
    if (started === false) toast.success(t.sent(firstName))
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
      <StateLabel state={state} />
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
            disabled={busy !== null || block !== null}
            aria-label={`${theyAsked ? t.accept : t.meetNow}: ${s.name}`}
            className="flex h-11 grow basis-0 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? <Spinner size="sm" /> : theyAsked ? t.accept : t.meetNow}
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
              <StateLabel state={a.state} compact />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
