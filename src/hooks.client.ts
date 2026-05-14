import type { HandleClientError } from "@sveltejs/kit";
import { PUBLIC_SENTRY_DSN } from "$env/static/public";

const sentry = PUBLIC_SENTRY_DSN ? await import("@sentry/sveltekit") : null;

if (sentry) {
  sentry.init({
    dsn: PUBLIC_SENTRY_DSN,
    sendDefaultPii: true,
    tunnel: "/tunnel",
    tracesSampleRate: 1.0,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
    ],
  });
}

export const handleError: HandleClientError = sentry
  ? sentry.handleErrorWithSentry()
  : ({ error }) => {
      console.error(error);
    };
