import { v } from 'convex/values'

/** Validators shared by the social tables in schema.ts and their functions. */

export const eventStatusValidator = v.union(
  v.literal('draft'),
  v.literal('published'),
  v.literal('closed'),
)

export const guestStatusValidator = v.union(
  v.literal('approved'),
  v.literal('pending_approval'),
  v.literal('declined'),
  v.literal('waitlist'),
  v.literal('invited'),
)

export const guestSourceValidator = v.union(
  v.literal('app'),
  v.literal('luma'),
  v.literal('admin'),
)

export const lumaSyncValidator = v.union(
  v.literal('not_linked'),
  v.literal('pending'),
  v.literal('synced'),
  v.literal('error'),
)

export const allowlistSourceValidator = v.union(
  v.literal('csv'),
  v.literal('approval'),
  v.literal('manual'),
  // Approved for a past event on the org's Luma calendar
  v.literal('luma'),
)

export const availabilityValidator = v.union(
  v.literal('available'),
  v.literal('busy'),
)

export const socialVisibilityValidator = v.union(
  v.literal('event_attendees'),
  v.literal('org_members'),
  v.literal('public'),
)

export const profileMissingValidator = v.union(
  v.literal('background'),
  v.literal('seeking'),
  v.literal('canHelpWith'),
)

export const suggestionLanguageValidator = v.union(
  v.literal('es'),
  v.literal('en'),
)

/**
 * How an attendee's last suggestion run ended, or that one is running:
 * - generating: a run is in progress
 * - ready: the run saved suggestions
 * - nobody: the run found no one to suggest
 * - failed: the run could not finish
 */
export const suggestionsStatusValidator = v.union(
  v.literal('generating'),
  v.literal('ready'),
  v.literal('nobody'),
  v.literal('failed'),
)

/**
 * What started an event-wide suggestion run:
 * - admin: the admin's button
 * - attendee: the first attendee to open the people page
 * - attendance: attendees with a ready profile joined since the last run
 */
export const suggestionRunTriggerValidator = v.union(
  v.literal('admin'),
  v.literal('attendee'),
  v.literal('attendance'),
)
