import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'
import { inferBaishCourseState } from '../lib/baishCourseOpportunities'

// One-shot migration for the email redesign phase 3 (issue #20). Idempotent —
// safe to re-run. Steps:
//   1. Copy autoEmailLog rows into the unified emailLog (legacy triggers are
//      mapped onto the new kinds so idempotency protects against re-sends).
//   2. Set an explicit isEOI flag on opportunities the legacy string
//      inference considered EOIs.
//   3. Unset the legacy autoSendAvailabilityEmail field everywhere (the field
//      is removed from the schema in the follow-up deploy).
//   4. Preserve real legacy auto-email template content as per-opportunity
//      template overrides in the new system. Literal {{poll_link}} /
//      {{survey_link}} placeholders become the include*Link system blocks.

const LOG_KIND_MAP: Record<string, string> = {
  new_application: 'application_received',
  availability: 'application_received',
  'status:accepted': 'accepted',
  'status:rejected': 'rejected',
  'status:waitlisted': 'waitlisted',
}

const TRIGGER_TO_KIND: Record<
  string,
  'application_received' | 'accepted' | 'rejected' | 'waitlisted'
> = {
  new_application: 'application_received',
  'status:accepted': 'accepted',
  'status:rejected': 'rejected',
  'status:waitlisted': 'waitlisted',
}

// Remove literal link placeholders; drop lines that end up with no words
// (e.g. a lone "👉"). The links are system-managed blocks now.
function stripLinkPlaceholders(body: string): {
  text: string
  hadPoll: boolean
  hadSurvey: boolean
} {
  const hadPoll = body.includes('{{poll_link}}')
  const hadSurvey = body.includes('{{survey_link}}')
  const text = body
    .split('\n')
    .map((line) =>
      line.replaceAll('{{poll_link}}', '').replaceAll('{{survey_link}}', ''),
    )
    .filter((line, i) => {
      const original = body.split('\n')[i] ?? ''
      const hadPlaceholder =
        original.includes('{{poll_link}}') ||
        original.includes('{{survey_link}}')
      if (!hadPlaceholder) return true
      // Keep the line only if meaningful words remain after stripping.
      return /[\p{L}\p{N}]/u.test(line)
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text, hadPoll, hadSurvey }
}

export const run = internalMutation({
  args: {},
  returns: v.object({
    logsCopied: v.number(),
    logsSkipped: v.number(),
    eoiFlagged: v.number(),
    fieldsUnset: v.number(),
    overridesCreated: v.number(),
    overridesSkipped: v.number(),
  }),
  handler: async (ctx) => {
    let logsCopied = 0
    let logsSkipped = 0
    let eoiFlagged = 0
    let fieldsUnset = 0
    let overridesCreated = 0
    let overridesSkipped = 0

    // ── 1. autoEmailLog → emailLog ─────────────────────────────────────────
    const legacyLogs = await ctx.db.query('autoEmailLog').collect()
    const existingLogs = await ctx.db.query('emailLog').collect()
    const seen = new Set(
      existingLogs.map((r) => `${r.applicationId}|${r.sentAt}`),
    )
    const orgByOpp = new Map<string, any>()
    for (const row of legacyLogs) {
      const key = `${row.applicationId}|${row.sentAt}`
      if (seen.has(key)) {
        logsSkipped++
        continue
      }
      let orgId = orgByOpp.get(row.opportunityId)
      if (!orgId) {
        const opp = await ctx.db.get('orgOpportunities', row.opportunityId)
        if (!opp) {
          logsSkipped++
          continue
        }
        orgId = opp.orgId
        orgByOpp.set(row.opportunityId, orgId)
      }
      await ctx.db.insert('emailLog', {
        orgId,
        opportunityId: row.opportunityId,
        applicationId: row.applicationId,
        recipientEmail: row.recipientEmail,
        recipientName: row.recipientName,
        kind: LOG_KIND_MAP[row.trigger] ?? row.trigger,
        source: 'auto',
        subject: row.subject,
        sentAt: row.sentAt,
        sentBy: 'system',
        status: row.status,
        error: row.error,
      })
      seen.add(key)
      logsCopied++
    }

    // ── 2 + 3. isEOI + unset legacy field on opportunities ────────────────
    const opportunities = await ctx.db.query('orgOpportunities').collect()
    for (const opp of opportunities) {
      const inferredEOI =
        inferBaishCourseState(opp.title, opp.description) === 'eoi_open' ||
        (opp.tags ?? []).includes('EOI')
      const patch: Record<string, unknown> = {}
      if (inferredEOI && opp.isEOI === undefined) {
        patch.isEOI = true
        eoiFlagged++
      }
      if (opp.autoSendAvailabilityEmail !== undefined) {
        patch.autoSendAvailabilityEmail = undefined
        fieldsUnset++
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch('orgOpportunities', opp._id, patch as any)
      }
    }

    // ── 4. Legacy template content → per-opportunity overrides ────────────
    const configs = await ctx.db.query('opportunityAutoEmails').collect()
    for (const cfg of configs) {
      if (!cfg.enabled) continue
      const templates =
        cfg.templates ??
        (cfg.triggers ?? []).map((trigger) => ({
          trigger,
          subject: cfg.subject ?? '',
          markdownBody: cfg.markdownBody ?? '',
          requiresPoll: cfg.requiresPoll ?? false,
        }))
      for (const t of templates) {
        const kind = TRIGGER_TO_KIND[t.trigger]
        if (!kind || !t.subject.trim()) {
          overridesSkipped++
          continue
        }
        const existing = await ctx.db
          .query('emailTemplates')
          .withIndex('by_opportunity_and_kind', (q) =>
            q.eq('opportunityId', cfg.opportunityId).eq('kind', kind),
          )
          .first()
        if (existing) {
          overridesSkipped++
          continue
        }
        const { text, hadPoll, hadSurvey } = stripLinkPlaceholders(
          t.markdownBody,
        )
        await ctx.db.insert('emailTemplates', {
          orgId: cfg.orgId,
          opportunityId: cfg.opportunityId,
          kind,
          enabled: true,
          subject: t.subject,
          markdownBody: text,
          includePollLink: t.requiresPoll || hadPoll,
          includeSurveyLink: hadSurvey,
          updatedAt: Date.now(),
        })
        overridesCreated++
      }
    }

    return {
      logsCopied,
      logsSkipped,
      eoiFlagged,
      fieldsUnset,
      overridesCreated,
      overridesSkipped,
    }
  },
})

// Step 2 — run ONLY after verifying `run`'s output. Empties the legacy tables
// so they can be dropped from the schema in the follow-up deploy.
export const purgeLegacyTables = internalMutation({
  args: {},
  returns: v.object({ logsDeleted: v.number(), configsDeleted: v.number() }),
  handler: async (ctx) => {
    const logs = await ctx.db.query('autoEmailLog').collect()
    for (const row of logs) {
      await ctx.db.delete('autoEmailLog', row._id)
    }
    const configs = await ctx.db.query('opportunityAutoEmails').collect()
    for (const row of configs) {
      await ctx.db.delete('opportunityAutoEmails', row._id)
    }
    return { logsDeleted: logs.length, configsDeleted: configs.length }
  },
})
