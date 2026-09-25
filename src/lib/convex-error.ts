import { ConvexError } from 'convex/values'

/**
 * Readable text from an error thrown by a Convex function. ConvexError data
 * reaches the client in production; plain Errors show up as "Server Error",
 * so anything else falls back to `fallback`.
 */
export function errorText(error: unknown, fallback: string): string {
  if (error instanceof ConvexError) {
    const data: unknown = error.data
    if (typeof data === 'string') return data
    if (
      data &&
      typeof data === 'object' &&
      'message' in data &&
      typeof data.message === 'string'
    ) {
      return data.message
    }
  }
  return fallback
}

/** The `code` of a ConvexError thrown with `{ code, message }` data. */
export function errorCode<Code extends string>(error: unknown): Code | null {
  if (!(error instanceof ConvexError)) return null
  const data: unknown = error.data
  if (data && typeof data === 'object' && 'code' in data) {
    return typeof data.code === 'string' ? (data.code as Code) : null
  }
  return null
}
