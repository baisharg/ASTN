import type { QueryCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { getLegacyUserEmail } from './auth'
import { extractApplicantEmailFromResponses } from './applicantEmail'
import { resolveApplicantDisplayName } from './applicantName'
import type { FormField } from './formFields'

/**
 * Resolve an applicant's display name and email from a single source of truth,
 * so the recipient table and the actual broadcast send never disagree about
 * who gets an email.
 *
 * Email resolution order: guestEmail → profile.email → legacy users table →
 * email typed into the application form (`responses`). Returns `email: ''` when
 * no address can be resolved.
 */
export async function resolveApplicantContact(
  ctx: QueryCtx,
  app: Doc<'opportunityApplications'>,
  formFields: Array<FormField> | undefined,
  nameFallback: string,
): Promise<{ name: string; email: string }> {
  let email = ''
  let name: string

  if (app.guestEmail) {
    email = app.guestEmail
    name = resolveApplicantDisplayName({
      responses: app.responses,
      fallback: nameFallback,
    })
  } else if (app.userId) {
    const profile = await ctx.db
      .query('profiles')
      .withIndex('by_user', (q) => q.eq('userId', app.userId!))
      .first()

    name = resolveApplicantDisplayName({
      profileName: profile?.name,
      responses: app.responses,
      fallback: nameFallback,
    })

    email = profile?.email ?? (await getLegacyUserEmail(ctx, app.userId)) ?? ''
  } else {
    name = resolveApplicantDisplayName({
      responses: app.responses,
      fallback: nameFallback,
    })
  }

  // Final fallback: the email the applicant typed into the form itself.
  if (!email) {
    email = extractApplicantEmailFromResponses(app.responses, formFields) ?? ''
  }

  return { name, email }
}
