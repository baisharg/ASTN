import { ConvexError, v } from 'convex/values'
import type {
  Infer,
  ObjectType,
  PropertyValidators,
  Validator,
} from 'convex/values'
import type {
  RegisteredAction,
  RegisteredMutation,
  RegisteredQuery,
} from 'convex/server'
import { action, internalQuery, mutation, query } from '../_generated/server'
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { getUserId } from './auth'
import { canAccessOpportunity, getOrgAccess } from './courseAccess'
import type { AccessLevel, OrgAccess } from './courseAccess'

/**
 * Access levels for public Convex functions. A function in a file listed in
 * `ACCESS_DECLARED_FILES` (eslint.config.mjs) is built with one of these
 * instead of the bare `query` / `mutation` / `action`, so the check runs
 * before the handler and the handler gets what the check loaded:
 *
 * - `publicQuery` / `publicMutation`: no login needed (apply pages, poll and
 *   survey links). Each one is listed in `PUBLIC_OR_OWN`
 *   (convex/permissions/coverage.helpers.ts) with the reason.
 * - `memberQuery` / `memberMutation`: a signed-in person acting on their own
 *   data. The handler gets `userId`.
 * - `courseQuery` / `courseMutation` / `courseAction`: an opportunity's
 *   course, at `level` 'read', 'edit' or 'admin' (an org admin who reaches
 *   the opportunity). `load` finds the record from the arguments (the
 *   opportunity, or a poll, survey, application or draft and its
 *   opportunity); access is checked against that opportunity's org and
 *   course with `getOrgAccess` / `canAccessOpportunity`, never against an
 *   org or user the caller passes. The handler gets the loaded records,
 *   `userId` and `access`.
 * - `orgQuery` / `orgMutation`: org-wide functions with no opportunity
 *   ('admin': canonicals, footer, counts; 'team': an admin or anyone with a
 *   course grant).
 *
 * Internal functions stay bare: only other Convex functions can call them.
 */

type ReturnsValidator = Validator<any, 'required', any>
type Ctx = QueryCtx | MutationCtx

export type CourseLevel = AccessLevel | 'admin'

/** What a course function acts on: at least the opportunity it belongs to. */
export interface CourseRecord {
  opportunity: Pick<Doc<'orgOpportunities'>, 'orgId' | 'tags'>
}

export interface Granted {
  userId: string
  access: OrgAccess
}

/** Whether `access` reaches `opportunity` at `level`. */
export function reachesOpportunity(
  access: OrgAccess | null,
  opportunity: Pick<Doc<'orgOpportunities'>, 'tags'>,
  level: CourseLevel,
): boolean {
  if (level === 'admin') {
    return (
      access?.isAdmin === true &&
      canAccessOpportunity(access, opportunity, 'edit')
    )
  }
  return canAccessOpportunity(access, opportunity, level)
}

function deniedMessage(level: CourseLevel): string {
  return level === 'edit' ? 'Edit access required' : 'Admin access required'
}

// ── Loaders: the record a course function acts on, and its opportunity ─────

export async function loadOpportunity(
  ctx: Ctx,
  opportunityId: Id<'orgOpportunities'>,
): Promise<{ opportunity: Doc<'orgOpportunities'> } | null> {
  const opportunity = await ctx.db.get('orgOpportunities', opportunityId)
  return opportunity ? { opportunity } : null
}

export async function loadPoll(
  ctx: Ctx,
  pollId: Id<'availabilityPolls'>,
): Promise<{
  poll: Doc<'availabilityPolls'>
  opportunity: Doc<'orgOpportunities'>
} | null> {
  const poll = await ctx.db.get('availabilityPolls', pollId)
  if (!poll) return null
  const opportunity = await ctx.db.get('orgOpportunities', poll.opportunityId)
  return opportunity ? { poll, opportunity } : null
}

export async function loadSurvey(
  ctx: Ctx,
  surveyId: Id<'feedbackSurveys'>,
): Promise<{
  survey: Doc<'feedbackSurveys'>
  opportunity: Doc<'orgOpportunities'>
} | null> {
  const survey = await ctx.db.get('feedbackSurveys', surveyId)
  if (!survey) return null
  const opportunity = await ctx.db.get('orgOpportunities', survey.opportunityId)
  return opportunity ? { survey, opportunity } : null
}

export async function loadApplication(
  ctx: Ctx,
  applicationId: Id<'opportunityApplications'>,
): Promise<{
  application: Doc<'opportunityApplications'>
  opportunity: Doc<'orgOpportunities'>
} | null> {
  const application = await ctx.db.get('opportunityApplications', applicationId)
  if (!application) return null
  const opportunity = await ctx.db.get(
    'orgOpportunities',
    application.opportunityId,
  )
  return opportunity ? { application, opportunity } : null
}

export async function loadDraft(
  ctx: Ctx,
  draftId: Id<'emailOutbox'>,
): Promise<{
  draft: Doc<'emailOutbox'>
  opportunity: Doc<'orgOpportunities'>
} | null> {
  const draft = await ctx.db.get('emailOutbox', draftId)
  if (!draft) return null
  const opportunity = await ctx.db.get('orgOpportunities', draft.opportunityId)
  return opportunity ? { draft, opportunity } : null
}

// ── Public ──────────────────────────────────────────────────────────────────

/** No login needed. List the function in PUBLIC_OR_OWN with the reason. */
export const publicQuery = query
/** No login needed. List the function in PUBLIC_OR_OWN with the reason. */
export const publicMutation = mutation

// ── Signed-in member, own data ──────────────────────────────────────────────

interface MemberDef<
  A extends PropertyValidators,
  R extends ReturnsValidator,
  C,
> {
  args: A
  returns: R
  /** Returned to a signed-out caller instead of throwing "Not authenticated". */
  signedOut?: () => Infer<R>
  handler: (
    ctx: C,
    args: ObjectType<A>,
    caller: { userId: string },
  ) => Promise<Infer<R>>
}

function memberHandler<
  A extends PropertyValidators,
  R extends ReturnsValidator,
  C extends Ctx,
>(def: MemberDef<A, R, C>) {
  return async (ctx: C, args: ObjectType<A>): Promise<Infer<R>> => {
    const userId = await getUserId(ctx)
    if (!userId) {
      if (def.signedOut) return def.signedOut()
      throw new ConvexError('Not authenticated')
    }
    return await def.handler(ctx, args, { userId })
  }
}

export function memberQuery<
  A extends PropertyValidators,
  R extends ReturnsValidator,
>(
  def: MemberDef<A, R, QueryCtx>,
): RegisteredQuery<'public', ObjectType<A>, Promise<Infer<R>>> {
  return query({
    args: def.args,
    returns: def.returns,
    handler: memberHandler(def) as any,
  }) as RegisteredQuery<'public', ObjectType<A>, Promise<Infer<R>>>
}

export function memberMutation<
  A extends PropertyValidators,
  R extends ReturnsValidator,
>(
  def: MemberDef<A, R, MutationCtx>,
): RegisteredMutation<'public', ObjectType<A>, Promise<Infer<R>>> {
  return mutation({
    args: def.args,
    returns: def.returns,
    handler: memberHandler(def) as any,
  }) as RegisteredMutation<'public', ObjectType<A>, Promise<Infer<R>>>
}

// ── Course: an opportunity, through its org and course tag ──────────────────

interface CourseDef<
  A extends PropertyValidators,
  R extends ReturnsValidator,
  L extends CourseRecord,
  C,
> {
  level: CourseLevel
  args: A
  returns: R
  /** The record the call acts on and its opportunity; null when missing. */
  load: (ctx: C, args: ObjectType<A>) => Promise<L | null>
  /**
   * When `load` finds nothing: the error to throw (default "Not found"), or
   * a function giving the value to return instead.
   */
  missing?: string | (() => Infer<R>)
  /**
   * Returned instead of throwing when the caller is signed out or lacks
   * access, for queries whose page treats "no access" as "nothing there".
   */
  denied?: () => Infer<R>
  handler: (
    ctx: C,
    args: ObjectType<A>,
    granted: L & Granted,
  ) => Promise<Infer<R>>
}

function courseHandler<
  A extends PropertyValidators,
  R extends ReturnsValidator,
  L extends CourseRecord,
  C extends Ctx,
>(def: CourseDef<A, R, L, C>) {
  return async (ctx: C, args: ObjectType<A>): Promise<Infer<R>> => {
    const userId = await getUserId(ctx)
    if (!userId) {
      if (def.denied) return def.denied()
      throw new ConvexError('Not authenticated')
    }
    const loaded = await def.load(ctx, args)
    if (!loaded) {
      if (typeof def.missing === 'function') return def.missing()
      throw new ConvexError(def.missing ?? 'Not found')
    }
    const access = await getOrgAccess(ctx, userId, loaded.opportunity.orgId)
    if (!access || !reachesOpportunity(access, loaded.opportunity, def.level)) {
      if (def.denied) return def.denied()
      throw new ConvexError(deniedMessage(def.level))
    }
    return await def.handler(ctx, args, { ...loaded, userId, access })
  }
}

export function courseQuery<
  A extends PropertyValidators,
  R extends ReturnsValidator,
  L extends CourseRecord,
>(
  def: CourseDef<A, R, L, QueryCtx>,
): RegisteredQuery<'public', ObjectType<A>, Promise<Infer<R>>> {
  return query({
    args: def.args,
    returns: def.returns,
    handler: courseHandler(def) as any,
  }) as RegisteredQuery<'public', ObjectType<A>, Promise<Infer<R>>>
}

export function courseMutation<
  A extends PropertyValidators,
  R extends ReturnsValidator,
  L extends CourseRecord,
>(
  def: CourseDef<A, R, L, MutationCtx>,
): RegisteredMutation<'public', ObjectType<A>, Promise<Infer<R>>> {
  return mutation({
    args: def.args,
    returns: def.returns,
    handler: courseHandler(def) as any,
  }) as RegisteredMutation<'public', ObjectType<A>, Promise<Infer<R>>>
}

/** What a course action acts on: an opportunity, or a poll of one. */
export type CourseTarget =
  | { opportunityId: Id<'orgOpportunities'> }
  | { pollId: Id<'availabilityPolls'> }

/** Whether `userId` reaches the target's opportunity at `level`. */
export const canReach = internalQuery({
  args: {
    userId: v.string(),
    level: v.union(v.literal('read'), v.literal('edit'), v.literal('admin')),
    opportunityId: v.optional(v.id('orgOpportunities')),
    pollId: v.optional(v.id('availabilityPolls')),
  },
  returns: v.boolean(),
  handler: async (ctx, { userId, level, opportunityId, pollId }) => {
    const loaded = opportunityId
      ? await loadOpportunity(ctx, opportunityId)
      : pollId
        ? await loadPoll(ctx, pollId)
        : null
    if (!loaded) return false
    const access = await getOrgAccess(ctx, userId, loaded.opportunity.orgId)
    return reachesOpportunity(access, loaded.opportunity, level)
  },
})

interface CourseActionDef<
  A extends PropertyValidators,
  R extends ReturnsValidator,
> {
  level: CourseLevel
  args: A
  returns: R
  /** The opportunity (or poll) the call acts on, from its arguments. */
  target: (args: ObjectType<A>) => CourseTarget
  handler: (
    ctx: ActionCtx,
    args: ObjectType<A>,
    caller: { userId: string },
  ) => Promise<Infer<R>>
}

export function courseAction<
  A extends PropertyValidators,
  R extends ReturnsValidator,
>(
  def: CourseActionDef<A, R>,
): RegisteredAction<'public', ObjectType<A>, Promise<Infer<R>>> {
  return action({
    args: def.args,
    returns: def.returns,
    handler: (async (ctx: ActionCtx, args: ObjectType<A>) => {
      const identity = await ctx.auth.getUserIdentity()
      if (!identity) throw new ConvexError('Not authenticated')
      const userId = identity.subject
      const ok: boolean = await ctx.runQuery(internal.lib.access.canReach, {
        userId,
        level: def.level,
        ...def.target(args),
      })
      if (!ok) throw new ConvexError(deniedMessage(def.level))
      return await def.handler(ctx, args, { userId })
    }) as any,
  }) as RegisteredAction<'public', ObjectType<A>, Promise<Infer<R>>>
}

// ── Org-wide: no opportunity involved ───────────────────────────────────────

interface OrgDef<A extends PropertyValidators, R extends ReturnsValidator, C> {
  /** 'admin': org admins. 'team': admins and members with a course grant. */
  role: 'admin' | 'team'
  args: A
  returns: R
  /** The org the call reads or changes. */
  org: (args: ObjectType<A>) => Id<'organizations'>
  /** Returned instead of throwing when the caller is signed out or not let in. */
  denied?: () => Infer<R>
  handler: (
    ctx: C,
    args: ObjectType<A>,
    granted: Granted & { orgId: Id<'organizations'> },
  ) => Promise<Infer<R>>
}

function orgHandler<
  A extends PropertyValidators,
  R extends ReturnsValidator,
  C extends Ctx,
>(def: OrgDef<A, R, C>) {
  return async (ctx: C, args: ObjectType<A>): Promise<Infer<R>> => {
    const userId = await getUserId(ctx)
    if (!userId) {
      if (def.denied) return def.denied()
      throw new ConvexError('Not authenticated')
    }
    const orgId = def.org(args)
    const access = await getOrgAccess(ctx, userId, orgId)
    const allowed =
      def.role === 'admin'
        ? access?.isAdmin === true
        : !!access && (access.isAdmin || access.courses.size > 0)
    if (!access || !allowed) {
      if (def.denied) return def.denied()
      throw new ConvexError('Admin access required')
    }
    return await def.handler(ctx, args, { userId, access, orgId })
  }
}

export function orgQuery<
  A extends PropertyValidators,
  R extends ReturnsValidator,
>(
  def: OrgDef<A, R, QueryCtx>,
): RegisteredQuery<'public', ObjectType<A>, Promise<Infer<R>>> {
  return query({
    args: def.args,
    returns: def.returns,
    handler: orgHandler(def) as any,
  }) as RegisteredQuery<'public', ObjectType<A>, Promise<Infer<R>>>
}

export function orgMutation<
  A extends PropertyValidators,
  R extends ReturnsValidator,
>(
  def: OrgDef<A, R, MutationCtx>,
): RegisteredMutation<'public', ObjectType<A>, Promise<Infer<R>>> {
  return mutation({
    args: def.args,
    returns: def.returns,
    handler: orgHandler(def) as any,
  }) as RegisteredMutation<'public', ObjectType<A>, Promise<Infer<R>>>
}
