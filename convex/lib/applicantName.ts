import type { Doc, Id } from '../_generated/dataModel'
import type { DatabaseReader } from '../_generated/server'

const FULL_NAME_KEYS = [
  'fullName',
  'name',
  'applicantName',
  'candidateName',
  'displayName',
  'respondentName',
  'nombre',
]

const FIRST_NAME_KEYS = [
  'firstName',
  'givenName',
  'forename',
  'nombre',
  'nombres',
]

const LAST_NAME_KEYS = [
  'lastName',
  'familyName',
  'surname',
  'apellido',
  'apellidos',
]

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function toNameCandidate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = normalizeWhitespace(value)
  if (!trimmed) return null

  // Guard against long free-text answers being mistaken for a name.
  if (trimmed.length > 120) return null
  if (trimmed.split(' ').length > 8) return null

  return trimmed
}

function readByKeys(
  valuesByNormalizedKey: Map<string, unknown>,
  keys: Array<string>,
): string | null {
  for (const key of keys) {
    const candidate = toNameCandidate(
      valuesByNormalizedKey.get(normalizeKey(key)),
    )
    if (candidate) return candidate
  }
  return null
}

/**
 * First and last name for showing them in separate columns: the form's own
 * first/last name answers, else a full name split at its first space (from
 * the form, else from the profile).
 */
export function resolveApplicantNameParts({
  profileName,
  responses,
}: {
  profileName?: string
  responses: unknown
}): { firstName: string; lastName: string } {
  const valuesByNormalizedKey = new Map<string, unknown>()
  if (responses && typeof responses === 'object' && !Array.isArray(responses)) {
    for (const [key, value] of Object.entries(
      responses as Record<string, unknown>,
    )) {
      valuesByNormalizedKey.set(normalizeKey(key), value)
    }
  }

  const firstName = readByKeys(valuesByNormalizedKey, FIRST_NAME_KEYS)
  const lastName = readByKeys(valuesByNormalizedKey, LAST_NAME_KEYS)
  if (firstName && lastName) return { firstName, lastName }

  const full =
    firstName ??
    lastName ??
    readByKeys(valuesByNormalizedKey, FULL_NAME_KEYS) ??
    toNameCandidate(profileName)
  if (!full) return { firstName: '', lastName: '' }
  const space = full.indexOf(' ')
  return space === -1
    ? { firstName: full, lastName: '' }
    : { firstName: full.slice(0, space), lastName: full.slice(space + 1) }
}

export function extractApplicantNameFromResponses(
  responses: unknown,
): string | null {
  if (!responses || typeof responses !== 'object' || Array.isArray(responses)) {
    return null
  }

  const valuesByNormalizedKey = new Map<string, unknown>()
  for (const [key, value] of Object.entries(
    responses as Record<string, unknown>,
  )) {
    valuesByNormalizedKey.set(normalizeKey(key), value)
  }

  const firstName = readByKeys(valuesByNormalizedKey, FIRST_NAME_KEYS)
  const lastName = readByKeys(valuesByNormalizedKey, LAST_NAME_KEYS)
  if (firstName || lastName) {
    return [firstName, lastName].filter(Boolean).join(' ')
  }

  return readByKeys(valuesByNormalizedKey, FULL_NAME_KEYS)
}

export function resolveApplicantDisplayName({
  profileName,
  responses,
  fallback,
}: {
  profileName?: string
  responses: unknown
  fallback: string
}): string {
  const fromProfile = toNameCandidate(profileName)
  if (fromProfile) return fromProfile

  const fromResponses = extractApplicantNameFromResponses(responses)
  if (fromResponses) return fromResponses

  return fallback
}

export async function resolveApplicantDisplayNameFromApplication(
  db: DatabaseReader,
  application: Doc<'opportunityApplications'>,
  fallback: string,
): Promise<string> {
  let profileName: string | undefined
  const userId = application.userId

  if (userId) {
    const profile = await db
      .query('profiles')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()
    profileName = profile?.name
  }

  return resolveApplicantDisplayName({
    profileName,
    responses: application.responses,
    fallback,
  })
}

export async function resolveApplicantDisplayNameByApplicationId(
  db: DatabaseReader,
  applicationId: Id<'opportunityApplications'>,
  fallback: string,
): Promise<string> {
  const application = await db.get('opportunityApplications', applicationId)
  if (!application) return fallback

  return resolveApplicantDisplayNameFromApplication(db, application, fallback)
}
