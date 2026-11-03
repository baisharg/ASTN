/** Svix signature check (the scheme Resend signs its webhooks with). */
export async function verifySvixSignature(
  secret: string,
  headers: {
    id: string | null
    timestamp: string | null
    signature: string | null
  },
  rawBody: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): Promise<boolean> {
  const { id, timestamp, signature } = headers
  if (!id || !timestamp || !signature) return false
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > toleranceSeconds) {
    return false
  }
  const keyBytes = Uint8Array.from(
    atob(secret.startsWith('whsec_') ? secret.slice(6) : secret),
    (c) => c.charCodeAt(0),
  )
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`),
  )
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)))
  return signature
    .split(' ')
    .map((part) => part.split(',')[1] ?? '')
    .some((candidate) => {
      if (candidate.length !== expected.length) return false
      let diff = 0
      for (let i = 0; i < expected.length; i++) {
        diff |= expected.charCodeAt(i) ^ candidate.charCodeAt(i)
      }
      return diff === 0
    })
}

/** "Ana Pérez <ana@x.com>" → "ana@x.com". */
export function addressOf(from: string): string {
  const match = from.match(/<([^>]+)>/)
  return (match ? match[1] : from).trim().toLowerCase()
}
