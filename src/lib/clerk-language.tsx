import { ClerkProvider } from '@clerk/clerk-react'
import { esUY } from '@clerk/localizations/es-UY'
import { createContext, useContext, useEffect, useState } from 'react'

/**
 * The language of Clerk's own screens: the sign-in and sign-up forms, the
 * verification-code step, their error messages and the account menu.
 *
 * They are in English unless the page on screen asks for Spanish with
 * `useClerkLanguage`. The in-person event pages do (through
 * `SocialLangProvider`), so their sign-in follows the page's language toggle.
 *
 * The emails Clerk sends (verification codes) are not covered: their text is
 * set in the Clerk dashboard.
 */
export type ClerkLanguage = 'en' | 'es'

/**
 * Clerk's screens in Argentine Spanish. Clerk has no Argentine dictionary;
 * the Uruguayan one uses the same "vos" forms. The entries added here are
 * ones it lacks, which would otherwise show in English.
 */
const SPANISH: typeof esUY = {
  ...esUY,
  locale: 'es-AR',
  formFieldInput__emailAddress_format: 'Formato de ejemplo: nombre@ejemplo.com',
  userButton: {
    ...esUY.userButton,
    action__openUserMenu: 'Abrir el menú de usuario',
    action__closeUserMenu: 'Cerrar el menú de usuario',
  },
  unstable__errors: {
    ...esUY.unstable__errors,
    form_code_incorrect: 'El código ingresado es incorrecto.',
  },
}

/**
 * What `ClerkProvider` takes as `localization`. English is Clerk's built-in
 * text, so it needs none. Always the same object for a language: Clerk
 * re-applies the localization whenever it gets a new one.
 */
export function clerkLocalization(
  language: ClerkLanguage,
): typeof esUY | undefined {
  return language === 'es' ? SPANISH : undefined
}

const SetClerkLanguageContext = createContext<
  (language: ClerkLanguage) => void
>(() => {})

/** `ClerkProvider` whose screens are in the language set by `useClerkLanguage`. */
export function LocalizedClerkProvider({
  publishableKey,
  children,
}: {
  publishableKey: string
  children: React.ReactNode
}) {
  const [language, setLanguage] = useState<ClerkLanguage>('en')
  return (
    <SetClerkLanguageContext.Provider value={setLanguage}>
      <ClerkProvider
        publishableKey={publishableKey}
        localization={clerkLocalization(language)}
      >
        {children}
      </ClerkProvider>
    </SetClerkLanguageContext.Provider>
  )
}

/**
 * Show Clerk's screens in `language` for as long as the calling component is
 * mounted. They go back to English when it unmounts.
 */
export function useClerkLanguage(language: ClerkLanguage): void {
  const setLanguage = useContext(SetClerkLanguageContext)
  useEffect(() => {
    setLanguage(language)
    return () => setLanguage('en')
  }, [language, setLanguage])
}
