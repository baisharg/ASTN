import { useAuth } from '@clerk/clerk-react'
import { useCallback, useMemo } from 'react'

/**
 * How the site signs in to Convex with Clerk.
 *
 * Convex always gets Clerk's `convex` JWT template. That token carries the
 * account's email and name, which the backend reads from it
 * (`ctx.auth.getUserIdentity()`): registering for an event, matching a Luma
 * guest to an account and claiming guest applications all need the email.
 *
 * Clerk's plain session token is also valid for Convex when Clerk's Convex
 * integration is on, but it has no email or name, so it is never used here.
 */

type ClerkGetToken = (options: {
  template: 'convex'
  skipCache: boolean
}) => Promise<string | null>

/**
 * The token for Convex, or null when Clerk can't give one (signed out, or
 * the request failed), which Convex treats as not signed in.
 */
export async function fetchConvexToken(
  getToken: ClerkGetToken,
  forceRefreshToken: boolean,
): Promise<string | null> {
  try {
    return await getToken({ template: 'convex', skipCache: forceRefreshToken })
  } catch {
    return null
  }
}

/** The `useAuth` hook `ConvexProviderWithAuth` takes, backed by Clerk. */
export function useConvexAuthFromClerk(): {
  isLoading: boolean
  isAuthenticated: boolean
  fetchAccessToken: (args: {
    forceRefreshToken: boolean
  }) => Promise<string | null>
} {
  // The memoization below is written by hand and must stay as it is: Convex
  // signs in again whenever `fetchAccessToken` is a new function.
  'use no memo'
  const { isLoaded, isSignedIn, getToken, orgId, orgRole, sessionId } =
    useAuth()
  const fetchAccessToken = useCallback(
    ({ forceRefreshToken }: { forceRefreshToken: boolean }) =>
      fetchConvexToken(getToken, forceRefreshToken),
    // A new function only when the session or its organization changes.
    // Clerk's `getToken` is a new function on some renders, so it is left
    // out: including it would make Convex sign in again in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orgId, orgRole, sessionId],
  )
  return useMemo(
    () => ({
      isLoading: !isLoaded,
      isAuthenticated: isSignedIn ?? false,
      fetchAccessToken,
    }),
    [isLoaded, isSignedIn, fetchAccessToken],
  )
}
