import { Link, createFileRoute } from '@tanstack/react-router'
import {
  AuthLoading,
  Authenticated,
  Unauthenticated,
  useAction,
  useMutation,
  useQuery,
} from 'convex/react'
import { Check, Circle, MessageCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../../../../convex/_generated/api'
import type { Doc } from '../../../../../../convex/_generated/dataModel'
import { useAgentSidebar } from '~/components/agent-sidebar/AgentSidebarProvider'
import { useSocialEvent } from '~/components/social/SocialEventContext'
import {
  BackLink,
  PageTitle,
  Panel,
  primaryButtonClass,
  secondaryButtonClass,
} from '~/components/social/ui'
import { Spinner } from '~/components/ui/spinner'
import { useCopy } from '~/lib/social-i18n'
import { useBusyAction } from '~/lib/use-busy-action'

export const Route = createFileRoute('/org/$slug/e/$eventSlug/profile')({
  component: EventProfilePage,
})

type Visibility = NonNullable<Doc<'profiles'>['socialVisibility']>

/** The free-text fields edited on this page. */
type DraftField = 'headline' | 'seeking' | 'canHelpWith'

const copy = {
  es: {
    back: 'Volver al evento',
    title: 'Tu perfil',
    signIn: 'Iniciá sesión desde la página del evento para armar tu perfil.',
    goToEvent: 'Ir al evento',
    ready: 'Listo para el matching',
    notReady: 'Completá tu perfil',
    progress: (done: number) => `${done} de 3`,
    items: {
      background: 'Trayectoria',
      seeking: 'Qué querés sacar del evento',
      canHelpWith: 'En qué podés ayudar a otros',
    },
    optional: 'Opcional',
    interests: 'Intereses',
    linkedinLabel: 'Perfil de LinkedIn',
    import: 'Importar',
    importing: 'Importando…',
    imported: 'Importamos tu trayectoria desde LinkedIn.',
    importFailed:
      'No pudimos leer ese perfil de LinkedIn. Revisá el link o completá los datos a mano.',
    chatTitle: 'Chateá con el asistente',
    chatBody:
      'Te hace unas preguntas y completa tu perfil con tus respuestas. Después podés editar todo.',
    chatButton: 'Empezar el chat',
    chatOpener: (event: string) =>
      `Quiero armar mi perfil para ${event}. Haceme las preguntas que necesites.`,
    manualTitle: 'O completalo a mano',
    headline: 'Titular',
    headlinePlaceholder: 'Ej.: Ingeniera de ML en una fintech',
    seeking: 'Qué querés sacar del evento',
    seekingPlaceholder:
      'Ej.: Conocer gente que investiga interpretabilidad y encontrar un proyecto para arrancar.',
    canHelpWith: 'En qué podés ayudar a otros',
    canHelpWithPlaceholder:
      'Ej.: ML en producción, infraestructura de evals, contratar para roles técnicos.',
    save: 'Guardar',
    saved: 'Guardado',
    saveFailed: 'No pudimos guardar. Probá de nuevo.',
    visibility: 'Quién puede ver tu perfil',
    visibilityOptions: {
      event_attendees: 'Asistentes de los eventos a los que vas',
      org_members: 'Todos los miembros de BAISH',
      public: 'Cualquier persona con cuenta',
    } satisfies Record<Visibility, string>,
    seePeople: 'Ver quiénes van',
    englishNote:
      'El asistente guarda tus respuestas en inglés, que es el idioma que usamos para el matching.',
  },
  en: {
    back: 'Back to the event',
    title: 'Your profile',
    signIn: 'Sign in from the event page to set up your profile.',
    goToEvent: 'Go to the event',
    ready: 'Ready for matching',
    notReady: 'Finish your profile',
    progress: (done: number) => `${done} of 3`,
    items: {
      background: 'Background',
      seeking: 'What you want from the event',
      canHelpWith: 'How you can help others',
    },
    optional: 'Optional',
    interests: 'Interests',
    linkedinLabel: 'LinkedIn profile',
    import: 'Import',
    importing: 'Importing…',
    imported: 'We imported your background from LinkedIn.',
    importFailed:
      "We couldn't read that LinkedIn profile. Check the link or fill things in by hand.",
    chatTitle: 'Chat with the assistant',
    chatBody:
      'It asks a few questions and fills in your profile from your answers. You can edit everything afterwards.',
    chatButton: 'Start the chat',
    chatOpener: (event: string) =>
      `I want to set up my profile for ${event}. Ask me whatever you need.`,
    manualTitle: 'Or fill it in yourself',
    headline: 'Headline',
    headlinePlaceholder: 'E.g. ML engineer at a fintech',
    seeking: 'What you want from the event',
    seekingPlaceholder:
      'E.g. Meet people doing interpretability research and find a project to start on.',
    canHelpWith: 'How you can help others',
    canHelpWithPlaceholder:
      'E.g. Production ML, evals infrastructure, hiring for technical roles.',
    save: 'Save',
    saved: 'Saved',
    saveFailed: "We couldn't save. Please try again.",
    visibility: 'Who can see your profile',
    visibilityOptions: {
      event_attendees: "Attendees of events you're going to",
      org_members: 'All BAISH members',
      public: 'Anyone with an account',
    } satisfies Record<Visibility, string>,
    seePeople: "See who's coming",
    englishNote:
      'The assistant saves your answers in English, the language we use for matching.',
  },
}

function EventProfilePage() {
  const { slug, eventSlug } = Route.useParams()
  const t = useCopy(copy)
  return (
    <main className="flex flex-col gap-5 px-5 pb-10 pt-2">
      <div className="-ml-3">
        <BackLink
          to="/org/$slug/e/$eventSlug"
          params={{ slug, eventSlug }}
          label={t.back}
        />
      </div>
      <PageTitle>{t.title}</PageTitle>
      <AuthLoading>
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      </AuthLoading>
      <Unauthenticated>
        <Panel>
          <p className="text-[15px]">{t.signIn}</p>
          <Link
            to="/org/$slug/e/$eventSlug"
            params={{ slug, eventSlug }}
            className={primaryButtonClass}
          >
            {t.goToEvent}
          </Link>
        </Panel>
      </Unauthenticated>
      <Authenticated>
        <ProfileEditor />
      </Authenticated>
    </main>
  )
}

function ProfileEditor() {
  const profile = useQuery(api.profiles.getOrCreateProfile)
  const createProfile = useMutation(api.profiles.create)
  const creating = useRef(false)

  // New accounts arrive here straight from registration, before any profile.
  useEffect(() => {
    if (profile === null && !creating.current) {
      creating.current = true
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      void createProfile({ timezone }).finally(() => {
        creating.current = false
      })
    }
  }, [profile, createProfile])

  if (!profile) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    )
  }
  return <ProfileForm profile={profile} />
}

function ProfileForm({ profile }: { profile: Doc<'profiles'> }) {
  const event = useSocialEvent()
  const t = useCopy(copy)
  const { slug, eventSlug } = Route.useParams()
  const registration = useQuery(api.social.events.getMyRegistration, {
    eventId: event._id,
  })
  const updateField = useMutation(api.profiles.updateField)
  const extractFromLinkedIn = useAction(
    api.extraction.linkedin.extractFromLinkedIn,
  )
  const { openWithMessage } = useAgentSidebar()

  const [linkedin, setLinkedin] = useState(profile.linkedinUrl ?? '')
  const [importing, setImporting] = useState(false)
  // Only the fields the person has edited. Untouched fields show the saved
  // profile, so updates from the assistant appear as they happen.
  const [draft, setDraft] = useState<Partial<Record<DraftField, string>>>({})
  const { busy, run } = useBusyAction<'save'>()
  const value = (field: DraftField) => draft[field] ?? profile[field] ?? ''
  const edit = (field: DraftField) => (next: string) =>
    setDraft((d) => ({ ...d, [field]: next }))

  const missing = registration?.profileMissing ?? []
  const done = 3 - missing.length
  const ready = registration !== undefined && missing.length === 0
  const isAttendee = registration?.guest?.status === 'approved'

  const dirty = Object.keys(draft).length > 0

  const onImport = async () => {
    const url = linkedin.trim()
    if (!url) return
    setImporting(true)
    try {
      const result = await extractFromLinkedIn({ linkedinUrl: url })
      const data = result.extractedData
      const updates: Parameters<typeof updateField>[0]['updates'] = {
        linkedinUrl: url,
      }
      // Only fill what's empty; never overwrite what the person wrote.
      if (!profile.name && data.name) updates.name = data.name
      if (!profile.location && data.location) updates.location = data.location
      if (!profile.workHistory?.length && data.workHistory?.length) {
        updates.workHistory = data.workHistory.map((w) => ({
          organization: w.organization,
          title: w.title,
          current: w.current,
          description: w.description,
          startDate: toTimestamp(w.startDate),
          endDate: toTimestamp(w.endDate),
        }))
      }
      if (!profile.education?.length && data.education?.length) {
        updates.education = data.education
      }
      if (!profile.skills?.length && data.skills?.length) {
        updates.skills = data.skills
      }
      const current = data.workHistory?.find((w) => w.current)
      if (!profile.headline && current) {
        updates.headline = `${current.title} · ${current.organization}`
      }
      await updateField({ profileId: profile._id, updates })
      toast.success(t.imported)
    } catch (error) {
      console.error(error)
      await updateField({
        profileId: profile._id,
        updates: { linkedinUrl: url },
      }).catch(() => {})
      toast.error(t.importFailed)
    } finally {
      setImporting(false)
    }
  }

  const onSave = () =>
    run(
      'save',
      async () => {
        await updateField({
          profileId: profile._id,
          updates: {
            headline: value('headline').trim() || undefined,
            seeking: value('seeking').trim() || undefined,
            canHelpWith: value('canHelpWith').trim() || undefined,
          },
        })
        setDraft({})
        toast.success(t.saved)
      },
      () => toast.error(t.saveFailed),
    )

  const onVisibility = async (value: Visibility) => {
    try {
      await updateField({
        profileId: profile._id,
        updates: { socialVisibility: value },
      })
    } catch (error) {
      console.error(error)
      toast.error(t.saveFailed)
    }
  }

  const checklist: Array<{ key: keyof typeof t.items; ok: boolean }> = [
    { key: 'background', ok: !missing.includes('background') },
    { key: 'seeking', ok: !missing.includes('seeking') },
    { key: 'canHelpWith', ok: !missing.includes('canHelpWith') },
  ]

  return (
    <div className="flex flex-col gap-5">
      <Panel aria-label={ready ? t.ready : t.notReady}>
        <div className="flex items-center justify-between">
          <h2
            className={
              ready
                ? 'text-[17px] font-semibold text-[var(--baish-ok)]'
                : 'text-[17px] font-semibold text-[var(--baish-strong)]'
            }
          >
            {ready ? t.ready : t.notReady}
          </h2>
          <span className="text-[13px] text-muted-foreground">
            {t.progress(done)}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-border">
          <div
            className="h-1.5 bg-primary transition-[width]"
            style={{ width: `${(done / 3) * 100}%` }}
          />
        </div>
        <ul className="flex flex-col gap-2.5 text-sm">
          {checklist.map((item) => (
            <li key={item.key} className="flex items-center gap-2.5">
              {item.ok ? (
                <Check
                  className="size-[18px] text-[var(--baish-ok)]"
                  aria-hidden="true"
                />
              ) : (
                <Circle
                  className="size-[18px] text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              <span className={item.ok ? '' : 'text-muted-foreground'}>
                {t.items[item.key]}
              </span>
            </li>
          ))}
          <li className="flex items-center gap-2.5 text-muted-foreground">
            {profile.aiSafetyInterests?.length ? (
              <Check
                className="size-[18px] text-[var(--baish-ok)]"
                aria-hidden="true"
              />
            ) : (
              <Circle className="size-[18px]" aria-hidden="true" />
            )}
            <span className="grow">{t.interests}</span>
            <span>{t.optional}</span>
          </li>
        </ul>
      </Panel>

      <section className="flex flex-col gap-2">
        <label
          htmlFor="linkedin"
          className="text-sm font-semibold text-[var(--baish-strong)]"
        >
          {t.linkedinLabel}
        </label>
        <div className="flex gap-2">
          <input
            id="linkedin"
            type="url"
            inputMode="url"
            placeholder="linkedin.com/in/..."
            value={linkedin}
            onChange={(e) => setLinkedin(e.target.value)}
            className="h-12 min-w-0 grow rounded-xl border border-input bg-card px-3.5 text-[15px] text-[var(--baish-strong)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="button"
            onClick={onImport}
            disabled={importing || !linkedin.trim()}
            className={secondaryButtonClass}
          >
            {importing ? t.importing : t.import}
          </button>
        </div>
      </section>

      <Panel>
        <div className="flex items-start gap-3">
          <MessageCircle
            className="mt-0.5 size-5 shrink-0 text-[var(--baish-brand-text)]"
            aria-hidden="true"
          />
          <div className="flex flex-col gap-1">
            <h2 className="text-[17px] font-semibold text-[var(--baish-strong)]">
              {t.chatTitle}
            </h2>
            <p className="text-sm leading-normal text-muted-foreground">
              {t.chatBody}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => openWithMessage(t.chatOpener(event.title))}
          className={primaryButtonClass}
        >
          {t.chatButton}
        </button>
        <p className="text-xs leading-normal text-muted-foreground">
          {t.englishNote}
        </p>
      </Panel>

      <section className="flex flex-col gap-4">
        <h2 className="text-[17px] font-semibold text-[var(--baish-strong)]">
          {t.manualTitle}
        </h2>
        <Field
          id="headline"
          label={t.headline}
          value={value('headline')}
          onChange={edit('headline')}
          placeholder={t.headlinePlaceholder}
        />
        <Field
          id="seeking"
          label={t.seeking}
          value={value('seeking')}
          onChange={edit('seeking')}
          placeholder={t.seekingPlaceholder}
          multiline
        />
        <Field
          id="canHelpWith"
          label={t.canHelpWith}
          value={value('canHelpWith')}
          onChange={edit('canHelpWith')}
          placeholder={t.canHelpWithPlaceholder}
          multiline
        />
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={!dirty || busy !== null}
          className={secondaryButtonClass}
        >
          {busy ? <Spinner className="size-5" /> : t.save}
        </button>
      </section>

      <section className="flex flex-col gap-2">
        <label
          htmlFor="visibility"
          className="text-sm font-semibold text-[var(--baish-strong)]"
        >
          {t.visibility}
        </label>
        <select
          id="visibility"
          value={profile.socialVisibility ?? 'event_attendees'}
          onChange={(e) => void onVisibility(e.target.value as Visibility)}
          className="h-12 rounded-xl border border-input bg-card px-3 text-[15px] text-[var(--baish-strong)]"
        >
          {(Object.keys(t.visibilityOptions) as Array<Visibility>).map((v) => (
            <option key={v} value={v}>
              {t.visibilityOptions[v]}
            </option>
          ))}
        </select>
      </section>

      {isAttendee && (
        <Link
          to="/org/$slug/e/$eventSlug/people"
          params={{ slug, eventSlug }}
          className={primaryButtonClass}
        >
          {t.seePeople}
        </Link>
      )}
    </div>
  )
}

/** LinkedIn import gives dates as strings like "2021-03" or "2021". */
function toTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Date.parse(/^\d{4}$/.test(value) ? `${value}-01-01` : value)
  return Number.isNaN(parsed) ? undefined : parsed
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  multiline?: boolean
}) {
  const className =
    'rounded-xl border border-input bg-card px-3.5 text-[15px] text-[var(--baish-strong)] outline-none focus-visible:ring-2 focus-visible:ring-ring'
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-sm font-semibold text-[var(--baish-strong)]"
      >
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          rows={3}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${className} resize-none py-3`}
        />
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${className} h-12`}
        />
      )}
    </div>
  )
}
