import { v } from 'convex/values'
import {
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
} from '../_generated/server'
import { internal } from '../_generated/api'
import { FROM_ADDRESS, resend } from './send'
import { replyToFor } from './replyTo'
import { addressOf, verifySvixSignature } from '../lib/inboundMail'

/**
 * Replies that reach notifications@safetytalent.org. Emails sent before an
 * org had a reply-to address, and mail clients that ignore Reply-To, answer
 * the From address. Resend receives that mail (safetytalent.org's MX points
 * at it) and calls /resend-inbound; each reply is forwarded to the reply-to
 * address of the org that last emailed the sender, with Reply-To set to the
 * sender so the team answers them directly.
 *
 * Setup: RESEND_API_KEY only sends, so reading received mail takes a
 * full-access key in RESEND_RECEIVING_API_KEY. Then run
 * emails/inbound:setupWebhook once against the deployment and store the
 * signing secret it returns in RESEND_INBOUND_WEBHOOK_SECRET (or create the
 * webhook for email.received in the Resend dashboard and copy its secret).
 */

const RESEND_API = 'https://api.resend.com'

const receivingAuth = () => ({
  Authorization: `Bearer ${process.env.RESEND_RECEIVING_API_KEY}`,
})

export const resendInboundHandler = httpAction(async (ctx, request) => {
  const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET
  if (!secret) {
    console.error('RESEND_INBOUND_WEBHOOK_SECRET is not set; rejecting webhook')
    return new Response('Webhook not configured', { status: 503 })
  }
  const rawBody = await request.text()
  const valid = await verifySvixSignature(
    secret,
    {
      id: request.headers.get('svix-id'),
      timestamp: request.headers.get('svix-timestamp'),
      signature: request.headers.get('svix-signature'),
    },
    rawBody,
    Math.floor(Date.now() / 1000),
  )
  if (!valid) return new Response('Invalid signature', { status: 401 })

  let event: { type?: unknown; data?: { email_id?: unknown } }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }
  if (
    event.type === 'email.received' &&
    typeof event.data?.email_id === 'string'
  ) {
    await ctx.scheduler.runAfter(0, internal.emails.inbound.forwardReceived, {
      emailId: event.data.email_id,
    })
  }
  return new Response(null, { status: 200 })
})

/** Where a reply from `sender` goes: the org that emailed them last. */
export const forwardTargetFor = internalQuery({
  args: { sender: v.string() },
  returns: v.union(v.null(), v.array(v.string())),
  handler: async (ctx, { sender }) => {
    const last = await ctx.db
      .query('emailLog')
      .withIndex('by_recipient_email', (q) => q.eq('recipientEmail', sender))
      .order('desc')
      .first()
    if (!last) return null
    return (await replyToFor(ctx, last.orgId)) ?? null
  },
})

export const forwardReceived = internalAction({
  args: { emailId: v.string() },
  returns: v.null(),
  handler: async (ctx, { emailId }) => {
    const response = await fetch(`${RESEND_API}/emails/receiving/${emailId}`, {
      headers: receivingAuth(),
    })
    if (!response.ok) {
      throw new Error(
        `Resend: could not read received email ${emailId} (${response.status})`,
      )
    }
    const email = (await response.json()) as {
      from: string
      subject: string | null
      html: string | null
      text: string | null
    }
    const sender = addressOf(email.from)
    // Our own mail (bounces, loops) is never forwarded.
    if (sender.endsWith('@safetytalent.org')) return null
    const to = await ctx.runQuery(internal.emails.inbound.forwardTargetFor, {
      sender,
    })
    if (!to) {
      console.warn(`Inbound reply from ${sender}: no org has emailed them`)
      return null
    }
    await ctx.runMutation(internal.emails.inbound.sendForward, {
      to,
      sender: email.from,
      senderAddress: sender,
      subject: email.subject ?? '(sin asunto)',
      html: email.html,
      text: email.text,
    })
    return null
  },
})

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const sendForward = internalMutation({
  args: {
    to: v.array(v.string()),
    sender: v.string(),
    senderAddress: v.string(),
    subject: v.string(),
    html: v.union(v.string(), v.null()),
    text: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const note = `<p style="font-size:13px;color:#6b7280">Respuesta de ${escapeHtml(
      args.sender,
    )} a un mail enviado desde ASTN. Respondé este mensaje para contestarle.</p><hr/>`
    const body =
      args.html ??
      `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(
        args.text ?? '',
      )}</pre>`
    await resend.sendEmail(ctx, {
      from: FROM_ADDRESS,
      to: args.to,
      subject: args.subject,
      html: note + body,
      replyTo: [args.senderAddress],
    })
    return null
  },
})

/**
 * One-off per deployment: point a Resend webhook for received mail at this
 * deployment's /resend-inbound. Returns the signing secret to store in
 * RESEND_INBOUND_WEBHOOK_SECRET, and the latest received emails so you can
 * see that receiving works.
 */
export const setupWebhook = internalAction({
  args: {},
  returns: v.any(),
  handler: async () => {
    const auth = receivingAuth()
    const endpoint = `${process.env.CONVEX_SITE_URL}/resend-inbound`
    const created = await fetch(`${RESEND_API}/webhooks`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, events: ['email.received'] }),
    })
    const webhook = await created.json()
    const received = await fetch(`${RESEND_API}/emails/receiving?limit=5`, {
      headers: auth,
    })
    const list = (await received.json()) as {
      data?: Array<{ from: string; subject: string; created_at: string }>
    }
    return {
      endpoint,
      webhook,
      latestReceived: (list.data ?? []).map((e) => ({
        from: e.from,
        subject: e.subject,
        at: e.created_at,
      })),
    }
  },
})
