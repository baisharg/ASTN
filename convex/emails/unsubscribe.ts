import { v } from 'convex/values'
import { httpAction, internalMutation } from '../_generated/server'
import { internal } from '../_generated/api'
import { appUrl } from '../lib/siteUrl'

/**
 * HTTP handler for /unsubscribe
 * - POST: RFC 8058 one-click unsubscribe (mail clients send List-Unsubscribe=One-Click)
 * - GET: manual click from email footer link
 *
 * Delegates HMAC verification to a Node.js action, then disables notifications.
 */
export const unsubscribeHandler = httpAction(async (ctx, request) => {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')

  if (!token) {
    return new Response('Missing token', { status: 400 })
  }

  // Verify token + disable notifications in one call (Node.js runtime for crypto)
  const success: boolean = await ctx.runAction(
    internal.emails.unsubscribeVerify.verifyAndUnsubscribe,
    { token },
  )

  if (!success) {
    return new Response('Invalid or expired unsubscribe link', { status: 403 })
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Unsubscribed - ASTN</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: white; padding: 2rem; border-radius: 8px; text-align: center; max-width: 400px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    h1 { color: #1a1a1a; font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #666; line-height: 1.5; }
    a { color: #FF6B4A; }
  </style>
</head>
<body>
  <div class="card">
    <h1>You've been unsubscribed</h1>
    <p>You will no longer receive email notifications from ASTN.</p>
    <p>You can re-enable notifications anytime from your <a href="${appUrl()}/profile?section=privacy">profile settings</a>.</p>
  </div>
</body>
</html>`

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  })
})

/**
 * Disable all email notifications for a profile.
 * Called after HMAC token verification.
 */
export const disableAllNotifications = internalMutation({
  args: {
    profileId: v.id('profiles'),
  },
  returns: v.null(),
  handler: async (ctx, { profileId }) => {
    const profile = await ctx.db.get('profiles', profileId)
    if (!profile) return null

    // Disable match alerts, weekly digest, and deadline reminders
    const prefs = profile.notificationPreferences ?? {
      matchAlerts: { enabled: false },
      weeklyDigest: { enabled: false },
      deadlineReminders: { enabled: false },
      timezone: 'UTC',
    }

    await ctx.db.patch('profiles', profileId, {
      notificationPreferences: {
        ...prefs,
        matchAlerts: { enabled: false },
        weeklyDigest: { enabled: false },
        deadlineReminders: { enabled: false },
      },
    })

    // Disable event notifications
    if (profile.eventNotificationPreferences) {
      await ctx.db.patch('profiles', profileId, {
        eventNotificationPreferences: {
          ...profile.eventNotificationPreferences,
          frequency: 'none',
        },
      })
    }

    return null
  },
})
