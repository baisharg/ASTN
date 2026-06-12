import { httpAction } from '../_generated/server'
import { verifyClerkOAuthToken } from './jwt'
import { TOOL_DEFS, callTool } from './tools'

// MCP server over Streamable HTTP (single POST endpoint, JSON responses —
// no SSE stream; the spec allows a plain application/json reply). Stateless:
// no Mcp-Session-Id is issued, every request re-authenticates the bearer JWT.
//
// OAuth wiring (RFC 9728): an unauthenticated request gets a 401 whose
// WWW-Authenticate header points at our protected-resource metadata, which
// in turn points at Clerk as the authorization server. Claude Code follows
// that chain, dynamically registers (DCR), and runs the browser login.

const LATEST_PROTOCOL = '2025-06-18'
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

function siteUrl(): string {
  const url = process.env.CONVEX_SITE_URL
  if (!url) throw new Error('CONVEX_SITE_URL is not set')
  return url
}

function jsonRpcResult(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id: id ?? null, result })
}

function jsonRpcError(
  id: unknown,
  code: number,
  message: string,
  status = 200,
): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code, message },
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  )
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'invalid_token' }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer resource_metadata="${siteUrl()}/.well-known/oauth-protected-resource/mcp"`,
    },
  })
}

export const mcpHandler = httpAction(async (ctx, request) => {
  const userId = await verifyClerkOAuthToken(
    request.headers.get('Authorization'),
  )
  if (!userId) return unauthorized()

  let message: any
  try {
    message = await request.json()
  } catch {
    return jsonRpcError(null, -32700, 'Parse error', 400)
  }
  if (Array.isArray(message)) {
    return jsonRpcError(null, -32600, 'Batch requests are not supported', 400)
  }
  const { id, method, params } = message ?? {}
  if (typeof method !== 'string') {
    return jsonRpcError(id, -32600, 'Invalid request', 400)
  }

  // Notifications (no id, no response body expected).
  if (method.startsWith('notifications/')) {
    return new Response(null, { status: 202 })
  }

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion
      const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested)
        ? requested
        : LATEST_PROTOCOL
      return jsonRpcResult(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: {
          name: 'astn-crm',
          title: 'ASTN CRM',
          version: '0.1.0',
        },
        instructions:
          'CRM database of an ASTN organization (contacts, organizations, ' +
          'opportunities, submissions). Start with list_my_orgs to find your ' +
          'org slug, crm_stats for an overview, and crm_fields before ' +
          'creating or updating records. All access is scoped to orgs where ' +
          'the signed-in user is an admin.',
      })
    }
    case 'ping':
      return jsonRpcResult(id, {})
    case 'tools/list':
      return jsonRpcResult(id, { tools: TOOL_DEFS })
    case 'tools/call': {
      const name = params?.name
      const args = params?.arguments ?? {}
      if (typeof name !== 'string') {
        return jsonRpcError(id, -32602, 'Missing tool name')
      }
      try {
        const result = await callTool(ctx, userId, name, args)
        return jsonRpcResult(id, {
          content: [
            {
              type: 'text',
              text:
                typeof result === 'string'
                  ? result
                  : JSON.stringify(result, null, 2),
            },
          ],
          isError: false,
        })
      } catch (err) {
        // Tool-level failures (bad args, not found, not admin) travel as
        // isError results so the calling model can read and correct them.
        return jsonRpcResult(id, {
          content: [
            {
              type: 'text',
              text: err instanceof Error ? err.message : String(err),
            },
          ],
          isError: true,
        })
      }
    }
    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`)
  }
})

// GET (SSE stream) and DELETE (session termination) are valid Streamable
// HTTP requests we deliberately don't support on this stateless server.
export const mcpMethodNotAllowed = httpAction(async () => {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } })
})

// RFC 9728 protected-resource metadata: tells the MCP client which
// authorization server (Clerk) guards this resource.
export const protectedResourceMetadata = httpAction(async () => {
  const issuer = process.env.CLERK_JWT_ISSUER_DOMAIN
  if (!issuer) throw new Error('CLERK_JWT_ISSUER_DOMAIN is not set')
  return Response.json({
    resource: `${siteUrl()}/mcp`,
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
  })
})
