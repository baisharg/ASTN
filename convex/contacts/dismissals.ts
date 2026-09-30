import { ConvexError } from 'convex/values'
import { pairKey, planDismissalMove } from './mergeLogic'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/**
 * Pairs of contacts an admin marked as different people
 * (`crmDuplicateDismissals`, stored with `a < b`). findDuplicates never puts
 * such a pair in one group. Rows follow their contacts: a merge moves them to
 * the kept contact and a delete removes them.
 */

// The most dismissals read for one org, and for one contact.
export const MAX_DISMISSALS = 5000
const MAX_PER_CONTACT = 1000

function ordered(
  x: Id<'crmContacts'>,
  y: Id<'crmContacts'>,
): [Id<'crmContacts'>, Id<'crmContacts'>] {
  return x < y ? [x, y] : [y, x]
}

/** Every dismissed pair of the org, as pairKey strings. Throws past the cap. */
export async function dismissedPairs(
  ctx: QueryCtx,
  orgId: Id<'organizations'>,
): Promise<Set<string>> {
  const rows = await ctx.db
    .query('crmDuplicateDismissals')
    .withIndex('by_orgId_and_a_and_b', (q) => q.eq('orgId', orgId))
    .take(MAX_DISMISSALS + 1)
  if (rows.length > MAX_DISMISSALS) {
    throw new ConvexError(
      `Hay más de ${MAX_DISMISSALS} pares marcados como personas distintas; no se pueden leer todos`,
    )
  }
  return new Set(rows.map((d) => pairKey(d.a, d.b)))
}

async function rowsFor(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  contactId: Id<'crmContacts'>,
): Promise<Array<Doc<'crmDuplicateDismissals'>>> {
  const asA = await ctx.db
    .query('crmDuplicateDismissals')
    .withIndex('by_orgId_and_a_and_b', (q) =>
      q.eq('orgId', orgId).eq('a', contactId),
    )
    .take(MAX_PER_CONTACT + 1)
  const asB = await ctx.db
    .query('crmDuplicateDismissals')
    .withIndex('by_orgId_and_b', (q) => q.eq('orgId', orgId).eq('b', contactId))
    .take(MAX_PER_CONTACT + 1)
  if (asA.length > MAX_PER_CONTACT || asB.length > MAX_PER_CONTACT) {
    throw new ConvexError(
      `Un contacto tiene más de ${MAX_PER_CONTACT} pares marcados como personas distintas`,
    )
  }
  return [...asA, ...asB]
}

export async function findDismissal(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  x: Id<'crmContacts'>,
  y: Id<'crmContacts'>,
): Promise<Doc<'crmDuplicateDismissals'> | null> {
  const [a, b] = ordered(x, y)
  return await ctx.db
    .query('crmDuplicateDismissals')
    .withIndex('by_orgId_and_a_and_b', (q) =>
      q.eq('orgId', orgId).eq('a', a).eq('b', b),
    )
    .first()
}

export async function addDismissal(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  x: Id<'crmContacts'>,
  y: Id<'crmContacts'>,
  createdBy: string,
): Promise<boolean> {
  if (x === y || (await findDismissal(ctx, orgId, x, y))) return false
  const [a, b] = ordered(x, y)
  await ctx.db.insert('crmDuplicateDismissals', {
    orgId,
    a,
    b,
    createdBy,
    createdAt: Date.now(),
  })
  return true
}

/** Remove a deleted contact's dismissals. */
export async function deleteDismissalsFor(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  contactId: Id<'crmContacts'>,
): Promise<void> {
  for (const row of await rowsFor(ctx, orgId, contactId)) {
    await ctx.db.delete('crmDuplicateDismissals', row._id)
  }
}

/**
 * Move the merged contacts' dismissals onto the kept one (see
 * planDismissalMove): "A is not C" becomes "keep is not C".
 */
export async function moveDismissals(
  ctx: MutationCtx,
  orgId: Id<'organizations'>,
  keepId: Id<'crmContacts'>,
  mergedIds: Array<Id<'crmContacts'>>,
): Promise<void> {
  const rows: Array<Doc<'crmDuplicateDismissals'>> = []
  for (const id of [keepId, ...mergedIds]) {
    rows.push(...(await rowsFor(ctx, orgId, id)))
  }
  const plan = planDismissalMove(rows, keepId, mergedIds)
  for (const id of plan.remove) {
    await ctx.db.delete(
      'crmDuplicateDismissals',
      id as Id<'crmDuplicateDismissals'>,
    )
  }
  for (const r of plan.repoint) {
    await ctx.db.patch(
      'crmDuplicateDismissals',
      r._id as Id<'crmDuplicateDismissals'>,
      {
        a: r.a as Id<'crmContacts'>,
        b: r.b as Id<'crmContacts'>,
      },
    )
  }
}
