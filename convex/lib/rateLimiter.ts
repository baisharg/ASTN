import { HOUR, MINUTE, RateLimiter } from '@convex-dev/rate-limiter'
import { components } from '../_generated/api'

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // --- CRITICAL: LLM-cost endpoints ---
  matchComputation: {
    kind: 'token bucket',
    rate: 3,
    period: HOUR,
    capacity: 1,
  },
  enrichmentChat: {
    kind: 'token bucket',
    rate: 20,
    period: MINUTE,
    capacity: 5,
  },
  enrichmentExtraction: {
    kind: 'token bucket',
    rate: 10,
    period: MINUTE,
    capacity: 3,
  },

  // --- CRITICAL: Anonymous / unauthenticated ---
  feedbackSubmit: { kind: 'fixed window', rate: 10, period: HOUR },
  guestApplication: { kind: 'fixed window', rate: 5, period: HOUR },
  // Upload slots for `image` form fields, requested by respondents who are not
  // logged in. Keyed by survey token, so a leaked link cannot be turned into
  // open file hosting. A form has a handful of image fields at most.
  surveyFileUpload: { kind: 'fixed window', rate: 10, period: HOUR },

  // --- MEDIUM: Admin actions ---
  adminBroadcast: { kind: 'fixed window', rate: 5, period: HOUR },
  // Test emails go only to the admin themselves, so the limit is looser
  // and kept separate from adminBroadcast to avoid eating the broadcast budget.
  adminTestEmail: { kind: 'fixed window', rate: 20, period: HOUR },

  // --- HIGH: Authenticated write endpoints ---
  orgApplicationSubmit: { kind: 'fixed window', rate: 5, period: HOUR },
  opportunityApplication: { kind: 'fixed window', rate: 30, period: HOUR },
  generateUploadUrl: {
    kind: 'token bucket',
    rate: 10,
    period: MINUTE,
    capacity: 5,
  },
  guestVisitApplication: { kind: 'fixed window', rate: 5, period: HOUR },
  accountDeletion: { kind: 'fixed window', rate: 1, period: HOUR },
})
