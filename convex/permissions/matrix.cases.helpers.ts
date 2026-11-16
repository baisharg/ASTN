// The permission matrix: who may call what. Edit this file when a change to
// access is intended; a test fails when behaviour and this table disagree.
//
// The intended design is the comment at the top of convex/lib/courseAccess.ts:
//  - org admins do everything; the owner also manages roles and course access;
//  - a "read" grant shows a course's opportunities, applications, answers and
//    availability; "edit" also changes statuses, emails, polls and forms;
//  - everything that is not a course (CRM, events, members, canonicals,
//    settings) is admin-only.
import { getFunctionName } from 'convex/server'
import type { FunctionReference } from 'convex/server'
import { api } from '../_generated/api'
import { SUBJECT, stripOpportunity } from './harness.helpers'
import type { Actor, Backend, Fixture } from './harness.helpers'

export type OppKey = keyof Fixture['opp']
export type Target = 'tais' | 'gov' | 'plain'
export type Gate =
  | 'read'
  | 'edit'
  | 'admin'
  | 'owner'
  | 'platform'
  | 'anyOrgAdmin'

/** The draft opportunity each target stands for. */
export const TARGET_OPP: Record<Target, OppKey> = {
  tais: 'taisDraft',
  gov: 'govDraft',
  plain: 'plain',
}

const ADMINS: Array<Actor> = ['owner', 'admin']
const TAIS_READERS: Array<Actor> = [...ADMINS, 'courseEditor', 'courseReader']
const TAIS_EDITORS: Array<Actor> = [...ADMINS, 'courseEditor']

/**
 * Who gets in, written out. 'tais' is the course the editor and the reader
 * were granted; 'gov' and 'plain' (no course tag) are reachable by admins only.
 */
export const ALLOWED: Record<string, Array<Actor>> = {
  'read:tais': TAIS_READERS,
  'edit:tais': TAIS_EDITORS,
  'read:gov': ADMINS,
  'edit:gov': ADMINS,
  'read:plain': ADMINS,
  'edit:plain': ADMINS,
  admin: ADMINS,
  owner: ['owner'],
  platform: ['platformAdmin'],
  // What requireAnyOrgAdmin lets in: an admin of any org at all.
  anyOrgAdmin: [...ADMINS, 'otherOrgAdmin'],
}

export interface Case {
  /** Defaults to the function's path. */
  name?: string
  kind: 'query' | 'mutation' | 'action'
  ref: FunctionReference<any, 'public'>
  gate: Gate
  /** For read/edit gates: which opportunities to try. Default: all three. */
  targets?: Array<Target>
  args: (fx: Fixture, k: OppKey, actor: Actor) => any
  setup?: (t: Backend, fx: Fixture, k: OppKey) => Promise<void>
  /** Denial shows up as null / [] / 0 instead of an error. */
  silent?: boolean
  /** Allowed means "got past the access check": any non-access error counts. */
  lenient?: boolean
  /** Not run for allowed actors (it would reach an outside service). */
  deniedOnly?: boolean
  /** KNOWN HOLE: actors that are let in although they should not be. */
  hole?: { actors: Array<Actor>; note: string }
  /**
   * KNOWN HOLE, stated as a gate: the matrix passes on what the code does
   * today, and every actor whose outcome would differ under this gate gets a
   * todo test asserting the wanted outcome.
   */
  wanted?: { gate: Gate; note: string }
}

export function caseName(c: Case): string {
  return c.name ?? getFunctionName(c.ref)
}

type Opts = Partial<
  Pick<
    Case,
    | 'name'
    | 'targets'
    | 'setup'
    | 'silent'
    | 'lenient'
    | 'deniedOnly'
    | 'hole'
    | 'wanted'
  >
>
const q = (
  ref: Case['ref'],
  gate: Gate,
  args: Case['args'],
  opts: Opts = {},
): Case => ({ kind: 'query', ref, gate, args, ...opts })
const m = (
  ref: Case['ref'],
  gate: Gate,
  args: Case['args'],
  opts: Opts = {},
): Case => ({ kind: 'mutation', ref, gate, args, ...opts })
const act = (
  ref: Case['ref'],
  gate: Gate,
  args: Case['args'],
  opts: Opts = {},
): Case => ({ kind: 'action', ref, gate, args, ...opts })

const FORM = [
  { key: 'firstName', kind: 'text', label: 'Nombre', required: true },
  { key: 'lastName', kind: 'text', label: 'Apellido', required: true },
  { key: 'email', kind: 'email', label: 'Email', required: true },
]
const SURVEY_FORM = [{ key: 'comment', kind: 'textarea', label: 'Comentarios' }]
const TAGS: Record<OppKey, Array<string>> = {
  taisActive: ['TAIS Course'],
  taisDraft: ['TAIS Course'],
  govActive: ['Governance'],
  govDraft: ['Governance'],
  plain: [],
}
const NOW = 1_800_000_000_000

const byOpp = (fx: Fixture, k: OppKey) => ({ opportunityId: fx.opp[k] })

// ── Opportunities ───────────────────────────────────────────────────────────

const opportunities: Array<Case> = [
  q(api.orgOpportunities.get, 'read', (fx, k) => ({ id: fx.opp[k] }), {
    silent: true,
  }),
  q(
    api.orgOpportunities.getByKey,
    'read',
    (fx, k) => ({ orgSlug: fx.orgSlug, key: fx.opp[k] }),
    { silent: true },
  ),
  q(
    api.orgOpportunities.getWithRedirect,
    'read',
    (fx, k) => ({
      id: fx.opp[k],
    }),
    { silent: true },
  ),
  q(
    api.orgOpportunities.getWithRedirectByKey,
    'read',
    (fx, k) => ({ orgSlug: fx.orgSlug, key: fx.opp[k] }),
    { silent: true },
  ),
  q(api.applicationInvites.getApplyTarget, 'read', byOpp),
  m(api.orgOpportunities.setArchived, 'edit', (fx, k) => ({
    id: fx.opp[k],
    archived: true,
  })),
  m(api.orgOpportunities.update, 'edit', (fx, k) => ({
    id: fx.opp[k],
    title: 'Renamed',
  })),
  m(
    api.orgOpportunities.update,
    'admin',
    (fx, k) => ({ id: fx.opp[k], tags: ['Governance'] }),
    {
      name: 'orgOpportunities:update (retag to another course)',
      targets: ['tais'],
    },
  ),
  m(api.orgOpportunities.duplicate, 'edit', (fx, k) => ({ id: fx.opp[k] })),
  m(api.orgOpportunities.remove, 'edit', (fx, k) => ({ id: fx.opp[k] }), {
    setup: async (t, fx, k) => {
      await stripOpportunity(t, fx.opp[k], [
        'applications',
        'polls',
        'surveys',
        'emails',
      ])
    },
  }),
  m(api.orgOpportunities.create, 'edit', (fx, k) => ({
    orgId: fx.orgId,
    title: 'New',
    description: 'New',
    type: 'course',
    status: 'draft',
    featured: false,
    tags: TAGS[k],
    formSource: 'custom',
  })),
  m(
    api.orgOpportunities.replaceForm,
    'edit',
    (fx, k) => ({ id: fx.opp[k], source: 'custom' }),
    {
      setup: async (t, fx, k) =>
        stripOpportunity(t, fx.opp[k], ['applications']),
    },
  ),
  m(
    api.orgOpportunities.saveForm,
    'edit',
    (fx, k) => ({ id: fx.opp[k], formFields: FORM }),
    {
      setup: async (t, fx, k) =>
        stripOpportunity(t, fx.opp[k], ['applications']),
    },
  ),
]

// ── Applications ────────────────────────────────────────────────────────────

const applications: Array<Case> = [
  q(api.opportunityApplications.listByOpportunity, 'read', byOpp),
  q(api.opportunityApplications.listRecipientsByOpportunity, 'read', byOpp),
  q(api.opportunityApplications.getById, 'read', (fx, k) => ({
    applicationId: fx.app[k],
  })),
  q(api.opportunityApplications.getApplicationCount, 'read', byOpp, {
    silent: true,
  }),
  q(api.opportunityApplications.getNextEditionLinks, 'read', byOpp),
  q(api.opportunityApplications.getUnseenAutoAccepted, 'read', byOpp),
  m(api.opportunityApplications.markAutoAcceptedSeen, 'read', (fx, k) => ({
    applicationIds: [fx.app[k]],
  })),
  m(api.opportunityApplications.updateStatus, 'edit', (fx, k) => ({
    applicationId: fx.app[k],
    status: 'under_review',
  })),
  q(
    api.opportunityApplications.getOrgApplicationCount,
    'admin',
    (fx) => ({ orgId: fx.orgId }),
    { silent: true },
  ),
  act(api.opportunityApplications.exportApplications, 'read', byOpp),
]

// ── Availability polls ──────────────────────────────────────────────────────

const polls: Array<Case> = [
  q(api.availabilityPolls.getPollByOpportunity, 'read', byOpp, {
    silent: true,
  }),
  q(api.availabilityPolls.getPollResults, 'read', (fx, k) => ({
    pollId: fx.poll[k],
  })),
  q(api.availabilityPolls.getRespondentLinks, 'edit', (fx, k) => ({
    pollId: fx.poll[k],
  })),
  m(
    api.availabilityPolls.createPoll,
    'edit',
    (fx, k) => ({
      opportunityId: fx.opp[k],
      title: 'Poll',
      timezone: 'America/Argentina/Buenos_Aires',
      days: [0, 1],
      startMinutes: 540,
      endMinutes: 1080,
      slotDurationMinutes: 60,
    }),
    { setup: async (t, fx, k) => stripOpportunity(t, fx.opp[k], ['polls']) },
  ),
  m(api.availabilityPolls.updatePoll, 'edit', (fx, k) => ({
    pollId: fx.poll[k],
    title: 'Renamed poll',
  })),
  m(api.availabilityPolls.deletePoll, 'edit', (fx, k) => ({
    pollId: fx.poll[k],
  })),
  m(api.availabilityPolls.finalizePoll, 'edit', (fx, k) => ({
    pollId: fx.poll[k],
    finalizedSlot: { day: 0, startMinutes: 540, endMinutes: 600 },
  })),
  act(api.availabilityPolls.exportAvailability, 'read', (fx, k) => ({
    pollId: fx.poll[k],
  })),
  m(api.availabilityPolls.backfillRespondents, 'edit', (fx, k) => ({
    pollId: fx.poll[k],
  })),
]

// ── Feedback surveys ────────────────────────────────────────────────────────
// Surveys are not named in courseAccess.ts, so the matrix keeps them with
// admins (what the code does); getRespondentLinks is the one exception and
// takes an edit grant.

const surveys: Array<Case> = [
  m(
    api.feedbackSurveys.createSurvey,
    'admin',
    (fx, k) => ({
      opportunityId: fx.opp[k],
      title: 'Survey',
      formFields: SURVEY_FORM,
    }),
    {
      targets: ['tais'],
      setup: async (t, fx, k) => stripOpportunity(t, fx.opp[k], ['surveys']),
    },
  ),
  m(
    api.feedbackSurveys.updateSurvey,
    'admin',
    (fx, k) => ({ surveyId: fx.survey[k], title: 'Renamed survey' }),
    { targets: ['tais'] },
  ),
  m(
    api.feedbackSurveys.deleteSurvey,
    'admin',
    (fx, k) => ({
      surveyId: fx.survey[k],
    }),
    { targets: ['tais'] },
  ),
  m(
    api.feedbackSurveys.backfillRespondents,
    'admin',
    (fx, k) => ({
      surveyId: fx.survey[k],
    }),
    { targets: ['tais'] },
  ),
  m(
    api.feedbackSurveys.removeRespondent,
    'admin',
    (fx, k) => ({
      surveyId: fx.survey[k],
      respondentId: fx.surveyRespondent[k],
    }),
    { targets: ['tais'] },
  ),
  q(api.feedbackSurveys.getSurveysByOpportunity, 'admin', byOpp, {
    targets: ['tais'],
  }),
  q(
    api.feedbackSurveys.getSurveyResults,
    'admin',
    (fx, k) => ({
      surveyId: fx.survey[k],
    }),
    { targets: ['tais'] },
  ),
  q(
    api.feedbackSurveys.getFormImageUrls,
    'admin',
    (fx, k) => ({
      surveyId: fx.survey[k],
    }),
    { targets: ['tais'] },
  ),
  q(api.feedbackSurveys.getRespondentLinks, 'edit', (fx, k) => ({
    surveyId: fx.survey[k],
  })),
  // Returns the survey with its generic access token: a course read grant.
  q(api.feedbackSurveys.getSurveyByOpportunity, 'read', byOpp, {
    silent: true,
  }),
  // Your own answers, or those of surveys in orgs you administer; the
  // applicant's own read is in scenarios.test.ts.
  q(
    api.feedbackSurveys.getSurveyResponsesForUser,
    'admin',
    () => ({ userId: 'user_applicant' }),
    { silent: true, targets: ['tais'] },
  ),
]

// ── Emails: outbox, per-opportunity templates, canonical emails ─────────────

const emails: Array<Case> = [
  q(api.emails.outbox.listForOpportunity, 'read', byOpp),
  q(api.emails.outbox.listLogForOpportunity, 'read', byOpp),
  m(api.emails.outbox.updateDraft, 'edit', (fx, k) => ({
    draftId: fx.draft[k],
    subject: 'Edited',
  })),
  m(
    api.emails.outbox.resetDraftToTemplate,
    'edit',
    (fx, k) => ({
      draftId: fx.draft[k],
    }),
    {},
  ),
  m(api.emails.outbox.setRecipientEmail, 'edit', (fx, k) => ({
    draftId: fx.draft[k],
    email: 'someone@example.com',
  })),
  m(api.emails.outbox.deleteDraft, 'edit', (fx, k) => ({
    draftId: fx.draft[k],
  })),
  q(api.emails.templateLibrary.getOpportunityEmails, 'read', byOpp),
  m(api.emails.templateLibrary.saveOpportunityEmail, 'edit', (fx, k) => ({
    opportunityId: fx.opp[k],
    kind: 'accepted',
    subject: 'Hola',
    markdownBody: 'Hola {{applicant_name}}',
    enabled: true,
    includePollLink: false,
    includeSurveyLink: false,
  })),
  m(
    api.emails.templateLibrary.revertOpportunityEmail,
    'edit',
    (fx, k) => ({
      opportunityId: fx.opp[k],
      kind: 'accepted',
    }),
    {},
  ),
  act(
    api.emails.outboxSend.sendDrafts,
    'edit',
    (fx, k) => ({ opportunityId: fx.opp[k], draftIds: [fx.draft[k]] }),
    { deniedOnly: true },
  ),
  act(
    api.emails.adminBroadcastAction.sendBroadcastToApplicants,
    'edit',
    (fx, k) => ({
      opportunityId: fx.opp[k],
      applicationIds: [fx.app[k]],
      subject: 'Hola',
      markdownBody: 'Hola',
    }),
    { deniedOnly: true },
  ),
  act(
    api.emails.adminBroadcastAction.sendTestEmail,
    'edit',
    (fx, k) => ({
      opportunityId: fx.opp[k],
      subject: 'Hola',
      markdownBody: 'Hola',
      toEmail: 'me@example.com',
    }),
    { deniedOnly: true },
  ),
  q(api.emails.templateLibrary.getCanonical, 'admin', (fx) => ({
    orgId: fx.orgId,
  })),
  m(api.emails.templateLibrary.saveCanonicalEmail, 'admin', (fx) => ({
    orgId: fx.orgId,
    kind: 'accepted',
    subject: 'Hola',
    markdownBody: 'Hola',
    enabled: true,
    includePollLink: false,
    includeSurveyLink: false,
  })),
  m(api.emails.templateLibrary.saveFooter, 'admin', (fx) => ({
    orgId: fx.orgId,
    footer: 'Footer',
  })),
]

// ── Canonical forms ─────────────────────────────────────────────────────────

const canonicals: Array<Case> = [
  q(
    api.canonicalForms.get,
    'admin',
    (fx) => ({
      orgId: fx.orgId,
      kind: 'course',
    }),
    { silent: true },
  ),
  m(api.canonicalForms.save, 'admin', (fx) => ({
    orgId: fx.orgId,
    kind: 'course',
    formFields: FORM,
  })),
  q(
    api.canonicalForms.surveyStart,
    'admin',
    (fx, k) => ({
      opportunityId: fx.opp[k],
      anonymous: false,
    }),
    { targets: ['tais'] },
  ),
]

// ── CRM and contacts ────────────────────────────────────────────────────────

const org = (fx: Fixture) => ({ orgId: fx.orgId })
const crm: Array<Case> = [
  q(api.crm.listContacts, 'admin', org),
  q(api.crm.listOrganizations, 'admin', org),
  q(api.crm.listOpportunities, 'admin', org),
  q(api.crm.listSubmissions, 'admin', org),
  q(api.crm.exportAll, 'admin', org),
  q(api.crm.getStats, 'admin', org),
  q(
    api.crm.getContact,
    'admin',
    (fx) => ({
      orgId: fx.orgId,
      id: fx.crm.contact,
    }),
    { silent: true },
  ),
  q(
    api.crm.getOrganization,
    'admin',
    (fx) => ({
      orgId: fx.orgId,
      id: fx.crm.organization,
    }),
    { silent: true },
  ),
  q(
    api.crm.getOpportunity,
    'admin',
    (fx) => ({
      orgId: fx.orgId,
      id: fx.crm.opportunity,
    }),
    { silent: true },
  ),
  q(
    api.crm.getSubmission,
    'admin',
    (fx) => ({
      orgId: fx.orgId,
      id: fx.crm.submission,
    }),
    { silent: true },
  ),
  m(
    api.crm.insertContacts,
    'admin',
    (fx) => ({ orgId: fx.orgId, records: [] }),
    {},
  ),
  m(
    api.crm.insertOrganizations,
    'admin',
    (fx) => ({ orgId: fx.orgId, records: [] }),
    {},
  ),
  m(
    api.crm.insertOpportunities,
    'admin',
    (fx) => ({ orgId: fx.orgId, records: [] }),
    {},
  ),
  m(
    api.crm.insertSubmissions,
    'admin',
    (fx) => ({ orgId: fx.orgId, records: [] }),
    {},
  ),
  m(api.crm.createEmptyContact, 'admin', org),
  m(api.crm.createEmptyOrganization, 'admin', org),
  m(api.crm.createEmptyOpportunity, 'admin', org),
  m(api.crm.createEmptySubmission, 'admin', org),
  m(
    api.crm.createContactWithFields,
    'admin',
    (fx) => ({
      orgId: fx.orgId,
      fields: { name: 'New contact' },
    }),
    {},
  ),
  m(
    api.crm.createOrganizationWithFields,
    'admin',
    (fx) => ({
      orgId: fx.orgId,
      fields: { name: 'New org' },
    }),
    {},
  ),
  m(
    api.crm.createOpportunityWithFields,
    'admin',
    (fx) => ({
      orgId: fx.orgId,
      fields: { title: 'New opportunity' },
    }),
    {},
  ),
  m(api.crm.updateContact, 'admin', (fx) => ({
    orgId: fx.orgId,
    id: fx.crm.contact,
    field: 'name',
    value: 'Renamed',
  })),
  m(api.crm.updateOrganization, 'admin', (fx) => ({
    orgId: fx.orgId,
    id: fx.crm.organization,
    field: 'name',
    value: 'Renamed',
  })),
  m(api.crm.updateOpportunity, 'admin', (fx) => ({
    orgId: fx.orgId,
    id: fx.crm.opportunity,
    field: 'title',
    value: 'Renamed',
  })),
  m(api.crm.deleteContact, 'admin', (fx) => ({
    orgId: fx.orgId,
    id: fx.crm.contact,
  })),
  m(api.crm.deleteOrganization, 'admin', (fx) => ({
    orgId: fx.orgId,
    id: fx.crm.organization,
  })),
  m(api.crm.deleteOpportunity, 'admin', (fx) => ({
    orgId: fx.orgId,
    id: fx.crm.opportunity,
  })),
  m(api.crm.deleteSubmission, 'admin', (fx) => ({
    orgId: fx.orgId,
    id: fx.crm.submission,
  })),
  m(api.crm.clearCollection, 'admin', (fx) => ({
    orgId: fx.orgId,
    collection: 'crmContacts',
  })),
  q(api.contacts.people.getPerson, 'admin', (fx) => ({
    orgId: fx.orgId,
    contactId: fx.crm.contact,
  })),
  m(api.contacts.people.setOtherEmails, 'admin', (fx) => ({
    orgId: fx.orgId,
    contactId: fx.crm.contact,
    emails: ['alt@example.com'],
  })),
  m(
    api.contacts.people.addActivity,
    'admin',
    (fx) => ({
      orgId: fx.orgId,
      contactId: fx.crm.contact,
      kind: 'note',
      title: 'Called',
    }),
    {},
  ),
  q(api.contacts.people.listViews, 'admin', (fx) => ({
    orgId: fx.orgId,
    collection: 'contacts',
  })),
  q(api.contacts.records.listFields, 'admin', (fx) => ({
    orgId: fx.orgId,
    collection: 'contacts',
  })),
  m(api.contacts.records.setupFields, 'admin', org),
  m(api.contacts.people.deleteActivity, 'admin', (fx) => ({
    orgId: fx.orgId,
    activityId: fx.crm.activity,
  })),
  m(api.contacts.people.linkAccounts, 'admin', org),
  m(api.contacts.people.saveView, 'admin', (fx) => ({
    orgId: fx.orgId,
    collection: 'contacts',
    name: 'New view',
    filters: [],
    sort: [],
  })),
  m(api.contacts.people.deleteView, 'admin', (fx) => ({
    orgId: fx.orgId,
    viewId: fx.crm.view,
  })),
  m(api.contacts.records.createField, 'admin', (fx) => ({
    orgId: fx.orgId,
    collection: 'contacts',
    label: 'New field',
    type: 'text',
  })),
  m(api.contacts.records.updateField, 'admin', (fx) => ({
    orgId: fx.orgId,
    fieldId: fx.crm.fieldDef,
    label: 'Renamed field',
  })),
  m(api.contacts.records.reorderFields, 'admin', (fx) => ({
    orgId: fx.orgId,
    fieldIds: [fx.crm.fieldDef],
  })),
  m(api.contacts.records.deleteField, 'admin', (fx) => ({
    orgId: fx.orgId,
    fieldId: fx.crm.fieldDef,
  })),
  m(api.contacts.records.setField, 'admin', (fx) => ({
    orgId: fx.orgId,
    collection: 'contacts',
    id: fx.crm.contact,
    key: 'custom_one',
    value: 'x',
  })),
  m(api.contacts.records.bulkSetField, 'admin', (fx) => ({
    orgId: fx.orgId,
    collection: 'contacts',
    ids: [fx.crm.contact],
    key: 'custom_one',
    mode: 'set',
    value: 'x',
  })),
  m(api.contacts.merge.dismissDuplicate, 'admin', (fx) => ({
    orgId: fx.orgId,
    ids: [fx.crm.contact, fx.crm.contact2],
  })),
  m(api.contacts.merge.mergeContacts, 'admin', (fx) => ({
    orgId: fx.orgId,
    keepId: fx.crm.contact,
    mergeIds: [fx.crm.contact2],
  })),
  q(api.contacts.merge.findDuplicates, 'admin', org),
  q(api.contacts.merge.contactSummaries, 'admin', (fx) => ({
    orgId: fx.orgId,
    ids: [fx.crm.contact],
  })),
  m(api.contacts.bulk.deleteRecords, 'admin', (fx) => ({
    orgId: fx.orgId,
    collection: 'contacts',
    ids: [fx.crm.contact],
  })),
]

// ── Members, roles, course access, settings ─────────────────────────────────

const members: Array<Case> = [
  q(api.courseAccess.list, 'owner', org),
  m(api.courseAccess.setAccess, 'owner', (fx) => ({
    orgId: fx.orgId,
    userId: 'user_member',
    course: 'Governance',
    level: 'read',
  })),
  m(api.courseAccess.setOwner, 'owner', (fx) => ({
    orgId: fx.orgId,
    membershipId: fx.memberships.admin,
    owner: true,
  })),
  m(api.orgs.admin.promoteToAdmin, 'owner', (fx) => ({
    orgId: fx.orgId,
    membershipId: fx.memberships.member,
  })),
  m(api.orgs.admin.demoteToMember, 'owner', (fx) => ({
    orgId: fx.orgId,
    membershipId: fx.memberships.admin,
  })),
  m(api.orgs.admin.removeMember, 'admin', (fx) => ({
    orgId: fx.orgId,
    membershipId: fx.memberships.member,
  })),
  q(api.orgs.admin.getAllMembersWithProfiles, 'admin', org),
  m(api.orgs.admin.createInviteLink, 'admin', org),
  m(api.orgs.admin.getOrCreateInviteLink, 'admin', org),
  q(api.orgs.admin.getInviteLinks, 'admin', org),
  m(api.orgs.admin.revokeInviteLink, 'admin', (fx) => ({
    inviteLinkId: fx.inviteLinkId,
  })),
  q(
    api.orgs.members.getMemberProfileForAdmin,
    'admin',
    (fx) => ({
      orgId: fx.orgId,
      userId: 'user_member',
    }),
    { silent: true },
  ),
  q(
    api.orgs.members.getMemberAttendanceHistory,
    'admin',
    (fx) => ({
      orgId: fx.orgId,
      userId: 'user_member',
    }),
    {},
  ),
  q(
    api.orgs.members.getMemberEngagementHistory,
    'admin',
    (fx) => ({
      orgId: fx.orgId,
      userId: 'user_member',
    }),
    {},
  ),
  q(api.engagement.queries.getOrgEngagementForAdmin, 'admin', org, {}),
  q(
    api.engagement.queries.getMemberEngagementForAdmin,
    'admin',
    (fx) => ({
      orgId: fx.orgId,
      userId: 'user_member',
    }),
    {},
  ),
  q(api.orgs.stats.getOrgStats, 'admin', org, {}),
  q(api.orgs.stats.getEnhancedOrgStats, 'admin', org, {}),
  // Settings
  q(api.orgs.admin.getOrgProfile, 'admin', org),
  m(api.orgs.admin.updateOrgProfile, 'admin', (fx) => ({
    orgId: fx.orgId,
    description: 'Updated',
  })),
  q(api.orgs.admin.getEmailSettings, 'admin', org),
  m(api.orgs.admin.updateReplyToEmail, 'admin', (fx) => ({
    orgId: fx.orgId,
    replyToEmail: 'reply@example.com',
  })),
  q(api.orgs.admin.getLumaConfig, 'admin', org),
  m(api.orgs.admin.updateLumaConfig, 'admin', (fx) => ({
    orgId: fx.orgId,
    lumaCalendarUrl: 'https://lu.ma/test',
  })),
  q(api.orgs.admin.getOnboardingProgress, 'admin', org, {}),
  m(api.orgs.admin.removeOrgLogo, 'admin', org),
  m(api.orgs.admin.saveOrgLogo, 'admin', (fx) => ({
    orgId: fx.orgId,
    storageId: fx.storageId,
  })),
]

// ── Events ──────────────────────────────────────────────────────────────────

const events: Array<Case> = [
  q(api.luma.admin.listLumaEvents, 'admin', (fx) => ({
    orgId: fx.orgId,
    now: NOW,
  })),
  q(api.luma.admin.getSyncStatus, 'admin', org),
  q(api.social.events.listEvents, 'admin', org),
  q(api.social.events.listAllowlist, 'admin', org),
  q(api.luma.admin.getLumaEvent, 'admin', (fx) => ({
    orgId: fx.orgId,
    lumaEventId: 'evt-1',
  })),
  m(api.luma.admin.syncNow, 'admin', org, { deniedOnly: true }),
  m(
    api.luma.admin.refreshGuests,
    'admin',
    (fx) => ({ orgId: fx.orgId, lumaEventId: 'evt-1' }),
    { deniedOnly: true },
  ),
  m(
    api.luma.admin.manageInAstn,
    'admin',
    (fx) => ({ orgId: fx.orgId, lumaEventId: 'evt-1' }),
    { deniedOnly: true },
  ),
  m(api.social.events.createEvent, 'admin', (fx) => ({
    orgId: fx.orgId,
    title: 'New event',
    startAt: NOW,
    timezone: 'America/Argentina/Buenos_Aires',
  })),
  q(api.social.events.getEventAdmin, 'admin', (fx) => ({
    eventId: fx.socialEvent,
  })),
  q(api.social.events.getKnownPendingCount, 'admin', (fx) => ({
    eventId: fx.socialEvent,
  })),
  q(api.social.events.listGuests, 'admin', (fx) => ({
    eventId: fx.socialEvent,
  })),
  m(api.social.events.updateEvent, 'admin', (fx) => ({
    eventId: fx.socialEvent,
    title: 'Renamed event',
  })),
  m(api.social.events.importAllowlist, 'admin', (fx) => ({
    orgId: fx.orgId,
    rows: [{ email: 'new@example.com' }],
  })),
  m(api.social.events.removeFromAllowlist, 'admin', (fx) => ({
    entryId: fx.allowlistEntry,
  })),
  m(api.social.events.addPreapprovedGuests, 'admin', (fx) => ({
    eventId: fx.socialEvent,
    entryIds: [fx.allowlistEntry],
  })),
  m(api.social.events.setGuestStatus, 'admin', (fx) => ({
    guestId: fx.guest,
    status: 'approved',
  })),
  m(api.social.events.setSpots, 'admin', (fx) => ({
    eventId: fx.socialEvent,
    spots: [],
  })),
  m(api.engagement.mutations.overrideEngagement, 'admin', (fx) => ({
    engagementId: fx.engagement,
    newLevel: 'highly_engaged',
    notes: 'Reviewed by hand',
  })),
  // The seeded row has no override, so an allowed caller gets "No override to
  // clear" after the access check.
  m(
    api.engagement.mutations.clearOverride,
    'admin',
    (fx) => ({ engagementId: fx.engagement }),
    { lenient: true },
  ),
  m(api.social.events.setFloorPlan, 'admin', (fx) => ({
    eventId: fx.socialEvent,
    storageId: null,
  })),
  m(api.social.events.generateFloorPlanUploadUrl, 'admin', (fx) => ({
    eventId: fx.socialEvent,
  })),
  m(
    api.social.events.linkLumaEvent,
    'admin',
    (fx) => ({ eventId: fx.socialEvent, lumaEventId: 'evt-1' }),
    { deniedOnly: true },
  ),
  m(api.social.events.unlinkLumaEvent, 'admin', (fx) => ({
    eventId: fx.socialEvent,
  })),
  m(
    api.social.events.syncLumaNow,
    'admin',
    (fx) => ({ eventId: fx.socialEvent }),
    { deniedOnly: true },
  ),
  m(
    api.social.events.retryLumaErrors,
    'admin',
    (fx) => ({ eventId: fx.socialEvent }),
    { deniedOnly: true },
  ),
  act(
    api.social.events.createPersonalLinks,
    'admin',
    (fx) => ({ eventId: fx.socialEvent, guestIds: [] }),
    { deniedOnly: true },
  ),
]

// ── Agent action log ────────────────────────────────────────────────────────
// The agent calls it with the signed-in admin's own Clerk token, so the caller
// is an admin of the org and the logged userId is the caller.
const agentLog: Array<Case> = [
  m(
    api.agentActionLog.logAgentAction,
    'admin',
    (fx, _k, actor) => ({
      userId: actor === 'anonymous' ? 'user_admin' : SUBJECT[actor],
      orgId: fx.orgId,
      toolName: 'astn_update',
      params: '{}',
      result: '{}',
      approvalStatus: 'auto',
    }),
    { targets: ['tais'] },
  ),
]

// ── Platform admin and the legacy global opportunities ──────────────────────

const platform: Array<Case> = [
  q(api.platformAdmin.users.listAllProfiles, 'platform', () => ({}), {
    silent: true,
  }),
  q(
    api.platformAdmin.llmCosts.getOverallStats,
    'platform',
    () => ({
      startTime: 0,
      endTime: NOW,
    }),
    {},
  ),
  q(api.orgApplications.listAll, 'platform', () => ({})),
  q(api.orgApplications.getApplication, 'platform', (fx) => ({
    applicationId: fx.orgApplication,
  })),
  m(
    api.orgApplications.approve,
    'platform',
    (fx) => ({ applicationId: fx.orgApplication }),
    { deniedOnly: true },
  ),
  m(api.orgApplications.reject, 'platform', (fx) => ({
    applicationId: fx.orgApplication,
    rejectionReason: 'No',
  })),
  q(api.platformAdmin.llmCosts.getCostTimeSeries, 'platform', () => ({
    startTime: 0,
    endTime: NOW,
    granularity: 'day',
  })),
  q(api.platformAdmin.llmCosts.getCostByModel, 'platform', () => ({
    startTime: 0,
    endTime: NOW,
  })),
  q(api.platformAdmin.llmCosts.getCostByOperation, 'platform', () => ({
    startTime: 0,
    endTime: NOW,
  })),
  q(api.platformAdmin.llmCosts.getMatchingStats, 'platform', () => ({
    startTime: 0,
    endTime: NOW,
  })),
  q(api.platformAdmin.users.getProfileDetail, 'platform', () => ({
    userId: 'user_applicant',
  })),
  q(api.platformAdmin.users.getUserMatches, 'platform', (fx) => ({
    profileId: fx.applicantProfile,
  })),
  q(api.platformAdmin.users.getEnrichmentMessages, 'platform', (fx) => ({
    profileId: fx.applicantProfile,
  })),
  // Reads the agent component, which the test backend does not register.
  q(
    api.platformAdmin.users.getAgentMessages,
    'platform',
    () => ({ threadId: 'thread' }),
    { deniedOnly: true },
  ),
  q(api.platformAdmin.users.getAgentToolCalls, 'platform', () => ({
    threadId: 'thread',
  })),
  m(
    api.platformAdmin.users.recomputeMatches,
    'platform',
    (fx) => ({ profileId: fx.applicantProfile }),
    { deniedOnly: true },
  ),
  // KNOWN HOLE: the four mutations on the global `opportunities` table only
  // require admin of ANY org (requireAnyOrgAdmin), so an admin of an unrelated
  // org can create, edit, archive or delete listings that belong to nobody's
  // org. A platform admin who is not a member of any org cannot use them. The
  // matrix expects platform admins only.
  ...(
    [
      [
        api.admin.createOpportunity,
        (): Record<string, unknown> => ({
          title: 'x',
          organization: 'x',
          location: 'x',
          isRemote: true,
          roleType: 'other',
          description: 'x',
          sourceUrl: 'https://example.com',
        }),
      ],
      [
        api.admin.updateOpportunity,
        (fx: Fixture) => ({ id: fx.legacyOpportunity, title: 'Hijacked' }),
      ],
      [
        api.admin.archiveOpportunity,
        (fx: Fixture) => ({ id: fx.legacyOpportunity }),
      ],
      [
        api.admin.deleteOpportunity,
        (fx: Fixture) => ({ id: fx.legacyOpportunity }),
      ],
    ] as const
  ).map(([ref, args]) =>
    m(ref, 'anyOrgAdmin', args as Case['args'], {
      wanted: {
        gate: 'platform',
        note: 'only platform admins should touch the global opportunities; requireAnyOrgAdmin lets any org admin in (and keeps platform admins out)',
      },
    }),
  ),
]

export const CASES: Array<Case> = [
  ...opportunities,
  ...applications,
  ...polls,
  ...surveys,
  ...emails,
  ...canonicals,
  ...crm,
  ...members,
  ...events,
  ...agentLog,
  ...platform,
]

/** Functions the matrix exercises, as `module:name`. */
export const COVERED_BY_MATRIX = new Set(
  CASES.map((c) => getFunctionName(c.ref)),
)
