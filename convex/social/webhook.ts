import { internal } from '../_generated/api'
import { httpAction } from '../_generated/server'
import { mirrorFromLuma } from '../luma/shared'
import { lumaCheckedInAt, verifyLumaWebhookSignature } from './luma'
import type { LumaEvent, LumaGuest } from './luma'

const EVENT_TYPES = new Set([
  'event.created',
  'event.updated',
  'event.canceled',
])

/**
 * Luma webhook (guest.registered, guest.updated, event.created,
 * event.updated, event.canceled). Configure it in Luma under Settings →
 * Developer → Webhooks, pointing at <CONVEX_SITE_URL>/luma-webhook, and store
 * its secret in LUMA_WEBHOOK_SECRET.
 */
export const lumaWebhookHandler = httpAction(async (ctx, request) => {
  const secret = process.env.LUMA_WEBHOOK_SECRET
  if (!secret) {
    console.error('LUMA_WEBHOOK_SECRET is not set; rejecting Luma webhook')
    return new Response('Webhook not configured', { status: 503 })
  }

  const rawBody = await request.text()
  const valid = await verifyLumaWebhookSignature(
    secret,
    request.headers.get('webhook-signature'),
    rawBody,
    Math.floor(Date.now() / 1000),
  )
  if (!valid) return new Response('Invalid signature', { status: 401 })

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }
  if (typeof payload !== 'object' || payload === null) {
    return new Response('Invalid payload', { status: 400 })
  }
  const { type, data } = payload as { type?: unknown; data?: unknown }
  if (typeof type === 'string' && EVENT_TYPES.has(type)) {
    const event = data as Partial<LumaEvent> | null
    if (
      typeof event !== 'object' ||
      event === null ||
      typeof event.id !== 'string' ||
      typeof event.name !== 'string' ||
      typeof event.start_at !== 'string' ||
      typeof event.timezone !== 'string' ||
      typeof event.url !== 'string'
    ) {
      return new Response('Missing event fields', { status: 400 })
    }
    const mirrored = mirrorFromLuma(event as LumaEvent)
    if (Number.isNaN(mirrored.startAt)) {
      return new Response('Invalid start_at', { status: 400 })
    }
    await ctx.runMutation(internal.luma.mirror.applyWebhookEvent, {
      calendarId:
        typeof event.calendar_id === 'string' ? event.calendar_id : null,
      event: mirrored,
      canceled: type === 'event.canceled',
      accessUnknown: typeof event.access !== 'string',
    })
    return new Response('OK', { status: 200 })
  }
  if (type !== 'guest.registered' && type !== 'guest.updated') {
    // Acknowledge event types we don't use so Luma doesn't retry them.
    return new Response('Ignored', { status: 200 })
  }
  if (typeof data !== 'object' || data === null) {
    return new Response('Invalid payload', { status: 400 })
  }

  const guest = data as Partial<LumaGuest> & { event?: { id?: unknown } }
  const lumaEventId = guest.event?.id
  if (
    typeof lumaEventId !== 'string' ||
    typeof guest.id !== 'string' ||
    typeof guest.user_email !== 'string' ||
    typeof guest.approval_status !== 'string'
  ) {
    return new Response('Missing guest fields', { status: 400 })
  }

  await ctx.runMutation(internal.social.lumaSync.applyWebhookGuest, {
    lumaEventId,
    guest: {
      id: guest.id,
      email: guest.user_email,
      name: typeof guest.user_name === 'string' ? guest.user_name : null,
      approvalStatus: guest.approval_status,
      checkedInAt: lumaCheckedInAt(guest as LumaGuest),
      checkInCode:
        typeof guest.check_in_qr_code === 'string'
          ? guest.check_in_qr_code
          : undefined,
    },
  })
  return new Response('OK', { status: 200 })
})
