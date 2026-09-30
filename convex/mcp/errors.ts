/**
 * How MCP tool failures reach the client (convex/mcp/server.ts), per the
 * MCP spec's tool error handling: failures the calling model can act on
 * (not found, not allowed, a refused merge) are tool results with
 * `isError: true`; unknown tools and invalid arguments are JSON-RPC
 * "Invalid params" errors, and unexpected failures JSON-RPC "Internal
 * error". Either way the client gets the message only, never a stack or
 * Convex's wrapper. No Convex server imports, so src/ tests can import it.
 */

export const INVALID_PARAMS = -32602
export const INTERNAL_ERROR = -32603

/** A protocol-level problem with the call itself. */
export class McpProtocolError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
    this.name = 'McpProtocolError'
  }
}

export function invalidParams(message: string): McpProtocolError {
  return new McpProtocolError(INVALID_PARAMS, message)
}

const FALLBACK = 'The tool failed'
const MAX_LENGTH = 2000
const MAX_DEPTH = 4
const SKIP_KEYS = new Set(['stack', 'cause'])

/**
 * Errors from queries and mutations reach the HTTP action as
 * "[CONVEX M(mod:fn)] [Request ID: …] Server Error\nUncaught Error: msg\n
 *     at handler (../../convex/…)". Keep "msg".
 */
export function cleanMessage(raw: string): string {
  const lines: Array<string> = []
  for (const line of raw.split('\n')) {
    // Stack frames, and everything after the first one.
    if (/^\s+at\s/.test(line) || /^\s*Called by client/.test(line)) break
    lines.push(line)
  }
  let text = lines.join('\n')
  text = text.replace(/\[CONVEX [^\]]*\]\s*/g, '')
  text = text.replace(/\[Request ID: [^\]]*\]\s*/g, '')
  text = text.replace(/^\s*Server Error\s*(\n|$)/, '')
  text = text.replace(/^\s*Uncaught (?:\w*Error)?:?\s*/, '')
  return text.trim()
}

/** JSON without stacks or causes; bigints as strings, cycles marked. */
function safeJson(value: unknown): string | null {
  const seen = new WeakSet<object>()
  try {
    const json = JSON.stringify(value, (key, v: unknown) => {
      if (SKIP_KEYS.has(key)) return undefined
      if (typeof v === 'bigint') return v.toString()
      if (v && typeof v === 'object') {
        if (seen.has(v)) return '[Circular]'
        seen.add(v)
      }
      return v
    })
    return json && json !== '{}' && json !== '[]' ? json : null
  } catch {
    return null
  }
}

function extract(
  value: unknown,
  depth: number,
  seen: Set<object>,
): string | null {
  if (typeof value === 'string') return cleanMessage(value) || null
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value)
  }
  if (!value || typeof value !== 'object' || depth > MAX_DEPTH) return null
  if (seen.has(value)) return null
  seen.add(value)
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => extract(item, depth + 1, seen))
      .filter((p): p is string => !!p)
    return parts.length ? parts.join('; ') : null
  }
  const obj = value as Record<string, unknown>
  // A ConvexError's message is its data (a string or an object).
  if ('data' in obj && obj.data !== undefined && obj.data !== null) {
    const fromData = extract(obj.data, depth + 1, seen)
    if (fromData) return fromData
  }
  for (const key of ['message', 'error', 'detail', 'reason']) {
    const found = extract(obj[key], depth + 1, seen)
    if (found) return found
  }
  return value instanceof Error ? null : safeJson(obj)
}

/** The readable message of anything thrown. Never throws. */
export function toolErrorText(err: unknown): string {
  try {
    const text = extract(err, 0, new Set()) ?? FALLBACK
    return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH)}…` : text
  } catch {
    return FALLBACK
  }
}

export type ToolFailure =
  | { kind: 'result'; text: string }
  | { kind: 'rpc'; code: number; message: string }

function rawMessage(err: unknown): string {
  try {
    return err instanceof Error ? String(err.message) : ''
  } catch {
    return ''
  }
}

/**
 * Sort a thrown tool error into an `isError` result (something the model
 * can read and act on) or a JSON-RPC error (the call was invalid, or the
 * server broke).
 */
export function classifyToolError(err: unknown): ToolFailure {
  const text = toolErrorText(err)
  if (err instanceof McpProtocolError) {
    return { kind: 'rpc', code: err.code, message: text }
  }
  const raw = rawMessage(err)
  // Convex's argument validation of the internal function we called.
  if (/ArgumentValidationError|does not match validator/.test(raw)) {
    return {
      kind: 'rpc',
      code: INVALID_PARAMS,
      message: `Invalid arguments: ${text}`,
    }
  }
  const isConvexError =
    !!err &&
    typeof err === 'object' &&
    ((err as { name?: unknown }).name === 'ConvexError' || 'data' in err)
  // Errors our handlers throw on purpose: ConvexError, or a plain Error
  // (as it arrives from a query or mutation: "Uncaught Error: …").
  const plainError =
    err instanceof Error &&
    err.name === 'Error' &&
    !/Uncaught (Type|Range|Reference|Syntax|Eval|URI)Error/.test(raw) &&
    !/^\s*(\[[^\]]*\]\s*)*Server Error\s*$/.test(raw)
  if (isConvexError || plainError) return { kind: 'result', text }
  return {
    kind: 'rpc',
    code: INTERNAL_ERROR,
    message: `Internal error: ${text}`,
  }
}
