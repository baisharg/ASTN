import { ConvexError, v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { setAttendanceStatus } from '../luma/shared'
import { getProfileByUser, requireEventAdmin } from './lib'
import { guestStatusValidator } from './validators'
import type { AttendanceStatus } from '../luma/shared'
import type { GuestStatus } from './lib'

/**
 * Door check-in for events managed in ASTN. Luma's API can't check guests
 * in, so these check-ins live only in ASTN (socialEventGuests.checkedInAt);
 * Luma's own app and guest list won't show them. Guests are found by name,
 * email, or the QR code on their Luma ticket.
 */

const checkInGuestValidator = v.object({
  _id: v.id('socialEventGuests'),
  name: v.string(),
  email: v.string(),
  status: guestStatusValidator,
  checkedInAt: v.union(v.number(), v.null()),
  checkInSource: v.union(v.literal('luma'), v.literal('astn'), v.null()),
  // The Luma ticket QR payload, matched on the device when scanning.
  checkInCode: v.union(v.string(), v.null()),
})

export const listForCheckIn = query({
  args: { eventId: v.id('socialEvents') },
  returns: v.object({
    title: v.string(),
    startAt: v.number(),
    timezone: v.string(),
    lumaLinked: v.boolean(),
    lumaLastSyncedAt: v.union(v.number(), v.null()),
    guests: v.array(checkInGuestValidator),
  }),
  handler: async (ctx, { eventId }) => {
    const { event } = await requireEventAdmin(ctx, eventId)
    const guests = await ctx.db
      .query('socialEventGuests')
      .withIndex('by_eventId_and_email', (q) => q.eq('eventId', eventId))
      .take(3000)
    const rows = await Promise.all(
      guests.map(async (g) => {
        const profile = g.userId ? await getProfileByUser(ctx, g.userId) : null
        return {
          _id: g._id,
          name: profile?.name ?? g.name ?? g.email,
          email: g.email,
          status: g.status,
          checkedInAt: g.checkedInAt ?? null,
          checkInSource:
            g.checkedInAt === undefined ? null : (g.checkInSource ?? 'luma'),
          checkInCode: g.lumaCheckInCode ?? null,
        }
      }),
    )
    return {
      title: event.title,
      startAt: event.startAt,
      timezone: event.timezone,
      lumaLinked: !!event.lumaEventId,
      lumaLastSyncedAt: event.lumaLastSyncedAt ?? null,
      guests: rows,
    }
  },
})

function attendanceFor(status: GuestStatus): AttendanceStatus | null {
  switch (status) {
    case 'approved':
      return 'approved'
    case 'pending_approval':
      return 'pending'
    case 'declined':
      return 'declined'
    case 'waitlist':
      return 'waitlist'
    default:
      return null
  }
}

/** Mark a guest as arrived, or undo it. */
export const setCheckedIn = mutation({
  args: { guestId: v.id('socialEventGuests'), checkedIn: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { guestId, checkedIn }) => {
    const guest = await ctx.db.get('socialEventGuests', guestId)
    if (!guest) throw new ConvexError('Guest not found')
    const { event, userId } = await requireEventAdmin(ctx, guest.eventId)
    if (checkedIn === (guest.checkedInAt !== undefined)) return null
    // A check-in made in Luma's app can't be undone from here: Luma would
    // report it again on the next sync.
    if (!checkedIn && guest.checkInSource !== 'astn') {
      throw new ConvexError(
        'This check-in was made in Luma; undo it in Luma’s app',
      )
    }
    await ctx.db.patch('socialEventGuests', guestId, {
      checkedInAt: checkedIn ? Date.now() : undefined,
      checkInSource: checkedIn ? 'astn' : undefined,
      checkedInBy: checkedIn ? userId : undefined,
      updatedAt: Date.now(),
    })
    // Keep the person's CRM history in step (Luma won't report this one).
    if (event.lumaEventId) {
      const status = checkedIn ? 'checked_in' : attendanceFor(guest.status)
      if (status) {
        await setAttendanceStatus(ctx, {
          orgId: event.orgId,
          lumaEventId: event.lumaEventId,
          email: guest.email,
          status,
        })
      }
    }
    return null
  },
})
