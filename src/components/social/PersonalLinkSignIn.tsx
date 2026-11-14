import { useAuth, useClerk, useSignIn, useUser } from '@clerk/clerk-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Panel, secondaryButtonClass } from '~/components/social/ui'
import { Spinner } from '~/components/ui/spinner'
import {
  hasSignInTicket,
  signInTicketPlan,
  subscribeSignInTicket,
  takeSignInTicket,
} from '~/lib/signInTicket'
import { useCopy } from '~/lib/social-i18n'

const copy = {
  es: {
    signingIn: 'Iniciando tu sesión con tu link personal…',
    failedTitle: 'Este link personal ya no sirve',
    failedBody:
      'Cada link funciona una sola vez y por tiempo limitado. Iniciá sesión acá abajo con el email al que te llegó el link.',
    keptTitle: 'No usamos tu link personal',
    keptBody: (email: string | null) =>
      email
        ? `Ya tenías la sesión iniciada como ${email}. Si el link es de otra cuenta, cerrá sesión y volvé a abrirlo.`
        : 'Ya tenías una sesión iniciada. Si el link es de otra cuenta, cerrá sesión y volvé a abrirlo.',
    signOut: 'Cerrar sesión',
    dismiss: 'Entendido',
  },
  en: {
    signingIn: 'Signing you in with your personal link…',
    failedTitle: 'This personal link no longer works',
    failedBody:
      'Each link works once and for a limited time. Sign in below with the email the link was sent to.',
    keptTitle: "We didn't use your personal link",
    keptBody: (email: string | null) =>
      email
        ? `You were already signed in as ${email}. If the link belongs to another account, sign out and open it again.`
        : 'You were already signed in. If the link belongs to another account, sign out and open it again.',
    signOut: 'Sign out',
    dismiss: 'Got it',
  },
}

type Notice = 'none' | 'signing_in' | 'failed' | 'kept_session'

/**
 * Signs the visitor in with the token of a personal event link, when the page
 * was opened from one (`captureSignInTicket` holds the token). Without a
 * token it renders nothing and does nothing.
 *
 * A link that was already used, has expired or needs a second factor leaves
 * the page as it is, with a notice pointing to the normal sign-in.
 */
export function PersonalLinkSignIn() {
  const t = useCopy(copy)
  const { isLoaded: authLoaded, isSignedIn } = useAuth()
  const { isLoaded: signInLoaded, signIn, setActive } = useSignIn()
  const { user } = useUser()
  const { signOut } = useClerk()
  const [notice, setNotice] = useState<Notice>('none')
  const ticketWaiting = useSyncExternalStore(
    subscribeSignInTicket,
    hasSignInTicket,
    () => false,
  )

  useEffect(() => {
    if (!ticketWaiting || !authLoaded || !signInLoaded) return
    // Taking the token hands it over once: a repeated effect finds none.
    const ticket = takeSignInTicket()
    const plan = signInTicketPlan({ ticket, isSignedIn })
    if (plan === 'nothing' || !ticket) return
    if (plan === 'keep_session') {
      setNotice('kept_session')
      return
    }
    setNotice('signing_in')
    void (async () => {
      try {
        const attempt = await signIn.create({ strategy: 'ticket', ticket })
        if (attempt.status !== 'complete' || !attempt.createdSessionId) {
          setNotice('failed')
          return
        }
        await setActive({ session: attempt.createdSessionId })
        setNotice('none')
      } catch {
        // Used, expired or revoked. The error is not logged: nothing about
        // a sign-in token belongs in a console or an error report.
        setNotice('failed')
      }
    })()
  }, [ticketWaiting, authLoaded, signInLoaded, isSignedIn, signIn, setActive])

  if (notice === 'none') return null
  // Signed in the normal way after a link that didn't work: nothing to say.
  if (notice === 'failed' && isSignedIn) return null

  if (notice === 'signing_in') {
    return (
      <div className="px-5 pt-6">
        <Panel role="status" className="flex-row items-center">
          <Spinner className="size-5 shrink-0" />
          <p className="text-[15px] leading-normal">{t.signingIn}</p>
        </Panel>
      </div>
    )
  }

  const failed = notice === 'failed'
  return (
    <div className="px-5 pt-6">
      <Panel role={failed ? 'alert' : 'status'}>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-[17px] font-semibold text-[var(--baish-strong)]">
            {failed ? t.failedTitle : t.keptTitle}
          </h2>
          <p className="text-[15px] leading-normal">
            {failed
              ? t.failedBody
              : t.keptBody(user?.primaryEmailAddress?.emailAddress ?? null)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setNotice('none')}
            className={secondaryButtonClass}
          >
            {t.dismiss}
          </button>
          {!failed && (
            <button
              type="button"
              onClick={() =>
                void signOut({ redirectUrl: window.location.href })
              }
              className="flex min-h-11 items-center px-2 text-sm font-semibold text-[var(--baish-brand-text)] underline-offset-2 hover:underline"
            >
              {t.signOut}
            </button>
          )}
        </div>
      </Panel>
    </div>
  )
}
