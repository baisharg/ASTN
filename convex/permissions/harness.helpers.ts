// Test harness for the permission matrix. Not a Convex function module: the
// double extension keeps it out of the bundle `convex deploy` builds.
import { convexTest } from 'convex-test'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import schema from '../schema'
import type { Id } from '../_generated/dataModel'

const CONVEX_DIR = join(import.meta.dirname, '..')

/** Every Convex function module, the way the bundler picks them. */
export function convexModuleFiles(dir = CONVEX_DIR): Array<string> {
  const out: Array<string> = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry === 'node_modules' || entry === '_generated') continue
      out.push(...convexModuleFiles(path))
      continue
    }
    if (!/\.(ts|js)$/.test(entry) || entry.endsWith('.d.ts')) continue
    // Same filter as the Convex bundler: dotfiles, schema and any file with
    // more than one dot (tests, helpers, config) are not function modules.
    if (entry.startsWith('.') || entry === 'schema.ts') continue
    if ((entry.match(/\./g) ?? []).length > 1) continue
    out.push(path)
  }
  return out.sort()
}

const modules: Record<string, () => Promise<unknown>> = {}
for (const file of convexModuleFiles()) {
  modules['/convex/' + relative(CONVEX_DIR, file)] = () => import(file)
}
// convex-test locates the functions directory through `_generated`.
for (const f of ['api.js', 'server.js']) {
  const file = join(CONVEX_DIR, '_generated', f)
  modules['/convex/_generated/' + f] = () => import(file)
}

export function newBackend() {
  return convexTest(schema, modules)
}
export type Backend = ReturnType<typeof newBackend>

/** What a refusal says: the access check threw, whatever its wording. */
export const ACCESS_ERROR =
  /Not authenticated|access required|Only owners|Not authorized|Unauthorized|not a member|You can only tag|Access denied/i

// ── Actors ──────────────────────────────────────────────────────────────────

export const ACTORS = [
  'platformAdmin',
  'owner',
  'admin',
  'courseEditor',
  'courseReader',
  'member',
  'outsider',
  'otherOrgAdmin',
  'anonymous',
] as const
export type Actor = (typeof ACTORS)[number]

/** The Clerk subject each actor signs in with (`getUserId` reads `subject`). */
export const SUBJECT: Record<Exclude<Actor, 'anonymous'>, string> = {
  platformAdmin: 'user_platform_admin',
  owner: 'user_owner',
  admin: 'user_admin',
  courseEditor: 'user_course_editor',
  courseReader: 'user_course_reader',
  member: 'user_member',
  outsider: 'user_outsider',
  otherOrgAdmin: 'user_other_org_admin',
}
export const APPLICANT = 'user_applicant'

/** The signed-in view of the backend for one actor. */
export function asActor(t: Backend, actor: Actor) {
  if (actor === 'anonymous') return t
  return t.withIdentity({
    subject: SUBJECT[actor],
    issuer: 'https://clerk.test',
    tokenIdentifier: `https://clerk.test|${SUBJECT[actor]}`,
  })
}

// ── Fixture ─────────────────────────────────────────────────────────────────

const FORM = [
  { key: 'firstName', kind: 'text', label: 'Nombre', required: true },
  { key: 'lastName', kind: 'text', label: 'Apellido', required: true },
  { key: 'email', kind: 'email', label: 'Email', required: true },
]

type OppKey = 'taisActive' | 'taisDraft' | 'govActive' | 'govDraft' | 'plain'

export interface Fixture {
  orgId: Id<'organizations'>
  otherOrgId: Id<'organizations'>
  orgSlug: string
  memberships: Record<
    'owner' | 'admin' | 'courseEditor' | 'courseReader' | 'member',
    Id<'orgMemberships'>
  >
  inviteLinkId: Id<'orgInviteLinks'>
  /** `plain` is a draft with no course tag. */
  opp: Record<OppKey, Id<'orgOpportunities'>>
  app: Record<OppKey, Id<'opportunityApplications'>>
  poll: Record<OppKey, Id<'availabilityPolls'>>
  pollRespondent: Record<OppKey, Id<'pollRespondents'>>
  survey: Record<OppKey, Id<'feedbackSurveys'>>
  surveyRespondent: Record<OppKey, Id<'surveyRespondents'>>
  draft: Record<OppKey, Id<'emailOutbox'>>
  crm: {
    contact: Id<'crmContacts'>
    contact2: Id<'crmContacts'>
    fieldDef: Id<'crmFieldDefs'>
    activity: Id<'crmActivities'>
    view: Id<'crmViews'>
    organization: Id<'crmOrganizations'>
    opportunity: Id<'crmOpportunities'>
    submission: Id<'crmSubmissions'>
  }
  legacyOpportunity: Id<'opportunities'>
  socialEvent: Id<'socialEvents'>
  allowlistEntry: Id<'orgAllowlist'>
  applicantProfile: Id<'profiles'>
  orgApplication: Id<'orgApplications'>
  storageId: Id<'_storage'>
  guest: Id<'socialEventGuests'>
  engagement: Id<'memberEngagement'>
}

const OPP_SPECS: Array<
  [OppKey, string, string | undefined, 'active' | 'draft']
> = [
  ['taisActive', 'TAIS active', 'TAIS Course', 'active'],
  ['taisDraft', 'TAIS draft', 'TAIS Course', 'draft'],
  ['govActive', 'Governance active', 'Governance', 'active'],
  ['govDraft', 'Governance draft', 'Governance', 'draft'],
  ['plain', 'No course draft', undefined, 'draft'],
]

/** One org with every actor, opportunities in two courses and their data. */
export async function seed(t: Backend): Promise<Fixture> {
  return await t.run(async (ctx) => {
    const now = Date.now()
    const orgId = await ctx.db.insert('organizations', {
      name: 'Test Org',
      slug: 'test-org',
    })
    const otherOrgId = await ctx.db.insert('organizations', {
      name: 'Other Org',
      slug: 'other-org',
    })

    const member = async (
      userId: string,
      role: 'admin' | 'member',
      extra: { isOwner?: boolean; org?: Id<'organizations'> } = {},
    ) =>
      await ctx.db.insert('orgMemberships', {
        userId,
        orgId: extra.org ?? orgId,
        role,
        isOwner: extra.isOwner,
        directoryVisibility: 'visible',
        joinedAt: now,
      })
    const memberships = {
      owner: await member(SUBJECT.owner, 'admin', { isOwner: true }),
      admin: await member(SUBJECT.admin, 'admin'),
      courseEditor: await member(SUBJECT.courseEditor, 'member'),
      courseReader: await member(SUBJECT.courseReader, 'member'),
      member: await member(SUBJECT.member, 'member'),
    }
    await member(SUBJECT.otherOrgAdmin, 'admin', {
      isOwner: true,
      org: otherOrgId,
    })
    await ctx.db.insert('platformAdmins', {
      userId: SUBJECT.platformAdmin,
      addedAt: now,
    })
    for (const [userId, level] of [
      [SUBJECT.courseEditor, 'edit'],
      [SUBJECT.courseReader, 'read'],
    ] as const) {
      await ctx.db.insert('courseAccess', {
        orgId,
        userId,
        course: 'TAIS Course',
        level,
        grantedBy: SUBJECT.owner,
        grantedAt: now,
      })
    }
    let applicantProfile: Id<'profiles'> | undefined
    for (const userId of [...Object.values(SUBJECT), APPLICANT]) {
      const profileId = await ctx.db.insert('profiles', {
        userId,
        email: `${userId}@example.com`,
        name: userId,
        createdAt: now,
        updatedAt: now,
      })
      if (userId === APPLICANT) applicantProfile = profileId
    }
    const inviteLinkId = await ctx.db.insert('orgInviteLinks', {
      orgId,
      token: 'invite-token',
      createdBy: memberships.owner,
      createdAt: now,
    })

    const opp = {} as Fixture['opp']
    const app = {} as Fixture['app']
    const poll = {} as Fixture['poll']
    const pollRespondent = {} as Fixture['pollRespondent']
    const survey = {} as Fixture['survey']
    const surveyRespondent = {} as Fixture['surveyRespondent']
    const draft = {} as Fixture['draft']
    for (const [key, title, tag, status] of OPP_SPECS) {
      const opportunityId = await ctx.db.insert('orgOpportunities', {
        orgId,
        title,
        description: `${title} description`,
        type: 'course',
        status,
        featured: false,
        formFields: FORM,
        formSource: 'custom',
        emailsCopiedAt: now,
        slug: key.toLowerCase(),
        ...(tag ? { tags: [tag] } : {}),
        createdAt: now,
        updatedAt: now,
      })
      opp[key] = opportunityId
      const applicationId = await ctx.db.insert('opportunityApplications', {
        opportunityId,
        orgId,
        userId: APPLICANT,
        status: 'submitted',
        responses: {
          firstName: 'Ana',
          lastName: key,
          email: 'ana@example.com',
        },
        submittedAt: now,
      })
      app[key] = applicationId
      const pollId = await ctx.db.insert('availabilityPolls', {
        opportunityId,
        orgId,
        createdBy: SUBJECT.owner,
        title: `${title} poll`,
        timezone: 'America/Argentina/Buenos_Aires',
        days: [0, 1, 2],
        startMinutes: 540,
        endMinutes: 1080,
        slotDurationMinutes: 60,
        accessToken: `poll-token-${key}`,
        status: 'open',
        createdAt: now,
        updatedAt: now,
      })
      poll[key] = pollId
      const respondentId = await ctx.db.insert('pollRespondents', {
        pollId,
        applicationId,
        respondentToken: `poll-respondent-${key}`,
        respondentName: 'Ana',
      })
      pollRespondent[key] = respondentId
      await ctx.db.insert('availabilityResponses', {
        pollId,
        respondentId,
        respondentName: 'Ana',
        slots: { '0|540': 'available' },
        updatedAt: now,
      })
      const surveyId = await ctx.db.insert('feedbackSurveys', {
        opportunityId,
        orgId,
        createdBy: SUBJECT.owner,
        title: `${title} survey`,
        formFields: [
          { key: 'comment', kind: 'textarea', label: 'Comentarios' },
        ],
        accessToken: `survey-token-${key}`,
        status: 'open',
        createdAt: now,
        updatedAt: now,
      })
      survey[key] = surveyId
      surveyRespondent[key] = await ctx.db.insert('surveyRespondents', {
        surveyId,
        applicationId,
        respondentToken: `survey-respondent-${key}`,
        respondentName: 'Ana',
        userId: APPLICANT,
      })
      await ctx.db.insert('surveyResponses', {
        surveyId,
        respondentId: surveyRespondent[key],
        respondentName: 'Ana',
        userId: APPLICANT,
        responses: { comment: `secret answer ${key}` },
        submittedAt: now,
        updatedAt: now,
      })
      await ctx.db.insert('emailTemplates', {
        orgId,
        opportunityId,
        kind: 'accepted',
        subject: 'Aceptada',
        markdownBody: 'Hola {{applicant_name}}',
        updatedAt: now,
      })
      draft[key] = await ctx.db.insert('emailOutbox', {
        orgId,
        opportunityId,
        applicationId,
        kind: 'accepted',
        subject: 'Aceptada',
        markdownBody: 'Hola {{applicant_name}}',
        createdAt: now,
        updatedAt: now,
      })
    }

    const contact = await ctx.db.insert('crmContacts', {
      orgId,
      name: 'Contact',
      email: 'contact@example.com',
      createdAt: now,
      updatedAt: now,
    })
    const crm = {
      contact,
      contact2: await ctx.db.insert('crmContacts', {
        orgId,
        name: 'Contact two',
        email: 'contact2@example.com',
        createdAt: now,
        updatedAt: now,
      }),
      fieldDef: await ctx.db.insert('crmFieldDefs', {
        orgId,
        collection: 'contacts',
        key: 'custom_one',
        label: 'Custom one',
        type: 'text',
        order: 100,
        source: 'admin',
        createdAt: now,
        updatedAt: now,
      }),
      activity: await ctx.db.insert('crmActivities', {
        orgId,
        contactId: contact,
        kind: 'note',
        title: 'Seeded note',
        source: 'manual',
        createdAt: now,
      }),
      view: await ctx.db.insert('crmViews', {
        orgId,
        collection: 'contacts',
        name: 'View',
        filters: [],
        sort: [],
        createdBy: SUBJECT.owner,
        createdAt: now,
        updatedAt: now,
      }),
      organization: await ctx.db.insert('crmOrganizations', {
        orgId,
        name: 'CRM org',
        createdAt: now,
        updatedAt: now,
      }),
      opportunity: await ctx.db.insert('crmOpportunities', {
        orgId,
        title: 'CRM opportunity',
        createdAt: now,
        updatedAt: now,
      }),
      submission: await ctx.db.insert('crmSubmissions', {
        orgId,
        data: {},
        createdAt: now,
        updatedAt: now,
      }),
    }
    await ctx.db.insert('events', {
      orgId,
      lumaEventId: 'evt-1',
      title: 'Event',
      startAt: now + 86_400_000,
      timezone: 'America/Argentina/Buenos_Aires',
      url: 'https://lu.ma/evt-1',
      isVirtual: false,
      syncedAt: now,
    })
    await ctx.db.insert('canonicalForms', {
      orgId,
      kind: 'course',
      formFields: FORM,
      updatedBy: SUBJECT.owner,
      updatedAt: now,
    })

    const legacyOpportunity = await ctx.db.insert('opportunities', {
      title: 'Legacy',
      organization: 'Somewhere',
      location: 'Remote',
      isRemote: true,
      roleType: 'job',
      description: 'legacy',
      sourceUrl: 'https://example.com',
      sourceId: 'manual-1',
      source: 'manual',
      status: 'active',
      lastVerified: now,
      createdAt: now,
      updatedAt: now,
    } as never)

    const socialEvent = await ctx.db.insert('socialEvents', {
      orgId,
      slug: 'meetup',
      title: 'Meetup',
      startAt: now + 86_400_000,
      timezone: 'America/Argentina/Buenos_Aires',
      status: 'draft',
      meetingMinutes: 15,
      createdBy: SUBJECT.owner,
      createdAt: now,
      updatedAt: now,
    })
    const allowlistEntry = await ctx.db.insert('orgAllowlist', {
      orgId,
      email: 'known@example.com',
      source: 'manual',
      addedAt: now,
    })
    const orgApplication = await ctx.db.insert('orgApplications', {
      applicantUserId: APPLICANT,
      applicantName: 'Applicant',
      applicantEmail: 'applicant@example.com',
      orgName: 'New Org',
      description: 'd',
      city: 'Buenos Aires',
      country: 'Argentina',
      status: 'pending',
      createdAt: now,
    })

    const storageId = await ctx.storage.store(new Blob(['logo']))
    const guest = await ctx.db.insert('socialEventGuests', {
      eventId: socialEvent,
      orgId,
      email: 'guest@example.com',
      name: 'Guest',
      status: 'pending_approval',
      source: 'app',
      lumaSync: 'not_linked',
      registeredAt: now,
      updatedAt: now,
    })
    const engagement = await ctx.db.insert('memberEngagement', {
      userId: SUBJECT.member,
      orgId,
      level: 'moderate',
      adminExplanation: 'x',
      userExplanation: 'x',
      signals: {
        eventsAttended90d: 0,
        rsvpCount90d: 0,
        joinedAt: now,
      },
      computedAt: now,
      modelVersion: 'test',
    })

    return {
      guest,
      engagement,
      storageId,
      socialEvent,
      allowlistEntry,
      orgApplication,
      applicantProfile: applicantProfile as Id<'profiles'>,
      orgId,
      otherOrgId,
      orgSlug: 'test-org',
      memberships,
      inviteLinkId,
      opp,
      app,
      poll,
      pollRespondent,
      survey,
      surveyRespondent,
      draft,
      crm,
      legacyOpportunity,
    }
  })
}

/** Delete what hangs off an opportunity so a destructive call can succeed. */
export async function stripOpportunity(
  t: Backend,
  opportunityId: Id<'orgOpportunities'>,
  parts: Array<'applications' | 'polls' | 'surveys' | 'emails'>,
): Promise<void> {
  await t.run(async (ctx) => {
    const del = async (rows: Array<{ _id: never }>) => {
      for (const r of rows) await ctx.db.delete(r._id)
    }
    if (parts.includes('emails')) {
      await del(
        (await ctx.db.query('emailOutbox').collect()).filter(
          (r) => r.opportunityId === opportunityId,
        ) as never,
      )
    }
    if (parts.includes('polls')) {
      for (const poll of (
        await ctx.db.query('availabilityPolls').collect()
      ).filter((p) => p.opportunityId === opportunityId)) {
        await del(
          (await ctx.db.query('availabilityResponses').collect()).filter(
            (r) => r.pollId === poll._id,
          ) as never,
        )
        await del(
          (await ctx.db.query('pollRespondents').collect()).filter(
            (r) => r.pollId === poll._id,
          ) as never,
        )
        await ctx.db.delete(poll._id)
      }
    }
    if (parts.includes('surveys')) {
      for (const survey of (
        await ctx.db.query('feedbackSurveys').collect()
      ).filter((s) => s.opportunityId === opportunityId)) {
        await del(
          (await ctx.db.query('surveyResponses').collect()).filter(
            (r) => r.surveyId === survey._id,
          ) as never,
        )
        await del(
          (await ctx.db.query('surveyRespondents').collect()).filter(
            (r) => r.surveyId === survey._id,
          ) as never,
        )
        await ctx.db.delete(survey._id)
      }
    }
    if (parts.includes('applications')) {
      await del(
        (await ctx.db.query('opportunityApplications').collect()).filter(
          (r) => r.opportunityId === opportunityId,
        ) as never,
      )
    }
  })
}

/** Every public query, mutation and action, as `module:name`. */
export async function publicFunctions(): Promise<Array<string>> {
  const out: Array<string> = []
  for (const file of convexModuleFiles()) {
    const mod = (await import(file)) as Record<string, unknown>
    const moduleName = relative(CONVEX_DIR, file).replace(/\.(ts|js)$/, '')
    for (const [name, value] of Object.entries(mod)) {
      const fn = value as {
        isPublic?: boolean
        isQuery?: boolean
        isMutation?: boolean
        isAction?: boolean
      }
      if (
        typeof value === 'function' &&
        fn.isPublic &&
        (fn.isQuery || fn.isMutation || fn.isAction)
      ) {
        out.push(`${moduleName}:${name}`)
      }
    }
  }
  return out.sort()
}
