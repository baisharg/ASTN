import * as Sentry from '@sentry/tanstackstart-react'
import { createRouter } from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import { routerWithQueryClient } from '@tanstack/react-router-with-query'
import { ConvexQueryClient } from '@convex-dev/react-query'
import { ClerkProvider, useAuth } from '@clerk/clerk-react'
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import { useEffect, useRef } from 'react'
import { Authenticated, useMutation } from 'convex/react'
import { api } from '../convex/_generated/api'
import { routeTree } from './routeTree.gen'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { ErrorDisplay } from '~/components/ErrorDisplay'

function UserMigration() {
  const migrateUser = useMutation(api.userMigration.migrateUserIfNeeded)
  const ensureIdentity = useMutation(api.profiles.ensureIdentityFields)
  const didRun = useRef(false)

  useEffect(() => {
    if (didRun.current) return
    didRun.current = true
    migrateUser().catch(() => {
      // Silent failure — migration is best-effort
    })
    ensureIdentity().catch(() => {
      // Silent failure — backfill is best-effort
    })
  }, [migrateUser, ensureIdentity])

  return null
}

function DefaultErrorComponent({ error, reset }: ErrorComponentProps) {
  return <ErrorDisplay error={error} reset={reset} />
}

export function getRouter() {
  const CONVEX_URL = (import.meta as any).env.VITE_CONVEX_URL as string
  if (!CONVEX_URL) {
    throw new Error(
      'VITE_CONVEX_URL is not set. Check your environment variables.',
    )
  }

  const convexQueryClient = new ConvexQueryClient(CONVEX_URL)

  const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
        gcTime: Infinity,
      },
    },
  })
  convexQueryClient.connect(queryClient)

  const router = routerWithQueryClient(
    createRouter({
      routeTree,
      defaultPreload: 'intent',
      context: { queryClient },
      scrollRestoration: true,
      defaultPreloadStaleTime: 0, // Let React Query handle all caching
      defaultViewTransition: true, // Enable View Transitions API for smooth page navigation
      defaultErrorComponent: DefaultErrorComponent,
      defaultNotFoundComponent: () => <p>not found</p>,
      Wrap: ({ children }) => (
        <ClerkProvider
          publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}
        >
          <ConvexProviderWithClerk
            client={convexQueryClient.convexClient}
            useAuth={useAuth}
          >
            <Authenticated>
              <UserMigration />
            </Authenticated>
            {children}
          </ConvexProviderWithClerk>
        </ClerkProvider>
      ),
    }),
    queryClient,
  )

  if (!router.isServer) {
    Sentry.init({
      dsn: 'https://f7612c740401feef0039be0728f64cc4@o4510997439053824.ingest.de.sentry.io/4510997440692304',
      sendDefaultPii: true,
      tunnel: '/tunnel',
      integrations: [
        Sentry.tanstackRouterBrowserTracingIntegration(router),
        Sentry.replayIntegration(),
      ],
      tracesSampleRate: 1.0,
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
      enableLogs: true,
      ignoreErrors: [
        // Benign: browser aborts ViewTransition when a new navigation starts during an ongoing transition
        'Old view transition aborted by new view transition',
        'Skipped ViewTransition due to another transition starting',
        'Transition was skipped',
        'Transition was aborted because of invalid state',
        // Unactionable browser-embedded/extension rejection seen after email-link opens on Windows Chrome.
        /^Non-Error promise rejection captured with value: Object Not Found Matching Id:\d+, MethodName:update, ParamCount:\d+$/,
        // Unactionable: bots/crawlers with corrupted JS bundles failing to construct Convex WebSocket
        "Failed to construct 'WebSocket'",
        // Benign browser noise
        'ResizeObserver loop limit exceeded',
        'ResizeObserver loop completed with undelivered notifications',
        // Android in-app browsers (WebView bridge torn down)
        'Java object is gone',
      ],
    })

    // After a deploy, an open tab can ask for code chunks that no longer
    // exist. Reload once to pick up the new build instead of erroring.
    window.addEventListener('vite:preloadError', (event) => {
      try {
        const key = 'astn-chunk-reload'
        const last = Number(sessionStorage.getItem(key) ?? 0)
        if (Date.now() - last < 60_000) return
        sessionStorage.setItem(key, String(Date.now()))
      } catch {
        // No storage: still reload once.
      }
      event.preventDefault()
      window.location.reload()
    })
  }

  return router
}
