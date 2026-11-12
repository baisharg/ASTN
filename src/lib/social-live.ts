/**
 * Pure rules for the attendee's live 1:1 screens: what to show for a given
 * live state and clock reading. No React and no Convex client, so they can be
 * tested directly (social-live.test.ts).
 */

/** How long after a meeting ends the meeting page still says so. */
export const ENDED_CARD_MS = 10 * 60 * 1000

/**
 * Whether a meeting that ended at `endedAt` (server time) is recent enough,
 * by this device's clock, to show "Reunión terminada". A device whose clock
 * runs behind the server sees a time in the future, which counts as recent.
 */
export function endedRecently(endedAt: number, now: number): boolean {
  return now - endedAt < ENDED_CARD_MS
}
