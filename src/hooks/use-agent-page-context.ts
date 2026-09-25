import { useRouterState } from '@tanstack/react-router'

export type PageContextType =
  | 'viewing_home'
  | 'editing_profile'
  | 'browsing_matches'
  | 'viewing_match'
  | 'browsing_opportunities'
  | 'viewing_opportunity'
  | 'event_profile'

export interface AgentPageContext {
  type: PageContextType
  entityId?: string
}

/** Backward-compat alias */
export type PageContext = AgentPageContext

export function useAgentPageContext(): AgentPageContext | undefined {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  if (pathname === '/') return { type: 'viewing_home' }
  // In-person event pages: /org/<org>/e/<event>/...
  const eventMatch = pathname.match(/^\/org\/([^/]+)\/e\/([^/]+)/)
  if (eventMatch) {
    return {
      type: 'event_profile',
      entityId: `${eventMatch[1]}/${eventMatch[2]}`,
    }
  }
  if (pathname === '/profile' || pathname === '/profile/')
    return { type: 'editing_profile' }
  if (pathname === '/matches' || pathname === '/matches/')
    return { type: 'browsing_matches' }
  if (pathname.startsWith('/matches/')) {
    const entityId = pathname.split('/matches/')[1]?.replace(/\/$/, '')
    return { type: 'viewing_match', entityId: entityId || undefined }
  }
  if (pathname === '/opportunities' || pathname === '/opportunities/')
    return { type: 'browsing_opportunities' }
  if (pathname.startsWith('/opportunities/')) {
    const entityId = pathname.split('/opportunities/')[1]?.replace(/\/$/, '')
    return { type: 'viewing_opportunity', entityId: entityId || undefined }
  }

  return undefined
}
