import { httpRouter } from 'convex/server'
import { corsHandler, streamChat } from './enrichment/streaming'
import { unsubscribeHandler } from './emails/unsubscribe'
import {
  mcpHandler,
  mcpMethodNotAllowed,
  protectedResourceMetadata,
} from './mcp/server'

const http = httpRouter()

// MCP endpoint (Streamable HTTP) + OAuth protected-resource metadata.
// Clients discover auth via 401 → /.well-known/oauth-protected-resource →
// Clerk. RFC 9728 path-appended form (/…/mcp) served alongside the root one.
http.route({ path: '/mcp', method: 'POST', handler: mcpHandler })
http.route({ path: '/mcp', method: 'GET', handler: mcpMethodNotAllowed })
http.route({ path: '/mcp', method: 'DELETE', handler: mcpMethodNotAllowed })
http.route({
  path: '/.well-known/oauth-protected-resource',
  method: 'GET',
  handler: protectedResourceMetadata,
})
http.route({
  path: '/.well-known/oauth-protected-resource/mcp',
  method: 'GET',
  handler: protectedResourceMetadata,
})

// Enrichment chat streaming endpoint
http.route({
  path: '/enrichment-stream',
  method: 'POST',
  handler: streamChat,
})

// CORS preflight for streaming endpoint
http.route({
  path: '/enrichment-stream',
  method: 'OPTIONS',
  handler: corsHandler,
})

// Email unsubscribe (RFC 8058 one-click via POST, manual via GET)
http.route({
  path: '/unsubscribe',
  method: 'POST',
  handler: unsubscribeHandler,
})

http.route({
  path: '/unsubscribe',
  method: 'GET',
  handler: unsubscribeHandler,
})

export default http
