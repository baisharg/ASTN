import { v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalMutation, mutation, query } from '../_generated/server'
import { getUserId, requireAuth } from '../lib/auth'
import {
  getGuestByUser,
  getProfileByUser,
  initialsOf,
  isProfileReadyForMatching,
  socialProfileView,
} from './lib'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

const MAX_OUTGOING_PENDING = 5
const MAX_NOTE_LENGTH = 280

type AttendeeState = 'available' | 'in_meeting' | 'busy'

async function requireApprovedAttendee(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
  userId: string,
): Promise<Doc<'socialEventGuests'>> {
  const guest = await getGuestByUser(ctx, eventId, userId)
  if (!guest || guest.status !== 'approved') {
    throw new Error('Only confirmed attendees can do this')
  }
  return guest
}

async function activeMeetingFor(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
  userId: string,
): Promise<Doc<'socialMeetings'> | null> {
  const asA = await ctx.db
    .query('socialMeetings')
    .withIndex('by_eventId_and_userA_and_status', (q) =>
      q.eq('eventId', eventId).eq('userA', userId).eq('status', 'active'),
    )
    .first()
  if (asA) return asA
  return await ctx.db
    .query('socialMeetings')
    .withIndex('by_eventId_and_userB_and_status', (q) =>
      q.eq('eventId', eventId).eq('userB', userId).eq('status', 'active'),
    )
    .first()
}

async function availabilityFor(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
  userId: string,
): Promise<'available' | 'busy'> {
  const row = await ctx.db
    .query('socialAttendeeStatus')
    .withIndex('by_eventId_and_userId', (q) =>
      q.eq('eventId', eventId).eq('userId', userId),
    )
    .first()
  return row?.availability ?? 'available'
}

async function attendeeState(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
  userId: string,
): Promise<AttendeeState> {
  if (await activeMeetingFor(ctx, eventId, userId)) return 'in_meeting'
  return await availabilityFor(ctx, eventId, userId)
}

function meetingsOpen(event: Doc<'socialEvents'>, now: number): boolean {
  if (event.meetingsOpenAt !== undefined && now < event.meetingsOpenAt) {
    return false
  }
  if (event.meetingsCloseAt !== undefined && now > event.meetingsCloseAt) {
    return false
  }
  return event.status === 'published'
}

async function attendeeCard(
  ctx: QueryCtx,
  userId: string,
  fallbackName: string | undefined,
) {
  const profile = await getProfileByUser(ctx, userId)
  const name = profile?.name ?? fallbackName ?? 'Asistente'
  return {
    userId,
    name,
    initials: initialsOf(name),
    headline: profile?.headline ?? null,
  }
}

const cardValidator = v.object({
  userId: v.string(),
  name: v.string(),
  initials: v.string(),
  headline: v.union(v.string(), v.null()),
})

const stateValidator = v.union(
  v.literal('available'),
  v.literal('in_meeting'),
  v.literal('busy'),
)

// ── Queries ─────────────────────────────────────────────────────────────

/**
 * Everything the attendee's live screens need: their status, current
 * meeting, and incoming and outgoing requests. `now` comes from the client
 * so the query doesn't read the clock.
 */
export const getLiveState = query({
  args: { eventId: v.id('socialEvents'), now: v.number() },
  returns: v.union(
    v.null(),
    v.object({
      isAttendee: v.boolean(),
      profileReady: v.boolean(),
      meetingsOpen: v.boolean(),
      meetingsOpenAt: v.union(v.number(), v.null()),
      meetingsCloseAt: v.union(v.number(), v.null()),
      meetingMinutes: v.number(),
      availability: v.union(v.literal('available'), v.literal('busy')),
      meeting: v.union(
        v.null(),
        v.object({
          _id: v.id('socialMeetings'),
          partner: cardValidator,
          spot: v.union(
            v.null(),
            v.object({
              number: v.number(),
              label: v.union(v.string(), v.null()),
              x: v.number(),
              y: v.number(),
            }),
          ),
          startedAt: v.number(),
          endsAt: v.number(),
          topics: v.array(v.string()),
        }),
      ),
      incoming: v.array(
        v.object({
          _id: v.id('socialMeetingRequests'),
          from: cardValidator,
          note: v.union(v.string(), v.null()),
          createdAt: v.number(),
          fromState: stateValidator,
        }),
      ),
      outgoing: v.array(
        v.object({
          _id: v.id('socialMeetingRequests'),
          to: cardValidator,
          note: v.union(v.string(), v.null()),
          createdAt: v.number(),
          queuePosition: v.number(),
          toState: stateValidator,
        }),
      ),
    }),
  ),
  handler: async (ctx, { eventId, now }) => {
    const userId = await getUserId(ctx)
    if (!userId) return null
    const event = await ctx.db.get('socialEvents', eventId)
    if (!event) return null
    const guest = await getGuestByUser(ctx, eventId, userId)
    const profile = await getProfileByUser(ctx, userId)
    const base = {
      isAttendee: guest?.status === 'approved',
      profileReady: isProfileReadyForMatching(profile),
      meetingsOpen: meetingsOpen(event, now),
      meetingsOpenAt: event.meetingsOpenAt ?? null,
      meetingsCloseAt: event.meetingsCloseAt ?? null,
      meetingMinutes: event.meetingMinutes,
      availability: await availabilityFor(ctx, eventId, userId),
    }
    if (!base.isAttendee) {
      return { ...base, meeting: null, incoming: [], outgoing: [] }
    }

    const active = await activeMeetingFor(ctx, eventId, userId)
    let meeting = null
    if (active) {
      const partnerId = active.userA === userId ? active.userB : active.userA
      const partnerGuest = await getGuestByUser(ctx, eventId, partnerId)
      const spot = active.spotId
        ? await ctx.db.get('socialEventSpots', active.spotId)
        : null
      const suggestion = await ctx.db
        .query('socialSuggestions')
        .withIndex('by_eventId_and_userId_and_rank', (q) =>
          q.eq('eventId', eventId).eq('userId', userId),
        )
        .take(20)
      meeting = {
        _id: active._id,
        partner: await attendeeCard(ctx, partnerId, partnerGuest?.name),
        spot: spot
          ? {
              number: spot.number,
              label: spot.label ?? null,
              x: spot.x,
              y: spot.y,
            }
          : null,
        startedAt: active.startedAt,
        endsAt: active.endsAt,
        topics:
          suggestion.find((s) => s.suggestedUserId === partnerId)?.topics ?? [],
      }
    }

    const incomingRows = await ctx.db
      .query('socialMeetingRequests')
      .withIndex('by_eventId_and_toUserId_and_status', (q) =>
        q.eq('eventId', eventId).eq('toUserId', userId).eq('status', 'pending'),
      )
      .take(50)
    const incoming = await Promise.all(
      incomingRows.map(async (r) => {
        const fromGuest = await getGuestByUser(ctx, eventId, r.fromUserId)
        return {
          _id: r._id,
          from: await attendeeCard(ctx, r.fromUserId, fromGuest?.name),
          note: r.note ?? null,
          createdAt: r.createdAt,
          fromState: await attendeeState(ctx, eventId, r.fromUserId),
        }
      }),
    )

    const outgoingRows = await ctx.db
      .query('socialMeetingRequests')
      .withIndex('by_eventId_and_fromUserId_and_status', (q) =>
        q
          .eq('eventId', eventId)
          .eq('fromUserId', userId)
          .eq('status', 'pending'),
      )
      .take(MAX_OUTGOING_PENDING * 2)
    const outgoing = await Promise.all(
      outgoingRows.map(async (r) => {
        const toGuest = await getGuestByUser(ctx, eventId, r.toUserId)
        const ahead = await ctx.db
          .query('socialMeetingRequests')
          .withIndex('by_eventId_and_toUserId_and_status', (q) =>
            q
              .eq('eventId', eventId)
              .eq('toUserId', r.toUserId)
              .eq('status', 'pending'),
          )
          .take(50)
        return {
          _id: r._id,
          to: await attendeeCard(ctx, r.toUserId, toGuest?.name),
          note: r.note ?? null,
          createdAt: r.createdAt,
          queuePosition:
            ahead.filter((a) => a.createdAt < r.createdAt).length + 1,
          toState: await attendeeState(ctx, eventId, r.toUserId),
        }
      }),
    )

    return { ...base, meeting, incoming, outgoing }
  },
})

/**
 * Approved attendees with an account, for other approved attendees. Everyone
 * at the event can see each other regardless of their wider visibility.
 */
export const listAttendees = query({
  args: { eventId: v.id('socialEvents') },
  returns: v.array(
    v.object({
      userId: v.string(),
      name: v.string(),
      initials: v.string(),
      headline: v.union(v.string(), v.null()),
      state: stateValidator,
      profileReady: v.boolean(),
    }),
  ),
  handler: async (ctx, { eventId }) => {
    const userId = await requireAuth(ctx)
    await requireApprovedAttendee(ctx, eventId, userId)
    const guests = await ctx.db
      .query('socialEventGuests')
      .withIndex('by_eventId_and_status', (q) =>
        q.eq('eventId', eventId).eq('status', 'approved'),
      )
      .take(500)
    const rows = await Promise.all(
      guests
        .filter((g) => g.userId && g.userId !== userId)
        .map(async (g) => {
          const otherId = g.userId as string
          const profile = await getProfileByUser(ctx, otherId)
          const name = profile?.name ?? g.name ?? 'Asistente'
          return {
            userId: otherId,
            name,
            initials: initialsOf(name),
            headline: profile?.headline ?? null,
            state: await attendeeState(ctx, eventId, otherId),
            profileReady: isProfileReadyForMatching(profile),
          }
        }),
    )
    return rows.sort((a, b) => a.name.localeCompare(b.name))
  },
})

export const getAttendeeProfile = query({
  args: { eventId: v.id('socialEvents'), userId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      userId: v.string(),
      initials: v.string(),
      state: stateValidator,
      profile: v.any(),
      suggestion: v.union(
        v.null(),
        v.object({ reason: v.string(), topics: v.array(v.string()) }),
      ),
      pendingRequestId: v.union(v.id('socialMeetingRequests'), v.null()),
      theyRequestedMe: v.union(v.id('socialMeetingRequests'), v.null()),
    }),
  ),
  handler: async (ctx, { eventId, userId: otherId }) => {
    const viewerId = await requireAuth(ctx)
    await requireApprovedAttendee(ctx, eventId, viewerId)
    const otherGuest = await getGuestByUser(ctx, eventId, otherId)
    if (!otherGuest || otherGuest.status !== 'approved') return null

    const profile = await getProfileByUser(ctx, otherId)
    const view = socialProfileView(profile, otherGuest.name)
    const suggestions = await ctx.db
      .query('socialSuggestions')
      .withIndex('by_eventId_and_userId_and_rank', (q) =>
        q.eq('eventId', eventId).eq('userId', viewerId),
      )
      .take(20)
    const suggestion = suggestions.find((s) => s.suggestedUserId === otherId)

    const mine = await ctx.db
      .query('socialMeetingRequests')
      .withIndex('by_eventId_and_fromUserId_and_status', (q) =>
        q
          .eq('eventId', eventId)
          .eq('fromUserId', viewerId)
          .eq('status', 'pending'),
      )
      .take(MAX_OUTGOING_PENDING * 2)
    const theirs = await ctx.db
      .query('socialMeetingRequests')
      .withIndex('by_eventId_and_fromUserId_and_status', (q) =>
        q
          .eq('eventId', eventId)
          .eq('fromUserId', otherId)
          .eq('status', 'pending'),
      )
      .take(MAX_OUTGOING_PENDING * 2)

    return {
      userId: otherId,
      initials: initialsOf(view.name),
      state: await attendeeState(ctx, eventId, otherId),
      profile: view,
      suggestion: suggestion
        ? { reason: suggestion.reason, topics: suggestion.topics }
        : null,
      pendingRequestId: mine.find((r) => r.toUserId === otherId)?._id ?? null,
      theyRequestedMe: theirs.find((r) => r.toUserId === viewerId)?._id ?? null,
    }
  },
})

// ── Mutations ───────────────────────────────────────────────────────────

export const setAvailability = mutation({
  args: {
    eventId: v.id('socialEvents'),
    availability: v.union(v.literal('available'), v.literal('busy')),
  },
  returns: v.null(),
  handler: async (ctx, { eventId, availability }) => {
    const userId = await requireAuth(ctx)
    await requireApprovedAttendee(ctx, eventId, userId)
    const row = await ctx.db
      .query('socialAttendeeStatus')
      .withIndex('by_eventId_and_userId', (q) =>
        q.eq('eventId', eventId).eq('userId', userId),
      )
      .first()
    if (row) {
      await ctx.db.patch('socialAttendeeStatus', row._id, {
        availability,
        updatedAt: Date.now(),
      })
    } else {
      await ctx.db.insert('socialAttendeeStatus', {
        eventId,
        userId,
        availability,
        updatedAt: Date.now(),
      })
    }
    return null
  },
})

async function startMeeting(
  ctx: MutationCtx,
  event: Doc<'socialEvents'>,
  userA: string,
  userB: string,
): Promise<Id<'socialMeetings'>> {
  const now = Date.now()
  const active = await ctx.db
    .query('socialMeetings')
    .withIndex('by_eventId_and_status', (q) =>
      q.eq('eventId', event._id).eq('status', 'active'),
    )
    .take(500)
  const taken = new Set(active.map((m) => m.spotId).filter(Boolean))
  const spots = await ctx.db
    .query('socialEventSpots')
    .withIndex('by_eventId_and_number', (q) => q.eq('eventId', event._id))
    .take(200)
  const free = spots.find((s) => !taken.has(s._id))

  const endsAt = now + event.meetingMinutes * 60 * 1000
  const meetingId = await ctx.db.insert('socialMeetings', {
    eventId: event._id,
    userA,
    userB,
    spotId: free?._id,
    startedAt: now,
    endsAt,
    status: 'active',
  })
  await ctx.scheduler.runAt(endsAt, internal.social.meetings.endIfDue, {
    meetingId,
  })
  return meetingId
}

/**
 * Ask someone to meet now. If they already asked you, this accepts their
 * request instead.
 */
export const requestMeeting = mutation({
  args: {
    eventId: v.id('socialEvents'),
    toUserId: v.string(),
    note: v.optional(v.string()),
  },
  returns: v.object({
    requestId: v.id('socialMeetingRequests'),
    meetingId: v.union(v.id('socialMeetings'), v.null()),
  }),
  handler: async (ctx, { eventId, toUserId, note }) => {
    const userId = await requireAuth(ctx)
    if (toUserId === userId) throw new Error("You can't meet yourself")
    const event = await ctx.db.get('socialEvents', eventId)
    if (!event) throw new Error('Event not found')
    if (!meetingsOpen(event, Date.now())) {
      throw new Error('1:1s are not open right now')
    }
    await requireApprovedAttendee(ctx, eventId, userId)
    await requireApprovedAttendee(ctx, eventId, toUserId)

    const cleanNote = note?.trim().slice(0, MAX_NOTE_LENGTH) || undefined
    const now = Date.now()

    // They already asked me: accept that instead of opening a second request.
    const theirs = await ctx.db
      .query('socialMeetingRequests')
      .withIndex('by_eventId_and_fromUserId_and_status', (q) =>
        q
          .eq('eventId', eventId)
          .eq('fromUserId', toUserId)
          .eq('status', 'pending'),
      )
      .take(MAX_OUTGOING_PENDING * 2)
    const reverse = theirs.find((r) => r.toUserId === userId)
    if (reverse) {
      if (await activeMeetingFor(ctx, eventId, userId)) {
        throw new Error('Finish your current meeting first')
      }
      if (await activeMeetingFor(ctx, eventId, toUserId)) {
        throw new Error('They are in a meeting right now')
      }
      const meetingId = await startMeeting(ctx, event, toUserId, userId)
      await ctx.db.patch('socialMeetingRequests', reverse._id, {
        status: 'accepted',
        meetingId,
        respondedAt: now,
      })
      return { requestId: reverse._id, meetingId }
    }

    if ((await availabilityFor(ctx, eventId, toUserId)) === 'busy') {
      throw new Error('They are not taking requests right now')
    }
    const mine = await ctx.db
      .query('socialMeetingRequests')
      .withIndex('by_eventId_and_fromUserId_and_status', (q) =>
        q
          .eq('eventId', eventId)
          .eq('fromUserId', userId)
          .eq('status', 'pending'),
      )
      .take(MAX_OUTGOING_PENDING * 2)
    const existing = mine.find((r) => r.toUserId === toUserId)
    if (existing) return { requestId: existing._id, meetingId: null }
    if (mine.length >= MAX_OUTGOING_PENDING) {
      throw new Error(
        `You can have at most ${MAX_OUTGOING_PENDING} requests waiting at once`,
      )
    }

    const requestId = await ctx.db.insert('socialMeetingRequests', {
      eventId,
      fromUserId: userId,
      toUserId,
      note: cleanNote,
      status: 'pending',
      createdAt: now,
    })
    return { requestId, meetingId: null }
  },
})

export const respondToRequest = mutation({
  args: {
    requestId: v.id('socialMeetingRequests'),
    accept: v.boolean(),
  },
  returns: v.union(v.id('socialMeetings'), v.null()),
  handler: async (ctx, { requestId, accept }) => {
    const userId = await requireAuth(ctx)
    const request = await ctx.db.get('socialMeetingRequests', requestId)
    if (!request || request.toUserId !== userId) {
      throw new Error('Request not found')
    }
    if (request.status !== 'pending') return request.meetingId ?? null
    const now = Date.now()

    if (!accept) {
      await ctx.db.patch('socialMeetingRequests', requestId, {
        status: 'declined',
        respondedAt: now,
      })
      return null
    }

    const event = await ctx.db.get('socialEvents', request.eventId)
    if (!event) throw new Error('Event not found')
    if (!meetingsOpen(event, now))
      throw new Error('1:1s are not open right now')
    if (await activeMeetingFor(ctx, request.eventId, userId)) {
      throw new Error('Finish your current meeting first')
    }
    if (await activeMeetingFor(ctx, request.eventId, request.fromUserId)) {
      throw new Error(
        'They are in a meeting right now. Try again when it ends.',
      )
    }
    const meetingId = await startMeeting(ctx, event, request.fromUserId, userId)
    await ctx.db.patch('socialMeetingRequests', requestId, {
      status: 'accepted',
      meetingId,
      respondedAt: now,
    })
    return meetingId
  },
})

export const cancelRequest = mutation({
  args: { requestId: v.id('socialMeetingRequests') },
  returns: v.null(),
  handler: async (ctx, { requestId }) => {
    const userId = await requireAuth(ctx)
    const request = await ctx.db.get('socialMeetingRequests', requestId)
    if (!request || request.fromUserId !== userId) {
      throw new Error('Request not found')
    }
    if (request.status === 'pending') {
      await ctx.db.patch('socialMeetingRequests', requestId, {
        status: 'cancelled',
        respondedAt: Date.now(),
      })
    }
    return null
  },
})

async function requireParticipant(
  ctx: MutationCtx,
  meetingId: Id<'socialMeetings'>,
): Promise<Doc<'socialMeetings'>> {
  const userId = await requireAuth(ctx)
  const meeting = await ctx.db.get('socialMeetings', meetingId)
  if (!meeting || (meeting.userA !== userId && meeting.userB !== userId)) {
    throw new Error('Meeting not found')
  }
  return meeting
}

export const extendMeeting = mutation({
  args: { meetingId: v.id('socialMeetings'), minutes: v.number() },
  returns: v.null(),
  handler: async (ctx, { meetingId, minutes }) => {
    const meeting = await requireParticipant(ctx, meetingId)
    if (meeting.status !== 'active') throw new Error('This meeting has ended')
    const add = Math.min(15, Math.max(1, Math.round(minutes)))
    const endsAt = meeting.endsAt + add * 60 * 1000
    await ctx.db.patch('socialMeetings', meetingId, { endsAt })
    await ctx.scheduler.runAt(endsAt, internal.social.meetings.endIfDue, {
      meetingId,
    })
    return null
  },
})

export const endMeeting = mutation({
  args: { meetingId: v.id('socialMeetings') },
  returns: v.null(),
  handler: async (ctx, { meetingId }) => {
    const meeting = await requireParticipant(ctx, meetingId)
    if (meeting.status === 'active') {
      await ctx.db.patch('socialMeetings', meetingId, {
        status: 'ended',
        endedAt: Date.now(),
      })
    }
    return null
  },
})

/** Scheduled at a meeting's end time; no-op if it was extended or ended. */
export const endIfDue = internalMutation({
  args: { meetingId: v.id('socialMeetings') },
  returns: v.null(),
  handler: async (ctx, { meetingId }) => {
    const meeting = await ctx.db.get('socialMeetings', meetingId)
    if (!meeting || meeting.status !== 'active') return null
    const now = Date.now()
    if (meeting.endsAt > now + 1000) return null
    await ctx.db.patch('socialMeetings', meetingId, {
      status: 'ended',
      endedAt: now,
    })
    return null
  },
})

// ── Admin view of the live event ────────────────────────────────────────

export const getLiveOverview = query({
  args: { eventId: v.id('socialEvents') },
  returns: v.object({
    activeMeetings: v.number(),
    pendingRequests: v.number(),
    meetingsSoFar: v.number(),
  }),
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get('socialEvents', eventId)
    if (!event) throw new Error('Event not found')
    const userId = await requireAuth(ctx)
    const membership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user_and_org', (q) =>
        q.eq('userId', userId).eq('orgId', event.orgId),
      )
      .first()
    if (membership?.role !== 'admin') throw new Error('Admin access required')

    const active = await ctx.db
      .query('socialMeetings')
      .withIndex('by_eventId_and_status', (q) =>
        q.eq('eventId', eventId).eq('status', 'active'),
      )
      .take(500)
    const ended = await ctx.db
      .query('socialMeetings')
      .withIndex('by_eventId_and_status', (q) =>
        q.eq('eventId', eventId).eq('status', 'ended'),
      )
      .take(2000)
    const guests = await ctx.db
      .query('socialEventGuests')
      .withIndex('by_eventId_and_status', (q) =>
        q.eq('eventId', eventId).eq('status', 'approved'),
      )
      .take(500)
    let pendingRequests = 0
    for (const g of guests) {
      if (!g.userId) continue
      const rows = await ctx.db
        .query('socialMeetingRequests')
        .withIndex('by_eventId_and_toUserId_and_status', (q) =>
          q
            .eq('eventId', eventId)
            .eq('toUserId', g.userId as string)
            .eq('status', 'pending'),
        )
        .take(50)
      pendingRequests += rows.length
    }
    return {
      activeMeetings: active.length,
      pendingRequests,
      meetingsSoFar: active.length + ended.length,
    }
  },
})
