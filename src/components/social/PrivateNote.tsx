import { useMutation, useQuery } from 'convex/react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import {
  MAX_MEETING_NOTE_LENGTH,
  meetingNoteToStore,
} from '../../../convex/social/constants'
import { useSocialEvent } from './SocialEventContext'
import { useSocialErrorMessage } from './live'
import { Spinner } from '~/components/ui/spinner'
import { useCopy } from '~/lib/social-i18n'
import { useBusyAction } from '~/lib/use-busy-action'

const copy = {
  es: {
    label: (name: string) => `Tu nota sobre ${name}`,
    privacy: 'Privada: solo vos la ves.',
    placeholder: 'De qué hablaron, qué quedaron en hacer…',
    loading: 'Cargando tu nota…',
    save: 'Guardar nota',
    remove: 'Borrar nota',
    saved: 'Nota guardada.',
    removed: 'Nota borrada.',
    upToDate: 'Guardada',
  },
  en: {
    label: (name: string) => `Your note about ${name}`,
    privacy: 'Private: only you can see it.',
    placeholder: 'What you talked about, what you agreed to do…',
    loading: 'Loading your note…',
    save: 'Save note',
    remove: 'Delete note',
    saved: 'Note saved.',
    removed: 'Note deleted.',
    upToDate: 'Saved',
  },
}

// The character count shows once this few characters are left.
const COUNT_FROM_LEFT = 200

/**
 * The viewer's private note about one person at the event: a text box and a
 * button that saves it. Nothing is saved until the button is pressed. Only
 * for approved attendees (the note functions refuse anyone else).
 */
export function PrivateNote({
  aboutUserId,
  name,
}: {
  aboutUserId: string
  // How the person is called in the label, e.g. their first name.
  name: string
}) {
  const event = useSocialEvent()
  const t = useCopy(copy)
  const saved = useQuery(api.social.meetings.getMyNoteAbout, {
    eventId: event._id,
    aboutUserId,
  })
  // The form starts from the saved text, so it mounts once that has loaded.
  if (saved === undefined) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner size="sm" />
        {t.loading}
      </p>
    )
  }
  return <PrivateNoteForm aboutUserId={aboutUserId} name={name} saved={saved} />
}

function PrivateNoteForm({
  aboutUserId,
  name,
  saved,
}: {
  aboutUserId: string
  name: string
  saved: string | null
}) {
  const event = useSocialEvent()
  const t = useCopy(copy)
  const errorMessage = useSocialErrorMessage()
  const setNote = useMutation(api.social.meetings.setMyNoteAbout)
  const { busy, run } = useBusyAction<'save'>()
  const [draft, setDraft] = useState(saved ?? '')

  // What saving the draft would store; null deletes the note.
  const toStore = meetingNoteToStore(draft)
  const changed = toStore !== saved
  const removes = toStore === null && saved !== null
  const inputId = `private-note-${aboutUserId}`
  const left = MAX_MEETING_NOTE_LENGTH - draft.length

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!changed || busy) return
    void run(
      'save',
      async () => {
        await setNote({ eventId: event._id, aboutUserId, text: draft })
        setDraft(toStore ?? '')
        toast.success(toStore === null ? t.removed : t.saved)
      },
      (error) => toast.error(errorMessage(error)),
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <label
          htmlFor={inputId}
          className="text-sm font-semibold text-[var(--baish-strong)]"
        >
          {t.label(name)}
        </label>
        <span
          id={`${inputId}-privacy`}
          className="text-[13px] text-muted-foreground"
        >
          {t.privacy}
        </span>
      </div>
      <textarea
        id={inputId}
        rows={3}
        maxLength={MAX_MEETING_NOTE_LENGTH}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={t.placeholder}
        aria-describedby={`${inputId}-privacy`}
        disabled={busy !== null}
        className="rounded-xl border border-input bg-background px-3.5 py-3 text-[15px] text-[var(--baish-strong)] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-muted-foreground" aria-live="polite">
          {left <= COUNT_FROM_LEFT
            ? `${draft.length}/${MAX_MEETING_NOTE_LENGTH}`
            : !changed && saved !== null
              ? t.upToDate
              : ''}
        </span>
        <button
          type="submit"
          disabled={!changed || busy !== null}
          className="flex h-11 shrink-0 items-center justify-center rounded-xl border border-input bg-card px-4 text-sm font-semibold text-[var(--baish-brand-text)] hover:bg-muted disabled:opacity-60"
        >
          {busy ? <Spinner size="sm" /> : removes ? t.remove : t.save}
        </button>
      </div>
    </form>
  )
}
