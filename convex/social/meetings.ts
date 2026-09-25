import { ConvexError, v } from 'convex/values'
import { internal } from '../_generated/api'
import { internalMutation, mutation, query } from '../_generated/server'
import { getUserId, requireAuth } from '../lib/auth'
import { MAX_NOTE_LENGTH, MAX_OUTGOING_PENDING } from './constants'
import {
  approvedGuests,
  attendeeCard,
  canViewSocialProfile,
  findSuggestion,
  getGuestByUser,
  getProfileByUser,
  initialsOf,
  isProfileReadyForMatching,
  meetingsWindow,
  requireEventAdmin,
  socialProfileView,
} from './lib'
import { availabilityValidator } from './validators'
import type { MeetingErrorCode } from './constants'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

type AttendeeState = 'available' | 'in_meeting' | 'busy'

/** Refuse a 1:1 action with a code the pages translate. */
function refuse(code: MeetingErrorCode, message: string): never {
  throw new ConvexError({ code, message })
}

async function requireApprovedAttendee(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
  userId: string,
): Promise<Doc<'socialEventGuests'>> {
  const guest = await getGuestByUser(ctx, eventId, userId)
  if (!guest || guest.status !== 'approved') {
    refuse('not_attendee', 'Only confirmed attendees can do this')
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

async function statusRow(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
  userId: string,
): Promise<Doc<'socialAttendeeStatus'> | null> {
  return await ctx.db
    .query('socialAttendeeStatus')
    .withIndex('by_eventId_and_userId', (q) =>
      q.eq('eventId', eventId).eq('userId', userId),
    )
    .first()
}

async function availabilityFor(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
  userId: string,
): Promise<'available' | 'busy'> {
  return (await statusRow(ctx, eventId, userId))?.availability ?? 'available'
}

async function attendeeState(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
  userId: string,
): Promise<AttendeeState> {
  if (await activeMeetingFor(ctx, eventId, userId)) return 'in_meeting'
  return await availabilityFor(ctx, eventId, userId)
}

async function pendingRequestsFrom(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<'socialEvents'>,
  userId: string,
): Promise<Array<Doc<'socialMeetingRequests'>>> {
  return await ctx.db
    .query('socialMeetingRequests')
    .withIndex('by_eventId_and_fromUserId_and_status', (q) =>
      q.eq('eventId', eventId).eq('fromUserId', userId).eq('status', 'pending'),
    )
    .take(MAX_OUTGOING_PENDING * 2)
}

function requireMeetingsOpen(event: Doc<'socialEvents'>): void {
  const { openAt, closeAt } = meetingsWindow(event)
  const now = Date.now()
  if (event.status !== 'published' || now < openAt || now > closeAt) {
    refuse('closed', '1:1s are not open right now')
  }
}

/** Topics for a meeting: from my suggestion for them, else theirs for me. */
async function meetingTopics(
  ctx: QueryCtx,
  eventId: Id<'socialEvents'>,
  userId: string,
  partnerId: string,
): Promise<Array<string>> {
  const mine = await findSuggestion(ctx, eventId, userId, partnerId)
  if (mine) return mine.topics
  const theirs = await findSuggestion(ctx, eventId, partnerId, userId)
  return theirs?.topics ?? []
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
 * meeting, and incoming and outgoing requests. Whether 1:1s are open right
 * now is left to the client, which has a clock; the query only returns the
 * window, so it doesn't re-run as time passes.
 */
export const getLiveState = query({
  args: { eventId: v.id('socialEvents') },
  returns: v.union(
    v.null(),
    v.object({
      isAttendee: v.boolean(),
      profileReady: v.boolean(),
      meetingsOpenAt: v.number(),
      meetingsCloseAt: v.number(),
      availability: availabilityValidator,
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
  handler: async (ctx, { eventId }) => {
    const userId = await getUserId(ctx)
    if (!userId) return null
    const event = await ctx.db.get('socialEvents', eventId)
    if (!event) return null
    const [guest, profile, availability] = await Promise.all([
      getGuestByUser(ctx, eventId, userId),
      getProfileByUser(ctx, userId),
      availabilityFor(ctx, eventId, userId),
    ])
    const window = meetingsWindow(event)
    const base = {
      isAttendee: guest?.status === 'approved',
      profileReady: isProfileReadyForMatching(profile),
      meetingsOpenAt: window.openAt,
      meetingsCloseAt: window.closeAt,
      availability,
    }
    if (!base.isAttendee) {
      return { ...base, meeting: null, incoming: [], outgoing: [] }
    }

    const [active, incomingRows, outgoingRows] = await Promise.all([
      activeMeetingFor(ctx, eventId, userId),
      ctx.db
        .query('socialMeetingRequests')
        .withIndex('by_eventId_and_toUserId_and_status', (q) =>
          q
            .eq('eventId', eventId)
            .eq('toUserId', userId)
            .eq('status', 'pending'),
        )
        .take(50),
      pendingRequestsFrom(ctx, eventId, userId),
    ])

    let meeting = null
    if (active) {
      const partnerId = active.userA === userId ? active.userB : active.userA
      const spot = active.spotId
        ? await ctx.db.get('socialEventSpots', active.spotId)
        : null
      meeting = {
        _id: active._id,
        partner: await attendeeCard(ctx, eventId, partnerId),
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
        topics: await meetingTopics(ctx, eventId, userId, partnerId),
      }
    }

    const incoming = await Promise.all(
      incomingRows.map(async (r) => ({
        _id: r._id,
        from: await attendeeCard(ctx, eventId, r.fromUserId),
        note: r.note ?? null,
        createdAt: r.createdAt,
        fromState: await attendeeState(ctx, eventId, r.fromUserId),
      })),
    )

    const outgoing = await Promise.all(
      outgoingRows.map(async (r) => {
        // Only earlier requests, so later ones don't re-run this query.
        const ahead = await ctx.db
          .query('socialMeetingRequests')
          .withIndex('by_eventId_and_toUserId_and_status', (q) =>
            q
              .eq('eventId', eventId)
              .eq('toUserId', r.toUserId)
              .eq('status', 'pending')
              .lt('_creationTime', r._creationTime),
          )
          .take(50)
        return {
          _id: r._id,
          to: await attendeeCard(ctx, eventId, r.toUserId),
          note: r.note ?? null,
          createdAt: r.createdAt,
          queuePosition: ahead.length + 1,
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
    }),
  ),
  handler: async (ctx, { eventId }) => {
    const userId = await requireAuth(ctx)
    await requireApprovedAttendee(ctx, eventId, userId)
    const guests = await approvedGuests(ctx, eventId)
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
      viewerIsAttendee: v.boolean(),
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
    const otherGuest = await getGuestByUser(ctx, eventId, otherId)
    if (!otherGuest || otherGuest.status !== 'approved') return null
    const profile = await getProfileByUser(ctx, otherId)

    // Attendees see each other; others only if the owner widened visibility.
    const viewerGuest = await getGuestByUser(ctx, eventId, viewerId)
    const viewerIsAttendee = viewerGuest?.status === 'approved'
    if (
      !viewerIsAttendee &&
      !(await canViewSocialProfile(ctx, viewerId, otherId, profile))
    ) {
      return null
    }
    const view = socialProfileView(profile, otherGuest.name)
    const [suggestion, mine, theirs, state] = await Promise.all([
      findSuggestion(ctx, eventId, viewerId, otherId),
      pendingRequestsFrom(ctx, eventId, viewerId),
      pendingRequestsFrom(ctx, eventId, otherId),
      attendeeState(ctx, eventId, otherId),
    ])

    return {
      viewerIsAttendee,
      initials: initialsOf(view.name),
      state,
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
    availability: availabilityValidator,
  },
  returns: v.null(),
  handler: async (ctx, { eventId, availability }) => {
    const userId = await requireAuth(ctx)
    await requireApprovedAttendee(ctx, eventId, userId)
    const row = await statusRow(ctx, eventId, userId)
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

/** Accept a pending request: both must be free; starts the meeting. */
async function acceptRequest(
  ctx: MutationCtx,
  event: Doc<'socialEvents'>,
  request: Doc<'socialMeetingRequests'>,
): Promise<Id<'socialMeetings'>> {
  requireMeetingsOpen(event)
  if (await activeMeetingFor(ctx, event._id, request.toUserId)) {
    refuse('self_in_meeting', 'Finish your current meeting first')
  }
  if (await activeMeetingFor(ctx, event._id, request.fromUserId)) {
    refuse('they_in_meeting', 'They are in a meeting right now')
  }
  const meetingId = await startMeeting(
    ctx,
    event,
    request.fromUserId,
    request.toUserId,
  )
  await ctx.db.patch('socialMeetingRequests', request._id, {
    status: 'accepted',
    meetingId,
    respondedAt: Date.now(),
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
    if (toUserId === userId) refuse('self', "You can't meet yourself")
    const event = await ctx.db.get('socialEvents', eventId)
    if (!event) refuse('not_found', 'Event not found')
    requireMeetingsOpen(event)
    await requireApprovedAttendee(ctx, eventId, userId)
    await requireApprovedAttendee(ctx, eventId, toUserId)

    // They already asked me: accept that instead of opening a second request.
    const theirs = await pendingRequestsFrom(ctx, eventId, toUserId)
    const reverse = theirs.find((r) => r.toUserId === userId)
    if (reverse) {
      const meetingId = await acceptRequest(ctx, event, reverse)
      return { requestId: reverse._id, meetingId }
    }

    if ((await availabilityFor(ctx, eventId, toUserId)) === 'busy') {
      refuse('busy', 'They are not taking requests right now')
    }
    const mine = await pendingRequestsFrom(ctx, eventId, userId)
    const existing = mine.find((r) => r.toUserId === toUserId)
    if (existing) return { requestId: existing._id, meetingId: null }
    if (mine.length >= MAX_OUTGOING_PENDING) {
      refuse(
        'limit',
        `You can have at most ${MAX_OUTGOING_PENDING} requests waiting at once`,
      )
    }

    const requestId = await ctx.db.insert('socialMeetingRequests', {
      eventId,
      fromUserId: userId,
      toUserId,
      note: note?.trim().slice(0, MAX_NOTE_LENGTH) || undefined,
      status: 'pending',
      createdAt: Date.now(),
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
      refuse('not_found', 'Request not found')
    }
    if (request.status !== 'pending') return request.meetingId ?? null

    if (!accept) {
      await ctx.db.patch('socialMeetingRequests', requestId, {
        status: 'declined',
        respondedAt: Date.now(),
      })
      return null
    }
    const event = await ctx.db.get('socialEvents', request.eventId)
    if (!event) refuse('not_found', 'Event not found')
    return await acceptRequest(ctx, event, request)
  },
})

export const cancelRequest = mutation({
  args: { requestId: v.id('socialMeetingRequests') },
  returns: v.null(),
  handler: async (ctx, { requestId }) => {
    const userId = await requireAuth(ctx)
    const request = await ctx.db.get('socialMeetingRequests', requestId)
    if (!request || request.fromUserId !== userId) {
      refuse('not_found', 'Request not found')
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
    refuse('not_found', 'Meeting not found')
  }
  return meeting
}

export const extendMeeting = mutation({
  args: { meetingId: v.id('socialMeetings'), minutes: v.number() },
  returns: v.null(),
  handler: async (ctx, { meetingId, minutes }) => {
    const meeting = await requireParticipant(ctx, meetingId)
    if (meeting.status !== 'active') refuse('ended', 'This meeting has ended')
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
    await requireEventAdmin(ctx, eventId)
    const countMeetings = async (status: Doc<'socialMeetings'>['status']) =>
      (
        await ctx.db
          .query('socialMeetings')
          .withIndex('by_eventId_and_status', (q) =>
            q.eq('eventId', eventId).eq('status', status),
          )
          .take(2000)
      ).length
    const [activeMeetings, endedMeetings, pending] = await Promise.all([
      countMeetings('active'),
      countMeetings('ended'),
      ctx.db
        .query('socialMeetingRequests')
        .withIndex('by_eventId_and_status', (q) =>
          q.eq('eventId', eventId).eq('status', 'pending'),
        )
        .take(2000),
    ])
    return {
      activeMeetings,
      pendingRequests: pending.length,
      meetingsSoFar: activeMeetings + endedMeetings,
    }
  },
})
