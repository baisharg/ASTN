import { internal } from '../_generated/api'
import type { ActionCtx } from '../_generated/server'
import { CRM_FIELDS, type CrmCollection } from '../lib/crmFields'
import { OPPORTUNITY_EDITABLE } from '../crm'
import { UPDATE_FIELDS } from './platform'

// MCP tool definitions + dispatch for the /mcp endpoint. The surface is a small
// set of generic verbs (astn_list/get/create/update/delete) parameterized by a
// `resource`, plus a few named tools where the shape is special (stats,
// survey_results, availability_heatmap). Tool inputs take the org *slug*
// (discoverable via list_my_orgs); the data layer resolves and re-authorizes
// org-admin on every call.

// ── Resource registry ──────────────────────────────────────────────────────

// CRM resources are backed by convex/mcp/data.ts (collection-based). Map the
// public `crm_*` resource name to the internal collection key.
const CRM_RESOURCES: Record<string, CrmCollection> = {
  crm_contacts: 'contacts',
  crm_organizations: 'organizations',
  crm_opportunities: 'opportunities',
  crm_submissions: 'submissions',
}

// Contacts and organizations have per-org configurable fields, described
// live by mcp/data:describeFields; these two have fixed columns.
const CRM_WRITABLE: Record<'opportunities' | 'submissions', Set<string>> = {
  opportunities: OPPORTUNITY_EDITABLE,
  submissions: new Set(['participant', 'period', 'source']),
}

// A person's history (crmActivities), keyed by contact.
const ACTIVITIES = 'crm_activities'

// Platform resources are backed by convex/mcp/platform.ts.
const PLATFORM_READ = [
  'members',
  'opportunities',
  'applications',
  'programs',
  'program_modules',
  'program_sessions',
  'program_participants',
  'surveys',
  'polls',
  'spaces',
  'bookings',
  'guest_applications',
  'events',
  'engagement',
  'outbox',
  'email_log',
]
const PLATFORM_CREATE = [
  'programs',
  'program_modules',
  'program_sessions',
  'opportunities',
  'surveys',
  'polls',
]
const PLATFORM_UPDATE = Object.keys(UPDATE_FIELDS) // programs, modules, sessions, opportunities, surveys, polls, spaces

const READ_RESOURCES = [
  ...Object.keys(CRM_RESOURCES),
  ACTIVITIES,
  ...PLATFORM_READ,
]
const CREATE_RESOURCES = [
  ...Object.keys(CRM_RESOURCES),
  ACTIVITIES,
  ...PLATFORM_CREATE,
]
const UPDATE_RESOURCES = [...Object.keys(CRM_RESOURCES), ...PLATFORM_UPDATE]
// CRM, manual history, plus opportunities — but only ones with nothing
// attached (see platform).
const DELETE_RESOURCES = [
  ...Object.keys(CRM_RESOURCES),
  ACTIVITIES,
  'opportunities',
]

const isCrm = (resource: string): resource is keyof typeof CRM_RESOURCES =>
  resource in CRM_RESOURCES

const isConfigurable = (resource: string) =>
  resource === 'crm_contacts' || resource === 'crm_organizations'

const orgProp = {
  org: {
    type: 'string',
    description:
      "Organization slug (e.g. 'baish'). Use list_my_orgs to discover yours.",
  },
}

export const TOOL_DEFS = [
  {
    name: 'list_my_orgs',
    description:
      'List the ASTN organizations where you are an admin. Returns id, name and slug per org. Use the slug as the `org` argument of every other tool.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'astn_resources',
    description:
      'List every resource this server exposes and what you can do with each (read / create / update / delete). ' +
      'Pass a `resource` for its field detail. For crm_contacts and crm_organizations also pass `org`: ' +
      "you get that org's live fields (key, label, type, select options, hidden, source), the core " +
      'columns, the value shape per type and the filter ops per type. Call this first.',
    inputSchema: {
      type: 'object',
      properties: {
        resource: {
          type: 'string',
          description: 'Optional: a resource name to describe its fields.',
        },
        org: {
          type: 'string',
          description:
            'Organization slug. Required with crm_contacts / crm_organizations (fields are per org).',
        },
      },
      required: [],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'astn_stats',
    description:
      'Org overview: member counts by role, opportunities by status, application funnel by status, programs by status, member engagement by level, and CRM collection counts.',
    inputSchema: {
      type: 'object',
      properties: { ...orgProp },
      required: ['org'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'astn_list',
    description:
      `List records of a resource. Resources: ${READ_RESOURCES.join(', ')}. ` +
      'Returns at most `limit` (default 100, max 500). ' +
      'crm_contacts / crm_organizations return {records, nextCursor, scanned?, note?} (not a bare ' +
      'array): `filters` [{field, op, value}] ANDed, with the ops of saved views (field = core ' +
      'column or field key; see astn_resources with org for types, options and valid ops); ' +
      '`email` (contacts: exact match on primary or other emails); `search` (name full-text; ' +
      'filters apply to the hits, in relevance order); `cursor` = nextCursor from the previous ' +
      'call with the same resource and search; `labels: true` keys `fields` by label. A call ' +
      'reads at most 5000 records, so with filters a page can be short while nextCursor is still ' +
      'set (a `note` says so); nextCursor is null only when everything was read. ' +
      'crm_activities needs `contactId` (optional `kind`, `source`), newest first. ' +
      'events: `when` upcoming (ascending) | past (descending) | all (default, descending), ' +
      '`from`/`to` ISO dates on the start time, `includePrivate` (default true; each event ' +
      'shows visibility and canceled). ' +
      'Other filters: `status`, `level` (engagement), `opportunityId` (applications/polls; ' +
      'required for outbox/email_log), `programId` (required for program_modules/sessions/' +
      'participants), `spaceId`/`date` (bookings/guest_applications), `search` ' +
      '(crm_opportunities title).',
    inputSchema: {
      type: 'object',
      properties: {
        ...orgProp,
        resource: { type: 'string', enum: READ_RESOURCES },
        search: { type: 'string', description: 'CRM full-text on name/title.' },
        filters: {
          type: 'array',
          description:
            'crm_contacts/crm_organizations. Ops: is, isNot, contains, hasAny, hasAll, isEmpty, ' +
            'isNotEmpty, before, after (valid per type). Selects take a string or string[] ' +
            '(any of), checkbox a boolean, date YYYY-MM-DD, number a number.',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              op: { type: 'string' },
              value: {},
            },
            required: ['field', 'op'],
          },
        },
        email: {
          type: 'string',
          description: 'crm_contacts: exact email (primary or other).',
        },
        cursor: {
          type: 'string',
          description:
            'crm_contacts/crm_organizations: nextCursor from the last call.',
        },
        labels: {
          type: 'boolean',
          description: 'crm_contacts/crm_organizations: key `fields` by label.',
        },
        contactId: {
          type: 'string',
          description: 'crm_activities: whose history.',
        },
        kind: {
          type: 'string',
          description:
            'crm_activities: program|session|form|event|note|application.',
        },
        source: {
          type: 'string',
          description: 'crm_activities: airtable|luma|app|manual.',
        },
        when: {
          type: 'string',
          enum: ['upcoming', 'past', 'all'],
          description: 'events: time window (default all).',
        },
        from: {
          type: 'string',
          description: 'events: start time ≥ this ISO date.',
        },
        to: {
          type: 'string',
          description: 'events: start time < this ISO date.',
        },
        includePrivate: {
          type: 'boolean',
          description:
            'events: include members-only and private events (default true).',
        },
        status: {
          type: 'string',
          description: 'Filter by status where applicable.',
        },
        level: { type: 'string', description: 'Engagement level filter.' },
        opportunityId: { type: 'string' },
        programId: { type: 'string' },
        spaceId: { type: 'string' },
        date: { type: 'string', description: 'ISO date (bookings).' },
        limit: { type: 'number', description: 'Max records (default 100).' },
      },
      required: ['org', 'resource'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'astn_get',
    description:
      `Fetch a single record by its _id. Resources: ${READ_RESOURCES.join(', ')}. ` +
      'Returns null if it does not exist in this org.',
    inputSchema: {
      type: 'object',
      properties: {
        ...orgProp,
        resource: { type: 'string', enum: READ_RESOURCES },
        id: { type: 'string', description: 'Record _id.' },
      },
      required: ['org', 'resource', 'id'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'astn_create',
    description:
      `Create a record. Creatable resources: ${CREATE_RESOURCES.join(', ')}. ` +
      'Opportunities, feedback surveys and availability polls are created through the same code ' +
      'the web app uses, so tokens, respondent lists and the default poll all come out right. ' +
      'Call astn_resources with a resource for its required fields. ' +
      '`fields` holds canonical keys (call astn_resources to see them; unknown keys are rejected). ' +
      'crm_contacts/crm_organizations: a flat object of core columns and field keys; values ' +
      "must have the field type's shape and select values must be existing options, or the " +
      'call fails listing the valid ones — pass addOptions: true to add new options instead. ' +
      'crm_activities: {contactId, title, kind? (note default|event|program|session|form), ' +
      'occurredAt? (ms or ISO), status?}; always source manual. ' +
      'For program_modules and program_sessions, also pass `programId`.',
    inputSchema: {
      type: 'object',
      properties: {
        ...orgProp,
        resource: { type: 'string', enum: CREATE_RESOURCES },
        programId: {
          type: 'string',
          description: 'Parent program (program_modules / program_sessions).',
        },
        fields: {
          type: 'object',
          description: 'Field values by canonical key.',
        },
        addOptions: {
          type: 'boolean',
          description:
            'crm_contacts/crm_organizations: add unknown select values as new options instead of failing.',
        },
      },
      required: ['org', 'resource', 'fields'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'astn_update',
    description:
      `Update fields of a record. Updatable resources: ${UPDATE_RESOURCES.join(', ')}. ` +
      'Only allowlisted fields can be changed (see astn_resources). For applications you ' +
      'can set `status` (submitted/under_review/accepted/next_edition/rejected/redirected/waitlisted/participated) and ' +
      '`reviewNotes`; this records the decision inside ASTN and never emails the applicant. ' +
      'For opportunities and surveys you can also replace `formFields` — the application form and ' +
      'the survey questions respectively. Pass the whole array (astn_get returns the current one); ' +
      'keys are sanitised on write. Adding questions is always allowed, at any status: a published ' +
      'survey is not frozen. Removing or renaming a question that people already answered is refused ' +
      'the first time, with the count of answers it would strand, and goes through on a repeat call ' +
      'with confirmDiscardsAnswers: true. ' +
      'crm_contacts/crm_organizations: same strict value rules as astn_create (addOptions: true ' +
      'adds new select options); null clears a field. ' +
      'Sending emails is never exposed here. Only the provided keys change.',
    inputSchema: {
      type: 'object',
      properties: {
        ...orgProp,
        resource: { type: 'string', enum: UPDATE_RESOURCES },
        id: { type: 'string', description: 'Record _id.' },
        fields: { type: 'object', description: 'Field values to change.' },
        addOptions: {
          type: 'boolean',
          description:
            'crm_contacts/crm_organizations: add unknown select values as new options instead of failing.',
        },
        confirmDiscardsAnswers: {
          type: 'boolean',
          description:
            'For formFields on opportunities and surveys. Acknowledges that the new form drops ' +
            'questions people already answered, stranding those answers. The error you get ' +
            'without it tells you exactly how many.',
        },
      },
      required: ['org', 'resource', 'id', 'fields'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'astn_delete',
    description:
      `Permanently delete a record. Deletable resources: ${DELETE_RESOURCES.join(', ')}. ` +
      'This cannot be undone — confirm with the user before calling it. Deleting a contact also ' +
      'deletes its history. crm_activities: only manual entries (imported and Luma history comes ' +
      'back on the next sync). Opportunities only with nothing attached; for platform records prefer ' +
      'setting status to archived/closed via astn_update.',
    inputSchema: {
      type: 'object',
      properties: {
        ...orgProp,
        resource: { type: 'string', enum: DELETE_RESOURCES },
        id: { type: 'string', description: 'Record _id.' },
      },
      required: ['org', 'resource', 'id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'crm_person',
    description:
      'One person across ASTN, by contactId or email (primary or other emails): the contact ' +
      'with its fields, all emails, the linked app profile, and one timeline, newest first, of ' +
      'applications, event registrations (ASTN and Luma, with status such as approved or ' +
      'checked_in), program participation, imported Airtable history and notes. Plus counts ' +
      'by kind.',
    inputSchema: {
      type: 'object',
      properties: {
        ...orgProp,
        contactId: { type: 'string', description: 'crmContacts _id.' },
        email: { type: 'string', description: 'Any of the person’s emails.' },
      },
      required: ['org'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'event_attendance',
    description:
      'Who registered for and attended an event: the event (with Luma counts, visibility, ' +
      'canceled), each person with status (approved|checked_in|pending|declined|waitlist|' +
      'invited), checkedIn, contactId, name and email, and summary counts. Built from the ' +
      'Luma attendance history; if an ASTN event page is linked to the same Luma event, its ' +
      'guests are merged in and their status and check-in win (checkInSource says whether ' +
      'Luma or the ASTN door page checked them in). Get ids from astn_list resource=events.',
    inputSchema: {
      type: 'object',
      properties: {
        ...orgProp,
        eventId: { type: 'string', description: 'events _id.' },
        lumaEventId: { type: 'string', description: "Luma id ('evt-…')." },
      },
      required: ['org'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'survey_results',
    description:
      'Aggregated responses for a feedback survey: the form fields plus every submitted response. Get the surveyId from astn_list resource=surveys.',
    inputSchema: {
      type: 'object',
      properties: {
        ...orgProp,
        surveyId: { type: 'string', description: 'feedbackSurveys _id.' },
      },
      required: ['org', 'surveyId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'availability_heatmap',
    description:
      'Availability for a poll, aggregated and per person. Slot keys are ' +
      '"<weekday 0=Mon>|<minutes-from-midnight>" on a generic week. `slots` gives the ' +
      'available/maybe counts per slot; `respondents` gives each person by name with the ' +
      'slots they picked, which is what splitting a cohort into groups needs; `pending` ' +
      'lists people invited who have not answered. Plus poll config and finalizedSlot. ' +
      'Get the pollId from astn_list resource=polls.',
    inputSchema: {
      type: 'object',
      properties: {
        ...orgProp,
        pollId: { type: 'string', description: 'availabilityPolls _id.' },
      },
      required: ['org', 'pollId'],
    },
    annotations: { readOnlyHint: true },
  },
]

// ── astn_resources output ────────────────────────────────────────────────────

function describeCrmFields(collection: 'opportunities' | 'submissions') {
  const writable = CRM_WRITABLE[collection]
  const documented = CRM_FIELDS[collection].map((f) => ({
    key: f.key,
    label: f.label,
    required: f.required ?? false,
    writable: writable.has(f.key),
    type: f.type ?? 'string',
  }))
  const extras = [...writable]
    .filter((key) => !CRM_FIELDS[collection].some((f) => f.key === key))
    .map((key) => ({
      key,
      label: key,
      required: false,
      writable: true,
      type: 'string',
    }))
  return { resource: `crm_${collection}`, fields: [...documented, ...extras] }
}

const ACTIVITIES_DESCRIPTION = {
  resource: ACTIVITIES,
  read: true,
  create: true,
  update: false,
  delete: true,
  fields: {
    contactId: 'crmContacts _id',
    kind: 'program | session | form | event | note | application',
    title: 'string (for notes, the text)',
    occurredAt: 'ms timestamp',
    status:
      'optional string (Luma: approved | checked_in | pending | declined | waitlist)',
    source: 'airtable | luma | app | manual',
    externalId: "import key; Luma rows are 'luma:{lumaEventId}:{email}'",
    data: 'extra imported answers',
  },
  note:
    "A person's history that has no richer home in ASTN: imported Airtable programs, sessions " +
    'and forms, every Luma event registration, and manual notes. astn_list needs contactId ' +
    '(optional kind, source). astn_create makes manual entries only: {contactId, title, kind? ' +
    '(note default|event|program|session|form), occurredAt?, status?}. astn_delete removes ' +
    'manual entries only. For the whole timeline including applications use crm_person.',
}

const PLATFORM_FIELD_HINTS: Record<string, string> = {
  programs:
    'create requires: name, type (reading_group|fellowship|mentorship|cohort|workshop_series|custom), enrollmentMethod (admin_only|self_enroll|approval_required). optional: description, startDate, endDate, maxParticipants.',
  program_modules:
    'create requires: programId, title, weekNumber. optional: description, status (locked|available|completed).',
  program_sessions:
    'create requires: programId, dayNumber, title, date. optional: morningStartTime, afternoonStartTime, lumaUrl.',
  opportunities:
    'create requires: title, description, type (course|fellowship|job|other). optional: status ' +
    '(defaults to draft), deadline (ms), externalUrl, featured, tags, isEOI, formFields (the ' +
    'application form). A readable slug and the default availability poll are created for you.',
  surveys:
    'create requires: opportunityId, title, formFields (the questions). optional: description, ' +
    'applicantStatuses (which applicants get a personal link, e.g. ["accepted"]), anonymous. ' +
    'Always created as a draft — publish it by setting status to open. Returns the accessToken, ' +
    'which is the shareable link and, for an anonymous survey, the only way in. ' +
    'LIMIT: one active survey PER KIND per opportunity, where the kind is identified vs anonymous. ' +
    'So an identified survey and an anonymous one can be active at the same time on the same ' +
    'opportunity — that is the intended setup, e.g. named end-of-course feedback alongside ' +
    'anonymous feedback about the facilitators. What is refused is a second survey of the same ' +
    'kind while one is draft or open; close the first one, or edit it instead of creating another.',
  polls:
    'create requires: opportunityId. everything else defaults to how BAISH runs them: Mon–Sat ' +
    '09:00–21:00 in 30-minute slots, Buenos Aires. optional: title, timezone, days (0=Mon…6=Sun), ' +
    'startMinutes, endMinutes, slotDurationMinutes (15|30|60). Opens immediately and seeds a ' +
    'respondent per applicant. One active poll per opportunity.',
}

const PLATFORM_UPDATE_HINTS: Record<string, string> = {
  opportunities:
    'archived: true|false takes it out of / back into the admin list without touching anything ' +
    'that references it — use it for finished cohorts and for mistakes. formFields replaces the ' +
    'application form (pass the whole array). astn_delete only works on an opportunity with ' +
    'nothing attached: no applications, surveys, extra polls or sent emails.',
  surveys:
    'status ∈ draft|open|closed. Opening publishes it — and an identified survey and an anonymous ' +
    'one can both be open on the same opportunity, so publishing one never means retiring the ' +
    'other. The one-active limit is per kind, not per opportunity. formFields replaces the ' +
    'questions (pass ' +
    'the whole array) and works at any status — adding is always free; removing a question is ' +
    'refused while somebody has answered it, and the refusal names the questions and the count. ' +
    'Repeat with confirmDiscardsAnswers: true to strand those answers on purpose.',
  polls:
    'status ∈ open|closed. Finalizing (picking the chosen slot) is done in the web app.',
  applications:
    'status ∈ submitted|under_review|accepted|next_edition|rejected|redirected|waitlisted|participated (redirected = "Fit for another course"; next_edition = accepted for a later edition of the same course — whoever has it is accepted automatically when they apply or give availability to a later edition sharing a course tag); reviewNotes is free text. Setting these records the decision in ASTN and stamps reviewedAt/reviewedBy — it does NOT email the applicant (decision emails are drafted into the outbox when the opportunity has a template set).',
}

const PLATFORM_READ_HINTS: Record<string, string> = {
  events:
    'The Luma calendar mirror. astn_list returns a summary per event (no description; astn_get ' +
    'returns the full row): when (upcoming|past|all), from/to (ISO, on startAt), ' +
    'includePrivate (default true). Each event has visibility (public|members-only|private), ' +
    'canceled and the Luma guest counts. event_attendance gives the people. Creating or ' +
    'editing Luma events is not exposed: it emails real guests.',
}

async function describeResource(
  ctx: ActionCtx,
  userId: string,
  resource: string,
  org: string | undefined,
) {
  if (isConfigurable(resource)) {
    if (!org) {
      throw new Error(
        `Pass \`org\` with resource ${resource}: its fields are configured per organization.`,
      )
    }
    return await ctx.runQuery(internal.mcp.data.describeFields, {
      userId,
      orgSlug: org,
      collection: CRM_RESOURCES[resource] as 'contacts' | 'organizations',
    })
  }
  if (resource === ACTIVITIES) return ACTIVITIES_DESCRIPTION
  if (isCrm(resource)) {
    return describeCrmFields(
      CRM_RESOURCES[resource] as 'opportunities' | 'submissions',
    )
  }
  const updatable = UPDATE_FIELDS[resource]
  return {
    resource,
    read: PLATFORM_READ.includes(resource),
    creatable: PLATFORM_CREATE.includes(resource),
    updatableFields: updatable ? [...updatable] : [],
    readHint: PLATFORM_READ_HINTS[resource] ?? null,
    createHint: PLATFORM_FIELD_HINTS[resource] ?? null,
    updateHint: PLATFORM_UPDATE_HINTS[resource] ?? null,
    note: 'astn_get returns the full document (astn_list too, except where readHint says otherwise); the fields above are what astn_update accepts.',
  }
}

function describeAllResources() {
  const cap = (r: string) => ({
    name: r,
    kind: isCrm(r) || r === ACTIVITIES ? 'crm' : 'platform',
    read: READ_RESOURCES.includes(r),
    create: CREATE_RESOURCES.includes(r),
    update: UPDATE_RESOURCES.includes(r),
    delete: DELETE_RESOURCES.includes(r),
  })
  const all = [
    ...new Set([...READ_RESOURCES, ...CREATE_RESOURCES, ...UPDATE_RESOURCES]),
  ]
  return {
    resources: all.map(cap),
    tools: {
      crm_person: 'one person: contact, emails, profile and full timeline',
      event_attendance: 'an event and who registered / checked in',
    },
    note: "Pass a `resource` to astn_resources for its field detail (with `org` for crm_contacts / crm_organizations, whose fields are configured per org). Reads cover the whole org, including the CRM with its configurable fields, each person's history (crm_activities, crm_person) and the Luma events mirror with attendance (events, event_attendance). Writes are allowed where a mistake can be undone: you can build a cohort end to end — create the opportunity with its application form, create and open its feedback survey and availability poll, record admission decisions — and keep the CRM up to date (contacts, organizations, notes), because all of that is reversible. What stays out is what is not: sending emails or broadcasts (a status change queues a draft for a human to send, and never sends), any Luma write (creating or editing Luma events, approving guests and blasts all email real guests), membership changes, finalizing a poll, and deleting anything holding other people's answers or imported history.",
  }
}

/**
 * Re-key each record's `fields` by label for `labels: true`. Done here, not
 * in the query, because Convex values can't carry non-ASCII keys.
 */
function relabel(result: {
  records: Array<{ fields?: Record<string, unknown> }>
  fieldLabels?: Record<string, string>
}) {
  const { fieldLabels, ...rest } = result
  if (!fieldLabels) return result
  return {
    ...rest,
    records: rest.records.map((r) => ({
      ...r,
      fields: Object.fromEntries(
        Object.entries(r.fields ?? {}).map(([k, value]) => [
          fieldLabels[k] ?? k,
          value,
        ]),
      ),
    })),
  }
}

// Most records one astn_list call reads for crm_contacts/crm_organizations,
// and the page size it reads them in.
const CRM_SCAN_BUDGET = 5000
const CRM_PAGE = 200

type CrmPage = {
  matches: Array<{ fields?: Record<string, unknown> }>
  positions: Array<number>
  scanned: number
  continueCursor: string | null
  isDone: boolean
  fieldLabels?: Record<string, string>
}

/**
 * astn_list for crm_contacts / crm_organizations. Convex allows one
 * `.paginate()` per query, so the pages are chained here: read pages from
 * the cursor, keep the matches, stop at `limit` matches or CRM_SCAN_BUDGET
 * rows. When a page holds more matches than still fit, the same page is
 * read again from its start cursor, cut right after the last match that
 * fits, so the returned cursor never skips a match. nextCursor is null only
 * when the index was read to the end.
 */
async function listCrm(
  ctx: ActionCtx,
  userId: string,
  org: string,
  resource: string,
  args: Record<string, unknown>,
) {
  if (args.filters !== undefined && !Array.isArray(args.filters)) {
    throw new Error('filters must be an array of {field, op, value}')
  }
  const str = (key: string) =>
    typeof args[key] === 'string' ? (args[key] as string) : undefined
  const limit = Math.min(
    Math.max(Math.floor(Number(args.limit ?? 100) || 100), 1),
    500,
  )
  const filtered = Array.isArray(args.filters) && args.filters.length > 0
  const base = {
    userId,
    orgSlug: org,
    collection: CRM_RESOURCES[resource] as 'contacts' | 'organizations',
    filters: args.filters as any,
    email: str('email'),
    search: str('search'),
    labels: args.labels === true ? true : undefined,
  }
  const readPage = (cursor: string | null, numItems: number) =>
    ctx.runQuery(internal.mcp.data.listCrmPage, {
      ...base,
      cursor,
      numItems,
    }) as Promise<CrmPage>

  const records: CrmPage['matches'] = []
  let cursor = str('cursor') ?? null
  let scanned = 0
  let isDone = false
  let fieldLabels: Record<string, string> | undefined
  while (records.length < limit && scanned < CRM_SCAN_BUDGET) {
    const left = limit - records.length
    // Unfiltered, a page can't hold more matches than rows.
    const numItems = Math.min(
      CRM_PAGE,
      CRM_SCAN_BUDGET - scanned,
      filtered ? CRM_PAGE : left,
    )
    let page = await readPage(cursor, numItems)
    fieldLabels = page.fieldLabels
    if (page.matches.length > left && !base.email) {
      page = await readPage(cursor, page.positions[left - 1] + 1)
    }
    records.push(...page.matches.slice(0, left))
    scanned += page.scanned
    cursor = page.continueCursor
    if (page.isDone) {
      isDone = true
      break
    }
    if (page.scanned === 0) break
  }
  const result = {
    records,
    nextCursor: isDone ? null : cursor,
    scanned,
    ...(!isDone && records.length < limit
      ? {
          note:
            `Read ${scanned} records and found ${records.length} matches; there are more ` +
            'records to read. Call again with nextCursor to continue.',
        }
      : {}),
  }
  return fieldLabels ? relabel({ ...result, fieldLabels }) : result
}

// ── Dispatch ──────────────────────────────────────────────────────────────

export async function callTool(
  ctx: ActionCtx,
  userId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const org = args.org as string
  const resource = args.resource as string
  const str = (key: string) =>
    typeof args[key] === 'string' ? (args[key] as string) : undefined

  switch (name) {
    case 'list_my_orgs':
      return await ctx.runQuery(internal.mcp.data.myAdminOrgs, { userId })

    case 'astn_resources':
      return args.resource
        ? await describeResource(ctx, userId, resource, str('org'))
        : describeAllResources()

    case 'astn_stats':
      return await ctx.runQuery(internal.mcp.platform.orgStats, {
        userId,
        orgSlug: org,
      })

    case 'astn_list':
      if (resource === ACTIVITIES) {
        return await ctx.runQuery(internal.mcp.people.listActivities, {
          userId,
          orgSlug: org,
          contactId: str('contactId'),
          kind: str('kind'),
          source: str('source'),
          limit: args.limit as number | undefined,
        })
      }
      if (isConfigurable(resource)) {
        return await listCrm(ctx, userId, org, resource, args)
      }
      if (isCrm(resource)) {
        if (args.filters || args.email || args.cursor || args.labels) {
          throw new Error(
            'filters, email, cursor and labels apply to crm_contacts and crm_organizations only',
          )
        }
        return await ctx.runQuery(internal.mcp.data.listRecords, {
          userId,
          orgSlug: org,
          collection: CRM_RESOURCES[resource] as
            | 'opportunities'
            | 'submissions',
          search: str('search'),
          limit: args.limit as number | undefined,
        })
      }
      return await ctx.runQuery(internal.mcp.platform.list, {
        userId,
        orgSlug: org,
        resource: resource as any,
        opportunityId: args.opportunityId as string | undefined,
        programId: args.programId as string | undefined,
        spaceId: args.spaceId as string | undefined,
        status: args.status as string | undefined,
        level: args.level as string | undefined,
        date: args.date as string | undefined,
        limit: args.limit as number | undefined,
        ...(resource === 'events'
          ? {
              when: str('when'),
              from: str('from'),
              to: str('to'),
              includePrivate:
                typeof args.includePrivate === 'boolean'
                  ? args.includePrivate
                  : undefined,
              now: Date.now(),
            }
          : {}),
      })

    case 'astn_get':
      if (resource === ACTIVITIES) {
        return await ctx.runQuery(internal.mcp.people.getActivity, {
          userId,
          orgSlug: org,
          id: args.id as string,
        })
      }
      if (isCrm(resource)) {
        return await ctx.runQuery(internal.mcp.data.getRecord, {
          userId,
          orgSlug: org,
          collection: CRM_RESOURCES[resource] as any,
          id: args.id as string,
        })
      }
      return await ctx.runQuery(internal.mcp.platform.getOne, {
        userId,
        orgSlug: org,
        resource: resource as any,
        id: args.id as string,
      })

    case 'astn_create':
      if (resource === ACTIVITIES) {
        return await ctx.runMutation(internal.mcp.people.createActivity, {
          userId,
          orgSlug: org,
          fields: args.fields ?? {},
        })
      }
      if (isCrm(resource)) {
        return await ctx.runMutation(internal.mcp.data.createRecord, {
          userId,
          orgSlug: org,
          collection: CRM_RESOURCES[resource] as any,
          fields: args.fields ?? {},
          addOptions: args.addOptions === true,
        })
      }
      if (resource === 'programs') {
        return await ctx.runMutation(internal.mcp.platform.createProgram, {
          userId,
          orgSlug: org,
          fields: args.fields ?? {},
        })
      }
      if (resource === 'program_modules') {
        return await ctx.runMutation(internal.mcp.platform.createModule, {
          userId,
          orgSlug: org,
          programId: args.programId as string,
          fields: args.fields ?? {},
        })
      }
      if (resource === 'opportunities') {
        return await ctx.runMutation(internal.mcp.platform.createOpportunity, {
          userId,
          orgSlug: org,
          ...(args.fields as any),
        })
      }
      if (resource === 'surveys') {
        return await ctx.runMutation(internal.mcp.platform.createSurvey, {
          userId,
          orgSlug: org,
          ...(args.fields as any),
        })
      }
      if (resource === 'polls') {
        return await ctx.runMutation(internal.mcp.platform.createPoll, {
          userId,
          orgSlug: org,
          ...(args.fields as any),
        })
      }
      if (resource === 'program_sessions') {
        return await ctx.runMutation(internal.mcp.platform.createSession, {
          userId,
          orgSlug: org,
          programId: args.programId as string,
          fields: args.fields ?? {},
        })
      }
      throw new Error(`Resource '${String(resource)}' is not creatable`)

    case 'astn_update':
      if (isCrm(resource)) {
        return await ctx.runMutation(internal.mcp.data.updateRecord, {
          userId,
          orgSlug: org,
          collection: CRM_RESOURCES[resource] as any,
          id: args.id as string,
          fields: args.fields ?? {},
          addOptions: args.addOptions === true,
        })
      }
      return await ctx.runMutation(internal.mcp.platform.update, {
        userId,
        orgSlug: org,
        resource: resource as any,
        id: args.id as string,
        fields: args.fields ?? {},
        confirmDiscardsAnswers: args.confirmDiscardsAnswers as
          | boolean
          | undefined,
      })

    case 'astn_delete':
      if (resource === ACTIVITIES) {
        return await ctx.runMutation(internal.mcp.people.deleteActivity, {
          userId,
          orgSlug: org,
          id: args.id as string,
        })
      }
      if (isCrm(resource)) {
        return await ctx.runMutation(internal.mcp.data.deleteRecord, {
          userId,
          orgSlug: org,
          collection: CRM_RESOURCES[resource] as any,
          id: args.id as string,
        })
      }
      if (resource === 'opportunities') {
        return await ctx.runMutation(internal.mcp.platform.deleteOpportunity, {
          userId,
          orgSlug: org,
          id: args.id as string,
        })
      }
      throw new Error(
        `Resource '${String(resource)}' is not deletable. Use astn_update to set status to archived/closed.`,
      )

    case 'crm_person':
      return await ctx.runQuery(internal.mcp.people.person, {
        userId,
        orgSlug: org,
        contactId: str('contactId'),
        email: str('email'),
      })

    case 'event_attendance':
      return await ctx.runQuery(internal.mcp.people.eventAttendance, {
        userId,
        orgSlug: org,
        eventId: str('eventId'),
        lumaEventId: str('lumaEventId'),
      })

    case 'survey_results':
      return await ctx.runQuery(internal.mcp.platform.surveyResults, {
        userId,
        orgSlug: org,
        surveyId: args.surveyId as string,
      })

    case 'availability_heatmap':
      return await ctx.runQuery(internal.mcp.platform.availabilityHeatmap, {
        userId,
        orgSlug: org,
        pollId: args.pollId as string,
      })

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}
