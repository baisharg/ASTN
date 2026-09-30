import { createContext, useContext, useEffect, useState } from 'react'
import type { FunctionReturnType } from 'convex/server'
import type { api } from '../../../convex/_generated/api'

export type SocialEventPage = NonNullable<
  FunctionReturnType<typeof api.social.events.getEventPage>
>

const SocialEventContext = createContext<SocialEventPage | null>(null)

export const SocialEventProvider = SocialEventContext.Provider

/** The event of the current /org/$slug/e/$eventSlug page. */
export function useSocialEvent(): SocialEventPage {
  const event = useContext(SocialEventContext)
  if (!event)
    throw new Error('useSocialEvent must be used inside an event page')
  return event
}

/**
 * The current time, refreshed every `intervalMs`, for countdowns and for
 * working out whether 1:1s are open.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}
