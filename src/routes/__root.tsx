import { useUser } from '@clerk/clerk-react'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import * as React from 'react'
import { Toaster } from 'sonner'

// Font preloads for FOIT/FOUT prevention
import plusJakartaWoff2 from '@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2?url'
import spaceGroteskWoff2 from '@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2?url'

import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { QueryClient } from '@tanstack/react-query'
import appCss from '~/styles/app.css?url'
import { ThemeProvider } from '~/components/theme/theme-provider'
import { FeedbackDialog } from '~/components/feedback-dialog'
import { AgentSidebarProvider } from '~/components/agent-sidebar/AgentSidebarProvider'
import { AgentSidebar } from '~/components/agent-sidebar/AgentSidebar'
import { SidebarAwareWrapper } from '~/components/agent-sidebar/SidebarAwareWrapper'
import { MobileShell } from '~/components/layout/mobile-shell'
import { ErrorDisplay } from '~/components/ErrorDisplay'
import { isTauri } from '~/lib/platform'
import { SITE_URL } from '~/lib/site-url'
import { LazyPostHogProvider } from '~/components/analytics/LazyPostHogProvider'

// Lazy-loaded: identifies the Clerk user in PostHog once they are loaded
const PostHogUserIdentifier = React.lazy(() =>
  import('@posthog/react').then((mod) => ({
    default: function PostHogUserIdentifierInner() {
      const { user, isSignedIn } = useUser()
      const posthog = mod.usePostHog()

      React.useEffect(() => {
        if (isSignedIn) {
          posthog.identify(user.id, {
            email: user.primaryEmailAddress?.emailAddress ?? undefined,
            name: user.fullName ?? undefined,
          })
        } else if (isSignedIn === false) {
          posthog.reset()
        }
      }, [isSignedIn, user, posthog])

      return null
    },
  })),
)

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content:
          'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover',
      },
      {
        name: 'description',
        content:
          'AI safety roles matched to your profile. See why you fit, where your gaps are, and what to do next.',
      },
      {
        name: 'apple-mobile-web-app-capable',
        content: 'yes',
      },
      {
        name: 'mobile-web-app-capable',
        content: 'yes',
      },
      {
        name: 'apple-mobile-web-app-status-bar-style',
        content: 'default',
      },
      {
        title: 'AI Safety Talent Network',
      },
      // Open Graph
      {
        property: 'og:type',
        content: 'website',
      },
      {
        property: 'og:url',
        content: SITE_URL,
      },
      {
        property: 'og:title',
        content: 'AI Safety Talent Network',
      },
      {
        property: 'og:description',
        content:
          'AI safety roles matched to your profile. See why you fit, where your gaps are, and what to do next.',
      },
      {
        property: 'og:image',
        content: `${SITE_URL}/og-image.png`,
      },
      {
        property: 'og:image:width',
        content: '1200',
      },
      {
        property: 'og:image:height',
        content: '630',
      },
      {
        property: 'og:site_name',
        content: 'AI Safety Talent Network',
      },
      // Twitter Card
      {
        name: 'twitter:card',
        content: 'summary_large_image',
      },
      {
        name: 'twitter:title',
        content: 'AI Safety Talent Network',
      },
      {
        name: 'twitter:description',
        content:
          'AI safety roles matched to your profile. See why you fit, where your gaps are, and what to do next.',
      },
      {
        name: 'twitter:image',
        content: `${SITE_URL}/og-image.png`,
      },
    ],
    links: [
      // Font preloads (MUST come before stylesheet for browser prioritization)
      {
        rel: 'preload',
        href: plusJakartaWoff2,
        as: 'font',
        type: 'font/woff2',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'preload',
        href: spaceGroteskWoff2,
        as: 'font',
        type: 'font/woff2',
        crossOrigin: 'anonymous',
      },
      // Stylesheet (after preloads)
      { rel: 'stylesheet', href: appCss },
      {
        rel: 'apple-touch-icon',
        sizes: '180x180',
        href: '/apple-touch-icon.png',
      },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '32x32',
        href: '/favicon-32x32.png',
      },
      {
        rel: 'icon',
        type: 'image/png',
        sizes: '16x16',
        href: '/favicon-16x16.png',
      },
      { rel: 'manifest', href: '/site.webmanifest', color: '#fffff' },
      { rel: 'icon', href: '/favicon.ico' },
    ],
  }),
  notFoundComponent: () => <div>Route not found</div>,
  errorComponent: ({ error, reset }) => (
    <RootDocument>
      <ErrorDisplay error={error} reset={reset} />
    </RootDocument>
  ),
  component: RootComponent,
})

function TauriShell({ children }: { children: React.ReactNode }) {
  const profile = useQuery(api.profiles.getOrCreateProfile)
  const user = profile ? { name: profile.name || 'User' } : null
  return <MobileShell user={user}>{children}</MobileShell>
}

function RootComponent() {
  return (
    <RootDocument>
      <AgentSidebarProvider>
        {isTauri() ? (
          <TauriShell>
            <SidebarAwareWrapper>
              <Outlet />
            </SidebarAwareWrapper>
          </TauriShell>
        ) : (
          <SidebarAwareWrapper>
            <Outlet />
          </SidebarAwareWrapper>
        )}
        <AgentSidebar />
      </AgentSidebarProvider>
    </RootDocument>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="light">
      <head>
        <HeadContent />
      </head>
      <body>
        <LazyPostHogProvider
          apiKey={import.meta.env.VITE_PUBLIC_POSTHOG_KEY as string}
          options={{
            api_host: '/ingest',
            ui_host:
              import.meta.env.VITE_PUBLIC_POSTHOG_HOST ||
              'https://us.posthog.com',
            defaults: '2025-05-24',
            capture_exceptions: true,
            debug: import.meta.env.DEV,
          }}
        >
          <React.Suspense>
            <PostHogUserIdentifier />
          </React.Suspense>
          <ThemeProvider>
            {children}
            <Toaster position="top-right" richColors />
            <FeedbackDialog />
          </ThemeProvider>
        </LazyPostHogProvider>
        <Scripts />
      </body>
    </html>
  )
}
