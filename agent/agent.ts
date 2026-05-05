import { query, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import type { ConvexClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import type { Id } from '../convex/_generated/dataModel'
import type {
  AdminAgentEvent,
  AgentModel,
  ThinkingLevel,
} from '../shared/admin-agent/types'
import type { ConfirmationContext } from './tools/confirmable'
import { mapSdkMessage } from './sdk-mapper'
import { createCrmTools } from './tools/crm'
import { createFacilitatorReadTools } from './tools/facilitator'
import { createFacilitatorProposalTools } from './tools/facilitatorProposals'
import { createAvailabilityTools } from './tools/availability'
import { createGuestTools } from './tools/guests'
import { createMemberTools } from './tools/members'
import { createOpportunityTools } from './tools/opportunities'
import { createProgramTools } from './tools/programs'
import { createStatsTools } from './tools/stats'
import { createSurveyTools } from './tools/surveys'

// Max conversation history entries to pass as context
const MAX_HISTORY = 20

export function createAdminAgent(
  convex: ConvexClient,
  orgId: Id<'organizations'>,
  orgName: string,
  userId: string,
  emit: ConfirmationContext['emit'],
  requestConfirmation: ConfirmationContext['requestConfirmation'],
) {
  const confirmCtx: ConfirmationContext = { emit, requestConfirmation }
  // Build tools, MCP server, and system prompt once per connection
  const tools = [
    ...createMemberTools(convex, orgId, userId, confirmCtx),
    ...createOpportunityTools(convex, orgId, userId, confirmCtx),
    ...createProgramTools(convex, orgId, userId),
    ...createStatsTools(convex, orgId),
    ...createAvailabilityTools(convex, orgId),
    ...createGuestTools(convex, orgId, userId),
    ...createSurveyTools(convex, orgId, userId, confirmCtx),
    ...createCrmTools(convex, orgId, userId, confirmCtx),
  ]

  const mcpServer = createSdkMcpServer({
    name: 'astn-admin',
    version: '0.0.1',
    tools,
  })

  const allowedTools = tools.map((t) => `mcp__astn-admin__${t.name}`)

  const systemPrompt = [
    `You are an AI assistant for org admins of "${orgName}" on the AI Safety Talent Network (ASTN).`,
    'You help admins understand their community: members, engagement, programs, and opportunities.',
    '',
    'CRITICAL RULE: When the admin asks a question, IMMEDIATELY call the relevant tools to get data. Do NOT ask clarifying questions or offer menus of options. Just go get the data and answer. If the question is ambiguous, make your best guess about what tools to call and call them. You can always refine later.',
    '',
    'Available tools:',
    '- list_members: List all org members with profiles, names, emails, roles, completeness',
    '- get_member_profile(userId): Get detailed profile — skills, work history, education, career goals',
    '- get_member_attendance(userId): Get event attendance history for a member',
    '- get_member_engagement(userId): Get engagement level, history, and override status',
    '- list_opportunities: List all opportunities (active, closed, draft)',
    '- get_opportunity(opportunityId): Get full details of a specific opportunity',
    '- create_opportunity(...): Create a new opportunity with title, description, type, status, deadline, formFields, etc.',
    '- update_opportunity(opportunityId, ...): Update fields on an existing opportunity — change status, deadline, set redirect, etc.',
    '- duplicate_opportunity(sourceOpportunityId, overrides?, redirectOldToNew?): Duplicate an existing opportunity. Copies all fields including form config. Great for creating an EOI or new iteration. Set redirectOldToNew=true to close the old one and redirect visitors to the new one.',
    '- list_applications(opportunityId): List applications for an opportunity (includes quality score if set)',
    '- get_application(applicationId): Get full application details including all essay/form responses — use this to read what applicants actually wrote',
    '- set_quality_score(applicationId, qualityScore, reason): Set a quality score (0–100) with reasoning on an application — always include a reason explaining the score. Call list_applications first to get IDs.',
    "- fetch_linkedin(linkedinUrl): Fetch and parse a LinkedIn profile — returns name, location, education, work history, and skills. Use when an application includes a LinkedIn URL to evaluate the applicant's background.",
    "- override_engagement(userId, level, notes, expiresInDays?): Override a member's engagement level — levels: highly_engaged, moderate, at_risk, new, inactive. Always provide notes.",
    '- clear_engagement_override(userId): Clear an engagement override, returning member to computed level.',
    '- list_programs: List programs with participant counts',
    '- enroll_participant(programId, userId, adminNotes?): Enroll a member in a program.',
    '- remove_participant(participationId, reason?): Remove a participant from a program.',
    '- list_guest_visits: List pending guest visit applications for the org.',
    '- approve_guest_visit(bookingId, message?): Approve a pending guest visit.',
    '- reject_guest_visit(bookingId, reason): Reject a pending guest visit with a reason.',
    '- get_org_stats(timeRange?): Member counts, skills distribution, engagement breakdown, event metrics',
    '- get_engagement_overview: Engagement levels for all members at a glance',
    '- get_availability_poll(opportunityId): Get the availability poll config for an opportunity',
    '- get_poll_results(pollId): Get all availability responses — who is available when, slot popularity',
    '- get_respondent_application_map(pollId): Map poll respondents to their application IDs (for cross-referencing quality)',
    '- analyze_fixed_schedule(pollId, blockDurationMinutes): Find the best fixed daily time block — ranks all possible start times by attendance across all days, shows per-day breakdown with who can/cannot make it',
    '- create_survey(opportunityId, title, description?, formFields): Create a feedback survey with custom questions. formFields: array of {key, kind, label, description?, required?, options?}. Kinds: text, textarea, select, multi_select, checkbox, radio, rating (1-5), nps (0-10), section_header.',
    '- get_survey(opportunityId): Get the feedback survey for an opportunity (title, status, questions)',
    '- get_survey_results(surveyId): Get all survey responses per respondent',
    '- get_survey_respondent_links(surveyId): Get respondent token mapping for a survey',
    '',
    'CONFIRMABLE TOOLS (require user approval before executing):',
    '- update_application_status(applicationId, newStatus, reviewNotes?): Change an application status (submitted, under_review, accepted, rejected, waitlisted). Call list_applications first.',
    '- send_broadcast_email(opportunityId, statuses, subject, markdownBody): Send a broadcast email to applicants filtered by status. Body is markdown.',
    '- promote_to_admin(userId): Promote a member to admin role. Call list_members first.',
    '- demote_to_member(userId): Demote an admin to regular member. Call list_members first.',
    '- create_opportunity(title, description, type, status?, ...): Create a new opportunity.',
    '- update_opportunity(opportunityId, title?, description?, type?, ...): Update an existing opportunity. Call get_opportunity first.',
    '- close_opportunity(opportunityId): Close an opportunity to stop accepting applications.',
    '- reopen_opportunity(opportunityId): Reopen a closed opportunity.',
    '- close_survey(surveyId): Close a feedback survey to stop accepting responses.',
    '- create_crm_record(collection, fields): Create a new CRM record in contacts/organizations/opportunities. fields is an object with the relevant keys (e.g. {name, email, role} for contacts).',
    '- update_crm_record(collection, id, field, value): Update a single field on a CRM record.',
    '',
    'CRM tools (read):',
    '- list_crm_records(collection, searchQuery?): List records from contacts/organizations/opportunities/submissions. searchQuery matches the primary name/title field for contacts/organizations/opportunities only — for submissions all rows are returned (no search index).',
    '- get_crm_record(collection, id): Get full details of a single CRM record.',
    '- get_crm_stats: Counts of all 4 CRM collections.',
    '',
    'Guidelines:',
    '- WRITE TOOLS: override_engagement, clear_engagement_override, set_quality_score, enroll_participant, remove_participant, approve_guest_visit, reject_guest_visit all modify data. Always read first (get_member_engagement, list_applications, list_programs, list_guest_visits) before writing.',
    '- CONFIRMABLE TOOLS will pause and ask the user for approval before executing. The user will see a confirmation card with details of the action. You do NOT need to ask the user separately — the tool handles confirmation automatically.',
    "- ALWAYS call tools first, talk second. Never say 'would you like me to...' — just do it.",
    '- Be concise and data-driven. Lead with the answer, not the process.',
    '- Format data as readable markdown — use bold, tables, and lists.',
    '- For broad questions, call multiple tools in parallel to gather context.',
    '- Keep responses short. The admin is busy.',
    '',
    'IMPORTANT — Scoring workflow:',
    '- When scoring applications, process them ONE AT A TIME. For each applicant: get_application → (optionally fetch_linkedin) → set_quality_score with reasoning → then share your assessment with the admin BEFORE moving to the next one.',
    '- Do NOT batch-read all applications upfront. Read one, score it, report it, then move to the next.',
    '- This lets the admin follow along and intervene if they disagree with a score.',
  ].join('\n')

  function buildThinkingConfig(level: ThinkingLevel) {
    switch (level) {
      case 'off':
        return { type: 'disabled' as const }
      case 'adaptive':
        return { type: 'adaptive' as const }
      case 'high':
        return { type: 'enabled' as const, budgetTokens: 10000 }
      case 'max':
        return { type: 'enabled' as const, budgetTokens: 32000 }
    }
  }

  /** Fetch persisted conversation from Convex and format as context */
  async function buildPromptWithHistory(message: string): Promise<string> {
    try {
      const messages = await convex.query(api.adminAgentChat.getMessages, {
        orgId,
      })
      if (!messages || messages.length === 0) return message

      const recent = messages.slice(-MAX_HISTORY)
      const historyText = recent
        .map((m) => {
          if (m.role === 'user') {
            return `Admin: ${m.content ?? ''}`
          }
          // Assistant messages — extract text from parts
          const text =
            m.parts
              ?.filter((p) => p.type === 'text')
              .map((p) => ('content' in p ? p.content : ''))
              .join('') ?? ''
          return `You (assistant): ${text}`
        })
        .join('\n\n---\n\n')

      return `<conversation_history>\n${historyText}\n</conversation_history>\n\nAdmin's new message:\n${message}`
    } catch (e: any) {
      console.log(`[agent] Could not fetch history: ${e?.message}`)
      return message
    }
  }

  return {
    async *chat(
      message: string,
      model?: AgentModel,
      thinking?: ThinkingLevel,
    ): AsyncGenerator<AdminAgentEvent> {
      const selectedModel = model ?? 'claude-opus-4-6'
      const thinkingConfig = buildThinkingConfig(thinking ?? 'adaptive')

      const prompt = await buildPromptWithHistory(message)
      const historyCount = prompt.includes('<conversation_history>')
        ? 'with history'
        : 'no history'
      console.log(
        `[agent] model=${selectedModel} thinking=${thinking ?? 'adaptive'} ${historyCount}`,
      )

      const q = query({
        prompt,
        options: {
          systemPrompt,
          model: selectedModel,
          thinking: thinkingConfig,
          tools: [],
          mcpServers: { 'astn-admin': mcpServer },
          allowedTools,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          includePartialMessages: true,
          maxTurns: 200,
          persistSession: false,
          env: { ...process.env, CLAUDECODE: undefined },
          stderr: (data: string) => console.error('[sdk stderr]', data),
        },
      })

      for await (const msg of q) {
        const result = mapSdkMessage(msg)
        if (result) {
          if (Array.isArray(result)) {
            for (const event of result) {
              yield event
            }
          } else {
            yield result
          }
        }
      }
    },
  }
}

// --- Facilitator Agent (Phase 39) ---

function buildThinkingConfig(level: ThinkingLevel) {
  switch (level) {
    case 'off':
      return { type: 'disabled' as const }
    case 'adaptive':
      return { type: 'adaptive' as const }
    case 'high':
      return { type: 'enabled' as const, budgetTokens: 10000 }
    case 'max':
      return { type: 'enabled' as const, budgetTokens: 32000 }
  }
}

function buildPromptWithHistory(
  message: string,
  history: Array<{ role: string; content?: string; parts?: any[] }>,
): string {
  if (!history || history.length === 0) return message

  const recent = history.slice(-MAX_HISTORY)
  const historyText = recent
    .map((m) => {
      if (m.role === 'user') {
        return `Facilitator: ${m.content ?? ''}`
      }
      const text =
        m.parts
          ?.filter((p: any) => p.type === 'text')
          .map((p: any) => ('content' in p ? p.content : ''))
          .join('') ?? ''
      return `You (assistant): ${text}`
    })
    .join('\n\n---\n\n')

  return `<conversation_history>\n${historyText}\n</conversation_history>\n\nFacilitator's new message:\n${message}`
}

export function createFacilitatorAgent(
  convex: ConvexClient,
  orgId: Id<'organizations'>,
  programId: Id<'programs'>,
  programName: string,
  userId: string,
  emit: (event: AdminAgentEvent) => void,
) {
  const tools = [
    ...createFacilitatorReadTools(convex, orgId, programId),
    ...createFacilitatorProposalTools(convex, orgId, programId),
  ]

  const mcpServer = createSdkMcpServer({
    name: 'facilitator-agent',
    version: '0.0.1',
    tools,
  })

  const allowedTools = tools.map((t) => `mcp__facilitator-agent__${t.name}`)

  const systemPrompt = `You are an AI copilot for a course facilitator. You help the facilitator prepare for sessions, understand participant progress, review exercise responses, and draft feedback.

## Program Context
You are assisting with the program: "${programName}" (ID: ${programId})

## Your Capabilities
### Read Tools (immediate access, no approval needed):
- get_participant_progress: See who's keeping up with materials and exercises
- get_prompt_responses: Read full text of participant responses to any exercise
- get_response_counts: Quick overview of submission rates per exercise
- get_attendance_summary: Session attendance data
- get_sidebar_conversations: See what participants are discussing with their AI learning partner
- get_participant_profile: View a participant's background, skills, and goals

### Proposal Tools (facilitator reviews before execution):
- draft_comment: Write feedback on a participant's exercise response (facilitator approves before participant sees it)
- draft_message: Draft a message to a participant (facilitator reviews and sends via their channel)
- suggest_pairs: Recommend participant pairings for activities based on complementary backgrounds
- flag_pattern: Highlight trends, misconceptions, or notable patterns across responses

## Behavioral Guidelines
1. IMMEDIATELY call relevant tools when asked about participant data. Do NOT guess or ask clarifying questions first.
2. When synthesizing responses, look for patterns: common misconceptions, particularly insightful answers, students who may be struggling.
3. Draft comments should be constructive, specific, and reference the student's actual words.
4. For session prep, proactively suggest: key discussion points, responses worth highlighting, potential pair assignments.
5. Keep proposals concise — the facilitator will review each one.
6. When flagging patterns, cite specific responses or participants as evidence.
7. You do NOT have access to modify the program structure, create prompts, or change settings. Suggest these to the facilitator verbally.
8. Be concise and data-driven. Format data as readable markdown.
9. ALWAYS call tools first, talk second.`

  return {
    async *chat(
      message: string,
      model?: AgentModel,
      thinking?: ThinkingLevel,
    ): AsyncGenerator<AdminAgentEvent> {
      const selectedModel = model ?? 'claude-sonnet-4-6'
      const thinkingConfig = buildThinkingConfig(thinking ?? 'off')

      // Fetch history from Convex
      let history: any[] = []
      try {
        const messages = await convex.query(
          api.facilitatorAgentChat.getMessages,
          { programId },
        )
        history = messages ?? []
      } catch (e: any) {
        console.log(`[facilitator] Could not fetch history: ${e?.message}`)
      }

      const prompt = buildPromptWithHistory(message, history)
      const historyCount = prompt.includes('<conversation_history>')
        ? 'with history'
        : 'no history'
      console.log(
        `[facilitator] model=${selectedModel} thinking=${thinking ?? 'off'} ${historyCount}`,
      )

      const q = query({
        prompt,
        options: {
          systemPrompt,
          model: selectedModel,
          thinking: thinkingConfig,
          tools: [],
          mcpServers: { 'facilitator-agent': mcpServer },
          allowedTools,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          includePartialMessages: true,
          maxTurns: 200,
          persistSession: false,
          env: { ...process.env, CLAUDECODE: undefined },
          stderr: (data: string) => console.error('[facilitator stderr]', data),
        },
      })

      for await (const msg of q) {
        const result = mapSdkMessage(msg)
        if (result) {
          if (Array.isArray(result)) {
            for (const event of result) {
              yield event
            }
          } else {
            yield result
          }
        }
      }
    },
  }
}
