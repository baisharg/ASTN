import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'
import { acceptProposal } from './bookings'
import { bookingOpen, bookingSlots, placeForBooking } from './constants'
import {
  addToAllowlist,
  getGuestByUser,
  meetingsWindow,
  normalizeEmail,
  placesHeldAround,
} from './lib'
import type { Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

/**
 * Demo data for trying the event flow on a dev deployment. Internal only:
 * run from the dashboard or `bunx convex run social/seed:<fn> '<json>'`.
 * All people here are fictional; their accounts can't sign in.
 */

const DEMO_SLUG = 'social-demo'
const SEED_PREFIX = 'seed|social|'

const PEOPLE: Array<{
  name: string
  headline: string
  seeking: string
  canHelpWith: string
  interests: Array<string>
  status?: 'pending_approval'
}> = [
  {
    name: 'Sofía Ramírez',
    headline: 'Interpretability researcher (independent)',
    seeking:
      'People who want to start interpretability projects; members for a reading group',
    canHelpWith:
      'Getting started in interpretability, MATS applications, research workflow',
    interests: ['Interpretability', 'Evals'],
  },
  {
    name: 'Tomás Gutiérrez',
    headline: 'AI governance analyst',
    seeking: 'Engineers who can explain how frontier models are evaluated',
    canHelpWith: 'Policy landscape in Latin America, writing policy briefs',
    interests: ['AI governance', 'Compute governance'],
  },
  {
    name: 'Camila Ortega',
    headline: 'Founder, evals tooling startup',
    seeking: 'ML engineers to hire; early users for an evals platform',
    canHelpWith: 'Founding a startup, evals infrastructure, fundraising',
    interests: ['Evals', 'Startups'],
  },
  {
    name: 'Lucía Fernández',
    headline: 'BlueDot course participant, software engineer',
    seeking: 'Advice on applying to AI safety fellowships',
    canHelpWith: 'Backend engineering, TypeScript',
    interests: ['Field-building', 'Careers'],
  },
  {
    name: 'Martín Acosta',
    headline: 'Software engineer at a fintech',
    seeking:
      'Understanding which technical AI safety work fits a software engineer',
    canHelpWith: 'Distributed systems, security engineering',
    interests: ['Security', 'Control'],
  },
  {
    name: 'Julieta Paz',
    headline: 'Philosophy PhD student',
    seeking: 'Collaborators on AI welfare and moral status questions',
    canHelpWith: 'Philosophy of mind, academic writing',
    interests: ['AI welfare', 'Ethics'],
  },
  {
    name: 'Diego Herrera',
    headline: 'Product manager',
    seeking: 'Ways PMs contribute to AI safety organizations',
    canHelpWith: 'Product strategy, running user research',
    interests: ['Operations', 'Field-building'],
  },
  {
    name: 'Valentina Sosa',
    headline: 'ML engineer, recommender systems',
    seeking: 'Moving into interpretability research',
    canHelpWith: 'Production ML, evals infrastructure, hiring for ML roles',
    interests: ['Interpretability'],
  },
  {
    name: 'Nicolás Benítez',
    headline: 'Economics researcher',
    seeking: 'People working on AI and labor market forecasts',
    canHelpWith: 'Econometrics, forecasting',
    interests: ['Forecasting', 'Economics of AI'],
  },
  {
    name: 'Agustina Molina',
    headline: 'Community organizer, university AI safety group',
    seeking: 'Speakers and mentors for student groups',
    canHelpWith: 'Running reading groups and events',
    interests: ['Field-building', 'Education'],
  },
  {
    name: 'Ana Quiroga',
    headline: 'Data scientist',
    seeking: 'A first project in AI safety',
    canHelpWith: 'Data analysis, Python',
    interests: ['Evals'],
    status: 'pending_approval',
  },
  {
    name: 'Bruno Méndez',
    headline: 'Law student',
    seeking: 'Learning about AI regulation careers',
    canHelpWith: 'Legal research',
    interests: ['AI governance'],
    status: 'pending_approval',
  },
]

const SPOTS = [
  { number: 1, label: 'Ventana', x: 0.15, y: 0.25 },
  { number: 2, label: 'Ventana', x: 0.37, y: 0.25 },
  { number: 3, label: 'Ventana', x: 0.59, y: 0.25 },
  { number: 4, label: 'Ventana', x: 0.8, y: 0.25 },
  { number: 5, label: 'Centro', x: 0.15, y: 0.58 },
  { number: 6, label: 'Centro', x: 0.37, y: 0.58 },
  { number: 7, label: 'Centro', x: 0.59, y: 0.58 },
  { number: 8, label: 'Cerca de la barra', x: 0.55, y: 0.85 },
]

async function findOrg(ctx: MutationCtx, orgSlug: string) {
  const org = await ctx.db
    .query('organizations')
    .withIndex('by_slug', (q) => q.eq('slug', orgSlug))
    .first()
  if (!org) throw new Error(`No org with slug ${orgSlug}`)
  return org
}

async function findDemoEvent(ctx: MutationCtx, orgId: Id<'organizations'>) {
  return await ctx.db
    .query('socialEvents')
    .withIndex('by_org_and_slug', (q) =>
      q.eq('orgId', orgId).eq('slug', DEMO_SLUG),
    )
    .first()
}

export const seedDemoEvent = internalMutation({
  args: {
    orgSlug: v.string(),
    // Real emails to pre-approve, e.g. your own, to test the one-tap path.
    allowlistEmails: v.optional(v.array(v.string())),
  },
  returns: v.object({ eventId: v.id('socialEvents'), url: v.string() }),
  handler: async (ctx, { orgSlug, allowlistEmails }) => {
    const org = await findOrg(ctx, orgSlug)
    const now = Date.now()
    let event = await findDemoEvent(ctx, org._id)
    if (!event) {
      const eventId = await ctx.db.insert('socialEvents', {
        orgId: org._id,
        slug: DEMO_SLUG,
        title: 'BAISH Social (demo)',
        description:
          'Evento de prueba para probar el registro, los perfiles y los 1:1. Los asistentes son ficticios.',
        startAt: now + 2 * 3600 * 1000,
        endAt: now + 5 * 3600 * 1000,
        timezone: 'America/Argentina/Buenos_Aires',
        venueName: '[LUGAR]',
        status: 'published',
        // Open now so the demo can be tried right away.
        meetingsOpenAt: now,
        meetingsCloseAt: now + 8 * 3600 * 1000,
        meetingMinutes: 20,
        matchingPrompt:
          'Conectar a personas nuevas en AI safety con quienes ya trabajan en el área. Priorizá esos cruces por sobre juntar gente con perfiles parecidos, y sugerí próximos pasos concretos.',
        createdBy: 'seed',
        createdAt: now,
        updatedAt: now,
      })
      for (const spot of SPOTS) {
        await ctx.db.insert('socialEventSpots', { eventId, ...spot })
      }
      event = (await ctx.db.get('socialEvents', eventId))!
    }

    for (const [i, person] of PEOPLE.entries()) {
      const userId = `${SEED_PREFIX}${i + 1}`
      const email = `seed-social-${i + 1}@example.com`
      const existingProfile = await ctx.db
        .query('profiles')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .first()
      if (!existingProfile) {
        await ctx.db.insert('profiles', {
          userId,
          email,
          name: person.name,
          headline: person.headline,
          location: 'Buenos Aires',
          seeking: person.seeking,
          canHelpWith: person.canHelpWith,
          aiSafetyInterests: person.interests,
          preferredLanguage: 'es',
          createdAt: now,
          updatedAt: now,
        })
      }
      if (!(await getGuestByUser(ctx, event._id, userId))) {
        const status = person.status ?? 'approved'
        await ctx.db.insert('socialEventGuests', {
          eventId: event._id,
          orgId: org._id,
          email,
          name: person.name,
          userId,
          status,
          source: i % 3 === 0 ? 'luma' : 'app',
          lumaSync: 'not_linked',
          registeredAt: now,
          updatedAt: now,
        })
        if (status === 'approved') {
          await addToAllowlist(ctx, {
            orgId: org._id,
            email,
            name: person.name,
            source: 'manual',
          })
          // Most demo attendees are at the event, so they can be asked for
          // a 1:1; every fourth one hasn't arrived yet.
          if (i % 4 !== 3) {
            await ctx.db.insert('socialAttendeeStatus', {
              eventId: event._id,
              userId,
              availability: 'available',
              arrivedAt: now,
              updatedAt: now,
            })
          }
        }
      }
    }

    for (const email of allowlistEmails ?? []) {
      await addToAllowlist(ctx, {
        orgId: org._id,
        email: normalizeEmail(email),
        source: 'manual',
      })
    }

    return {
      eventId: event._id,
      url: `/org/${orgSlug}/e/${DEMO_SLUG}`,
    }
  },
})

/**
 * Have a few demo attendees ask a real account for a 1:1, to try the
 * requests and meeting screens. The account must have registered first.
 */
export const seedIncomingRequests = internalMutation({
  args: { orgSlug: v.string(), email: v.string() },
  returns: v.number(),
  handler: async (ctx, { orgSlug, email }) => {
    const org = await findOrg(ctx, orgSlug)
    const event = await findDemoEvent(ctx, org._id)
    if (!event) throw new Error('Run seedDemoEvent first')
    const guest = await ctx.db
      .query('socialEventGuests')
      .withIndex('by_eventId_and_email', (q) =>
        q.eq('eventId', event._id).eq('email', normalizeEmail(email)),
      )
      .first()
    if (!guest?.userId || guest.status !== 'approved') {
      throw new Error('Register for the demo event with that account first')
    }
    const notes = [
      '¡Hola! Me encantaría saber cómo llegaste a trabajar en esto.',
      '¿Me contás qué estás buscando esta noche?',
    ]
    const now = Date.now()
    for (const [i, note] of notes.entries()) {
      await ctx.db.insert('socialMeetingRequests', {
        eventId: event._id,
        fromUserId: `${SEED_PREFIX}${i + 2}`,
        toUserId: guest.userId,
        note,
        status: 'pending',
        createdAt: now - (notes.length - i) * 60_000,
      })
    }
    return notes.length
  },
})

/** The demo event with booking on, and the real account's user id. */
async function demoBookingContext(
  ctx: MutationCtx,
  orgSlug: string,
  email: string,
) {
  const org = await findOrg(ctx, orgSlug)
  const event = await findDemoEvent(ctx, org._id)
  if (!event) throw new Error('Run seedDemoEvent first')
  if (!bookingOpen(event)) {
    throw new Error(
      'Switch on "Reservar 1:1 con anticipación" in the demo event\'s Configuración first',
    )
  }
  const guest = await ctx.db
    .query('socialEventGuests')
    .withIndex('by_eventId_and_email', (q) =>
      q.eq('eventId', event._id).eq('email', normalizeEmail(email)),
    )
    .first()
  if (!guest?.userId || guest.status !== 'approved') {
    throw new Error('Register for the demo event with that account first')
  }
  return { event, userId: guest.userId }
}

/**
 * Set up booked 1:1s for a real account at the demo event, to try the
 * agenda and what happens when a slot starts. The demo event's slots are
 * moved so one starts `startsInMinutes` from now (default 2), then:
 * - that slot: a 1:1 with Tomás, who is already there, so "Ya estoy" starts
 *   the meeting;
 * - the next slot: a 1:1 with Camila, who never comes, to try releasing
 *   it after the wait;
 * - the slot after: a proposal from Martín waiting for an answer.
 * The account must have registered, and booking must be on.
 */
export const seedBookings = internalMutation({
  args: {
    orgSlug: v.string(),
    email: v.string(),
    startsInMinutes: v.optional(v.number()),
  },
  returns: v.object({
    firstSlotStart: v.number(),
    booked: v.number(),
    proposed: v.number(),
  }),
  handler: async (ctx, { orgSlug, email, startsInMinutes }) => {
    const { event, userId } = await demoBookingContext(ctx, orgSlug, email)
    const now = Date.now()
    const length = event.meetingMinutes * 60 * 1000
    const firstSlotStart = now + (startsInMinutes ?? 2) * 60 * 1000
    // Keep the window open now: move its start back by whole slots.
    const slotsBefore = Math.max(
      0,
      Math.ceil((firstSlotStart - meetingsWindow(event).openAt) / length),
    )
    const meetingsOpenAt = firstSlotStart - slotsBefore * length
    await ctx.db.patch('socialEvents', event._id, {
      meetingsOpenAt,
      updatedAt: now,
    })
    const slots = bookingSlots(
      { openAt: meetingsOpenAt, closeAt: meetingsWindow(event).closeAt },
      event.meetingMinutes,
    ).filter((slot) => slot.start >= firstSlotStart)
    if (slots.length < 3) throw new Error('The demo event is about to close')

    const spots = await ctx.db
      .query('socialEventSpots')
      .withIndex('by_eventId_and_number', (q) => q.eq('eventId', event._id))
      .take(200)

    let booked = 0
    const plans = [
      { slot: slots[0], seed: 2, there: true },
      { slot: slots[1], seed: 3, there: false },
    ]
    for (const { slot, seed, there } of plans) {
      const place = placeForBooking(
        spots.map((spot) => spot.number),
        slot,
        await placesHeldAround(ctx, event._id, spots, slot.start, slot.end),
      )
      if (!place.bookable) continue
      await ctx.db.insert('socialBookings', {
        eventId: event._id,
        fromUserId: `${SEED_PREFIX}${seed}`,
        toUserId: userId,
        slotStart: slot.start,
        slotEnd: slot.end,
        status: 'booked',
        spotNumber: place.spotNumber ?? undefined,
        createdAt: now,
        respondedAt: now,
        fromReadyAt: there ? slot.start : undefined,
      })
      booked += 1
    }
    await ctx.db.insert('socialBookings', {
      eventId: event._id,
      fromUserId: `${SEED_PREFIX}5`,
      toUserId: userId,
      slotStart: slots[2].start,
      slotEnd: slots[2].end,
      note: '¿Te parece si hablamos de cómo empezar en evals?',
      status: 'proposed',
      createdAt: now,
    })
    return { firstSlotStart, booked, proposed: 1 }
  },
})

/**
 * Have the demo attendees accept every proposal a real account sent them
 * that is still waiting. Returns how many became bookings; one that can't
 * (the time is taken or full) is left as it is.
 */
export const seedAcceptProposals = internalMutation({
  args: { orgSlug: v.string(), email: v.string() },
  returns: v.number(),
  handler: async (ctx, { orgSlug, email }) => {
    const { event, userId } = await demoBookingContext(ctx, orgSlug, email)
    const sent = await ctx.db
      .query('socialBookings')
      .withIndex('by_eventId_and_fromUserId_and_status_and_slotStart', (q) =>
        q
          .eq('eventId', event._id)
          .eq('fromUserId', userId)
          .eq('status', 'proposed'),
      )
      .take(50)
    let accepted = 0
    for (const row of sent) {
      if (!row.toUserId.startsWith(SEED_PREFIX)) continue
      try {
        await acceptProposal(ctx, row)
        accepted += 1
      } catch (error) {
        console.warn('Proposal not accepted', row._id, error)
      }
    }
    return accepted
  },
})

/** Make an existing account an admin of the org (dev convenience). */
export const grantOrgAdminByEmail = internalMutation({
  args: { orgSlug: v.string(), email: v.string() },
  returns: v.string(),
  handler: async (ctx, { orgSlug, email }) => {
    const org = await findOrg(ctx, orgSlug)
    const target = normalizeEmail(email)
    const profiles = await ctx.db.query('profiles').take(5000)
    const profile = profiles.find(
      (p) => p.email && normalizeEmail(p.email) === target,
    )
    if (!profile) {
      throw new Error('No profile with that email; sign in to the app first')
    }
    const membership = await ctx.db
      .query('orgMemberships')
      .withIndex('by_user_and_org', (q) =>
        q.eq('userId', profile.userId).eq('orgId', org._id),
      )
      .first()
    if (membership) {
      await ctx.db.patch('orgMemberships', membership._id, { role: 'admin' })
    } else {
      await ctx.db.insert('orgMemberships', {
        userId: profile.userId,
        orgId: org._id,
        role: 'admin',
        directoryVisibility: 'hidden',
        joinedAt: Date.now(),
      })
    }
    return profile.userId
  },
})

/** Remove the demo event and everything the seed created for it. */
export const clearDemoEvent = internalMutation({
  args: { orgSlug: v.string() },
  returns: v.null(),
  handler: async (ctx, { orgSlug }) => {
    const org = await findOrg(ctx, orgSlug)
    const event = await findDemoEvent(ctx, org._id)
    if (event) {
      const byEvent = [
        'socialEventGuests',
        'socialEventSpots',
        'socialAttendeeStatus',
        'socialMeetingRequests',
        'socialMeetings',
        'socialMeetingNotes',
        'socialBookings',
        'socialSuggestions',
        'socialSuggestionCandidates',
        'socialSuggestionRuns',
      ] as const
      for (const table of byEvent) {
        const rows = await ctx.db
          .query(table)
          .filter((q) => q.eq(q.field('eventId'), event._id))
          .take(2000)
        for (const row of rows) await ctx.db.delete(table, row._id)
      }
      await ctx.db.delete('socialEvents', event._id)
    }
    for (let i = 1; i <= PEOPLE.length; i++) {
      const profile = await ctx.db
        .query('profiles')
        .withIndex('by_user', (q) => q.eq('userId', `${SEED_PREFIX}${i}`))
        .first()
      if (profile) await ctx.db.delete('profiles', profile._id)
      const entry = await ctx.db
        .query('orgAllowlist')
        .withIndex('by_orgId_and_email', (q) =>
          q.eq('orgId', org._id).eq('email', `seed-social-${i}@example.com`),
        )
        .first()
      if (entry) await ctx.db.delete('orgAllowlist', entry._id)
    }
    return null
  },
})
