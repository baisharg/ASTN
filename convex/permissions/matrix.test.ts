import {
  ACCESS_ERROR,
  ACTORS,
  asActor,
  newBackend,
  seed,
} from './harness.helpers'
import type { Actor, Backend, Fixture } from './harness.helpers'
import { ALLOWED, CASES, TARGET_OPP, caseName } from './matrix.cases.helpers'
import type { Case, Target } from './matrix.cases.helpers'

type TestBody = () => void | Promise<void>
interface TestFn {
  (name: string, fn: TestBody): void
  skip: (name: string, fn: TestBody) => void
  todo: (name: string, fn?: TestBody) => void
}
declare const describe: (name: string, fn: () => void) => void
declare const test: TestFn

function isEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === 0 ||
    (Array.isArray(value) && value.length === 0)
  )
}

type Outcome = 'allowed' | 'denied'

async function attempt(
  c: Case,
  t: Backend,
  fx: Fixture,
  k: keyof Fixture['opp'],
  actor: Actor,
): Promise<{ outcome: Outcome; detail: string }> {
  const as = asActor(t, actor)
  const args = c.args(fx, k, actor)
  try {
    const result =
      c.kind === 'query'
        ? await as.query(c.ref, args)
        : c.kind === 'mutation'
          ? await as.mutation(c.ref, args)
          : await as.action(c.ref, args)
    if (c.silent && isEmpty(result)) {
      return { outcome: 'denied', detail: `returned ${JSON.stringify(result)}` }
    }
    return { outcome: 'allowed', detail: 'returned data' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (ACCESS_ERROR.test(message)) {
      return { outcome: 'denied', detail: message }
    }
    if (c.lenient) {
      return {
        outcome: 'allowed',
        detail: `passed the check, then: ${message}`,
      }
    }
    throw new Error(
      `${caseName(c)} as ${actor} failed for another reason than access: ${message}`,
    )
  }
}

async function check(
  c: Case,
  target: Target,
  actor: Actor,
  expected: Outcome,
): Promise<void> {
  const t = newBackend()
  const fx = await seed(t)
  const k = TARGET_OPP[target]
  if (c.setup) await c.setup(t, fx, k)
  const { outcome, detail } = await attempt(c, t, fx, k, actor)
  try {
    await t.finishInProgressScheduledFunctions()
  } catch {
    // Scheduled follow-ups (emails, counters) are not what is under test.
  }
  if (outcome !== expected) {
    throw new Error(
      `${caseName(c)} on ${target}: ${actor} was ${outcome}, expected ${expected} (${detail})`,
    )
  }
}

for (const c of CASES) {
  const scoped = c.gate === 'read' || c.gate === 'edit'
  const targets: Array<Target> =
    c.targets ?? (scoped ? ['tais', 'gov', 'plain'] : ['tais'])
  for (const target of targets) {
    const allowed = ALLOWED[scoped ? `${c.gate}:${target}` : c.gate]
    describe(`${c.kind} ${caseName(c)}${scoped ? ` (${c.gate}, ${target})` : ` (${c.gate})`}`, () => {
      for (const actor of ACTORS) {
        const expected: Outcome = allowed.includes(actor) ? 'allowed' : 'denied'
        const name = `${actor} is ${expected === 'allowed' ? 'allowed' : 'rejected'}`
        if (expected === 'allowed' && c.deniedOnly) {
          test.skip(`${name} (not run: it would reach an outside service or an unregistered component)`, () => {})
          continue
        }
        if (c.hole?.actors.includes(actor) && expected === 'denied') {
          // KNOWN HOLE: the correct behaviour is asserted, and fails today.
          test.todo(`KNOWN HOLE ${name}: ${c.hole.note}`, () =>
            check(c, target, actor, expected))
          continue
        }
        test(name, () => check(c, target, actor, expected))
        if (c.wanted) {
          const wantedOutcome: Outcome = ALLOWED[c.wanted.gate].includes(actor)
            ? 'allowed'
            : 'denied'
          if (wantedOutcome !== expected) {
            test.todo(`KNOWN HOLE ${actor} should be ${wantedOutcome === 'allowed' ? 'allowed' : 'rejected'}: ${c.wanted.note}`, () =>
              check(c, target, actor, wantedOutcome))
          }
        }
      }
    })
  }
}
