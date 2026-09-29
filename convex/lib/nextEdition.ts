import type { MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { syncOutboxOnStatusChange } from '../emails/outbox'
import { resolveApplicantContact } from './applicantContact'
import type { FormField } from './formFields'

/**
 * "Next edition": someone who could not take a course this time and was
 * promised a place in the next one. When that person shows up in a later
 * edition of the same course — through the application form, the poll's
 * generic link, anywhere — they are accepted without anyone re-reviewing
 * them.
 *
 * Two opportunities are the same course when they share a course tag.
 * Tags that describe the format rather than the course are ignored, so a
 * TAIS edition and a Governance edition that are both "Part-time" do not
 * count as the same course. Any other tag is a course tag, which means a
 * new course works as soon as its editions share a tag — no code change.
 */
const NON_COURSE_TAGS = new Set([
  'eoi',
  'part-time',
  'intensive',
  'feedback',
  'test',
])

function courseTags(opportunity: Doc<'orgOpportunities'>): Set<string> {
  return new Set(
    (opportunity.tags ?? [])
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t && !NON_COURSE_TAGS.has(t)),
  )
}

function sameCourse(
  a: Doc<'orgOpportunities'>,
  b: Doc<'orgOpportunities'>,
): boolean {
  const tagsA = courseTags(a)
  for (const tag of courseTags(b)) if (tagsA.has(tag)) return true
  return false
}

/**
 * The pending Next edition promise this person has for the application's
 * course, if any: the most recent `next_edition` application in another
 * edition of the same course, matched by account or by email, that has not
 * already been honoured in some other edition.
 */
async function findPendingNextEdition(
  ctx: MutationCtx,
  application: Doc<'opportunityApplications'>,
  opportunity: Doc<'orgOpportunities'>,
): Promise<Doc<'opportunityApplications'> | null> {
  if (courseTags(opportunity).size === 0) return null

  const { email } = await resolveApplicantContact(
    ctx,
    application,
    opportunity.formFields as Array<FormField> | undefined,
    '',
  )
  const myEmail = email.trim().toLowerCase()
  if (!myEmail && !application.userId) return null

  const promises = (
    await ctx.db
      .query('opportunityApplications')
      .withIndex('by_org', (q) => q.eq('orgId', opportunity.orgId))
      .collect()
  )
    .filter(
      (a) =>
        a.status === 'next_edition' &&
        a.nextEditionAcceptedIn === undefined &&
        a.opportunityId !== opportunity._id,
    )
    .sort((a, b) => b.submittedAt - a.submittedAt)

  const opportunities = new Map<
    Id<'orgOpportunities'>,
    Doc<'orgOpportunities'> | null
  >()
  for (const candidate of promises) {
    if (!opportunities.has(candidate.opportunityId)) {
      opportunities.set(
        candidate.opportunityId,
        await ctx.db.get('orgOpportunities', candidate.opportunityId),
      )
    }
    const edition = opportunities.get(candidate.opportunityId)
    if (!edition || !sameCourse(edition, opportunity)) continue

    if (application.userId && candidate.userId === application.userId)
      return candidate
    if (!myEmail) continue
    const theirs = await resolveApplicantContact(
      ctx,
      candidate,
      edition.formFields as Array<FormField> | undefined,
      '',
    )
    if (theirs.email.trim().toLowerCase() === myEmail) return candidate
  }
  return null
}

/**
 * Accept the application if its person was promised a place in this course's
 * next edition. Only undecided applications (submitted / under review) are
 * touched, so a decision an admin already made is never overridden. The
 * promise is marked as honoured, so it cannot accept the same person again in
 * a third edition, and the accepted email is drafted into the outbox like for
 * any other acceptance.
 */
export async function maybeAutoAcceptFromNextEdition(
  ctx: MutationCtx,
  applicationId: Id<'opportunityApplications'>,
): Promise<boolean> {
  const application = await ctx.db.get('opportunityApplications', applicationId)
  if (!application) return false
  if (
    application.status !== 'submitted' &&
    application.status !== 'under_review'
  )
    return false
  const opportunity = await ctx.db.get(
    'orgOpportunities',
    application.opportunityId,
  )
  if (!opportunity) return false

  const promise = await findPendingNextEdition(ctx, application, opportunity)
  if (!promise) return false

  const now = Date.now()
  await ctx.db.patch('opportunityApplications', application._id, {
    status: 'accepted',
    reviewedAt: now,
    reviewedBy: 'system',
    autoAcceptedFrom: promise._id,
    updatedAt: now,
  })
  await ctx.db.patch('opportunityApplications', promise._id, {
    nextEditionAcceptedIn: opportunity._id,
  })

  const accepted = await ctx.db.get('opportunityApplications', application._id)
  if (accepted) {
    await syncOutboxOnStatusChange(ctx, {
      application: accepted,
      status: 'accepted',
      opportunity,
    })
  }
  return true
}
