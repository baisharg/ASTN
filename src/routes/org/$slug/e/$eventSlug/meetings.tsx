import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { api } from '../../../../../../convex/_generated/api'
import {
  meetingLengthMs,
  showsMyMeetings,
} from '../../../../../../convex/social/constants'
import type { FunctionReturnType } from 'convex/server'
import { useSocialEvent } from '~/components/social/SocialEventContext'
import { PrivateNote } from '~/components/social/PrivateNote'
import {
  AttendeeGate,
  PageSpinner,
  formatDuration,
} from '~/components/social/live'
import {
  Avatar,
  BackLink,
  Chip,
  Eyebrow,
  PageTitle,
  Panel,
  secondaryButtonClass,
} from '~/components/social/ui'
import { formatTime, useCopy, useSocialLang } from '~/lib/social-i18n'
import { withNoteSlots } from '~/lib/social-live'

export const Route = createFileRoute('/org/$slug/e/$eventSlug/meetings')({
  component: MeetingsPage,
})

type MyMeeting = FunctionReturnType<
  typeof api.social.meetings.listMyMeetings
>[number]

const copy = {
  es: {
    back: 'Volver a asistentes',
    title: 'Mis reuniones',
    intro:
      'Los 1:1 que tuviste en este evento, del más reciente al más antiguo. Las notas son privadas: solo vos las ves.',
    emptyTitle: 'Todavía no terminaste ningún 1:1',
    emptyBody:
      'Cuando termine tu primera reunión, la vas a ver acá y vas a poder anotar algo sobre esa persona.',
    seePeople: 'Ver asistentes',
    startedAt: (time: string) => `Empezó a las ${time}`,
    lasted: (length: string) => `duró ${length}`,
    spot: (n: number, label: string | null) =>
      label ? `Lugar ${n} (${label})` : `Lugar ${n}`,
    topics: 'Temas sugeridos',
    noteAbove: (name: string) =>
      `Tu nota sobre ${name} está más arriba, en la reunión más reciente.`,
    offTitle: '“Mis reuniones” no está activado en este evento',
    offBody:
      'Quienes organizan el evento no activaron la lista de reuniones ni las notas.',
  },
  en: {
    back: 'Back to attendees',
    title: 'My meetings',
    intro:
      'The 1:1s you had at this event, most recent first. Notes are private: only you can see them.',
    emptyTitle: "You haven't finished a 1:1 yet",
    emptyBody:
      "Once your first meeting ends, you'll see it here and can write a note about that person.",
    seePeople: 'See attendees',
    startedAt: (time: string) => `Started at ${time}`,
    lasted: (length: string) => `lasted ${length}`,
    spot: (n: number, label: string | null) =>
      label ? `Spot ${n} (${label})` : `Spot ${n}`,
    topics: 'Suggested topics',
    noteAbove: (name: string) =>
      `Your note about ${name} is further up, on your most recent meeting.`,
    offTitle: '“My meetings” is not turned on for this event',
    offBody:
      "The organizers haven't turned on the meeting list and notes for this event.",
  },
}

function MeetingsPage() {
  return <AttendeeGate>{() => <MeetingsContent />}</AttendeeGate>
}

function MeetingsContent() {
  const { slug, eventSlug } = Route.useParams()
  const event = useSocialEvent()
  const t = useCopy(copy)
  const enabled = showsMyMeetings(event)

  return (
    <main className="flex flex-col gap-[22px] px-5 pb-8 pt-2">
      <div className="-ml-3 flex">
        <BackLink
          to="/org/$slug/e/$eventSlug/people"
          params={{ slug, eventSlug }}
          label={t.back}
        />
      </div>
      {enabled ? (
        <>
          <div className="flex flex-col gap-2">
            <PageTitle>{t.title}</PageTitle>
            <p className="text-[15px] leading-normal">{t.intro}</p>
          </div>
          <MeetingList />
        </>
      ) : (
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
            {t.seePeople}
          </Link>
        </Panel>
      )}
    </main>
  )
}

function MeetingList() {
  const { slug, eventSlug } = Route.useParams()
  const event = useSocialEvent()
  const t = useCopy(copy)
  const meetings = useQuery(api.social.meetings.listMyMeetings, {
    eventId: event._id,
  })

  if (meetings === undefined) return <PageSpinner />
  if (meetings.length === 0) {
    return (
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
          {t.seePeople}
        </Link>
      </Panel>
    )
  }
  return (
    <ul className="flex flex-col gap-3.5">
      {withNoteSlots(meetings).map(({ meeting, showsNote }) => (
        <li key={meeting._id}>
          <MeetingCard meeting={meeting} showsNote={showsNote} />
        </li>
      ))}
    </ul>
  )
}

function MeetingCard({
  meeting,
  showsNote,
}: {
  meeting: MyMeeting
  // False on an earlier meeting with someone met again: their one note is
  // on the most recent meeting.
  showsNote: boolean
}) {
  const { slug, eventSlug } = Route.useParams()
  const event = useSocialEvent()
  const t = useCopy(copy)
  const { lang } = useSocialLang()
  const { partner } = meeting
  const firstName = partner.name.split(' ')[0] ?? partner.name

  const facts = [
    t.startedAt(formatTime(meeting.startedAt, event.timezone, lang)),
    t.lasted(formatDuration(meetingLengthMs(meeting))),
    meeting.spot ? t.spot(meeting.spot.number, meeting.spot.label) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(17,12,46,0.05)]">
      <Link
        to="/org/$slug/e/$eventSlug/people/$userId"
        params={{ slug, eventSlug, userId: partner.userId }}
        className="-m-1 flex items-center gap-3 rounded-xl p-1 hover:bg-muted"
      >
        <Avatar initials={partner.initials} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-base font-semibold text-[var(--baish-strong)]">
            {partner.name}
          </span>
          {partner.headline && (
            <span className="text-[13px] text-muted-foreground">
              {partner.headline}
            </span>
          )}
        </span>
      </Link>
      <p className="text-[13px] leading-normal text-muted-foreground">
        {facts}
      </p>
      {meeting.topics.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Eyebrow>{t.topics}</Eyebrow>
          <ul className="flex flex-wrap gap-1.5">
            {meeting.topics.map((topic) => (
              <li key={topic}>
                <Chip>{topic}</Chip>
              </li>
            ))}
          </ul>
        </div>
      )}
      {showsNote ? (
        <PrivateNote aboutUserId={partner.userId} name={firstName} />
      ) : (
        <p className="text-[13px] leading-normal text-muted-foreground">
          {t.noteAbove(firstName)}
        </p>
      )}
    </article>
  )
}
