import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useRouterState } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { ConsentDialog } from '~/components/consent/ConsentDialog'
import { isSocialEventPath } from '~/lib/socialEventPath'

interface AgentSidebarContextValue {
  isOpen: boolean
  toggle: () => void
  open: () => void
  close: () => void
  profileId: Id<'profiles'> | null
  threadId: string | null
  isReady: boolean
  sidebarWidth: number
  setSidebarWidth: (width: number) => void
  isResizing: boolean
  setIsResizing: (v: boolean) => void
  pendingMessage: string | null
  clearPendingMessage: () => void
  openWithMessage: (message: string) => void
}

const AgentSidebarContext = createContext<AgentSidebarContextValue | null>(null)

const STORAGE_KEY = 'agent-sidebar-open'
const WIDTH_STORAGE_KEY = 'agent-sidebar-width'
const DEFAULT_WIDTH = 400
const MIN_WIDTH = 280
const MAX_WIDTH = 600

export function AgentSidebarProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(STORAGE_KEY) === 'true'
  })
  const [sidebarWidth, setSidebarWidthRaw] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_WIDTH
    const stored = localStorage.getItem(WIDTH_STORAGE_KEY)
    return stored
      ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Number(stored)))
      : DEFAULT_WIDTH
  })
  const [isResizing, setIsResizing] = useState(false)

  const setSidebarWidth = useCallback((width: number) => {
    const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width))
    setSidebarWidthRaw(clamped)
    localStorage.setItem(WIDTH_STORAGE_KEY, String(clamped))
  }, [])

  const profile = useQuery(api.profiles.getOrCreateProfile)
  // People reach the in-person event pages for the event, often with an
  // account made a minute ago: there the assistant opens only when asked.
  const onEventPage = useRouterState({
    select: (s) => isSocialEventPath(s.location.pathname),
  })
  const createThread = useMutation(api.agent.threadOps.createAgentThread)
  const sendMessage = useMutation(api.agent.threadOps.sendMessage)
  const threadCreating = useRef(false)
  const autoGreetSent = useRef(false)
  const autoOpenedRef = useRef(false)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const [showConsentDialog, setShowConsentDialog] = useState(false)
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)
  const clearPendingMessage = useCallback(() => setPendingMessage(null), [])

  // Persist open state
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(isOpen))
  }, [isOpen])

  // Keyboard shortcut: Cmd+. / Ctrl+. to toggle sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault()
        setIsOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Ensure profile + thread exist when sidebar is open and user has a profile
  // (profile being non-null means user is authenticated AND has a profile)
  useEffect(() => {
    if (!profile) return // Loading, unauthenticated, or no profile
    if (!profile.consentedAt) return // Don't create thread without consent
    if (threadCreating.current) return
    if (profile.agentThreadId) return // Already has thread

    if (!isOpen) return // Don't create thread until sidebar is opened

    const setup = async () => {
      threadCreating.current = true
      try {
        const newThreadId = await createThread({ profileId: profile._id })

        // Auto-send greeting for new profiles to trigger BAISH CRM lookup
        // A profile is "new" if it has no name and no enrichment conversation yet.
        // Not on event pages: the person's own first message opens the chat.
        if (
          !onEventPage &&
          !profile.name &&
          !profile.hasEnrichmentConversation &&
          !autoGreetSent.current
        ) {
          autoGreetSent.current = true
          const browserLocale =
            typeof navigator !== 'undefined' ? navigator.language : undefined
          const isSpanish = browserLocale?.startsWith('es')
          await sendMessage({
            threadId: newThreadId,
            prompt: isSpanish
              ? 'Hola! Acabo de registrarme.'
              : 'Hi! I just signed up.',
            profileId: profile._id,
            browserLocale,
          })
        }
      } finally {
        threadCreating.current = false
      }
    }

    void setup()
  }, [profile, isOpen, onEventPage, createThread, sendMessage])

  // Auto-open for new users: profile exists but no thread yet
  // If no consent, show consent dialog instead of opening sidebar.
  // Waits until the person is off the event pages.
  useEffect(() => {
    if (!profile) return
    if (onEventPage) return
    if (autoOpenedRef.current) return
    if (!profile.agentThreadId) {
      autoOpenedRef.current = true
      if (profile.consentedAt) {
        setIsOpen(true)
      } else {
        setShowConsentDialog(true)
      }
    }
  }, [profile, onEventPage])

  const toggle = useCallback(() => {
    if (!isOpen && profile && !profile.consentedAt) {
      setShowConsentDialog(true)
      return
    }
    setIsOpen((v) => !v)
  }, [isOpen, profile])
  const open = useCallback(() => {
    if (profile && !profile.consentedAt) {
      setShowConsentDialog(true)
      return
    }
    previousFocusRef.current = document.activeElement as HTMLElement | null
    setIsOpen(true)
  }, [profile])
  const openWithMessage = useCallback(
    (message: string) => {
      setPendingMessage(message)
      if (profile && !profile.consentedAt) {
        setShowConsentDialog(true)
        return
      }
      previousFocusRef.current = document.activeElement as HTMLElement | null
      setIsOpen(true)
    },
    [profile],
  )
  const close = useCallback(() => {
    setIsOpen(false)
    const el = previousFocusRef.current
    if (el) {
      requestAnimationFrame(() => el.focus())
      previousFocusRef.current = null
    }
  }, [])

  const profileId = profile?._id ?? null
  const threadId = profile?.agentThreadId ?? null
  const isReady = profileId !== null && threadId !== null

  const handleConsented = useCallback(() => {
    setShowConsentDialog(false)
    setIsOpen(true)
  }, [])

  return (
    <AgentSidebarContext.Provider
      value={{
        isOpen,
        toggle,
        open,
        close,
        profileId,
        threadId,
        isReady,
        sidebarWidth,
        setSidebarWidth,
        isResizing,
        setIsResizing,
        pendingMessage,
        clearPendingMessage,
        openWithMessage,
      }}
    >
      {children}
      <ConsentDialog open={showConsentDialog} onConsented={handleConsented} />
    </AgentSidebarContext.Provider>
  )
}

export function useAgentSidebar() {
  const ctx = useContext(AgentSidebarContext)
  if (!ctx) {
    throw new Error('useAgentSidebar must be used within AgentSidebarProvider')
  }
  return ctx
}
