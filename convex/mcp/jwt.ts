import { createRemoteJWKSet, jwtVerify } from 'jose'

// Clerk acts as the OAuth 2.1 Authorization Server for the MCP endpoint
// (dashboard: Configure → OAuth Applications, with Dynamic Client
// Registration enabled). Access tokens it issues are RS256 JWTs signed with
// the instance key, so the resource server side reduces to a standard
// JWKS verification — no token introspection round-trip needed.

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null
let jwksIssuer: string | null = null

function getJwks(issuer: string) {
  // createRemoteJWKSet fetches lazily (inside the request handler) and
  // caches keys across invocations while the isolate stays warm.
  if (!jwks || jwksIssuer !== issuer) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`))
    jwksIssuer = issuer
  }
  return jwks
}

/**
 * Verify a Clerk-issued OAuth access token and return the Clerk user id
 * (`user_…` subject), or null if the token is missing/invalid/expired.
 *
 * This only authenticates *who* is calling. Authorization (org admin
 * membership) is re-checked per tool call in `convex/mcp/data.ts` — Clerk
 * has no custom OAuth scopes yet, so all fine-grained authz lives there.
 */
export async function verifyClerkOAuthToken(
  authorizationHeader: string | null,
): Promise<string | null> {
  const issuer = process.env.CLERK_JWT_ISSUER_DOMAIN
  if (!issuer) {
    throw new Error('CLERK_JWT_ISSUER_DOMAIN env var is not set')
  }
  if (!authorizationHeader?.startsWith('Bearer ')) return null
  const token = authorizationHeader.slice('Bearer '.length).trim()
  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, getJwks(issuer), {
      issuer,
      algorithms: ['RS256'],
    })
    const sub = payload.sub
    if (typeof sub !== 'string' || !sub.startsWith('user_')) return null
    return sub
  } catch {
    return null
  }
}
