import { ConvexError } from 'convex/values'
import { internal } from '../_generated/api'
import { requireOrgAdmin } from '../lib/auth'
import { DEFAULT_EVENT_HOURS } from './constants'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export type GuestStatus = Doc<'socialEventGuests'>['status']

/** Map a Luma approval_status onto our guest status. */
export function guestStatusFromLuma(lumaStatus: string): GuestStatus {
  switch (lumaStatus) {
    case 'approved':
    case 'session':
      return 'approved'
    case 'pending_approval':
      return 'pending_approval'
    case 'declined':
      return 'declined'
    case 'waitlist':
      return 'waitlist'
    case 'invited':
      return 'invited'
    default:
      return 'pending_approval'
  }
}

/**
 * Whether a guest's status stays as it is when Luma reports a different one.
 * It does while a push to Luma is on its way ('pending'), and after a failed
 * push ('error') when the status is a decision made in ASTN (approved or
 * declined). A status ASTN didn't decide follows Luma, so someone approved
 * in Luma is approved here even if their registration never reached it.
 */
export function keepsStatusOverLuma(
  guest: Pick<Doc<'socialEventGuests'>, 'status' | 'lumaSync'>,
): boolean {
  if (guest.lumaSync === 'pending') return true
  return (
    guest.lumaSync === 'error' &&
    (guest.status === 'approved' || guest.status === 'declined')
  )
}

/**
 * The status a push sets for the guest in Luma, or null when ASTN has none
 * to send. ASTN sends only what it decided: an approval or a decline, and
 * the pending registration of a row ASTN created (the person registered in
 * the app, or an admin added them). A waitlist or invited row, and a pending
 * row that came from Luma, hold Luma's own status, so a push leaves the
 * guest in Luma as they are.
 */
export function lumaStatusToPush(
  guest: Pick<Doc<'socialEventGuests'>, 'status' | 'source'>,
): 'approved' | 'declined' | 'pending_approval' | null {
  if (guest.status === 'approved' || guest.status === 'declined') {
    return guest.status
  }
  if (guest.status === 'pending_approval' && guest.source !== 'luma') {
    return 'pending_approval'
  }
  return null
}

/**
 * The patch that makes a guest row forget its Luma event: the Luma guest id,
 * the ticket code and the sync state, leaving the row `not_linked` (what
 * `pushUnlinkedGuests` pushes after the next link). Null when the row holds
 * nothing to forget.
 *
 * `clearLumaCheckIns` also removes a check-in made in Luma's app (any
 * check-in whose source isn't 'astn'). Linking a Luma event passes it: from
 * then on a Luma check-in means one the new event reported, the pull adds
 * the ones it has, and a leftover from the previous event could never be
 * undone (the door page refuses, and the new event doesn't have it). A
 * check-in made at the ASTN door always stays.
 */
export function lumaStateReset(
  guest: Pick<
    Doc<'socialEventGuests'>,
    | 'lumaGuestId'
    | 'lumaCheckInCode'
    | 'lumaSync'
    | 'lumaSyncError'
    | 'checkedInAt'
    | 'checkInSource'
  >,
  options: { clearLumaCheckIns: boolean },
): Partial<Doc<'socialEventGuests'>> | null {
  const patch: Partial<Doc<'socialEventGuests'>> = {}
  if (guest.lumaGuestId !== undefined) patch.lumaGuestId = undefined
  if (guest.lumaCheckInCode !== undefined) patch.lumaCheckInCode = undefined
  if (guest.lumaSyncError !== undefined) patch.lumaSyncError = undefined
  if (guest.lumaSync !== 'not_linked') patch.lumaSync = 'not_linked'
  if (
    options.clearLumaCheckIns &&
    guest.checkedInAt !== undefined &&
    guest.checkInSource !== 'astn'
  ) {
    patch.checkedInAt = undefined
    patch.checkInSource = undefined
  }
  return Object.keys(patch).length > 0 ? patch : null
}

/**
 * The details of the linked Luma event to copy into the ASTN event: only
 * the ones the ASTN event has empty, so nothing an admin wrote is replaced.
 * The description matters because saving the ASTN one sends it to Luma
 * (luma/api.ts pushSocialEventToLuma): an ASTN event left empty would
 * replace Luma's text on the admin's first edit.
 */
export function detailsToFillFromLuma(
  event: Pick<Doc<'socialEvents'>, 'venueAddress' | 'description'>,
  luma: { venueAddress?: string; description?: string },
): { venueAddress?: string; description?: string } {
  const fill: { venueAddress?: string; description?: string } = {}
  if (luma.venueAddress && !event.venueAddress) {
    fill.venueAddress = luma.venueAddress
  }
  if (luma.description && !event.description) {
    fill.description = luma.description
  }
  return fill
}

export async function isOnAllowlist(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
  email: string,
): Promise<boolean> {
  const row = await ctx.db
    .query('orgAllowlist')
    .withIndex('by_orgId_and_email', (q) =>
      q.eq('orgId', orgId).eq('email', normalizeEmail(email)),
    )
    .first()
  return row !== null
}

export async function addToAllowlist(
  ctx: MutationCtx,
  args: {
    orgId: Id<'organizations'>
    email: string
    name?: string
    source: Doc<'orgAllowlist'>['source']
    addedBy?: string
  },
): Promise<boolean> {
  const email = normalizeEmail(args.email)
  if (await isOnAllowlist(ctx, args.orgId, email)) return false
  await ctx.db.insert('orgAllowlist', {
    orgId: args.orgId,
    email,
    name: args.name,
    source: args.source,
    addedBy: args.addedBy,
    addedAt: Date.now(),
  })
  return true
}

export async function getGuestByEmail(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
  email: string,
): Promise<Doc<'socialEventGuests'> | null> {
  return await ctx.db
    .query('socialEventGuests')
    .withIndex('by_eventId_and_email', (q) =>
      q.eq('eventId', eventId).eq('email', normalizeEmail(email)),
    )
    .first()
}

export async function getGuestByUser(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
  userId: string,
): Promise<Doc<'socialEventGuests'> | null> {
  return await ctx.db
    .query('socialEventGuests')
    .withIndex('by_eventId_and_userId', (q) =>
      q.eq('eventId', eventId).eq('userId', userId),
    )
    .first()
}

/**
 * The caller's guest row for an event: by account first, then by the
 * account's email (which links it on the way).
 */
export async function findGuestForIdentity(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
  userId: string,
  email: string | undefined,
): Promise<Doc<'socialEventGuests'> | null> {
  const byUser = await getGuestByUser(ctx, eventId, userId)
  if (byUser) return byUser
  if (!email) return null
  return await getGuestByEmail(ctx, eventId, email)
}

export async function getProfileByUser(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<Doc<'profiles'> | null> {
  return await ctx.db
    .query('profiles')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .first()
}

/** What a profile still needs before we can suggest people to meet. */
export function profileMissingForMatching(
  profile: Doc<'profiles'> | null,
): Array<'background' | 'seeking' | 'canHelpWith'> {
  const missing: Array<'background' | 'seeking' | 'canHelpWith'> = []
  const hasBackground =
    !!profile?.headline?.trim() || (profile?.workHistory?.length ?? 0) > 0
  if (!hasBackground) missing.push('background')
  if (!profile?.seeking?.trim()) missing.push('seeking')
  if (!profile?.canHelpWith?.trim()) missing.push('canHelpWith')
  return missing
}

export function isProfileReadyForMatching(
  profile: Doc<'profiles'> | null,
): boolean {
  return profileMissingForMatching(profile).length === 0
}

/**
 * Whether `viewerId` may see `ownerId`'s event profile. Owners always can;
 * otherwise it depends on the owner's socialVisibility:
 * - event_attendees (default): the viewer is an approved guest of an event
 *   the owner is also an approved guest of
 * - org_members: that, or the viewer belongs to an org the owner belongs to
 * - public: anyone signed in
 */
export async function canViewSocialProfile(
  ctx: QueryCtx | MutationCtx,
  viewerId: string,
  ownerId: string,
  ownerProfile: Doc<'profiles'> | null,
): Promise<boolean> {
  if (viewerId === ownerId) return true
  const visibility = ownerProfile?.socialVisibility ?? 'event_attendees'
  if (visibility === 'public') return true

  const ownerGuestRows = await ctx.db
    .query('socialEventGuests')
    .withIndex('by_userId', (q) => q.eq('userId', ownerId))
    .take(50)
  for (const row of ownerGuestRows) {
    if (row.status !== 'approved') continue
    const viewerRow = await getGuestByUser(ctx, row.eventId, viewerId)
    if (viewerRow?.status === 'approved') return true
  }

  if (visibility === 'org_members') {
    const ownerOrgs = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', ownerId))
      .take(20)
    for (const m of ownerOrgs) {
      const viewerMembership = await ctx.db
        .query('orgMemberships')
        .withIndex('by_user_and_org', (q) =>
          q.eq('userId', viewerId).eq('orgId', m.orgId),
        )
        .first()
      if (viewerMembership) return true
    }
  }
  return false
}

/**
 * A LinkedIn URL safe to render as a link: http(s) on linkedin.com only.
 * Accepts "linkedin.com/in/x" without a scheme. Anything else is dropped, so
 * a stored `javascript:` URL can't reach another person's browser.
 */
export function safeLinkedinUrl(raw: string | undefined | null): string | null {
  const value = raw?.trim()
  if (!value) return null
  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`,
    )
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    const host = url.hostname.toLowerCase()
    if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null
    url.protocol = 'https:'
    return url.toString()
  } catch {
    return null
  }
}

/** The profile sections a person sets a visibility for in privacy settings. */
export const PROFILE_SECTIONS = [
  'basicInfo',
  'workHistory',
  'education',
  'skills',
  'careerGoals',
] as const
export type ProfileSection = (typeof PROFILE_SECTIONS)[number]

/**
 * The sections a person keeps private: those whose own visibility, or the
 * default when they have none, is 'private'. Without privacy settings
 * nothing is private.
 */
export function privateProfileSections(
  privacy: Doc<'profiles'>['privacySettings'],
): Array<ProfileSection> {
  if (!privacy) return []
  return PROFILE_SECTIONS.filter(
    (section) =>
      (privacy.sectionVisibility?.[section] ?? privacy.defaultVisibility) ===
      'private',
  )
}

/**
 * What a profile shares at an in-person event: with the other attendees and
 * with the model that suggests who to meet. Both read a profile only through
 * here.
 *
 * - Name, headline, `seeking` and `canHelpWith` are always shared: the person
 *   fills them in on the event profile page for this purpose.
 * - Everything else belongs to a section of the privacy settings and is left
 *   out (null or an empty list) when that section is private: location and
 *   LinkedIn (basicInfo), work history, education, skills, and career goals
 *   and AI safety interests (careerGoals). Co-attendees count as connections,
 *   so 'public' and 'connections' sections are both shared.
 */
export function attendeeVisibleProfile(profile: Doc<'profiles'> | null) {
  const hiddenSections = privateProfileSections(profile?.privacySettings)
  const shows = (section: ProfileSection) => !hiddenSections.includes(section)
  return {
    name: profile?.name ?? null,
    headline: profile?.headline ?? null,
    seeking: profile?.seeking ?? null,
    canHelpWith: profile?.canHelpWith ?? null,
    location: shows('basicInfo') ? (profile?.location ?? null) : null,
    linkedinUrl: shows('basicInfo')
      ? safeLinkedinUrl(profile?.linkedinUrl)
      : null,
    workHistory: shows('workHistory') ? (profile?.workHistory ?? []) : [],
    education: shows('education') ? (profile?.education ?? []) : [],
    skills: shows('skills') ? (profile?.skills ?? []) : [],
    careerGoals: shows('careerGoals') ? (profile?.careerGoals ?? null) : null,
    interests: shows('careerGoals') ? (profile?.aiSafetyInterests ?? []) : [],
    hiddenSections,
  }
}

export type AttendeeVisibleProfile = ReturnType<typeof attendeeVisibleProfile>

/** A part of a profile, as the event profile page names them. */
export type SharedProfilePart =
  | 'name'
  | 'headline'
  | 'seeking'
  | 'canHelpWith'
  | 'location'
  | 'linkedin'
  | 'workHistory'
  | 'skills'
  | 'careerGoals'
  | 'interests'
  | 'education'

/**
 * The parts of a profile that are shared at events and have something in
 * them, split by who reads them: `attendees` are shown on the person's
 * attendee page (and read by the suggestions model); `suggestionsOnly` are
 * read by the model and shown to nobody. The name is always listed: without
 * one, the name the person registered with is shown.
 */
export function sharedProfileParts(visible: AttendeeVisibleProfile): {
  attendees: Array<SharedProfilePart>
  suggestionsOnly: Array<SharedProfilePart>
} {
  const attendees: Array<[SharedProfilePart, boolean]> = [
    ['name', true],
    ['headline', !!visible.headline?.trim()],
    ['seeking', !!visible.seeking?.trim()],
    ['canHelpWith', !!visible.canHelpWith?.trim()],
    ['location', !!visible.location?.trim()],
    ['linkedin', visible.linkedinUrl !== null],
    ['workHistory', visible.workHistory.length > 0],
    ['skills', visible.skills.length > 0],
    ['careerGoals', !!visible.careerGoals?.trim()],
    ['interests', visible.interests.length > 0],
  ]
  return {
    attendees: attendees.filter(([, has]) => has).map(([part]) => part),
    suggestionsOnly: visible.education.length > 0 ? ['education'] : [],
  }
}

/**
 * The slice of a profile shown on a person's attendee page: what
 * attendeeVisibleProfile shares, with the last four jobs.
 */
export function socialProfileView(
  profile: Doc<'profiles'> | null,
  fallbackName: string | undefined,
) {
  const visible = attendeeVisibleProfile(profile)
  return {
    name: visible.name ?? fallbackName ?? 'Asistente',
    headline: visible.headline,
    location: visible.location,
    linkedinUrl: visible.linkedinUrl,
    seeking: visible.seeking,
    canHelpWith: visible.canHelpWith,
    careerGoals: visible.careerGoals,
    interests: visible.interests,
    skills: visible.skills,
    workHistory: visible.workHistory.slice(0, 4).map((w) => ({
      organization: w.organization,
      title: w.title,
      current: w.current ?? false,
      startDate: w.startDate ?? null,
      endDate: w.endDate ?? null,
    })),
  }
}

/** First sentence of the admin prompt, shown to attendees as the focus. */
export function focusFromPrompt(prompt: string | undefined): string | null {
  if (!prompt) return null
  const trimmed = prompt.trim()
  if (!trimmed) return null
  const match = trimmed.match(/^[^.!?]*[.!?]/)
  return (match ? match[0] : trimmed).trim()
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')
  return letters.toUpperCase() || '?'
}

export async function requireEventAdmin(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
): Promise<{ event: Doc<'socialEvents'>; userId: string }> {
  const event = await ctx.db.get('socialEvents', eventId)
  if (!event) throw new ConvexError('Event not found')
  const userId = await requireOrgAdmin(ctx, event.orgId)
  return { event, userId }
}

/**
 * When 1:1s run. Without explicit times, they follow the event itself: from
 * its start to its end (or DEFAULT_EVENT_HOURS after the start).
 */
export function meetingsWindow(event: Doc<'socialEvents'>): {
  openAt: number
  closeAt: number
} {
  return {
    openAt: event.meetingsOpenAt ?? event.startAt,
    closeAt:
      event.meetingsCloseAt ??
      event.endAt ??
      event.startAt + DEFAULT_EVENT_HOURS * 3600 * 1000,
  }
}

/**
 * Patch a guest and, when the event is linked to Luma, mark the row pending
 * and schedule the push. Every status change goes through here so the Luma
 * mirror stays in step.
 */
export async function updateGuestAndSync(
  ctx: MutationCtx,
  event: Doc<'socialEvents'>,
  guestId: Id<'socialEventGuests'>,
  patch: Partial<Doc<'socialEventGuests'>>,
): Promise<void> {
  await ctx.db.patch('socialEventGuests', guestId, {
    ...patch,
    lumaSync: event.lumaEventId ? 'pending' : 'not_linked',
    lumaSyncError: undefined,
    updatedAt: Date.now(),
  })
  if (event.lumaEventId) {
    await ctx.scheduler.runAfter(0, internal.social.lumaSync.pushGuest, {
      guestId,
    })
  }
}

// How long after its upload a file can still be attached as a floor plan.
const FLOOR_PLAN_UPLOAD_WINDOW_MS = 15 * 60 * 1000

/**
 * Whether a stored file may become an event's floor plan: an image uploaded
 * in the last few minutes, which is what the admin page sends right after
 * its upload. Anything else is some other file whose id the caller happens
 * to know; attaching it would expose it through the plan's URL and delete it
 * when the plan is replaced.
 */
export function isFreshImageUpload(
  file: { _creationTime: number; contentType?: string } | null,
  now: number,
): boolean {
  if (!file) return false
  if (!file.contentType?.toLowerCase().startsWith('image/')) return false
  return now - file._creationTime <= FLOOR_PLAN_UPLOAD_WINDOW_MS
}

/** Approved guests of an event (with or without an account). */
export async function approvedGuests(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
): Promise<Array<Doc<'socialEventGuests'>>> {
  return await ctx.db
    .query('socialEventGuests')
    .withIndex('by_eventId_and_status', (q) =>
      q.eq('eventId', eventId).eq('status', 'approved'),
    )
    .take(500)
}

/** A person's name, initials and headline for cards and lists. */
export async function attendeeCard(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
  userId: string,
) {
  const profile = await getProfileByUser(ctx, userId)
  const name =
    profile?.name ??
    (await getGuestByUser(ctx, eventId, userId))?.name ??
    'Asistente'
  return {
    userId,
    name,
    initials: initialsOf(name),
    headline: profile?.headline ?? null,
  }
}

/** The suggestion `owner` got about `other`, if any. */
export async function findSuggestion(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
  owner: string,
  other: string,
): Promise<Doc<'socialSuggestions'> | null> {
  const rows = await ctx.db
    .query('socialSuggestions')
    .withIndex('by_eventId_and_userId_and_rank', (q) =>
      q.eq('eventId', eventId).eq('userId', owner),
    )
    .take(20)
  return rows.find((r) => r.suggestedUserId === other) ?? null
}
