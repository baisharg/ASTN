import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'
import { FROM_ADDRESS, resend } from '../emails/send'
import { requestNeedsEmail } from './constants'
import { attendeeCard, getGuestByUser, getProfileByUser } from './lib'

/**
 * The email that tells someone a 1:1 request is waiting for them.
 *
 * The event pages alert with a toast, a vibration and the tab title, which
 * only reach a person whose page is open. requestMeeting books sendIfUnseen
 * for a moment after each request; if no page of the person asked has shown
 * it by then (markRequestsSeen), they get this email instead.
 */

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** Subject and body of the email. Names and the note are attendees' text. */
export function requestEmailContent(input: {
  recipientName: string
  requesterName: string
  eventTitle: string
  note: string | undefined
  /** The event's page with the recipient's requests. */
  requestsUrl: string
}): { subject: string; html: string } {
  const firstName = input.recipientName.trim().split(/\s+/)[0] ?? ''
  const requester = escapeHtml(input.requesterName)
  const note = input.note
    ? `<p style="margin:0 0 16px;padding:12px 14px;border-left:3px solid #d1d5db;color:#374151">${escapeHtml(input.note)}</p>`
    : ''
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;font-size:16px;line-height:1.5;color:#111827;max-width:480px">
      <p style="margin:0 0 16px">Hola${firstName ? ` ${escapeHtml(firstName)}` : ''}:</p>
      <p style="margin:0 0 16px"><strong>${requester}</strong> te pidió un 1:1 ahora en ${escapeHtml(input.eventTitle)}.</p>
      ${note}
      <p style="margin:0 0 20px">El pedido vence en unos minutos. Respondé desde la app:</p>
      <p style="margin:0 0 24px"><a href="${escapeHtml(input.requestsUrl)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#111827;color:#ffffff;text-decoration:none;font-weight:600">Ver la solicitud</a></p>
      <p style="margin:0;font-size:13px;color:#6b7280">Si ya lo viste en la app, ignorá este mail. Con la app abierta, los pedidos te llegan ahí.</p>
    </div>
  `
  return {
    subject: `${input.requesterName} quiere un 1:1 con vos ahora`,
    html,
  }
}

/**
 * Booked by requestMeeting for REQUEST_EMAIL_DELAY_MS after a request: email
 * the person asked, unless the request no longer needs it (requestNeedsEmail).
 */
export const sendIfUnseen = internalMutation({
  args: { requestId: v.id('socialMeetingRequests') },
  returns: v.null(),
  handler: async (ctx, { requestId }) => {
    const request = await ctx.db.get('socialMeetingRequests', requestId)
    if (!request) return null
    const { eventId, toUserId, fromUserId } = request
    const now = Date.now()
    const waiting = await ctx.db
      .query('socialMeetingRequests')
      .withIndex('by_eventId_and_toUserId_and_status', (q) =>
        q
          .eq('eventId', eventId)
          .eq('toUserId', toUserId)
          .eq('status', 'pending'),
      )
      .take(50)
    const emailedTimes = waiting.flatMap((r) =>
      r.emailedAt === undefined ? [] : [r.emailedAt],
    )
    const lastEmailedAt =
      emailedTimes.length === 0 ? undefined : Math.max(...emailedTimes)
    if (!requestNeedsEmail({ now, request, lastEmailedAt })) return null

    const [event, guest] = await Promise.all([
      ctx.db.get('socialEvents', eventId),
      getGuestByUser(ctx, eventId, toUserId),
    ])
    if (!event || guest?.status !== 'approved') return null
    const org = await ctx.db.get('organizations', event.orgId)
    if (!org?.slug) return null
    const [recipientProfile, requester] = await Promise.all([
      getProfileByUser(ctx, toUserId),
      attendeeCard(ctx, eventId, fromUserId),
    ])
    const baseUrl = process.env.SITE_URL ?? 'https://safetytalent.org'
    const { subject, html } = requestEmailContent({
      recipientName: recipientProfile?.name ?? guest.name ?? '',
      requesterName: requester.name,
      eventTitle: event.title,
      note: request.note,
      requestsUrl: `${baseUrl}/org/${org.slug}/e/${event.slug}/requests`,
    })
    await resend.sendEmail(ctx, {
      from: FROM_ADDRESS,
      to: guest.email,
      subject,
      html,
    })
    await ctx.db.patch('socialMeetingRequests', requestId, { emailedAt: now })
    return null
  },
})
