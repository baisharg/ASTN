import { ConvexError, v } from 'convex/values'
import { internal } from '../_generated/api'
import { mutation, query } from '../_generated/server'
import { getUserId, requireOrgAdmin } from '../lib/auth'
import { slugifyTitle } from '../orgOpportunities'
import schema from '../schema'
import { DEFAULT_MEETING_MINUTES } from './constants'
import {
  addToAllowlist,
  findGuestForIdentity,
  focusFromPrompt,
  getProfileByUser,
  isOnAllowlist,
  isProfileReadyForMatching,
  meetingsWindow,
  normalizeEmail,
  profileMissingForMatching,
  requireEventAdmin,
  safeLinkedinUrl,
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
  viewerIsAdmin: v.boolean(),
})

async function uniqueEventSlug(
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
      onAllowlist: email ? await isOnAllowlist(ctx, event.orgId, email) : false,
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
 * straight away; everyone else waits for an admin. Either way the guest is
 * mirrored to Luma when the event is linked.
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
    if (!identity) throw new ConvexError('Not authenticated')
    if (!identity.email) {
      throw new ConvexError('Your account has no email address')
    }
    const event = await ctx.db.get('socialEvents', eventId)
    if (!event || event.status !== 'published') {
      throw new ConvexError('Registration is not open for this event')
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

    const approved = await isOnAllowlist(ctx, event.orgId, email)
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
  },
  returns: v.null(),
  handler: async (ctx, { eventId, ...fields }) => {
    await requireEventAdmin(ctx, eventId)
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
    await ctx.db.patch('socialEvents', eventId, patch)
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
    await requireEventAdmin(ctx, eventId)
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
    await ctx.db.patch('socialEvents', eventId, {
      lumaEventId: id,
      lumaLastSyncError: undefined,
      updatedAt: Date.now(),
    })
    await ctx.scheduler.runAfter(0, internal.social.lumaSync.importLumaEvent, {
      eventId,
    })
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
 * pending for one of the org's open events is approved on the spot.
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
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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
        if (!justAdded.has(guest.email)) continue
        await updateGuestAndSync(ctx, event, guest._id, { status: 'approved' })
        approvedPending++
      }
    }
    return { added, alreadyListed, invalid, approvedPending }
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
    if (event.floorPlanStorageId && event.floorPlanStorageId !== storageId) {
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
