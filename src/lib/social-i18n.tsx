import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'

/**
 * Spanish/English copy for the in-person event pages. Each page keeps its own
 * `{ es, en }` dictionary and reads it with `useCopy`; Spanish is the default.
 */
export type SocialLang = 'es' | 'en'

const STORAGE_KEY = 'astn.social.lang'

const SocialLangContext = createContext<{
  lang: SocialLang
  setLang: (lang: SocialLang) => void
}>({ lang: 'es', setLang: () => {} })

export function SocialLangProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [lang, setLangState] = useState<SocialLang>('es')

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored === 'es' || stored === 'en') setLangState(stored)
    } catch {
      // Storage can be unavailable (private mode); Spanish it is.
    }
  }, [])

  const setLang = useCallback((next: SocialLang) => {
    setLangState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Ignore: the choice just won't persist.
    }
  }, [])

  return (
    <SocialLangContext.Provider value={{ lang, setLang }}>
      {children}
    </SocialLangContext.Provider>
  )
}

export function useSocialLang() {
  return useContext(SocialLangContext)
}

export function useCopy<T>(dict: { es: T; en: T }): T {
  const { lang } = useSocialLang()
  return dict[lang]
}

export function LangToggle() {
  const { lang, setLang } = useSocialLang()
  return (
    <div
      role="group"
      aria-label={lang === 'es' ? 'Idioma' : 'Language'}
      className="flex gap-0.5 rounded-full border border-border bg-muted p-[3px]"
    >
      {(['en', 'es'] as const).map((option) => {
        const active = option === lang
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => setLang(option)}
            className={
              active
                ? 'h-[38px] min-w-11 rounded-full bg-card text-[13px] font-semibold text-[var(--baish-strong)] shadow-sm'
                : 'h-[38px] min-w-11 rounded-full text-[13px] font-semibold text-muted-foreground'
            }
          >
            {option.toUpperCase()}
          </button>
        )
      })}
    </div>
  )
}

const LOCALE: Record<SocialLang, string> = { es: 'es-AR', en: 'en-US' }

export function formatEventDate(
  timestamp: number,
  timezone: string,
  lang: SocialLang,
): string {
  const text = new Intl.DateTimeFormat(LOCALE[lang], {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(timestamp)
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function formatTime(
  timestamp: number,
  timezone: string,
  lang: SocialLang,
): string {
  return new Intl.DateTimeFormat(LOCALE[lang], {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(timestamp)
}
