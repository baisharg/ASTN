import { ConvexError, v } from 'convex/values'
import { internal } from '../_generated/api'
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from '../_generated/server'
import { getUserId, requireOrgAdmin } from '../lib/auth'
import { BAISH_ORG_SLUG } from '../lib/baishCourseOpportunities'
import { slugifyTitle } from '../orgOpportunities'
import schema from '../schema'
import { requireOrgOwnsApiCalendar } from '../luma/binding'
import {
  DEFAULT_MEETING_MINUTES,
  MAX_PREAPPROVED_GUESTS_PER_ADD,
  PERSONAL_LINKS_PER_CALL,
  PREAPPROVED_ADD_APPROVED_LIMIT,
  eventPageUrl,
  looksLikeEmail,
  personalEventLink,
  personalLinkLifetimeSeconds,
  personalLinkRefusal,
  planPreapprovedAdd,
  showsMyMeetings,
  splitGuestName,
} from './constants'
import {
  addToAllowlist,
  autoApprovesKnownGuests,
  findGuestForIdentity,
  focusFromPrompt,
  getGuestByEmail,
  getProfileByUser,
  isFreshImageUpload,
  isOnAllowlist,
  isProfileReadyForMatching,
  lumaStateReset,
  meetingsWindow,
  normalizeEmail,
  profileMissingForMatching,
  requireEventAdmin,
  safeLinkedinUrl,
  shouldAutoApprove,
  updateGuestAndSync,
} from './lib'
import {
  allowlistSourceValidator,
  eventStatusValidator,
  guestSourceValidator,
  guestStatusValidator,
  lumaSyncValidator,
  profileMissingValidator,
} from './validators'
import type {
  PersonalLinkAccount,
  RegisterErrorCode,
  RegisterErrorData,
} from './constants'
import type { GuestStatus } from './lib'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

const eventPublicValidator = v.object({
  _id: v.id('socialEvents'),
  orgId: v.id('organizations'),
  orgName: v.string(),
  orgSlug: v.string(),
  slug: v.string(),
  title: v.string(),
  description: v.union(v.string(), v.null()),
  startAt: v.number(),
  endAt: v.union(v.number(), v.null()),
  timezone: v.string(),
  venueName: v.union(v.string(), v.null()),
  venueAddress: v.union(v.string(), v.null()),
  status: eventStatusValidator,
  lumaUrl: v.union(v.string(), v.null()),
  // Effective 1:1 window (defaults to the event's own hours).
  meetingsOpenAt: v.number(),
  meetingsCloseAt: v.number(),
  meetingMinutes: v.number(),
  focus: v.union(v.string(), v.null()),
  // Whether attendees see "Mis reuniones" (see showsMyMeetings).
  myMeetingsEnabled: v.boolean(),
  viewerIsAdmin: v.boolean(),
})

export async function uniqueEventSlug(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  base: string,
): Promise<string> {
  let slug = base
  for (let n = 2; n < 200; n++) {
    const existing = await ctx.db
      .query('socialEvents')
      .withIndex('by_org_and_slug', (q) =>
        q.eq('orgId', orgId).eq('slug', slug),
      )
      .first()
    if (!existing) return slug
    slug = `${base}-${n}`
  }
  throw new ConvexError('Could not generate a unique event slug')
}

/** An event with an end must end after it starts. */
function assertEndsAfterStart(startAt: number, endAt: number | undefined) {
  if (
    !Number.isFinite(startAt) ||
    (endAt !== undefined && !(endAt > startAt))
  ) {
    throw new ConvexError('The event must end after it starts')
  }
}

async function isOrgAdmin(
  ctx: QueryCtx | MutationCtx,
  userId: string | null,
  orgId: Id<'organizations'>,
): Promise<boolean> {
  if (!userId) return false
  const membership = await ctx.db
    .query('orgMemberships')
    .withIndex('by_user_and_org', (q) =>
      q.eq('userId', userId).eq('orgId', orgId),
    )
    .first()
  return membership?.role === 'admin'
}

async function countGuestsWithStatus(
  ctx: QueryCtx,
  eventId: Id<'socialEvents'>,
  status: Doc<'socialEventGuests'>['status'],
): Promise<number> {
  const rows = await ctx.db
    .query('socialEventGuests')
    .withIndex('by_eventId_and_status', (q) =>
      q.eq('eventId', eventId).eq('status', status),
    )
    .take(1000)
  return rows.length
}

// How many pending guests one automatic approval run looks at. Each approval
// on a linked event also schedules a push to Luma.
const AUTO_APPROVE_BATCH = 500

/**
 * The event's pending guests who are on the org's allowlist: the ones an
 * event that auto-approves would not leave waiting. Looks at the first
 * AUTO_APPROVE_BATCH pending guests.
 */
async function knownPendingGuests(
  ctx: QueryCtx | MutationCtx,
  event: Doc<'socialEvents'>,
): Promise<Array<Doc<'socialEventGuests'>>> {
  const pending = await ctx.db
    .query('socialEventGuests')
    .withIndex('by_eventId_and_status', (q) =>
      q.eq('eventId', event._id).eq('status', 'pending_approval'),
    )
    .take(AUTO_APPROVE_BATCH)
  const known: Array<Doc<'socialEventGuests'>> = []
  for (const guest of pending) {
    if (await isOnAllowlist(ctx, event.orgId, guest.email)) known.push(guest)
  }
  return known
}

/** Refuse a registration with a code the event page translates. */
function refuseRegistration(code: RegisterErrorCode, message: string): never {
  const data: RegisterErrorData = { code, message }
  throw new ConvexError(data)
}

// ── Public ──────────────────────────────────────────────────────────────

/** Everything the public event page needs. Drafts are visible to admins only. */
export const getEventPage = query({
  args: { orgSlug: v.string(), eventSlug: v.string() },
  returns: v.union(eventPublicValidator, v.null()),
  handler: async (ctx, { orgSlug, eventSlug }) => {
    const org = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', orgSlug))
      .first()
    if (!org) return null
    const event = await ctx.db
      .query('socialEvents')
      .withIndex('by_org_and_slug', (q) =>
        q.eq('orgId', org._id).eq('slug', eventSlug),
      )
      .first()
    if (!event) return null

    const viewerId = await getUserId(ctx)
    const viewerIsAdmin = await isOrgAdmin(ctx, viewerId, org._id)
    if (event.status === 'draft' && !viewerIsAdmin) return null

    return {
      _id: event._id,
      orgId: org._id,
      orgName: org.name,
      orgSlug,
      slug: event.slug,
      title: event.title,
      description: event.description ?? null,
      startAt: event.startAt,
      endAt: event.endAt ?? null,
      timezone: event.timezone,
      venueName: event.venueName ?? null,
      venueAddress: event.venueAddress ?? null,
      status: event.status,
      lumaUrl: event.lumaUrl ?? null,
      meetingsOpenAt: meetingsWindow(event).openAt,
      meetingsCloseAt: meetingsWindow(event).closeAt,
      meetingMinutes: event.meetingMinutes,
      focus: focusFromPrompt(event.matchingPrompt),
      myMeetingsEnabled: showsMyMeetings(event),
      viewerIsAdmin,
    }
  },
})

/**
 * How many people are confirmed. Separate from getEventPage so guest-row
 * changes don't re-run the page query every event screen subscribes to.
 */
export const getApprovedCount = query({
  args: { eventId: v.id('socialEvents') },
  returns: v.number(),
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get('socialEvents', eventId)
    if (!event || event.status === 'draft') return 0
    return await countGuestsWithStatus(ctx, eventId, 'approved')
  },
})

/** The signed-in person's registration for an event, if any. */
export const getMyRegistration = query({
  args: { eventId: v.id('socialEvents') },
  returns: v.union(
    v.null(),
    v.object({
      email: v.union(v.string(), v.null()),
      onAllowlist: v.boolean(),
      guest: v.union(
        v.null(),
        v.object({
          _id: v.id('socialEventGuests'),
          status: guestStatusValidator,
          linkedToAccount: v.boolean(),
          lumaSync: lumaSyncValidator,
        }),
      ),
      profileMissing: v.array(profileMissingValidator),
    }),
  ),
  handler: async (ctx, { eventId }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null
    const event = await ctx.db.get('socialEvents', eventId)
    if (!event) return null

    const email = identity.email ? normalizeEmail(identity.email) : null
    const guest = await findGuestForIdentity(
      ctx,
      eventId,
      identity.subject,
      email ?? undefined,
    )
    const profile = await getProfileByUser(ctx, identity.subject)
    return {
      email,
      // True when registering now would approve them straight away.
      onAllowlist: shouldAutoApprove(event, {
        status: 'pending_approval',
        onAllowlist: email
          ? await isOnAllowlist(ctx, event.orgId, email)
          : false,
      }),
      guest: guest
        ? {
            _id: guest._id,
            status: guest.status,
            linkedToAccount: guest.userId === identity.subject,
            lumaSync: guest.lumaSync,
          }
        : null,
      profileMissing: profileMissingForMatching(profile),
    }
  },
})

/**
 * Register the signed-in person. People on the org's allowlist are approved
 * straight away when the event auto-approves them (see shouldAutoApprove);
 * everyone else waits for an admin. Either way the guest is mirrored to Luma
 * when the event is linked.
 */
export const register = mutation({
  args: {
    eventId: v.id('socialEvents'),
    linkedinUrl: v.optional(v.string()),
  },
  returns: v.object({
    guestId: v.id('socialEventGuests'),
    status: guestStatusValidator,
  }),
  handler: async (ctx, { eventId, linkedinUrl }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) refuseRegistration('not_authenticated', 'Not authenticated')
    if (!identity.email) {
      refuseRegistration('no_email', 'Your account has no email address')
    }
    const event = await ctx.db.get('socialEvents', eventId)
    if (!event || event.status !== 'published') {
      refuseRegistration(
        'registration_closed',
        'Registration is not open for this event',
      )
    }

    const userId = identity.subject
    const email = normalizeEmail(identity.email)
    const now = Date.now()
    const cleanLinkedin = safeLinkedinUrl(linkedinUrl) ?? undefined

    const profile = await getProfileByUser(ctx, userId)
    if (profile && cleanLinkedin && !profile.linkedinUrl) {
      await ctx.db.patch('profiles', profile._id, {
        linkedinUrl: cleanLinkedin,
        updatedAt: now,
      })
    }

    const existing = await findGuestForIdentity(ctx, eventId, userId, email)
    if (existing) {
      // Came in through Luma or an earlier visit: link it to this account.
      if (existing.userId !== userId) {
        await ctx.db.patch('socialEventGuests', existing._id, {
          userId,
          linkedinUrl: existing.linkedinUrl ?? cleanLinkedin,
          updatedAt: now,
        })
      }
      return { guestId: existing._id, status: existing.status }
    }

    const approved = shouldAutoApprove(event, {
      status: 'pending_approval',
      onAllowlist: await isOnAllowlist(ctx, event.orgId, email),
    })
    const status: GuestStatus = approved ? 'approved' : 'pending_approval'
    const guestId = await ctx.db.insert('socialEventGuests', {
      eventId,
      orgId: event.orgId,
      email,
      name: identity.name ?? profile?.name ?? undefined,
      userId,
      status,
      source: 'app',
      linkedinUrl: cleanLinkedin,
      lumaSync: event.lumaEventId ? 'pending' : 'not_linked',
      registeredAt: now,
      updatedAt: now,
    })
    if (event.lumaEventId) {
      await ctx.scheduler.runAfter(0, internal.social.lumaSync.pushGuest, {
        guestId,
      })
    }
    return { guestId, status }
  },
})

/**
 * Link a guest row that came in through Luma (matched by email) to the
 * signed-in account. The event page calls this on load.
 */
export const linkMyGuest = mutation({
  args: { eventId: v.id('socialEvents') },
  returns: v.boolean(),
  handler: async (ctx, { eventId }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity?.email) return false
    const guest = await findGuestForIdentity(
      ctx,
      eventId,
      identity.subject,
      normalizeEmail(identity.email),
    )
    if (!guest || guest.userId === identity.subject) return false
    await ctx.db.patch('socialEventGuests', guest._id, {
      userId: identity.subject,
      updatedAt: Date.now(),
    })
    return true
  },
})

// ── Admin ───────────────────────────────────────────────────────────────

export const listEvents = query({
  args: { orgId: v.id('organizations') },
  returns: v.array(
    v.object({
      _id: v.id('socialEvents'),
      slug: v.string(),
      title: v.string(),
      startAt: v.number(),
      timezone: v.string(),
      status: eventStatusValidator,
      lumaLinked: v.boolean(),
      approvedCount: v.number(),
      pendingCount: v.number(),
    }),
  ),
  handler: async (ctx, { orgId }) => {
    await requireOrgAdmin(ctx, orgId)
    const events = await ctx.db
      .query('socialEvents')
      .withIndex('by_org_and_startAt', (q) => q.eq('orgId', orgId))
      .order('desc')
      .take(50)
    return await Promise.all(
      events.map(async (e) => ({
        _id: e._id,
        slug: e.slug,
        title: e.title,
        startAt: e.startAt,
        timezone: e.timezone,
        status: e.status,
        lumaLinked: !!e.lumaEventId,
        approvedCount: await countGuestsWithStatus(ctx, e._id, 'approved'),
        pendingCount: await countGuestsWithStatus(
          ctx,
          e._id,
          'pending_approval',
        ),
      })),
    )
  },
})

export const getEventAdmin = query({
  args: { eventId: v.id('socialEvents') },
  returns: v.object({
    ...schema.tables.socialEvents.validator.fields,
    _id: v.id('socialEvents'),
    _creationTime: v.number(),
    orgSlug: v.union(v.string(), v.null()),
    spots: v.array(
      v.object({
        ...schema.tables.socialEventSpots.validator.fields,
        _id: v.id('socialEventSpots'),
        _creationTime: v.number(),
      }),
    ),
    floorPlanUrl: v.union(v.string(), v.null()),
    approvedCount: v.number(),
    pendingCount: v.number(),
    lumaErrors: v.number(),
  }),
  handler: async (ctx, { eventId }) => {
    const { event } = await requireEventAdmin(ctx, eventId)
    const spots = await ctx.db
      .query('socialEventSpots')
      .withIndex('by_eventId_and_number', (q) => q.eq('eventId', eventId))
      .take(200)
    const floorPlanUrl = event.floorPlanStorageId
      ? await ctx.storage.getUrl(event.floorPlanStorageId)
      : null
    const org = await ctx.db.get('organizations', event.orgId)
    return {
      ...event,
      orgSlug: org?.slug ?? null,
      spots,
      floorPlanUrl,
      approvedCount: await countGuestsWithStatus(ctx, eventId, 'approved'),
      pendingCount: await countGuestsWithStatus(
        ctx,
        eventId,
        'pending_approval',
      ),
      lumaErrors: (
        await ctx.db
          .query('socialEventGuests')
          .withIndex('by_eventId_and_lumaSync', (q) =>
            q.eq('eventId', eventId).eq('lumaSync', 'error'),
          )
          .take(100)
      ).length,
    }
  },
})

/**
 * How many pending guests are on the org's allowlist. Publishing the event,
 * or switching its auto-approval on, approves them: the admin screen shows
 * this number before doing either.
 */
export const getKnownPendingCount = query({
  args: { eventId: v.id('socialEvents') },
  returns: v.number(),
  handler: async (ctx, { eventId }) => {
    const { event } = await requireEventAdmin(ctx, eventId)
    return (await knownPendingGuests(ctx, event)).length
  },
})

export const createEvent = mutation({
  args: {
    orgId: v.id('organizations'),
    title: v.string(),
    startAt: v.number(),
    endAt: v.optional(v.number()),
    timezone: v.string(),
    description: v.optional(v.string()),
    venueName: v.optional(v.string()),
    venueAddress: v.optional(v.string()),
  },
  returns: v.object({ eventId: v.id('socialEvents'), slug: v.string() }),
  handler: async (ctx, args) => {
    const userId = await requireOrgAdmin(ctx, args.orgId)
    const title = args.title.trim()
    if (!title) throw new ConvexError('Title is required')
    assertEndsAfterStart(args.startAt, args.endAt)
    const slug = await uniqueEventSlug(
      ctx,
      args.orgId,
      slugifyTitle(title) || 'evento',
    )
    const now = Date.now()
    const eventId = await ctx.db.insert('socialEvents', {
      orgId: args.orgId,
      slug,
      title,
      description: args.description?.trim() || undefined,
      startAt: args.startAt,
      endAt: args.endAt,
      timezone: args.timezone,
      venueName: args.venueName?.trim() || undefined,
      venueAddress: args.venueAddress?.trim() || undefined,
      status: 'draft',
      meetingMinutes: DEFAULT_MEETING_MINUTES,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    return { eventId, slug }
  },
})

export const updateEvent = mutation({
  args: {
    eventId: v.id('socialEvents'),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.union(v.number(), v.null())),
    timezone: v.optional(v.string()),
    venueName: v.optional(v.string()),
    venueAddress: v.optional(v.string()),
    status: v.optional(eventStatusValidator),
    meetingsOpenAt: v.optional(v.union(v.number(), v.null())),
    meetingsCloseAt: v.optional(v.union(v.number(), v.null())),
    meetingMinutes: v.optional(v.number()),
    matchingPrompt: v.optional(v.string()),
    // For an event linked to Luma: let Luma email the guests about a new
    // name, time or place. Left out, Luma is told not to.
    notifyGuests: v.optional(v.boolean()),
    autoApproveKnown: v.optional(v.boolean()),
    myMeetingsEnabled: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { eventId, notifyGuests, ...fields }) => {
    const { event } = await requireEventAdmin(ctx, eventId)
    const patch: Partial<Doc<'socialEvents'>> = { updatedAt: Date.now() }
    if (fields.title !== undefined) {
      const title = fields.title.trim()
      if (!title) throw new ConvexError('Title is required')
      patch.title = title
    }
    if (fields.description !== undefined) {
      patch.description = fields.description.trim() || undefined
    }
    if (fields.startAt !== undefined) patch.startAt = fields.startAt
    if (fields.endAt !== undefined) patch.endAt = fields.endAt ?? undefined
    if (fields.startAt !== undefined || fields.endAt !== undefined) {
      // Checked against the stored value of whichever one this call omits.
      assertEndsAfterStart(
        patch.startAt ?? event.startAt,
        'endAt' in patch ? patch.endAt : event.endAt,
      )
    }
    if (fields.timezone !== undefined) patch.timezone = fields.timezone
    if (fields.venueName !== undefined) {
      patch.venueName = fields.venueName.trim() || undefined
    }
    if (fields.venueAddress !== undefined) {
      patch.venueAddress = fields.venueAddress.trim() || undefined
    }
    if (fields.status !== undefined) patch.status = fields.status
    if (fields.meetingsOpenAt !== undefined) {
      patch.meetingsOpenAt = fields.meetingsOpenAt ?? undefined
    }
    if (fields.meetingsCloseAt !== undefined) {
      patch.meetingsCloseAt = fields.meetingsCloseAt ?? undefined
    }
    if (fields.meetingMinutes !== undefined) {
      if (fields.meetingMinutes < 5 || fields.meetingMinutes > 120) {
        throw new ConvexError(
          'Meeting length must be between 5 and 120 minutes',
        )
      }
      patch.meetingMinutes = Math.round(fields.meetingMinutes)
    }
    if (fields.matchingPrompt !== undefined) {
      patch.matchingPrompt = fields.matchingPrompt.trim() || undefined
    }
    if (fields.autoApproveKnown !== undefined) {
      patch.autoApproveKnown = fields.autoApproveKnown
    }
    if (fields.myMeetingsEnabled !== undefined) {
      patch.myMeetingsEnabled = fields.myMeetingsEnabled
    }
    await ctx.db.patch('socialEvents', eventId, patch)

    // Publishing a draft, or switching auto-approval on for a published
    // event, approves the allowlisted guests who were waiting.
    const updated = { ...event, ...patch }
    if (!autoApprovesKnownGuests(event) && autoApprovesKnownGuests(updated)) {
      for (const guest of await knownPendingGuests(ctx, updated)) {
        await updateGuestAndSync(ctx, updated, guest._id, {
          status: 'approved',
        })
      }
    }

    // Linked to Luma: send the details that changed there too.
    if (event.lumaEventId) {
      const changed = (key: keyof Doc<'socialEvents'>) =>
        key in patch && patch[key] !== event[key]
      const lumaFields: Array<'name' | 'description' | 'time' | 'address'> = []
      if (changed('title')) lumaFields.push('name')
      if (changed('description')) lumaFields.push('description')
      if (changed('startAt') || changed('endAt') || changed('timezone')) {
        lumaFields.push('time')
      }
      if (changed('venueAddress') && patch.venueAddress) {
        lumaFields.push('address')
      }
      if (lumaFields.length > 0) {
        await ctx.scheduler.runAfter(
          0,
          internal.luma.api.pushSocialEventToLuma,
          { eventId, fields: lumaFields, notifyGuests: notifyGuests === true },
        )
      }
    }
    return null
  },
})

/**
 * Link the event to a Luma event ("evt-..." or its luma.com URL is resolved
 * by the admin UI). Pulls the guest list right away.
 */
export const linkLumaEvent = mutation({
  args: { eventId: v.id('socialEvents'), lumaEventId: v.string() },
  returns: v.null(),
  handler: async (ctx, { eventId, lumaEventId }) => {
    const { event } = await requireEventAdmin(ctx, eventId)
    // Only the org whose calendar LUMA_API_KEY belongs to may use it.
    await requireOrgOwnsApiCalendar(ctx, event.orgId)
    const id = lumaEventId.trim()
    if (!/^evt-[A-Za-z0-9]+$/.test(id)) {
      throw new ConvexError('Luma event IDs look like evt-XXXXXXXX')
    }
    const other = await ctx.db
      .query('socialEvents')
      .withIndex('by_lumaEventId', (q) => q.eq('lumaEventId', id))
      .first()
    if (other && other._id !== eventId) {
      throw new ConvexError(
        'Another event is already linked to that Luma event',
      )
    }
    if (event.lumaEventId === id) {
      await ctx.db.patch('socialEvents', eventId, {
        lumaLastSyncError: undefined,
        updatedAt: Date.now(),
      })
    } else {
      // A different Luma event: nothing the guests or the event hold from
      // the previous one applies, and the import pushes the guests to this
      // one. A first link finds nothing to reset.
      await ctx.db.patch('socialEvents', eventId, {
        lumaEventId: id,
        lumaUrl: undefined,
        lumaLastSyncedAt: undefined,
        lumaLastSyncError: undefined,
        updatedAt: Date.now(),
      })
      await resetGuestsLumaState(ctx, eventId, { clearLumaCheckIns: true })
    }
    await ctx.scheduler.runAfter(0, internal.social.lumaSync.importLumaEvent, {
      eventId,
    })
    return null
  },
})

/** Apply `lumaStateReset` to every guest of the event. */
async function resetGuestsLumaState(
  ctx: MutationCtx,
  eventId: Id<'socialEvents'>,
  options: { clearLumaCheckIns: boolean },
): Promise<void> {
  const guests = await ctx.db
    .query('socialEventGuests')
    .withIndex('by_eventId_and_email', (q) => q.eq('eventId', eventId))
    .take(2000)
  for (const guest of guests) {
    const patch = lumaStateReset(guest, options)
    if (patch) await ctx.db.patch('socialEventGuests', guest._id, patch)
  }
}

/**
 * Remove the event's Luma link, e.g. after the Luma event was deleted.
 * Guests stay; their Luma mirror state resets, so linking a new Luma event
 * pushes them again. Check-ins stay too, until another Luma event is linked.
 */
export const unlinkLumaEvent = mutation({
  args: { eventId: v.id('socialEvents') },
  returns: v.null(),
  handler: async (ctx, { eventId }) => {
    await requireEventAdmin(ctx, eventId)
    await ctx.db.patch('socialEvents', eventId, {
      lumaEventId: undefined,
      lumaUrl: undefined,
      lumaLastSyncedAt: undefined,
      lumaLastSyncError: undefined,
      updatedAt: Date.now(),
    })
    await resetGuestsLumaState(ctx, eventId, { clearLumaCheckIns: false })
    return null
  },
})

export const syncLumaNow = mutation({
  args: { eventId: v.id('socialEvents') },
  returns: v.null(),
  handler: async (ctx, { eventId }) => {
    const { event } = await requireEventAdmin(ctx, eventId)
    if (!event.lumaEventId)
      throw new ConvexError('This event is not linked to Luma')
    await ctx.scheduler.runAfter(0, internal.social.lumaSync.pullGuests, {
      eventId,
    })
    return null
  },
})

export const listGuests = query({
  args: { eventId: v.id('socialEvents') },
  returns: v.array(
    v.object({
      _id: v.id('socialEventGuests'),
      email: v.string(),
      name: v.union(v.string(), v.null()),
      status: guestStatusValidator,
      source: guestSourceValidator,
      linkedinUrl: v.union(v.string(), v.null()),
      hasAccount: v.boolean(),
      profileReady: v.boolean(),
      lumaSync: lumaSyncValidator,
      lumaSyncError: v.union(v.string(), v.null()),
      checkedIn: v.boolean(),
      registeredAt: v.number(),
    }),
  ),
  handler: async (ctx, { eventId }) => {
    await requireEventAdmin(ctx, eventId)
    const guests = await ctx.db
      .query('socialEventGuests')
      .withIndex('by_eventId_and_email', (q) => q.eq('eventId', eventId))
      .take(1000)
    return await Promise.all(
      guests.map(async (g) => {
        const profile = g.userId ? await getProfileByUser(ctx, g.userId) : null
        return {
          _id: g._id,
          email: g.email,
          name: profile?.name ?? g.name ?? null,
          status: g.status,
          source: g.source,
          linkedinUrl:
            safeLinkedinUrl(g.linkedinUrl) ??
            safeLinkedinUrl(profile?.linkedinUrl),
          hasAccount: !!g.userId,
          profileReady: isProfileReadyForMatching(profile),
          lumaSync: g.lumaSync,
          lumaSyncError: g.lumaSyncError ?? null,
          checkedIn: g.checkedInAt !== undefined,
          registeredAt: g.registeredAt,
        }
      }),
    )
  },
})

/**
 * Approve or decline a guest. Approving also adds them to the org allowlist,
 * so future events skip the approval step. The change is pushed to Luma.
 */
export const setGuestStatus = mutation({
  args: {
    guestId: v.id('socialEventGuests'),
    status: v.union(v.literal('approved'), v.literal('declined')),
  },
  returns: v.null(),
  handler: async (ctx, { guestId, status }) => {
    const guest = await ctx.db.get('socialEventGuests', guestId)
    if (!guest) throw new ConvexError('Guest not found')
    const { event, userId } = await requireEventAdmin(ctx, guest.eventId)
    if (guest.status === status) return null

    await updateGuestAndSync(ctx, event, guestId, { status })
    if (status === 'approved') {
      await addToAllowlist(ctx, {
        orgId: event.orgId,
        email: guest.email,
        name: guest.name,
        source: 'approval',
        addedBy: userId,
      })
    }
    return null
  },
})

/** Retry pushing guests whose last Luma sync failed. */
export const retryLumaErrors = mutation({
  args: { eventId: v.id('socialEvents') },
  returns: v.number(),
  handler: async (ctx, { eventId }) => {
    const { event } = await requireEventAdmin(ctx, eventId)
    const failed = await ctx.db
      .query('socialEventGuests')
      .withIndex('by_eventId_and_lumaSync', (q) =>
        q.eq('eventId', eventId).eq('lumaSync', 'error'),
      )
      .take(100)
    for (const guest of failed) {
      await updateGuestAndSync(ctx, event, guest._id, {})
    }
    return failed.length
  },
})

// ── Allowlist ───────────────────────────────────────────────────────────

export const listAllowlist = query({
  args: { orgId: v.id('organizations') },
  returns: v.array(
    v.object({
      _id: v.id('orgAllowlist'),
      email: v.string(),
      name: v.union(v.string(), v.null()),
      source: allowlistSourceValidator,
      addedAt: v.number(),
    }),
  ),
  handler: async (ctx, { orgId }) => {
    await requireOrgAdmin(ctx, orgId)
    const rows = await ctx.db
      .query('orgAllowlist')
      .withIndex('by_orgId_and_email', (q) => q.eq('orgId', orgId))
      .take(5000)
    return rows.map((r) => ({
      _id: r._id,
      email: r.email,
      name: r.name ?? null,
      source: r.source,
      addedAt: r.addedAt,
    }))
  },
})

/**
 * Add people to the allowlist (the admin UI parses the CSV). Anyone already
 * pending for one of the org's open events that auto-approve is approved on
 * the spot.
 */
export const importAllowlist = mutation({
  args: {
    orgId: v.id('organizations'),
    rows: v.array(
      v.object({ email: v.string(), name: v.optional(v.string()) }),
    ),
    source: v.optional(v.union(v.literal('csv'), v.literal('manual'))),
  },
  returns: v.object({
    added: v.number(),
    alreadyListed: v.number(),
    invalid: v.number(),
    approvedPending: v.number(),
  }),
  handler: async (ctx, { orgId, rows, source }) => {
    const userId = await requireOrgAdmin(ctx, orgId)
    if (rows.length > 2000)
      throw new ConvexError('Import at most 2000 rows at once')

    let added = 0
    let alreadyListed = 0
    let invalid = 0
    const addedEmails: Array<string> = []
    for (const row of rows) {
      const email = normalizeEmail(row.email)
      if (!looksLikeEmail(email)) {
        invalid++
        continue
      }
      const inserted = await addToAllowlist(ctx, {
        orgId,
        email,
        name: row.name?.trim() || undefined,
        source: source ?? 'csv',
        addedBy: userId,
      })
      if (inserted) {
        added++
        addedEmails.push(email)
      } else {
        alreadyListed++
      }
    }

    // Approve matching people already waiting on the org's open events.
    let approvedPending = 0
    const openEvents = (
      await ctx.db
        .query('socialEvents')
        .withIndex('by_org_and_startAt', (q) =>
          q.eq('orgId', orgId).gte('startAt', Date.now() - 24 * 3600 * 1000),
        )
        .take(20)
    ).filter((e) => e.status === 'published')
    const justAdded = new Set(addedEmails)
    for (const event of openEvents) {
      const pending = await ctx.db
        .query('socialEventGuests')
        .withIndex('by_eventId_and_status', (q) =>
          q.eq('eventId', event._id).eq('status', 'pending_approval'),
        )
        .take(1000)
      for (const guest of pending) {
        const autoApprove = shouldAutoApprove(event, {
          status: guest.status,
          onAllowlist: justAdded.has(guest.email),
        })
        if (!autoApprove) continue
        await updateGuestAndSync(ctx, event, guest._id, { status: 'approved' })
        approvedPending++
      }
    }
    return { added, alreadyListed, invalid, approvedPending }
  },
})

/**
 * Put the chosen people from the org's pre-approved list on this event's
 * guest list as approved, without them registering. Only an admin's call
 * does this, for the entries it names and the one event it names.
 *
 * Each new row has no account; it links to one when the person signs in with
 * that email (linkMyGuest, register). On an event linked to Luma each new
 * guest is pushed there, and Luma emails them. Someone who already has a
 * guest row for the event keeps it as it is.
 */
export const addPreapprovedGuests = mutation({
  args: {
    eventId: v.id('socialEvents'),
    entryIds: v.array(v.id('orgAllowlist')),
  },
  returns: v.object({
    added: v.number(),
    alreadyGuest: v.number(),
    invalid: v.number(),
  }),
  handler: async (ctx, { eventId, entryIds }) => {
    const { event } = await requireEventAdmin(ctx, eventId)
    if (entryIds.length > MAX_PREAPPROVED_GUESTS_PER_ADD) {
      throw new ConvexError(
        `Add at most ${MAX_PREAPPROVED_GUESTS_PER_ADD} people at once`,
      )
    }

    const selected: Array<Doc<'orgAllowlist'> | null> = []
    const guestEmails = new Set<string>()
    for (const entryId of entryIds) {
      const entry = await ctx.db.get('orgAllowlist', entryId)
      selected.push(entry)
      if (entry && (await getGuestByEmail(ctx, eventId, entry.email))) {
        guestEmails.add(entry.email)
      }
    }
    const approved = await ctx.db
      .query('socialEventGuests')
      .withIndex('by_eventId_and_status', (q) =>
        q.eq('eventId', eventId).eq('status', 'approved'),
      )
      .take(PREAPPROVED_ADD_APPROVED_LIMIT + 1)

    const plan = planPreapprovedAdd({
      orgId: event.orgId,
      selected,
      guestEmails,
      approvedCount: approved.length,
    })
    if (plan.overLimitBy > 0) {
      throw new ConvexError(
        `People can be added from the pre-approved list until the event has ${PREAPPROVED_ADD_APPROVED_LIMIT} approved guests; this is ${plan.overLimitBy} too many`,
      )
    }

    const now = Date.now()
    for (const person of plan.toAdd) {
      const guestId = await ctx.db.insert('socialEventGuests', {
        eventId,
        orgId: event.orgId,
        email: person.email,
        name: person.name,
        status: 'approved',
        source: 'allowlist',
        lumaSync: 'not_linked',
        registeredAt: now,
        updatedAt: now,
      })
      await updateGuestAndSync(ctx, event, guestId, {})
    }
    return {
      added: plan.toAdd.length,
      alreadyGuest: plan.alreadyGuest,
      invalid: plan.invalid,
    }
  },
})

export const removeFromAllowlist = mutation({
  args: { entryId: v.id('orgAllowlist') },
  returns: v.null(),
  handler: async (ctx, { entryId }) => {
    const entry = await ctx.db.get('orgAllowlist', entryId)
    if (!entry) return null
    await requireOrgAdmin(ctx, entry.orgId)
    await ctx.db.delete('orgAllowlist', entryId)
    return null
  },
})

// ── Floor plan and meeting spots ────────────────────────────────────────

export const generateFloorPlanUploadUrl = mutation({
  args: { eventId: v.id('socialEvents') },
  returns: v.string(),
  handler: async (ctx, { eventId }) => {
    await requireEventAdmin(ctx, eventId)
    return await ctx.storage.generateUploadUrl()
  },
})

export const setFloorPlan = mutation({
  args: {
    eventId: v.id('socialEvents'),
    storageId: v.union(v.id('_storage'), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, { eventId, storageId }) => {
    const { event } = await requireEventAdmin(ctx, eventId)
    if (storageId === (event.floorPlanStorageId ?? null)) return null
    if (storageId !== null) {
      const file = await ctx.db.system.get('_storage', storageId)
      if (!isFreshImageUpload(file, Date.now())) {
        throw new ConvexError(
          'The floor plan must be an image you just uploaded. Upload it again.',
        )
      }
    }
    if (event.floorPlanStorageId) {
      await ctx.storage.delete(event.floorPlanStorageId)
    }
    await ctx.db.patch('socialEvents', eventId, {
      floorPlanStorageId: storageId ?? undefined,
      updatedAt: Date.now(),
    })
    return null
  },
})

/** Replace the event's meeting spots. x and y are 0–1 fractions. */
export const setSpots = mutation({
  args: {
    eventId: v.id('socialEvents'),
    spots: v.array(
      v.object({
        number: v.number(),
        label: v.optional(v.string()),
        x: v.number(),
        y: v.number(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { eventId, spots }) => {
    await requireEventAdmin(ctx, eventId)
    if (spots.length > 200) throw new ConvexError('At most 200 spots')
    const numbers = new Set(spots.map((s) => s.number))
    if (numbers.size !== spots.length) {
      throw new ConvexError('Spot numbers must be unique')
    }
    const active = await ctx.db
      .query('socialMeetings')
      .withIndex('by_eventId_and_status', (q) =>
        q.eq('eventId', eventId).eq('status', 'active'),
      )
      .first()
    if (active) {
      throw new ConvexError("Spots can't change while meetings are in progress")
    }

    const existing = await ctx.db
      .query('socialEventSpots')
      .withIndex('by_eventId_and_number', (q) => q.eq('eventId', eventId))
      .take(500)
    for (const spot of existing)
      await ctx.db.delete('socialEventSpots', spot._id)
    for (const spot of spots) {
      await ctx.db.insert('socialEventSpots', {
        eventId,
        number: spot.number,
        label: spot.label?.trim() || undefined,
        x: Math.min(1, Math.max(0, spot.x)),
        y: Math.min(1, Math.max(0, spot.y)),
      })
    }
    return null
  },
})

// ── Personal links ──────────────────────────────────────────────────────
// A personal link opens the event page already signed in as one guest: the
// page's address with a single-use Clerk sign-in token in its fragment. The
// token and the link exist only in the action's return value: they are never
// stored and never logged. `socialPersonalLinkLog` records who made a link
// for whom.

const noPersonalLinkReasonValidator = v.union(
  v.literal('account_in_use'),
  v.literal('email_not_primary'),
  v.literal('account_has_role'),
  v.literal('email_has_other_data'),
  // The guest is not approved (any more).
  v.literal('not_approved'),
  // Clerk refused a request; `clerkErrorCode` says why.
  v.literal('clerk_error'),
)

const personalLinkGuestValidator = v.object({
  guestId: v.id('socialEventGuests'),
  email: v.string(),
  name: v.union(v.string(), v.null()),
  approved: v.boolean(),
  emailHasOtherData: v.boolean(),
})

const personalLinkContextValidator = v.object({
  adminUserId: v.string(),
  orgId: v.id('organizations'),
  orgSlug: v.string(),
  eventSlug: v.string(),
  meetingsCloseAt: v.number(),
  guests: v.array(personalLinkGuestValidator),
})

const personalLinkResultValidator = v.object({
  guestId: v.id('socialEventGuests'),
  email: v.string(),
  // The link, or null with the reason in `noLinkReason`.
  link: v.union(v.string(), v.null()),
  // True when an account was created for this guest by this call.
  accountCreated: v.boolean(),
  noLinkReason: v.union(noPersonalLinkReasonValidator, v.null()),
  clerkErrorCode: v.union(v.string(), v.null()),
})

type PersonalLinkContext = typeof personalLinkContextValidator.type
type PersonalLinkResult = typeof personalLinkResultValidator.type

/**
 * Whether an account with `email` would reach data from outside `org` the
 * first time it signs in: an account from before the move to Clerk (migrated
 * by email, memberships included), applications sent to another organization
 * without an account, a place on another organization's event, or a BAISH
 * import record (which the career agent reads by the account's email).
 */
async function emailHasDataOutsideOrg(
  ctx: QueryCtx,
  org: Doc<'organizations'>,
  email: string,
): Promise<boolean> {
  const legacyUser = await ctx.db
    .query('users')
    .withIndex('email', (q) => q.eq('email', email))
    .first()
  if (legacyUser) return true

  const guestApplications = await ctx.db
    .query('opportunityApplications')
    .withIndex('by_guest_email_and_opportunity', (q) =>
      q.eq('guestEmail', email),
    )
    .take(100)
  if (guestApplications.some((a) => a.orgId !== org._id)) return true

  const guestRows = await ctx.db
    .query('socialEventGuests')
    .withIndex('by_email', (q) => q.eq('email', email))
    .take(100)
  if (guestRows.some((g) => g.orgId !== org._id)) return true

  if (org.slug === BAISH_ORG_SLUG) return false
  const baishImports = await ctx.db.query('baishImports').take(1000)
  return baishImports.some(
    (record) =>
      normalizeEmail(record.email) === email ||
      (record.otherEmails ?? []).some(
        (other) => normalizeEmail(other) === email,
      ),
  )
}

/**
 * What `createPersonalLinks` needs to know, for an admin of the event's org
 * only. Throws for a guest that is not on this event.
 */
export const getPersonalLinkContext = internalQuery({
  args: {
    eventId: v.id('socialEvents'),
    guestIds: v.array(v.id('socialEventGuests')),
  },
  returns: personalLinkContextValidator,
  handler: async (ctx, { eventId, guestIds }) => {
    const { event, userId } = await requireEventAdmin(ctx, eventId)
    if (event.status === 'draft') {
      // Guests can't open a draft's page, so a link to it is of no use.
      throw new ConvexError('Publish the event before making personal links')
    }
    if (guestIds.length === 0 || guestIds.length > PERSONAL_LINKS_PER_CALL) {
      throw new ConvexError(
        `Make links for 1 to ${PERSONAL_LINKS_PER_CALL} guests at a time`,
      )
    }
    if (new Set(guestIds).size !== guestIds.length) {
      throw new ConvexError('Each guest can be listed once')
    }
    const org = await ctx.db.get('organizations', event.orgId)
    if (!org?.slug) throw new ConvexError('The organization has no page')

    const guests: PersonalLinkContext['guests'] = []
    for (const guestId of guestIds) {
      const guest = await ctx.db.get('socialEventGuests', guestId)
      if (!guest || guest.eventId !== eventId) {
        throw new ConvexError('Guest not found on this event')
      }
      const email = normalizeEmail(guest.email)
      guests.push({
        guestId,
        email,
        name: guest.name ?? null,
        approved: guest.status === 'approved',
        emailHasOtherData: await emailHasDataOutsideOrg(ctx, org, email),
      })
    }
    return {
      adminUserId: userId,
      orgId: event.orgId,
      orgSlug: org.slug,
      eventSlug: event.slug,
      meetingsCloseAt: meetingsWindow(event).closeAt,
      guests,
    }
  },
})

/**
 * What the site holds for an account: whether it administers any
 * organization or the platform, and whether it has a profile, a membership
 * or a place on an event (which every account that opened an event page
 * signed in has).
 */
export const getAccountFacts = internalQuery({
  args: { userId: v.string() },
  returns: v.object({ hasAdminRole: v.boolean(), hasAstnData: v.boolean() }),
  handler: async (ctx, { userId }) => {
    const platformAdmin = await ctx.db
      .query('platformAdmins')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .first()
    const memberships = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .take(200)
    const profile = await getProfileByUser(ctx, userId)
    const eventPlace = await ctx.db
      .query('socialEventGuests')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first()
    return {
      hasAdminRole:
        platformAdmin !== null || memberships.some((m) => m.role === 'admin'),
      hasAstnData:
        profile !== null || memberships.length > 0 || eventPlace !== null,
    }
  },
})

/**
 * Record who made personal links for whom, and the accounts created on the
 * way. Never the links themselves.
 */
export const recordPersonalLinks = internalMutation({
  args: {
    eventId: v.id('socialEvents'),
    orgId: v.id('organizations'),
    createdBy: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    links: v.array(
      v.object({
        guestId: v.id('socialEventGuests'),
        email: v.string(),
        accountUserId: v.string(),
        accountCreated: v.boolean(),
        linkMade: v.boolean(),
        signInTokenId: v.optional(v.string()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { links, ...shared }) => {
    for (const link of links) {
      await ctx.db.insert('socialPersonalLinkLog', { ...shared, ...link })
    }
    return null
  },
})

/** A request Clerk's Backend API refused. Carries Clerk's error code only. */
class ClerkRequestError extends Error {
  constructor(
    operation: string,
    readonly code: string,
  ) {
    super(`Clerk ${operation} failed: ${code}`)
  }
}

type ClerkUser = {
  id: string
  primary_email_address_id: string | null
  last_sign_in_at: number | null
  email_addresses: Array<{
    id: string
    email_address: string
    verification: { status: string } | null
  }>
}

/**
 * One request to Clerk's Backend API. A rate-limited request is tried once
 * more. Failures throw a ClerkRequestError built from the status and Clerk's
 * error code: the response body, which can hold a token, is never put in an
 * error or a log line.
 */
async function clerkRequest(
  secretKey: string,
  operation: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(`https://api.clerk.com/v1${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch {
      throw new ClerkRequestError(operation, 'network_error')
    }
    if (res.status === 429 && attempt === 0) {
      const retryAfter = Number(res.headers.get('Retry-After'))
      const seconds =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(seconds, 10) * 1000),
      )
      continue
    }
    if (!res.ok) {
      let code = `http_${res.status}`
      try {
        const data = (await res.json()) as {
          errors?: Array<{ code?: unknown }>
        }
        const clerkCode = data.errors?.[0]?.code
        if (
          typeof clerkCode === 'string' &&
          /^[a-z0-9_]{1,80}$/.test(clerkCode)
        ) {
          code = clerkCode
        }
      } catch {
        // No readable error body: the status is the code.
      }
      throw new ClerkRequestError(operation, code)
    }
    return await res.json()
  }
}

/** A value Clerk returned in a shape this code does not expect. */
function unexpectedClerkResponse(operation: string): ClerkRequestError {
  return new ClerkRequestError(operation, 'unexpected_response')
}

/**
 * The account that has `email`, as Clerk knows it, or null when none does.
 * `userId` is only given for an account whose verified primary address is
 * `email`: that is the address the site knows an account by.
 */
async function findClerkAccount(
  secretKey: string,
  email: string,
): Promise<
  | { userId: string; emailIsVerifiedPrimary: true; hasSignedIn: boolean }
  | { userId: null; emailIsVerifiedPrimary: false; hasSignedIn: false }
  | null
> {
  const operation = 'user lookup'
  const users = await clerkRequest(
    secretKey,
    operation,
    `/users?email_address=${encodeURIComponent(email)}&limit=10`,
  )
  if (!Array.isArray(users)) throw unexpectedClerkResponse(operation)
  if (users.length === 0) return null
  const owner = (users as Array<ClerkUser>).find((user) =>
    user.email_addresses.some(
      (address) =>
        address.id === user.primary_email_address_id &&
        normalizeEmail(address.email_address) === email &&
        address.verification?.status === 'verified',
    ),
  )
  if (!owner) {
    return { userId: null, emailIsVerifiedPrimary: false, hasSignedIn: false }
  }
  return {
    userId: owner.id,
    emailIsVerifiedPrimary: true,
    hasSignedIn: owner.last_sign_in_at !== null,
  }
}

/**
 * Create the account for a guest who has none: their email (which Clerk
 * marks as verified, since the backend vouches for it), their name and no
 * password. Sign-up restrictions and legal-consent requirements of the Clerk
 * instance still apply. Returns the new account's id.
 */
async function createClerkAccount(
  secretKey: string,
  email: string,
  name: string | null,
): Promise<string> {
  const operation = 'user creation'
  const account = { email_address: [email], skip_password_requirement: true }
  const { firstName, lastName } = splitGuestName(name)
  let created: unknown
  try {
    created = await clerkRequest(secretKey, operation, '/users', {
      ...account,
      first_name: firstName,
      last_name: lastName,
    })
  } catch (error) {
    // An instance that does not collect names refuses them: create without.
    const namesRefused =
      error instanceof ClerkRequestError && error.code === 'form_param_unknown'
    if (!namesRefused) throw error
    created = await clerkRequest(secretKey, operation, '/users', account)
  }
  const id = (created as { id?: unknown } | null)?.id
  if (typeof id !== 'string') throw unexpectedClerkResponse(operation)
  return id
}

/**
 * A single-use sign-in token for an account, valid for `lifetimeSeconds`,
 * with Clerk's id for it (which can revoke it, and signs nobody in). The
 * token completes the first factor only: an account with a second factor
 * still has to give it.
 */
async function createClerkSignInToken(
  secretKey: string,
  userId: string,
  lifetimeSeconds: number,
): Promise<{ id: string; token: string }> {
  const operation = 'sign-in token creation'
  const created = await clerkRequest(secretKey, operation, '/sign_in_tokens', {
    user_id: userId,
    expires_in_seconds: lifetimeSeconds,
  })
  const { id, token } = (created ?? {}) as { id?: unknown; token?: unknown }
  if (typeof id !== 'string' || typeof token !== 'string' || !token) {
    throw unexpectedClerkResponse(operation)
  }
  return { id, token }
}

/**
 * Make personal links for approved guests of an event, for an admin of its
 * org. For a guest whose email has no account, this creates one (with that
 * email, marked as verified, and no password). A guest gets no link when
 * `personalLinkRefusal` says so; they sign in the usual way.
 *
 * Each link works once and until `expiresAt` (see
 * `personalLinkLifetimeSeconds`). Making a new link does not cancel earlier
 * ones: an unused link keeps working until it expires, even after the guest
 * has signed in with another. `socialPersonalLinkLog` keeps each token's id,
 * which Clerk can revoke. Nothing is emailed: the admin passes the links on.
 */
export const createPersonalLinks = action({
  args: {
    eventId: v.id('socialEvents'),
    guestIds: v.array(v.id('socialEventGuests')),
  },
  returns: v.object({
    // The event page's address, without a token.
    eventUrl: v.string(),
    expiresAt: v.number(),
    results: v.array(personalLinkResultValidator),
  }),
  handler: async (ctx, { eventId, guestIds }) => {
    const context: PersonalLinkContext = await ctx.runQuery(
      internal.social.events.getPersonalLinkContext,
      { eventId, guestIds },
    )
    const secretKey = process.env.CLERK_SECRET_KEY
    if (!secretKey) {
      throw new ConvexError('CLERK_SECRET_KEY is not set on the backend')
    }
    const eventUrl = eventPageUrl(
      process.env.SITE_URL ?? 'https://safetytalent.org',
      context.orgSlug,
      context.eventSlug,
    )
    const now = Date.now()
    const lifetimeSeconds = personalLinkLifetimeSeconds(
      now,
      context.meetingsCloseAt,
    )
    const expiresAt = now + lifetimeSeconds * 1000

    const results: Array<PersonalLinkResult> = []
    const log: Array<{
      guestId: Id<'socialEventGuests'>
      email: string
      accountUserId: string
      accountCreated: boolean
      linkMade: boolean
      signInTokenId?: string
    }> = []

    for (const guest of context.guests) {
      const noLink = (
        noLinkReason: NonNullable<PersonalLinkResult['noLinkReason']>,
        clerkErrorCode: string | null = null,
      ) =>
        results.push({
          guestId: guest.guestId,
          email: guest.email,
          link: null,
          accountCreated: false,
          noLinkReason,
          clerkErrorCode,
        })
      if (!guest.approved) {
        noLink('not_approved')
        continue
      }
      // Set once this call has created the guest's account.
      let createdAccountId: string | null = null
      try {
        const found = await findClerkAccount(secretKey, guest.email)
        let account: PersonalLinkAccount = { kind: 'none' }
        if (found) {
          // Only an account Clerk has seen no sign-in to can still get a
          // link, so only then is what the site holds for it looked up.
          const facts: { hasAdminRole: boolean; hasAstnData: boolean } =
            found.userId !== null && !found.hasSignedIn
              ? await ctx.runQuery(internal.social.events.getAccountFacts, {
                  userId: found.userId,
                })
              : { hasAdminRole: false, hasAstnData: false }
          account = {
            kind: 'existing',
            emailIsVerifiedPrimary: found.emailIsVerifiedPrimary,
            hasSignedIn: found.hasSignedIn,
            ...facts,
          }
        }
        const refusal = personalLinkRefusal({
          account,
          emailHasOtherData: guest.emailHasOtherData,
        })
        if (refusal) {
          noLink(refusal)
          continue
        }

        let accountUserId = found?.userId ?? null
        if (!accountUserId) {
          createdAccountId = await createClerkAccount(
            secretKey,
            guest.email,
            guest.name,
          )
          accountUserId = createdAccountId
        }
        const signInToken = await createClerkSignInToken(
          secretKey,
          accountUserId,
          lifetimeSeconds,
        )
        log.push({
          guestId: guest.guestId,
          email: guest.email,
          accountUserId,
          accountCreated: createdAccountId !== null,
          linkMade: true,
          signInTokenId: signInToken.id,
        })
        results.push({
          guestId: guest.guestId,
          email: guest.email,
          link: personalEventLink(eventUrl, signInToken.token),
          accountCreated: createdAccountId !== null,
          noLinkReason: null,
          clerkErrorCode: null,
        })
      } catch (error) {
        if (!(error instanceof ClerkRequestError)) throw error
        if (createdAccountId !== null) {
          log.push({
            guestId: guest.guestId,
            email: guest.email,
            accountUserId: createdAccountId,
            accountCreated: true,
            linkMade: false,
          })
        }
        results.push({
          guestId: guest.guestId,
          email: guest.email,
          link: null,
          accountCreated: createdAccountId !== null,
          noLinkReason: 'clerk_error',
          clerkErrorCode: error.code,
        })
      }
    }

    if (log.length > 0) {
      await ctx.runMutation(internal.social.events.recordPersonalLinks, {
        eventId,
        orgId: context.orgId,
        createdBy: context.adminUserId,
        createdAt: now,
        expiresAt,
        links: log,
      })
    }
    return { eventUrl, expiresAt, results }
  },
})
