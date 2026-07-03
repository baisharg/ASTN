import { internal } from '../_generated/api'
import type { ActionCtx } from '../_generated/server'
import { CRM_FIELDS, type CrmCollection } from '../lib/crmFields'
import {
  CONTACT_EDITABLE,
  OPPORTUNITY_EDITABLE,
  ORGANIZATION_EDITABLE,
} from '../crm'
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

const CRM_WRITABLE: Record<CrmCollection, Set<string>> = {
  contacts: CONTACT_EDITABLE,
  organizations: ORGANIZATION_EDITABLE,
  opportunities: OPPORTUNITY_EDITABLE,
  submissions: new Set(['participant', 'period', 'source']),
}

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
const PLATFORM_CREATE = ['programs', 'program_modules', 'program_sessions']
const PLATFORM_UPDATE = Object.keys(UPDATE_FIELDS) // programs, modules, sessions, opportunities, surveys, polls, spaces

const READ_RESOURCES = [...Object.keys(CRM_RESOURCES), ...PLATFORM_READ]
const CREATE_RESOURCES = [...Object.keys(CRM_RESOURCES), ...PLATFORM_CREATE]
const UPDATE_RESOURCES = [...Object.keys(CRM_RESOURCES), ...PLATFORM_UPDATE]
const DELETE_RESOURCES = Object.keys(CRM_RESOURCES) // CRM only in v1

const isCrm = (resource: string): resource is keyof typeof CRM_RESOURCES =>
  resource in CRM_RESOURCES

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
      'List every resource this server exposes and what you can do with each (read / create / update / delete), plus the filters astn_list accepts. Pass a `resource` to get its field detail (canonical keys, which are writable). Call this first to discover the data model.',
    inputSchema: {
      type: 'object',
      properties: {
        resource: {
          type: 'string',
          description: 'Optional: a resource name to describe its fields.',
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
      'Optional filters (resource-dependent): `search` (CRM name/title), ' +
      '`status`, `level` (engagement), `opportunityId` (applications/polls; required for outbox/email_log), ' +
      '`programId` (required for program_modules/sessions/participants), ' +
      '`spaceId`/`date` (bookings/guest_applications). Returns at most `limit` (default 100, max 500).',
    inputSchema: {
      type: 'object',
      properties: {
        ...orgProp,
        resource: { type: 'string', enum: READ_RESOURCES },
        search: { type: 'string', description: 'CRM full-text on name/title.' },
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
      '`fields` holds canonical keys (call astn_resources to see them; unknown keys are rejected). ' +
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
      },
      required: ['org', 'resource', 'fields'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'astn_update',
    description:
      `Update fields of a record. Updatable resources: ${UPDATE_RESOURCES.join(', ')}. ` +
      'Only allowlisted scalar fields can be changed (see astn_resources). For applications you ' +
      'can set `status` (submitted/under_review/accepted/rejected/redirected/waitlisted/participated) and ' +
      '`reviewNotes`; this records the decision inside ASTN and never emails the applicant. ' +
      'Other outward-facing actions (sending emails, publishing) are not exposed here. ' +
      'Only the provided keys change.',
    inputSchema: {
      type: 'object',
      properties: {
        ...orgProp,
        resource: { type: 'string', enum: UPDATE_RESOURCES },
        id: { type: 'string', description: 'Record _id.' },
        fields: { type: 'object', description: 'Field values to change.' },
      },
      required: ['org', 'resource', 'id', 'fields'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'astn_delete',
    description:
      `Permanently delete a record. Deletable resources: ${DELETE_RESOURCES.join(', ')} (CRM only). ` +
      'This cannot be undone — confirm with the user before calling it. For platform records prefer ' +
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
      'Aggregated availability for a poll: per generic-week slot ("<weekday 0=Mon>|<minutes-from-midnight>") the count of available vs maybe respondents, plus poll config. Get the pollId from astn_list resource=polls.',
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

function describeCrmFields(collection: CrmCollection) {
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

const PLATFORM_FIELD_HINTS: Record<string, string> = {
  programs:
    'create requires: name, type (reading_group|fellowship|mentorship|cohort|workshop_series|custom), enrollmentMethod (admin_only|self_enroll|approval_required). optional: description, startDate, endDate, maxParticipants.',
  program_modules:
    'create requires: programId, title, weekNumber. optional: description, status (locked|available|completed).',
  program_sessions:
    'create requires: programId, dayNumber, title, date. optional: morningStartTime, afternoonStartTime, lumaUrl.',
}

const PLATFORM_UPDATE_HINTS: Record<string, string> = {
  applications:
    'status ∈ submitted|under_review|accepted|rejected|redirected|waitlisted|participated (redirected = "Fit for another course"); reviewNotes is free text. Setting these records the decision in ASTN and stamps reviewedAt/reviewedBy — it does NOT email the applicant (decision emails are drafted into the outbox when the opportunity has a template set).',
}

function describeResource(resource: string) {
  if (isCrm(resource)) return describeCrmFields(CRM_RESOURCES[resource])
  const updatable = UPDATE_FIELDS[resource]
  return {
    resource,
    read: PLATFORM_READ.includes(resource),
    creatable: PLATFORM_CREATE.includes(resource),
    updatableFields: updatable ? [...updatable] : [],
    createHint: PLATFORM_FIELD_HINTS[resource] ?? null,
    updateHint: PLATFORM_UPDATE_HINTS[resource] ?? null,
    note: 'astn_get/astn_list return the full document; the fields above are what astn_update accepts.',
  }
}

function describeAllResources() {
  const cap = (r: string) => ({
    name: r,
    kind: isCrm(r) ? 'crm' : 'platform',
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
    note: 'Pass a `resource` to astn_resources for its field detail. Reads cover the whole org; writes are limited to safe changes. Setting an application status records the decision inside ASTN without emailing the applicant. Sending emails/broadcasts, membership changes, and publishing/finalizing are intentionally not exposed yet.',
  }
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

  switch (name) {
    case 'list_my_orgs':
      return await ctx.runQuery(internal.mcp.data.myAdminOrgs, { userId })

    case 'astn_resources':
      return args.resource
        ? describeResource(args.resource as string)
        : describeAllResources()

    case 'astn_stats':
      return await ctx.runQuery(internal.mcp.platform.orgStats, {
        userId,
        orgSlug: org,
      })

    case 'astn_list':
      if (isCrm(resource)) {
        return await ctx.runQuery(internal.mcp.data.listRecords, {
          userId,
          orgSlug: org,
          collection: CRM_RESOURCES[resource] as any,
          search: args.search as string | undefined,
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
      })

    case 'astn_get':
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
      if (isCrm(resource)) {
        return await ctx.runMutation(internal.mcp.data.createRecord, {
          userId,
          orgSlug: org,
          collection: CRM_RESOURCES[resource] as any,
          fields: args.fields ?? {},
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
        })
      }
      return await ctx.runMutation(internal.mcp.platform.update, {
        userId,
        orgSlug: org,
        resource: resource as any,
        id: args.id as string,
        fields: args.fields ?? {},
      })

    case 'astn_delete':
      if (isCrm(resource)) {
        return await ctx.runMutation(internal.mcp.data.deleteRecord, {
          userId,
          orgSlug: org,
          collection: CRM_RESOURCES[resource] as any,
          id: args.id as string,
        })
      }
      throw new Error(
        `Resource '${String(resource)}' is not deletable. Use astn_update to set status to archived/closed.`,
      )

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
