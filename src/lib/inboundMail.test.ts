import { addressOf, verifySvixSignature } from '../../convex/lib/inboundMail'

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
}

// Svix's published example (Resend signs its webhooks with Svix).
const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'
const headers = {
  id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
  timestamp: '1614265330',
  signature: 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
}
const body = '{"test": 2432232314}'

describe('verifySvixSignature', () => {
  test('accepts a valid signature', async () => {
    expect(await verifySvixSignature(secret, headers, body, 1614265330)).toBe(
      true,
    )
  })
  test('accepts it among several signatures', async () => {
    const signature = `v1,bm90IGl0 ${headers.signature}`
    expect(
      await verifySvixSignature(
        secret,
        { ...headers, signature },
        body,
        1614265330,
      ),
    ).toBe(true)
  })
  test('rejects a changed body', async () => {
    expect(
      await verifySvixSignature(secret, headers, `${body} `, 1614265330),
    ).toBe(false)
  })
  test('rejects an old timestamp', async () => {
    expect(
      await verifySvixSignature(secret, headers, body, 1614265330 + 3600),
    ).toBe(false)
  })
  test('rejects missing headers', async () => {
    expect(
      await verifySvixSignature(
        secret,
        { ...headers, signature: null },
        body,
        1614265330,
      ),
    ).toBe(false)
  })
})

describe('addressOf', () => {
  test('takes the address out of a display name', () => {
    expect(addressOf('Ana Pérez <Ana@Example.com>')).toBe('ana@example.com')
  })
  test('keeps a bare address', () => {
    expect(addressOf(' ana@example.com ')).toBe('ana@example.com')
  })
})
