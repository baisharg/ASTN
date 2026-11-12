import { findJustSentBlast } from './luma-blasts'
import type { ListedBlast } from './luma-blasts'

type BunTestFn = (name: string, fn: () => void | Promise<void>) => void

declare const describe: BunTestFn
declare const test: BunTestFn
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
}

const startedAt = Date.UTC(2026, 9, 10, 20, 0, 0)
const MINUTE = 60 * 1000

const blast = (over: Partial<ListedBlast>): ListedBlast => ({
  id: 'blast-new',
  subject: 'Cambio de lugar',
  contentMd: 'Nos vemos en la **otra** sala.',
  sentAt: startedAt + 2000,
  scheduledFor: null,
  ...over,
})

const attempt = {
  knownIds: new Set(['blast-old']),
  subject: 'Cambio de lugar',
  content: 'Nos vemos en la **otra** sala.',
  startedAt,
}

describe('findJustSentBlast', () => {
  test('finds the blast that appeared after the attempt', () => {
    const found = findJustSentBlast({ ...attempt, blasts: [blast({})] })
    expect(found?.id).toBe('blast-new')
  })

  test('ignores blasts that were already listed before sending', () => {
    expect(
      findJustSentBlast({
        ...attempt,
        blasts: [blast({ id: 'blast-old', sentAt: startedAt - 60 * MINUTE })],
      }),
    ).toBe(null)
  })

  test('ignores a blast with another message or subject', () => {
    expect(
      findJustSentBlast({
        ...attempt,
        blasts: [blast({ contentMd: 'Otro mensaje' })],
      }),
    ).toBe(null)
    expect(
      findJustSentBlast({ ...attempt, blasts: [blast({ subject: 'Otro' })] }),
    ).toBe(null)
  })

  test('differences in spacing do not matter', () => {
    const found = findJustSentBlast({
      ...attempt,
      content: '  Nos vemos en la\n**otra** sala.\n',
      blasts: [blast({})],
    })
    expect(found?.id).toBe('blast-new')
  })

  test('without a typed subject, Luma can have given it any subject', () => {
    const found = findJustSentBlast({
      ...attempt,
      subject: '  ',
      blasts: [blast({ subject: 'Nuevo mensaje en BAISH Social' })],
    })
    expect(found?.id).toBe('blast-new')
  })

  test('an identical blast sent well before the attempt is an older one', () => {
    expect(
      findJustSentBlast({
        ...attempt,
        knownIds: null,
        blasts: [blast({ sentAt: startedAt - 60 * MINUTE })],
      }),
    ).toBe(null)
  })

  test('works when the list had not loaded before sending', () => {
    const found = findJustSentBlast({
      ...attempt,
      knownIds: null,
      blasts: [blast({})],
    })
    expect(found?.id).toBe('blast-new')
  })

  test('finds a scheduled blast, which has no sent time yet', () => {
    const found = findJustSentBlast({
      ...attempt,
      blasts: [
        blast({ sentAt: null, scheduledFor: startedAt + 24 * 60 * MINUTE }),
      ],
    })
    expect(found?.id).toBe('blast-new')
  })
})
