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
  user_first_name?: string | null
  user_last_name?: string | null
  approval_status: LumaApprovalStatus
  registered_at: string | null
  // What the guest's Luma ticket QR encodes (a luma.com/check-in/... URL).
  check_in_qr_code?: string
  event_tickets?: Array<{ checked_in_at: string | null }>
}

export type LumaVisibility = 'public' | 'members-only' | 'private'

export type LumaEvent = {
  id: string
  name: string
  url: string
  start_at: string
  end_at: string | null
  timezone: string
  calendar_id?: string
  description?: string
  description_md?: string
  cover_url?: string | null
  visibility?: LumaVisibility
  location_type?: string
  meeting_url?: string | null
  require_approval?: boolean
  max_capacity?: number | null
  registration_open?: boolean
  platform?: 'luma' | 'external'
  // "manage" for events the calendar runs, "view" for events only listed
  // on it (their guests and settings aren't ours).
  access?: 'manage' | 'view'
  geo_address_json?: {
    address?: string
    full_address?: string | null
    city?: string | null
  } | null
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
    query?: Record<string, string | Array<string> | undefined>
    body?: unknown
  },
): Promise<T> {
  const apiKey = process.env.LUMA_API_KEY
  if (!apiKey) throw new LumaApiError('LUMA_API_KEY is not set', 0)

  const url = new URL(path, LUMA_API_BASE)
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item)
    } else if (value !== undefined) {
      url.searchParams.set(key, value)
    }
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

export function isLumaRateLimited(error: unknown): boolean {
  return error instanceof LumaApiError && error.status === 429
}

export type LumaCalendar = { id: string; slug: string | null; name: string }

/** The calendar the API key belongs to. */
export async function getLumaCalendar(): Promise<LumaCalendar> {
  const data = await lumaRequest<{
    id?: string
    api_id?: string
    slug?: string | null
    name?: string
    calendar?: { id?: string; api_id?: string; slug?: string; name?: string }
  }>('/v1/calendars/get', { method: 'GET' })
  const cal = data.calendar ?? data
  const id = cal.id ?? cal.api_id
  if (!id) throw new LumaApiError('Luma returned no calendar id', 0)
  return { id, slug: cal.slug ?? null, name: cal.name ?? '' }
}

/**
 * Every event the calendar manages, oldest first, following pagination.
 * `after` limits it to events starting after that time.
 */
export async function listLumaCalendarEvents(options?: {
  after?: number
}): Promise<Array<LumaEvent>> {
  const events: Array<LumaEvent> = []
  let cursor: string | undefined
  for (let page = 0; page < 100; page++) {
    const data = await lumaRequest<{
      entries: Array<LumaEvent & { event?: LumaEvent }>
      has_more: boolean
      next_cursor?: string
    }>('/v1/calendars/events/list', {
      method: 'GET',
      query: {
        pagination_limit: '50',
        pagination_cursor: cursor,
        sort_column: 'start_at',
        sort_direction: 'asc',
        access: ['manage', 'view'],
        platforms: ['luma', 'external'],
        after:
          options?.after !== undefined
            ? new Date(options.after).toISOString()
            : undefined,
      },
    })
    // Older API versions wrapped each entry in `event`.
    events.push(...data.entries.map((e) => e.event ?? e))
    if (!data.has_more || !data.next_cursor) return events
    cursor = data.next_cursor
  }
  throw new LumaApiError('Luma event list did not end after 100 pages', 0)
}

export type LumaEventInput = {
  name?: string
  start_at?: string
  end_at?: string
  timezone?: string
  description_md?: string
  geo_address_json?: { type: 'manual'; address: string }
  visibility?: LumaVisibility
  max_capacity?: number | null
}

/** Create an event on the calendar. Returns its id. */
export async function createLumaEvent(
  input: LumaEventInput & {
    name: string
    start_at: string
    timezone: string
    requireApproval: boolean
  },
): Promise<string> {
  const { requireApproval, ...body } = input
  const data = await lumaRequest<{ id?: string; api_id?: string }>(
    '/v1/events/create',
    {
      method: 'POST',
      body: {
        ...body,
        // Approval is a ticket setting; replace the default ticket with a
        // free one that has it on.
        ...(requireApproval
          ? {
              ticket_types: [
                { name: 'General', type: 'free', require_approval: true },
              ],
            }
          : {}),
      },
    },
  )
  const id = data.id ?? data.api_id
  if (!id) throw new LumaApiError('Luma returned no event id', 0)
  return id
}

export async function updateLumaEvent(
  eventId: string,
  input: LumaEventInput & { suppress_email?: boolean },
): Promise<void> {
  await lumaRequest('/v1/events/update', {
    method: 'POST',
    body: { event_id: eventId, ...input },
  })
}

/** Turn approval on or off for every visible ticket type of an event. */
export async function setLumaRequireApproval(
  eventId: string,
  requireApproval: boolean,
): Promise<void> {
  const data = await lumaRequest<{
    entries: Array<{
      id: string
      is_hidden?: boolean
      require_approval?: boolean
    }>
  }>('/v1/events/ticket-types/list', {
    method: 'GET',
    query: { event_id: eventId },
  })
  for (const ticket of data.entries) {
    if (ticket.is_hidden) continue
    if ((ticket.require_approval ?? false) === requireApproval) continue
    await lumaRequest('/v1/events/ticket-types/update', {
      method: 'POST',
      body: {
        event_ticket_type_id: ticket.id,
        require_approval: requireApproval,
      },
    })
  }
}

export type LumaBlastRecipientStatus =
  | 'approved'
  | 'checked_in'
  | 'pending_approval'
  | 'waitlist'
  | 'invited'

export type LumaBlast = {
  id: string
  subject: string | null
  content_md: string
  status: 'scheduled' | 'sent' | 'quarantined'
  scheduled_for: string | null
  sent_at: string | null
  recipient_groups: Array<{ status: string }>
  recipient_count: number
  email_open_count: number
  sender?: { type: string; name: string | null } | null
}

export async function listLumaBlasts(
  eventId: string,
): Promise<Array<LumaBlast>> {
  const data = await lumaRequest<{ entries: Array<LumaBlast> }>(
    '/v1/events/blasts/list',
    { method: 'GET', query: { event_id: eventId } },
  )
  return data.entries
}

/** Email the event's guests, now or at `scheduledFor`. Can't be recalled. */
export async function createLumaBlast(args: {
  eventId: string
  subject?: string
  contentMd: string
  recipients: Array<LumaBlastRecipientStatus>
  scheduledFor?: number
}): Promise<LumaBlast> {
  return await lumaRequest<LumaBlast>('/v1/events/blasts/create', {
    method: 'POST',
    body: {
      event_id: args.eventId,
      subject: args.subject || undefined,
      content_md: args.contentMd,
      recipient_groups: args.recipients.map((status) => ({ status })),
      scheduled_for:
        args.scheduledFor !== undefined
          ? new Date(args.scheduledFor).toISOString()
          : undefined,
    },
  })
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
    if (!data.has_more || !data.next_cursor) return guests
    cursor = data.next_cursor
  }
  // Treating a cut-off list as complete would drop the rest of the guests.
  throw new LumaApiError(
    `Luma guest list for ${eventId} has more than 50 pages; not read`,
    0,
  )
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
