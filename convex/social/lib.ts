import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

export const DEFAULT_MEETING_MINUTES = 20

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

/** Public-facing slice of a profile shown to other attendees. */
export function socialProfileView(
  profile: Doc<'profiles'> | null,
  fallbackName: string | undefined,
) {
  return {
    name: profile?.name ?? fallbackName ?? 'Asistente',
    headline: profile?.headline ?? null,
    location: profile?.location ?? null,
    linkedinUrl: safeLinkedinUrl(profile?.linkedinUrl),
    seeking: profile?.seeking ?? null,
    canHelpWith: profile?.canHelpWith ?? null,
    careerGoals: profile?.careerGoals ?? null,
    interests: profile?.aiSafetyInterests ?? [],
    skills: profile?.skills ?? [],
    workHistory: (profile?.workHistory ?? []).slice(0, 4).map((w) => ({
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
