import type { FormField } from './formFields'

// Keys (normalized) that commonly hold an email address in form responses.
const EMAIL_KEYS = [
  'email',
  'emailaddress',
  'correo',
  'correoelectronico',
  'mail',
  'e-mail',
]

// Pragmatic email shape check — the whole trimmed value must look like an email.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function toEmailCandidate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 254) return null
  return EMAIL_RE.test(trimmed) ? trimmed : null
}

/**
 * Best-effort extraction of an email address from an application's form
 * responses, for applicants who have no guestEmail / profile email / legacy
 * email but did type their address into the application form.
 *
 * Resolution order:
 *   1. Fields explicitly declared `kind: 'email'` in the form schema.
 *   2. Response keys that look like an email field (email, correo, ...).
 *   3. Any single response value that is itself a valid email.
 */
export function extractApplicantEmailFromResponses(
  responses: unknown,
  formFields?: Array<FormField>,
): string | null {
  if (!responses || typeof responses !== 'object' || Array.isArray(responses)) {
    return null
  }
  const resp = responses as Record<string, unknown>

  // 1. Prefer fields explicitly declared as email-type in the form schema.
  if (Array.isArray(formFields)) {
    for (const field of formFields) {
      if (field?.kind === 'email') {
        const candidate = toEmailCandidate(resp[field.key])
        if (candidate) return candidate
      }
    }
  }

  // 2. Fall back to email-ish keys.
  const valuesByNormalizedKey = new Map<string, unknown>()
  for (const [key, value] of Object.entries(resp)) {
    valuesByNormalizedKey.set(normalizeKey(key), value)
  }
  for (const key of EMAIL_KEYS) {
    const candidate = toEmailCandidate(
      valuesByNormalizedKey.get(normalizeKey(key)),
    )
    if (candidate) return candidate
  }

  // 3. Last resort: any response value that is itself a valid email.
  for (const value of Object.values(resp)) {
    const candidate = toEmailCandidate(value)
    if (candidate) return candidate
  }

  return null
}
