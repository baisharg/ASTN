// Every change to a role, the owner flag or a course grant leaves a row in
// permissionChanges saying who made it, to whom, what changed and through
// which function.
import { api, internal } from '../_generated/api'
import { SUBJECT, asActor, newBackend, seed } from './harness.helpers'
import type { Backend, Fixture } from './harness.helpers'

declare const describe: (name: string, fn: () => void) => void
declare const test: (name: string, fn: () => Promise<void>) => void
declare const expect: <T>(actual: T) => {
  toBe(expected: unknown): void
  toEqual(expected: unknown): void
}

async function changes(t: Backend, fx: Fixture) {
  const rows = await t.run(
    async (ctx) =>
      await ctx.db
        .query('permissionChanges')
        .withIndex('by_orgId', (q) => q.eq('orgId', fx.orgId))
        .collect(),
  )
  return rows.map(({ userId, by, change, course, from, to, via }) => ({
    userId,
    by,
    change,
    course,
    from,
    to,
    via,
  }))
}

describe('the permission log', () => {
  test('starts empty', async () => {
    const t = newBackend()
    const fx = await seed(t)
    expect(await changes(t, fx)).toEqual([])
  })

  test('records a demotion, with the owner flag it took', async () => {
    const t = newBackend()
    const fx = await seed(t)
    await asActor(t, 'owner').mutation(api.courseAccess.setOwner, {
      orgId: fx.orgId,
      membershipId: fx.memberships.admin,
      owner: true,
    })
    await asActor(t, 'owner').mutation(api.orgs.admin.demoteToMember, {
      orgId: fx.orgId,
      membershipId: fx.memberships.admin,
    })
    expect(await changes(t, fx)).toEqual([
      {
        userId: SUBJECT.admin,
        by: SUBJECT.owner,
        change: 'owner',
        course: undefined,
        from: 'no',
        to: 'yes',
        via: 'courseAccess:setOwner',
      },
      {
        userId: SUBJECT.admin,
        by: SUBJECT.owner,
        change: 'role',
        course: undefined,
        from: 'admin',
        to: 'member',
        via: 'orgs/admin:demoteToMember',
      },
      {
        userId: SUBJECT.admin,
        by: SUBJECT.owner,
        change: 'owner',
        course: undefined,
        from: 'yes',
        to: 'no',
        via: 'orgs/admin:demoteToMember',
      },
    ])
  })

  test('records course grants given, changed and taken away', async () => {
    const t = newBackend()
    const fx = await seed(t)
    const owner = asActor(t, 'owner')
    const set = (level: 'read' | 'edit' | null) =>
      owner.mutation(api.courseAccess.setAccess, {
        orgId: fx.orgId,
        userId: SUBJECT.member,
        course: 'Governance',
        level,
      })
    await set('read')
    await set('edit')
    await set('edit')
    await set(null)
    const row = (from: string | null, to: string | null) => ({
      userId: SUBJECT.member,
      by: SUBJECT.owner,
      change: 'course',
      course: 'Governance',
      from,
      to,
      via: 'courseAccess:setAccess',
    })
    expect(await changes(t, fx)).toEqual([
      row(null, 'read'),
      row('read', 'edit'),
      row('edit', null),
    ])
  })

  test('records a promotion and the course grants it dropped', async () => {
    const t = newBackend()
    const fx = await seed(t)
    await asActor(t, 'owner').mutation(api.orgs.admin.promoteToAdmin, {
      orgId: fx.orgId,
      membershipId: fx.memberships.courseEditor,
    })
    const via = 'orgs/admin:promoteToAdmin'
    expect(await changes(t, fx)).toEqual([
      {
        userId: SUBJECT.courseEditor,
        by: SUBJECT.owner,
        change: 'role',
        course: undefined,
        from: 'member',
        to: 'admin',
        via,
      },
      {
        userId: SUBJECT.courseEditor,
        by: SUBJECT.owner,
        change: 'course',
        course: 'TAIS Course',
        from: 'edit',
        to: null,
        via,
      },
    ])
  })

  test('records someone removed from the org and leaving it', async () => {
    const t = newBackend()
    const fx = await seed(t)
    await asActor(t, 'admin').mutation(api.orgs.admin.removeMember, {
      orgId: fx.orgId,
      membershipId: fx.memberships.courseReader,
    })
    await asActor(t, 'member').mutation(api.orgs.membership.leaveOrg, {
      orgId: fx.orgId,
    })
    expect(await changes(t, fx)).toEqual([
      {
        userId: SUBJECT.courseReader,
        by: SUBJECT.admin,
        change: 'role',
        course: undefined,
        from: 'member',
        to: null,
        via: 'orgs/admin:removeMember',
      },
      {
        userId: SUBJECT.courseReader,
        by: SUBJECT.admin,
        change: 'course',
        course: 'TAIS Course',
        from: 'read',
        to: null,
        via: 'orgs/admin:removeMember',
      },
      {
        userId: SUBJECT.member,
        by: SUBJECT.member,
        change: 'role',
        course: undefined,
        from: 'member',
        to: null,
        via: 'orgs/membership:leaveOrg',
      },
    ])
  })

  test('a refused change records nothing', async () => {
    const t = newBackend()
    const fx = await seed(t)
    try {
      await asActor(t, 'admin').mutation(api.orgs.admin.demoteToMember, {
        orgId: fx.orgId,
        membershipId: fx.memberships.owner,
      })
    } catch {
      // Only owners may demote.
    }
    expect(await changes(t, fx)).toEqual([])
  })

  test('listForOrg reads it newest first, with names', async () => {
    const t = newBackend()
    const fx = await seed(t)
    await asActor(t, 'owner').mutation(api.orgs.admin.promoteToAdmin, {
      orgId: fx.orgId,
      membershipId: fx.memberships.member,
    })
    const rows = await t.query(internal.permissionLog.listForOrg, {
      orgSlug: fx.orgSlug,
    })
    expect(rows.length).toBe(1)
    expect(rows[0].change).toBe('role')
    expect(rows[0].to).toBe('admin')
    expect(rows[0].via).toBe('orgs/admin:promoteToAdmin')
  })
})
