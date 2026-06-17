import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'
import {
  isoDateToWeekdayIndex,
  jsDayToWeekdayIndex,
  normalizeDays,
} from '../lib/availabilityWeek'

/**
 * One-shot migration: convert the date-based availability model to the
 * generic-week (weekday) model.
 *
 * - `availabilityPolls`: derive `days` (weekday indices) from the legacy
 *   [startDate, endDate] range, drop startDate/endDate, and convert
 *   `finalizedSlot.date` → `finalizedSlot.day`.
 * - `availabilityResponses`: rekey slots from "YYYY-MM-DD|min" → "<weekday>|min".
 *
 * MUST run while the schema still allows the legacy fields (the intermediate
 * schema where `days`/legacy fields are optional). Idempotent: polls already on
 * the new model are skipped, and re-running after the strict schema deploy is a
 * no-op.
 */
export const migrateAvailabilityToWeekdays = internalMutation({
  args: {},
  returns: v.object({
    pollsMigrated: v.number(),
    responsesMigrated: v.number(),
  }),
  handler: async (ctx) => {
    const polls = await ctx.db.query('availabilityPolls').collect()
    let pollsMigrated = 0

    for (const poll of polls) {
      // Legacy shape — these fields no longer exist in the strict schema type.
      const legacy = poll as unknown as {
        startDate?: string
        endDate?: string
        days?: Array<number>
        finalizedSlot?: {
          date?: string
          day?: number
          startMinutes: number
          endMinutes: number
        }
      }

      // Already migrated (has days, no legacy startDate) → skip.
      if (
        legacy.days &&
        legacy.days.length > 0 &&
        legacy.startDate === undefined
      ) {
        continue
      }

      // Derive weekday set from the legacy date range.
      const derived: Array<number> = []
      if (legacy.startDate && legacy.endDate) {
        const [sy, sm, sd] = legacy.startDate.split('-').map(Number)
        const [ey, em, ed] = legacy.endDate.split('-').map(Number)
        const cur = new Date(Date.UTC(sy, sm - 1, sd))
        const end = new Date(Date.UTC(ey, em - 1, ed))
        while (cur <= end) {
          derived.push(jsDayToWeekdayIndex(cur.getUTCDay()))
          cur.setUTCDate(cur.getUTCDate() + 1)
        }
      }
      const days = normalizeDays(
        derived.length > 0 ? derived : (legacy.days ?? []),
      )

      const patch: Record<string, unknown> = {
        days,
        startDate: undefined,
        endDate: undefined,
      }
      if (legacy.finalizedSlot && legacy.finalizedSlot.date !== undefined) {
        patch.finalizedSlot = {
          day: isoDateToWeekdayIndex(legacy.finalizedSlot.date),
          startMinutes: legacy.finalizedSlot.startMinutes,
          endMinutes: legacy.finalizedSlot.endMinutes,
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await ctx.db.patch('availabilityPolls', poll._id, patch as any)
      pollsMigrated++
    }

    // Rekey responses: "YYYY-MM-DD|min" → "<weekdayIndex>|min".
    const responses = await ctx.db.query('availabilityResponses').collect()
    let responsesMigrated = 0

    for (const resp of responses) {
      const slots = resp.slots as Record<string, 'available' | 'maybe'>
      let changed = false
      const next: Record<string, 'available' | 'maybe'> = {}

      for (const [key, val] of Object.entries(slots)) {
        const [datePart, minPart] = key.split('|')
        if (datePart.includes('-')) {
          // Legacy date key → weekday key.
          const day = isoDateToWeekdayIndex(datePart)
          const newKey = `${day}|${minPart}`
          // Best status wins on the (rare) chance two dates map to the same day.
          next[newKey] =
            next[newKey] === 'available' || val === 'available'
              ? 'available'
              : 'maybe'
          changed = true
        } else {
          next[key] = val
        }
      }

      if (changed) {
        await ctx.db.patch('availabilityResponses', resp._id, { slots: next })
        responsesMigrated++
      }
    }

    return { pollsMigrated, responsesMigrated }
  },
})
