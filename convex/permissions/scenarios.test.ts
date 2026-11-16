// What each person sees (not only whether a call is refused), the account a
// request cannot cross into another org with, and what public pages show.
import { api } from '../_generated/api'
import {
  ACCESS_ERROR,
  ACTORS,
  APPLICANT,
  asActor,
  newBackend,
  seed,
} from './harness.helpers'
import type { Actor } from './harness.helpers'

declare const describe: (name: string, fn: () => void) => void
declare const test: (name: string, fn: () => Promise<void>) => void
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

async function outcome<T>(run: () => Promise<T>): Promise<T | 'refused'> {
  try {
    return await run()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (ACCESS_ERROR.test(message)) return 'refused'
    throw error
  }
}

describe('the admin list of opportunities shows each person their own courses', () => {
  const ALL = [
    'Governance active',
    'Governance draft',
    'No course draft',
    'TAIS active',
    'TAIS draft',
  ]
  const TAIS = ['TAIS active', 'TAIS draft']
  const expected: Record<Actor, Array<string> | 'refused'> = {
    owner: ALL,
    admin: ALL,
    courseEditor: TAIS,
    courseReader: TAIS,
    member: 'refused',
    outsider: 'refused',
    otherOrgAdmin: 'refused',
    platformAdmin: 'refused',
    anonymous: 'refused',
  }
  for (const actor of ACTORS) {
    test(`${actor}`, async () => {
      const t = newBackend()
      const fx = await seed(t)
      const result = await outcome(() =>
        asActor(t, actor).query(api.orgOpportunities.listAllByOrg, {
          orgId: fx.orgId,
        }),
      )
      expect(
        result === 'refused' ? result : result.map((o) => o.title).sort(),
      ).toEqual(expected[actor])
    })
  }
})

describe('applications listed for a course reader stay inside the course', () => {
  test('a TAIS reader cannot read Governance applications, a TAIS one yes', async () => {
    const t = newBackend()
    const fx = await seed(t)
    const reader = asActor(t, 'courseReader')
    const tais = await reader.query(
      api.opportunityApplications.listByOpportunity,
      {
        opportunityId: fx.opp.taisDraft,
      },
    )
    expect(tais.length).toBe(1)
    expect(
      await outcome(() =>
        reader.query(api.opportunityApplications.listByOpportunity, {
          opportunityId: fx.opp.govDraft,
        }),
      ),
    ).toBe('refused')
  })

  test('a read grant does not change a status; an edit grant does', async () => {
    const t = newBackend()
    const fx = await seed(t)
    const args = {
      applicationId: fx.app.taisDraft,
      status: 'accepted' as const,
    }
    expect(
      await outcome(() =>
        asActor(t, 'courseReader').mutation(
          api.opportunityApplications.updateStatus,
          args,
        ),
      ),
    ).toBe('refused')
    expect(
      await outcome(() =>
        asActor(t, 'courseEditor').mutation(
          api.opportunityApplications.updateStatus,
          args,
        ),
      ),
    ).toBe(null)
  })
})

describe('public pages show only what is public', () => {
  test('an active opportunity is readable by anyone, a draft only by its team', async () => {
    const t = newBackend()
    const fx = await seed(t)
    for (const actor of ACTORS) {
      const as = asActor(t, actor)
      const active = await as.query(api.orgOpportunities.get, {
        id: fx.opp.taisActive,
      })
      expect(active?.title).toBe('TAIS active')
      const draft = await as.query(api.orgOpportunities.get, {
        id: fx.opp.taisDraft,
      })
      const sees = ['owner', 'admin', 'courseEditor', 'courseReader'].includes(
        actor,
      )
      expect(draft === null).toBe(!sees)
    }
  })

  test('the public listing holds active opportunities only', async () => {
    const t = newBackend()
    const fx = await seed(t)
    const listed = await asActor(t, 'anonymous').query(
      api.orgOpportunities.listByOrg,
      { orgId: fx.orgId },
    )
    expect(listed.map((o) => o.title).sort()).toEqual([
      'Governance active',
      'TAIS active',
    ])
  })

  test("the availability grid of an application shows only the caller's own answers", async () => {
    const t = newBackend()
    const fx = await seed(t)
    const asApplicant = t.withIdentity({ subject: APPLICANT })
    const own = await asApplicant.query(
      api.availabilityPolls.getApplicationAvailability,
      {
        opportunityId: fx.opp.taisDraft,
      },
    )
    expect(own?.slots).toEqual({ '0|540': 'available' })
    for (const actor of ACTORS) {
      const seen = await asActor(t, actor).query(
        api.availabilityPolls.getApplicationAvailability,
        { opportunityId: fx.opp.taisDraft },
      )
      expect(seen?.slots ?? null).toBe(null)
    }
  })
})

describe('who gets which access, as the app asks for it', () => {
  const expected: Record<Actor, unknown> = {
    owner: { isAdmin: true, canManage: true, courses: [] },
    admin: { isAdmin: true, canManage: false, courses: [] },
    courseEditor: {
      isAdmin: false,
      canManage: false,
      courses: [{ course: 'TAIS Course', level: 'edit' }],
    },
    courseReader: {
      isAdmin: false,
      canManage: false,
      courses: [{ course: 'TAIS Course', level: 'read' }],
    },
    member: { isAdmin: false, canManage: false, courses: [] },
    outsider: null,
    otherOrgAdmin: null,
    platformAdmin: null,
    anonymous: null,
  }
  for (const actor of ACTORS) {
    test(`${actor}`, async () => {
      const t = newBackend()
      const fx = await seed(t)
      const access = await asActor(t, actor).query(api.courseAccess.myAccess, {
        orgId: fx.orgId,
      })
      expect(access).toEqual(expected[actor])
    })
  }
})

describe('nobody crosses into another org', () => {
  const REFUSED = /Not found|not found|access required|Only owners|membership/i

  async function refusal(run: () => Promise<unknown>): Promise<string> {
    try {
      await run()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return REFUSED.test(message) ? 'refused' : `other error: ${message}`
    }
    return 'allowed'
  }

  test("another org's admin cannot reach this org's CRM records by naming their own org", async () => {
    const t = newBackend()
    const fx = await seed(t)
    const other = asActor(t, 'otherOrgAdmin')
    const own = { orgId: fx.otherOrgId }
    expect(
      await other.query(api.crm.getContact, { ...own, id: fx.crm.contact }),
    ).toBe(null)
    expect(
      await refusal(() =>
        other.mutation(api.crm.updateContact, {
          ...own,
          id: fx.crm.contact,
          field: 'name',
          value: 'Hijacked',
        }),
      ),
    ).toBe('refused')
    expect(
      await refusal(() =>
        other.mutation(api.crm.deleteContact, { ...own, id: fx.crm.contact }),
      ),
    ).toBe('refused')
    const contact = await t.run(async (ctx) => ctx.db.get(fx.crm.contact))
    expect(contact?.name).toBe('Contact')
  })

  test("another org's admin cannot remove or promote this org's members", async () => {
    const t = newBackend()
    const fx = await seed(t)
    const other = asActor(t, 'otherOrgAdmin')
    for (const run of [
      () =>
        other.mutation(api.orgs.admin.removeMember, {
          orgId: fx.otherOrgId,
          membershipId: fx.memberships.member,
        }),
      () =>
        other.mutation(api.orgs.admin.promoteToAdmin, {
          orgId: fx.otherOrgId,
          membershipId: fx.memberships.member,
        }),
      () =>
        other.mutation(api.courseAccess.setOwner, {
          orgId: fx.otherOrgId,
          membershipId: fx.memberships.admin,
          owner: true,
        }),
    ]) {
      expect(await refusal(run)).toBe('refused')
    }
    const member = await t.run(async (ctx) => ctx.db.get(fx.memberships.member))
    expect(member?.role).toBe('member')
    const admin = await t.run(async (ctx) => ctx.db.get(fx.memberships.admin))
    expect(admin?.isOwner).toBe(undefined)
  })

  test("this org's owner cannot act inside another org", async () => {
    const t = newBackend()
    const fx = await seed(t)
    const owner = asActor(t, 'owner')
    expect(
      await refusal(() =>
        owner.query(api.crm.listContacts, { orgId: fx.otherOrgId }),
      ),
    ).toBe('refused')
    expect(
      await refusal(() =>
        owner.mutation(api.orgOpportunities.create, {
          orgId: fx.otherOrgId,
          title: 'Planted',
          description: 'x',
          type: 'course',
          status: 'draft',
          featured: false,
          formSource: 'custom',
        }),
      ),
    ).toBe('refused')
    expect(
      await refusal(() =>
        owner.mutation(api.courseAccess.setAccess, {
          orgId: fx.otherOrgId,
          userId: 'user_owner',
          course: 'TAIS Course',
          level: 'edit',
        }),
      ),
    ).toBe('refused')
  })

  test("a course grant in this org gives nothing in another org's opportunities", async () => {
    const t = newBackend()
    const fx = await seed(t)
    const otherOpp = await t.run(async (ctx) =>
      ctx.db.insert('orgOpportunities', {
        orgId: fx.otherOrgId,
        title: 'Other org TAIS',
        description: 'x',
        type: 'course',
        status: 'draft',
        featured: false,
        tags: ['TAIS Course'],
        createdAt: 0,
        updatedAt: 0,
      }),
    )
    for (const actor of ['courseEditor', 'courseReader'] as const) {
      expect(
        await asActor(t, actor).query(api.orgOpportunities.get, {
          id: otherOpp,
        }),
      ).toBe(null)
    }
  })
})

describe('survey answers and the agent log', () => {
  test("a person reads their own survey answers, not anyone else's", async () => {
    const t = newBackend()
    await seed(t)
    const own = await t
      .withIdentity({ subject: APPLICANT })
      .query(api.feedbackSurveys.getSurveyResponsesForUser, {
        userId: APPLICANT,
      })
    expect(own.length > 0).toBe(true)
    const other = await asActor(t, 'outsider').query(
      api.feedbackSurveys.getSurveyResponsesForUser,
      { userId: APPLICANT },
    )
    expect(other).toEqual([])
    const otherOrgAdmin = await asActor(t, 'otherOrgAdmin').query(
      api.feedbackSurveys.getSurveyResponsesForUser,
      { userId: APPLICANT },
    )
    expect(otherOrgAdmin).toEqual([])
  })

  test('the agent log refuses a userId that is not the caller', async () => {
    const t = newBackend()
    const fx = await seed(t)
    expect(
      await outcome(() =>
        asActor(t, 'admin').mutation(api.agentActionLog.logAgentAction, {
          userId: 'user_owner',
          orgId: fx.orgId,
          toolName: 'x',
          params: '{}',
          result: '{}',
          approvalStatus: 'auto',
        }),
      ),
    ).toBe('refused')
  })
})
