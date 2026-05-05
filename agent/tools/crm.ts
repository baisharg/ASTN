import { z } from 'zod'
import { tool } from '@anthropic-ai/claude-agent-sdk'
import type { ConvexClient } from 'convex/browser'
import type { Id } from '../../convex/_generated/dataModel'
import { api } from '../../convex/_generated/api'
import type { ConfirmationContext } from './confirmable'
import { confirmAction } from './confirmable'

type CrmCollection =
  | 'contacts'
  | 'organizations'
  | 'opportunities'
  | 'submissions'

const collectionSchema = z
  .enum(['contacts', 'organizations', 'opportunities', 'submissions'])
  .describe('Which CRM collection to operate on')

function formatRecord(col: CrmCollection, r: any): string {
  const id = r._id
  if (col === 'contacts') {
    return `- **${r.name ?? 'No name'}** | ${r.email ?? '—'} | ${r.role ?? '—'} | ID: ${id}`
  }
  if (col === 'organizations') {
    return `- **${r.name ?? 'No name'}** | ${r.type ?? '—'} | ${r.mainTopic ?? '—'} | ID: ${id}`
  }
  if (col === 'opportunities') {
    return `- **${r.title ?? 'No title'}** | ${r.organization ?? '—'} | ${r.status ?? '—'} | ${r.category ?? '—'} | ID: ${id}`
  }
  return `- **${r.participant ?? '(no participant)'}** | ${r.period ?? '—'} | ${r.source ?? '—'} | ID: ${id}`
}

async function listCollection(
  convex: ConvexClient,
  orgId: Id<'organizations'>,
  collection: CrmCollection,
  searchQuery?: string,
) {
  if (collection === 'contacts') {
    return await convex.query(api.crm.listContacts, { orgId, searchQuery })
  }
  if (collection === 'organizations') {
    return await convex.query(api.crm.listOrganizations, {
      orgId,
      searchQuery,
    })
  }
  if (collection === 'opportunities') {
    return await convex.query(api.crm.listOpportunities, {
      orgId,
      searchQuery,
    })
  }
  // `crmSubmissions` has no search index — caller surfaces this to the
  // agent in the response text.
  return await convex.query(api.crm.listSubmissions, { orgId })
}

export function createCrmTools(
  convex: ConvexClient,
  orgId: Id<'organizations'>,
  _userId: string,
  confirmCtx: ConfirmationContext,
) {
  return [
    tool(
      'list_crm_records',
      'List records from a CRM collection (contacts, organizations, opportunities, submissions). searchQuery filters by the primary name/title field for contacts/organizations/opportunities only — submissions have no search index and always return all rows.',
      {
        collection: collectionSchema,
        searchQuery: z
          .string()
          .optional()
          .describe(
            'Optional text to search in the primary name/title field. Ignored for submissions (no search index).',
          ),
      },
      async (args) => {
        try {
          const records = await listCollection(
            convex,
            orgId,
            args.collection as CrmCollection,
            args.searchQuery,
          )
          if (!records || records.length === 0) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `No records found in ${args.collection}.`,
                },
              ],
            }
          }
          const lines = records.map((r: any) =>
            formatRecord(args.collection as CrmCollection, r),
          )
          const note =
            args.collection === 'submissions' && args.searchQuery
              ? `\n\n_Note: searchQuery is ignored for submissions (no search index); all rows returned._`
              : ''
          return {
            content: [
              {
                type: 'text' as const,
                text: `## ${args.collection} (${records.length})\n\n${lines.join('\n')}${note}`,
              },
            ],
          }
        } catch (e: any) {
          console.error('[tool] list_crm_records ERROR:', e)
          return {
            content: [{ type: 'text' as const, text: `Error: ${e.message}` }],
            isError: true,
          }
        }
      },
    ),

    tool(
      'get_crm_record',
      'Get all fields of a single CRM record. Use the Convex document ID from list_crm_records.',
      {
        collection: collectionSchema,
        id: z.string().describe('Convex document ID (e.g. "k97x2...")'),
      },
      async (args) => {
        try {
          const col = args.collection as CrmCollection
          let record: any = null
          if (col === 'contacts') {
            record = await convex.query(api.crm.getContact, {
              orgId,
              id: args.id as Id<'crmContacts'>,
            })
          } else if (col === 'organizations') {
            record = await convex.query(api.crm.getOrganization, {
              orgId,
              id: args.id as Id<'crmOrganizations'>,
            })
          } else if (col === 'opportunities') {
            record = await convex.query(api.crm.getOpportunity, {
              orgId,
              id: args.id as Id<'crmOpportunities'>,
            })
          } else {
            record = await convex.query(api.crm.getSubmission, {
              orgId,
              id: args.id as Id<'crmSubmissions'>,
            })
          }
          if (!record) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Record ${args.id} not found in ${args.collection}.`,
                },
              ],
            }
          }
          const lines = Object.entries(record)
            .filter(
              ([k]) =>
                ![
                  '_id',
                  '_creationTime',
                  'orgId',
                  'createdAt',
                  'updatedAt',
                ].includes(k),
            )
            .map(
              ([k, v]) => `- **${k}**: ${v == null ? '—' : JSON.stringify(v)}`,
            )
          return {
            content: [
              {
                type: 'text' as const,
                text: `## ${args.collection} record\n\n${lines.join('\n')}`,
              },
            ],
          }
        } catch (e: any) {
          return {
            content: [{ type: 'text' as const, text: `Error: ${e.message}` }],
            isError: true,
          }
        }
      },
    ),

    tool(
      'get_crm_stats',
      'Get record counts for all 4 CRM collections (contacts, organizations, opportunities, submissions).',
      {},
      async () => {
        try {
          const [contacts, organizations, opportunities, submissions] =
            await Promise.all([
              convex.query(api.crm.getContactCount, { orgId }),
              convex.query(api.crm.getOrganizationCount, { orgId }),
              convex.query(api.crm.getOpportunityCount, { orgId }),
              convex.query(api.crm.getSubmissionCount, { orgId }),
            ])
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  `## CRM Stats\n\n` +
                  `- Contacts: ${contacts}\n` +
                  `- Organizations: ${organizations}\n` +
                  `- Opportunities: ${opportunities}\n` +
                  `- Submissions: ${submissions}`,
              },
            ],
          }
        } catch (e: any) {
          return {
            content: [{ type: 'text' as const, text: `Error: ${e.message}` }],
            isError: true,
          }
        }
      },
    ),

    tool(
      'create_crm_record',
      'Create a new CRM record (contacts, organizations, opportunities). Not supported for submissions. Fields is an object with the relevant keys — see schema. Requires user confirmation.',
      {
        collection: z
          .enum(['contacts', 'organizations', 'opportunities'])
          .describe('Which CRM collection to create a record in'),
        fields: z
          .record(z.string(), z.any())
          .describe(
            'Object with record fields. For contacts use name/email/role/etc. For organizations use name/description/type. For opportunities use title/organization/category/status.',
          ),
      },
      async (args) => {
        try {
          const primary =
            args.collection === 'opportunities'
              ? args.fields.title
              : args.fields.name
          const approved = await confirmAction(confirmCtx, {
            action: 'Create CRM Record',
            description: `Create new ${args.collection.slice(0, -1)}: "${primary ?? '(no name)'}"`,
            details: {
              collection: args.collection,
              fields: args.fields,
            },
          })
          if (!approved) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'Action rejected by user.',
                },
              ],
            }
          }

          let newId: string
          if (args.collection === 'contacts') {
            newId = await convex.mutation(api.crm.createContactWithFields, {
              orgId,
              fields: args.fields,
            })
          } else if (args.collection === 'organizations') {
            newId = await convex.mutation(
              api.crm.createOrganizationWithFields,
              { orgId, fields: args.fields },
            )
          } else {
            newId = await convex.mutation(api.crm.createOpportunityWithFields, {
              orgId,
              fields: args.fields,
            })
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: `Created ${args.collection.slice(0, -1)} with ID ${newId}.`,
              },
            ],
          }
        } catch (e: any) {
          return {
            content: [{ type: 'text' as const, text: `Error: ${e.message}` }],
            isError: true,
          }
        }
      },
    ),

    tool(
      'update_crm_record',
      'Update a single field on a CRM record (contacts, organizations, opportunities). Requires user confirmation. Use the Convex ID from list_crm_records.',
      {
        collection: z
          .enum(['contacts', 'organizations', 'opportunities'])
          .describe('Which collection the record belongs to'),
        id: z.string().describe('Convex document ID'),
        field: z
          .string()
          .describe('Field name (camelCase, e.g. "name", "status")'),
        value: z.any().describe('New value for the field'),
      },
      async (args) => {
        try {
          const approved = await confirmAction(confirmCtx, {
            action: 'Update CRM Record',
            description: `Set ${args.field} on ${args.collection.slice(0, -1)} ${args.id}`,
            details: {
              collection: args.collection,
              id: args.id,
              field: args.field,
              newValue: args.value,
            },
          })
          if (!approved) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'Action rejected by user.',
                },
              ],
            }
          }

          if (args.collection === 'contacts') {
            await convex.mutation(api.crm.updateContact, {
              orgId,
              id: args.id as Id<'crmContacts'>,
              field: args.field,
              value: args.value,
            })
          } else if (args.collection === 'organizations') {
            await convex.mutation(api.crm.updateOrganization, {
              orgId,
              id: args.id as Id<'crmOrganizations'>,
              field: args.field,
              value: args.value,
            })
          } else {
            await convex.mutation(api.crm.updateOpportunity, {
              orgId,
              id: args.id as Id<'crmOpportunities'>,
              field: args.field,
              value: args.value,
            })
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: `Updated ${args.field} on ${args.id}.`,
              },
            ],
          }
        } catch (e: any) {
          return {
            content: [{ type: 'text' as const, text: `Error: ${e.message}` }],
            isError: true,
          }
        }
      },
    ),
  ]
}
