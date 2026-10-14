import * as Sentry from '@sentry/tanstackstart-react'
import { useEffect } from 'react'

/**
 * User-friendly error display component.
 * Extracts structured messages from ConvexError, shows dev-only stack traces.
 */
export function ErrorDisplay({
  error: thrown,
  reset,
}: {
  // The router types errors as unknown: anything can be thrown.
  error: unknown
  reset: () => void
}) {
  const error = thrown instanceof Error ? thrown : new Error(String(thrown))
  useEffect(() => {
    Sentry.captureException(thrown)
  }, [thrown])

  // Extract user-friendly message from ConvexError if available
  let friendlyMessage: string | null = null
  if ('data' in error) {
    const data = (error as Error & { data?: unknown }).data
    if (data && typeof data === 'object' && 'message' in data) {
      friendlyMessage = (data as { message: string }).message
    }
  }

  return (
    <main className="container mx-auto px-4 py-16">
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-2xl font-bold text-slate-900">
          Something went wrong
        </h1>
        <p className="mt-2 text-slate-600">
          {friendlyMessage ??
            'An unexpected error occurred. Please try again or go back to the home page.'}
        </p>
        {import.meta.env.DEV && error.message && (
          <pre className="mt-4 overflow-auto rounded bg-slate-100 p-4 text-left text-xs text-slate-700">
            {error.message}
            {error.stack && `\n\n${error.stack}`}
          </pre>
        )}
        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-md bg-coral-500 px-4 py-2 text-sm font-medium text-white hover:bg-coral-600"
          >
            Try again
          </button>
          <a
            href="/"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Go home
          </a>
        </div>
      </div>
    </main>
  )
}
