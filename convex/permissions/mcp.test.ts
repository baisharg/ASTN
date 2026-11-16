// The MCP server (convex/mcp/) lets admins in and nobody else. The HTTP layer
// verifies a Clerk OAuth token and passes the subject to internal functions,
// which must check admin membership on every call. The token check itself
// (convex/mcp/server.ts, jwt.ts) needs a real HTTP request and is not covered
// here; these tests call the internal functions it dispatches to, with each
// actor's subject.
import { getFunctionName } from 'convex/server'
import type { FunctionReference } from 'convex/server'
import { internal } from '../_generated/api'
import { resolveOrgForAdmin } from '../mcp/data'
import {
  ACCESS_ERROR,
  ACTORS,
  SUBJECT,
  newBackend,
  seed,
} from './harness.helpers'
import type { Actor, Fixture } from './harness.helpers'

declare const describe: (name: string, fn: () => void) => void
declare const test: (name: string, fn: () => Promise<void>) => void
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

/** Admins of the org, and nobody else: not even a course editor. */
const MCP_ALLOWED: Array<Actor> = ['owner', 'admin']

/** The subject the MCP handler would pass down; a logged-out caller has none. */
const subjectOf = (actor: Actor) =>
  actor === 'anonymous' ? '' : SUBJECT[actor]

interface McpCase {
  label?: string
  kind: 'query' | 'mutation'
  ref: FunctionReference<any, 'internal'>
  args: (fx: Fixture) => Record<string, any>
}

const base = (fx: Fixture) => ({ orgSlug: fx.orgSlug })
const P = internal.mcp.platform
const D = internal.mcp.data
const PE = internal.mcp.people

const CASES: Array<McpCase> = [
  { kind: 'query', ref: P.orgStats, args: base },
  {
    kind: 'query',
    label: 'opportunities',
    ref: P.list,
    args: (fx) => ({ ...base(fx), resource: 'opportunities' }),
  },
  {
    kind: 'query',
    label: 'applications',
    ref: P.list,
    args: (fx) => ({ ...base(fx), resource: 'applications' }),
  },
  {
    kind: 'query',
    label: 'members',
    ref: P.list,
    args: (fx) => ({ ...base(fx), resource: 'members' }),
  },
  {
    kind: 'query',
    label: 'outbox',
    ref: P.list,
    args: (fx) => ({ ...base(fx), resource: 'outbox' }),
  },
  {
    kind: 'query',
    ref: P.getOne,
    args: (fx) => ({
      ...base(fx),
      resource: 'opportunities',
      id: fx.opp.taisDraft,
    }),
  },
  {
    kind: 'query',
    ref: P.surveyResults,
    args: (fx) => ({ ...base(fx), surveyId: fx.survey.taisDraft }),
  },
  {
    kind: 'query',
    ref: P.availabilityHeatmap,
    args: (fx) => ({ ...base(fx), pollId: fx.poll.taisDraft }),
  },
  {
    kind: 'mutation',
    ref: P.update,
    args: (fx) => ({
      ...base(fx),
      resource: 'opportunities',
      id: fx.opp.taisDraft,
      fields: { title: 'Renamed' },
    }),
  },
  {
    kind: 'mutation',
    ref: P.createOpportunity,
    args: (fx) => ({
      ...base(fx),
      title: 'New',
      description: 'New',
      type: 'course',
      formSource: 'custom',
    }),
  },
  {
    kind: 'mutation',
    ref: P.duplicateOpportunity,
    args: (fx) => ({ ...base(fx), id: fx.opp.taisDraft }),
  },
  {
    kind: 'mutation',
    ref: P.deleteOpportunity,
    args: (fx) => ({ ...base(fx), id: fx.opp.taisDraft }),
  },
  {
    kind: 'mutation',
    ref: P.createSurvey,
    args: (fx) => ({
      ...base(fx),
      opportunityId: fx.opp.taisDraft,
      title: 'Survey',
      formFields: [{ key: 'c', kind: 'textarea', label: 'C' }],
    }),
  },
  {
    kind: 'mutation',
    ref: P.createPoll,
    args: (fx) => ({ ...base(fx), opportunityId: fx.opp.taisDraft }),
  },
  { kind: 'query', ref: D.stats, args: base },
  {
    kind: 'query',
    ref: D.describeFields,
    args: (fx) => ({ ...base(fx), collection: 'contacts' }),
  },
  {
    kind: 'query',
    ref: D.listRecords,
    args: (fx) => ({ ...base(fx), collection: 'opportunities' }),
  },
  {
    kind: 'query',
    ref: D.listCrmPage,
    args: (fx) => ({
      ...base(fx),
      collection: 'contacts',
      cursor: null,
      numItems: 10,
    }),
  },
  {
    kind: 'query',
    ref: D.getRecord,
    args: (fx) => ({
      ...base(fx),
      collection: 'contacts',
      id: fx.crm.contact,
    }),
  },
  {
    kind: 'mutation',
    ref: D.createRecord,
    args: (fx) => ({
      ...base(fx),
      collection: 'contacts',
      fields: { name: 'New contact' },
    }),
  },
  {
    kind: 'mutation',
    ref: D.updateRecord,
    args: (fx) => ({
      ...base(fx),
      collection: 'contacts',
      id: fx.crm.contact,
      fields: { name: 'Renamed' },
    }),
  },
  {
    kind: 'mutation',
    ref: D.deleteRecord,
    args: (fx) => ({
      ...base(fx),
      collection: 'contacts',
      id: fx.crm.contact,
    }),
  },
  {
    kind: 'query',
    ref: PE.person,
    args: (fx) => ({ ...base(fx), contactId: fx.crm.contact }),
  },
  { kind: 'query', ref: PE.listActivities, args: base },
  { kind: 'query', ref: PE.duplicates, args: base },
  { kind: 'query', ref: PE.eventAttendance, args: base },
  {
    kind: 'mutation',
    ref: PE.createActivity,
    args: (fx) => ({
      ...base(fx),
      fields: { contactId: fx.crm.contact, kind: 'note', title: 'Called' },
    }),
  },
  {
    kind: 'mutation',
    ref: PE.mergeContacts,
    args: (fx) => ({
      ...base(fx),
      keepId: fx.crm.contact,
      mergeIds: [fx.crm.contact],
    }),
  },
]

for (const c of CASES) {
  const name = `${c.kind} ${getFunctionName(c.ref)}${c.label ? ` (${c.label})` : ''}`
  describe(`MCP ${name}`, () => {
    for (const actor of ACTORS) {
      const allowed = MCP_ALLOWED.includes(actor)
      test(`${actor} is ${allowed ? 'allowed' : 'rejected'}`, async () => {
        const t = newBackend()
        const fx = await seed(t)
        const args = { userId: subjectOf(actor), ...c.args(fx) }
        let refused = false
        let detail = ''
        try {
          if (c.kind === 'query') await t.query(c.ref, args)
          else await t.mutation(c.ref, args)
        } catch (error) {
          detail = error instanceof Error ? error.message : String(error)
          refused = ACCESS_ERROR.test(detail)
          // Past the admin check, an unrelated failure (a missing field, a
          // business rule) still means the caller was let in.
        }
        expect(refused).toBe(!allowed)
        if (refused) expect(detail.includes('Admin access required')).toBe(true)
      })
    }
  })
}

describe('MCP org discovery and the shared admin check', () => {
  test('myAdminOrgs lists the org only for its admins', async () => {
    const t = newBackend()
    const fx = await seed(t)
    for (const actor of ACTORS) {
      const orgs = (await t.query(internal.mcp.data.myAdminOrgs, {
        userId: subjectOf(actor),
      })) as Array<{ id: string }>
      const sees = orgs.map((o) => o.id)
      expect(sees.includes(fx.orgId)).toBe(MCP_ALLOWED.includes(actor))
      expect(sees.includes(fx.otherOrgId)).toBe(actor === 'otherOrgAdmin')
    }
  })

  for (const actor of ACTORS) {
    const allowed = MCP_ALLOWED.includes(actor)
    test(`resolveOrgForAdmin: ${actor} is ${allowed ? 'allowed' : 'rejected'}`, async () => {
      const t = newBackend()
      const fx = await seed(t)
      const result = await t
        .run(async (ctx) => {
          const org = await resolveOrgForAdmin(
            ctx,
            subjectOf(actor),
            fx.orgSlug,
          )
          return org._id
        })
        .then(
          () => 'allowed',
          (error: Error) => error.message,
        )
      expect(result).toBe(allowed ? 'allowed' : 'Admin access required')
    })
  }
})
