/**
 * Client for Luma's public API (https://docs.luma.com/reference).
 *
 * Needs LUMA_API_KEY (a calendar API key from Luma Plus). Plain functions so
 * both actions and HTTP actions can use them; no "use node" needed.
 */

const LUMA_API_BASE = 'https://public-api.luma.com'

export type LumaApprovalStatus =
  | 'approved'
  | 'session'
  | 'pending_approval'
  | 'invited'
  | 'declined'
  | 'waitlist'

export type LumaGuest = {
  id: string
  user_email: string
  user_name: string | null
  approval_status: LumaApprovalStatus
  registered_at: string | null
  event_tickets?: Array<{ checked_in_at: string | null }>
}

export type LumaEvent = {
  id: string
  name: string
  url: string
  start_at: string
  end_at: string | null
  timezone: string
  description?: string
  geo_address_json?: { address?: string; full_address?: string | null } | null
}

export class LumaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export function hasLumaApiKey(): boolean {
  return !!process.env.LUMA_API_KEY
}

async function lumaRequest<T>(
  path: string,
  init: {
    method: 'GET' | 'POST'
    query?: Record<string, string | undefined>
    body?: unknown
  },
): Promise<T> {
  const apiKey = process.env.LUMA_API_KEY
  if (!apiKey) throw new LumaApiError('LUMA_API_KEY is not set', 0)

  const url = new URL(path, LUMA_API_BASE)
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value)
  }

  const response = await fetch(url, {
    method: init.method,
    headers: {
      'x-luma-api-key': apiKey,
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new LumaApiError(
      `Luma ${init.method} ${path} failed (${response.status}): ${text.slice(0, 300)}`,
      response.status,
    )
  }
  return (await response.json()) as T
}

export async function getLumaEvent(eventId: string): Promise<LumaEvent> {
  const data = await lumaRequest<{ event?: LumaEvent } & Partial<LumaEvent>>(
    '/v1/events/get',
    { method: 'GET', query: { event_id: eventId } },
  )
  // The response wraps the event in `event` on some API versions.
  return (data.event ?? data) as LumaEvent
}

/**
 * Add guests to a Luma event. Returns the emails Luma skipped (unsubscribed,
 * blocked or removed by an admin).
 */
export async function addLumaGuests(args: {
  eventId: string
  guests: Array<{ email: string; name?: string }>
  approvalStatus: 'approved' | 'pending_approval'
  sendEmail: boolean
}): Promise<Array<string>> {
  const data = await lumaRequest<{ skipped?: Array<{ email: string }> }>(
    '/v1/events/guests/add',
    {
      method: 'POST',
      body: {
        event_id: args.eventId,
        guests: args.guests.map((g) => ({ email: g.email, name: g.name })),
        approval_status: args.approvalStatus,
        send_email: args.sendEmail,
      },
    },
  )
  return (data.skipped ?? []).map((s) => s.email)
}

export async function getLumaGuest(
  eventId: string,
  emailOrGuestId: string,
): Promise<LumaGuest | null> {
  try {
    const data = await lumaRequest<{ guest?: LumaGuest } & Partial<LumaGuest>>(
      '/v1/events/guests/get',
      { method: 'GET', query: { event_id: eventId, id: emailOrGuestId } },
    )
    return (data.guest ?? data) as LumaGuest
  } catch (error) {
    if (error instanceof LumaApiError && error.status === 404) return null
    throw error
  }
}

export async function updateLumaGuestStatus(args: {
  eventId: string
  guestId: string
  status: 'approved' | 'declined' | 'pending_approval' | 'waitlist'
  sendEmail: boolean
}): Promise<void> {
  await lumaRequest('/v1/events/guests/update-status', {
    method: 'POST',
    body: {
      event_id: args.eventId,
      guest_id: args.guestId,
      status: args.status,
      send_email: args.sendEmail,
    },
  })
}

/** All guests of an event, following pagination. */
export async function listAllLumaGuests(
  eventId: string,
): Promise<Array<LumaGuest>> {
  const guests: Array<LumaGuest> = []
  let cursor: string | undefined
  for (let page = 0; page < 50; page++) {
    const data = await lumaRequest<{
      entries: Array<LumaGuest>
      has_more: boolean
      next_cursor?: string
    }>('/v1/events/guests/list', {
      method: 'GET',
      query: {
        event_id: eventId,
        pagination_limit: '100',
        pagination_cursor: cursor,
      },
    })
    guests.push(...data.entries)
    if (!data.has_more || !data.next_cursor) break
    cursor = data.next_cursor
  }
  return guests
}

export type LumaContact = {
  email: string
  name: string | null
  first_name: string | null
  last_name: string | null
  created_at: string
  event_approved_count: number
  event_checked_in_count: number
  tags: Array<{ id: string; name: string }>
}

/** Everyone on the calendar's contact list, following pagination. */
export async function listAllLumaContacts(): Promise<Array<LumaContact>> {
  const contacts: Array<LumaContact> = []
  let cursor: string | undefined
  for (let page = 0; page < 100; page++) {
    const data = await lumaRequest<{
      entries: Array<LumaContact>
      has_more: boolean
      next_cursor?: string
    }>('/v1/calendars/contacts/list', {
      method: 'GET',
      query: { pagination_limit: '100', pagination_cursor: cursor },
    })
    contacts.push(...data.entries)
    if (!data.has_more || !data.next_cursor) break
    cursor = data.next_cursor
  }
  return contacts
}

export function lumaCheckedInAt(guest: LumaGuest): number | undefined {
  const times = (guest.event_tickets ?? [])
    .map((t) => t.checked_in_at)
    .filter((t): t is string => !!t)
    .map((t) => Date.parse(t))
    .filter((t) => !Number.isNaN(t))
  return times.length > 0 ? Math.min(...times) : undefined
}

/**
 * Verify a Luma webhook signature. Luma signs `${t}.${rawBody}` with
 * HMAC-SHA256, keyed by the webhook secret as-is (including its `whsec_`
 * prefix), and sends `Webhook-Signature: t=<ts>,v1=<hex>`.
 */
export async function verifyLumaWebhookSignature(
  secret: string,
  signatureHeader: string | null,
  rawBody: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!signatureHeader) return false
  const parts: Record<string, string> = {}
  for (const part of signatureHeader.split(',')) {
    const idx = part.indexOf('=')
    if (idx > 0) parts[part.slice(0, idx).trim()] = part.slice(idx + 1).trim()
  }
  const timestamp = parts['t']
  const signature = parts['v1']
  if (!timestamp || !signature) return false
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > toleranceSeconds) {
    return false
  }

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${timestamp}.${rawBody}`),
  )
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return diff === 0
}
