import { internal } from '../_generated/api'
import type { ActionCtx } from '../_generated/server'
import { CRM_FIELDS, type CrmCollection } from '../lib/crmFields'
import {
  CONTACT_EDITABLE,
  OPPORTUNITY_EDITABLE,
  ORGANIZATION_EDITABLE,
} from '../crm'

// MCP tool definitions + dispatch for the /mcp endpoint. Tool inputs take the
// org *slug* (human-friendly, discoverable via list_my_orgs) and a collection
// name; the data layer resolves and authorizes both on every call.

const COLLECTION_ENUM = [
  'contacts',
  'organizations',
  'opportunities',
  'submissions',
]

const WRITABLE: Record<string, Set<string>> = {
  contacts: CONTACT_EDITABLE,
  organizations: ORGANIZATION_EDITABLE,
  opportunities: OPPORTUNITY_EDITABLE,
  submissions: new Set(['participant', 'period', 'source']),
}

const writableDocs = COLLECTION_ENUM.map(
  (c) => `${c}: ${[...WRITABLE[c]].join(', ')}`,
).join(' | ')

const orgProp = {
  org: {
    type: 'string',
    description:
      "Organization slug (e.g. 'baish'). Use list_my_orgs to discover yours.",
  },
}
const collectionProp = {
  collection: {
    type: 'string',
    enum: COLLECTION_ENUM,
    description: 'Which CRM collection to operate on.',
  },
}

export const TOOL_DEFS = [
  {
    name: 'list_my_orgs',
    description:
      'List the ASTN organizations where you are an admin. Returns id, name and slug per org. Use the slug as the `org` argument of every other CRM tool.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'crm_stats',
    description:
      'Record counts for each CRM collection (contacts, organizations, opportunities, submissions) of an org.',
    inputSchema: {
      type: 'object',
      properties: { ...orgProp },
      required: ['org'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'crm_fields',
    description:
      'Describe the fields of a CRM collection: canonical key, human label, and whether it is required or writable. Call this before creating or updating records.',
    inputSchema: {
      type: 'object',
      properties: { ...collectionProp },
      required: ['collection'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'crm_list',
    description:
      'List records in a CRM collection. Optional full-text `search` matches the name field (title for opportunities; not available for submissions). Returns at most `limit` records (default 100, max 500).',
    inputSchema: {
      type: 'object',
      properties: {
        ...orgProp,
        ...collectionProp,
        search: { type: 'string', description: 'Optional search text.' },
        limit: { type: 'number', description: 'Max records (default 100).' },
      },
      required: ['org', 'collection'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'crm_get',
    description:
      'Fetch a single CRM record by its id (the `_id` returned by crm_list). Returns null if it does not exist in this org.',
    inputSchema: {
      type: 'object',
      properties: {
        ...orgProp,
        ...collectionProp,
        id: { type: 'string', description: 'Record _id.' },
      },
      required: ['org', 'collection', 'id'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'crm_create',
    description:
      `Create a CRM record. \`fields\` is an object of canonical field keys. Writable fields — ${writableDocs}. ` +
      'For submissions, an additional `data` object holds free-form extra columns. Unknown keys are rejected.',
    inputSchema: {
      type: 'object',
      properties: {
        ...orgProp,
        ...collectionProp,
        fields: {
          type: 'object',
          description: 'Field values keyed by canonical field name.',
        },
      },
      required: ['org', 'collection', 'fields'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'crm_update',
    description:
      'Update fields of an existing CRM record. Same writable fields as crm_create. Only the provided keys are changed.',
    inputSchema: {
      type: 'object',
      properties: {
        ...orgProp,
        ...collectionProp,
        id: { type: 'string', description: 'Record _id.' },
        fields: {
          type: 'object',
          description: 'Field values to change, keyed by canonical name.',
        },
      },
      required: ['org', 'collection', 'id', 'fields'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'crm_delete',
    description:
      'Permanently delete a CRM record. This cannot be undone — confirm with the user before calling it.',
    inputSchema: {
      type: 'object',
      properties: {
        ...orgProp,
        ...collectionProp,
        id: { type: 'string', description: 'Record _id.' },
      },
      required: ['org', 'collection', 'id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
]

function describeFields(collection: CrmCollection) {
  const writable = WRITABLE[collection]
  const documented = CRM_FIELDS[collection].map((f) => ({
    key: f.key,
    label: f.label,
    required: f.required ?? false,
    writable: writable.has(f.key),
    type: f.type ?? 'string',
  }))
  // Writable fields that the import registry doesn't document (e.g. `notes`).
  const extras = [...writable]
    .filter((key) => !CRM_FIELDS[collection].some((f) => f.key === key))
    .map((key) => ({
      key,
      label: key,
      required: false,
      writable: true,
      type: 'string',
    }))
  return { collection, fields: [...documented, ...extras] }
}

export async function callTool(
  ctx: ActionCtx,
  userId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case 'list_my_orgs':
      return await ctx.runQuery(internal.mcp.data.myAdminOrgs, { userId })
    case 'crm_stats':
      return await ctx.runQuery(internal.mcp.data.stats, {
        userId,
        orgSlug: args.org as string,
      })
    case 'crm_fields':
      return describeFields(args.collection as CrmCollection)
    case 'crm_list':
      return await ctx.runQuery(internal.mcp.data.listRecords, {
        userId,
        orgSlug: args.org as string,
        collection: args.collection as any,
        search: args.search as string | undefined,
        limit: args.limit as number | undefined,
      })
    case 'crm_get':
      return await ctx.runQuery(internal.mcp.data.getRecord, {
        userId,
        orgSlug: args.org as string,
        collection: args.collection as any,
        id: args.id as string,
      })
    case 'crm_create':
      return await ctx.runMutation(internal.mcp.data.createRecord, {
        userId,
        orgSlug: args.org as string,
        collection: args.collection as any,
        fields: args.fields ?? {},
      })
    case 'crm_update':
      return await ctx.runMutation(internal.mcp.data.updateRecord, {
        userId,
        orgSlug: args.org as string,
        collection: args.collection as any,
        id: args.id as string,
        fields: args.fields ?? {},
      })
    case 'crm_delete':
      return await ctx.runMutation(internal.mcp.data.deleteRecord, {
        userId,
        orgSlug: args.org as string,
        collection: args.collection as any,
        id: args.id as string,
      })
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}
