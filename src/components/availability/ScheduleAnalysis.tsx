import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Clock } from 'lucide-react'
import type { AvailabilityResponse } from './AvailabilityHeatmap'
import { weekdayShort } from '../../../convex/lib/availabilityWeek'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScheduleAnalysisProps {
  days: Array<number>
  startMinutes: number
  endMinutes: number
  slotDurationMinutes: number
  responses: Array<AvailabilityResponse>
  totalRespondents: number
}

interface BlockAnalysis {
  startMinutes: number
  endMinutes: number
  score: number
  minDayAttendance: number
  perDay: Array<{
    day: number
    available: Array<string>
    maybe: Array<string>
    unavailable: Array<string>
  }>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMinutesToTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const period = hours >= 12 ? 'PM' : 'AM'
  const displayHour = hours % 12 || 12
  return `${displayHour}:${minutes.toString().padStart(2, '0')} ${period}`
}

const RANK_LABELS = ['🥇', '🥈', '🥉', '#4', '#5']

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScheduleAnalysis({
  days,
  startMinutes,
  endMinutes,
  slotDurationMinutes,
  responses,
  totalRespondents,
}: ScheduleAnalysisProps) {
  const [sessionHoursInput, setSessionHoursInput] = useState('')
  const [expandedBlock, setExpandedBlock] = useState<number | null>(null)

  const sessionMinutes = sessionHoursInput
    ? parseFloat(sessionHoursInput) * 60
    : null

  const blocks = useMemo(() => {
    if (!sessionMinutes || sessionMinutes <= 0 || responses.length === 0)
      return []

    const blockSlots = Math.ceil(sessionMinutes / slotDurationMinutes)

    // All possible start times
    const possibleStarts: Array<number> = []
    for (
      let m = startMinutes;
      m + sessionMinutes <= endMinutes;
      m += slotDurationMinutes
    ) {
      possibleStarts.push(m)
    }

    const results: Array<BlockAnalysis> = []

    for (const start of possibleStarts) {
      const end = start + sessionMinutes
      const blockSlotMinutes: Array<number> = []
      for (let i = 0; i < blockSlots; i++) {
        blockSlotMinutes.push(start + i * slotDurationMinutes)
      }

      let totalAvailable = 0
      let totalMaybe = 0
      let minDayAttendance = Infinity
      const perDay: BlockAnalysis['perDay'] = []

      for (const day of days) {
        const available: Array<string> = []
        const maybe: Array<string> = []
        const unavailable: Array<string> = []

        for (const resp of responses) {
          const slotStatuses: Array<string | undefined> = blockSlotMinutes.map(
            (mins) => resp.slots[`${day}|${mins}`],
          )
          const allAvailable = slotStatuses.every((s) => s === 'available')
          const allAvailableOrMaybe = slotStatuses.every(
            (s) => s === 'available' || s === 'maybe',
          )

          if (allAvailable) {
            available.push(resp.respondentName)
            totalAvailable += 1
          } else if (allAvailableOrMaybe) {
            maybe.push(resp.respondentName)
            totalMaybe += 1
          } else {
            unavailable.push(resp.respondentName)
          }
        }

        const dayAttendance = available.length + maybe.length
        if (dayAttendance < minDayAttendance) minDayAttendance = dayAttendance

        perDay.push({ day, available, maybe, unavailable })
      }

      results.push({
        startMinutes: start,
        endMinutes: end,
        score: totalAvailable + totalMaybe * 0.5,
        minDayAttendance,
        perDay,
      })
    }

    // Sort by score descending, then by min-day attendance descending
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return b.minDayAttendance - a.minDayAttendance
    })

    return results.slice(0, 5)
  }, [
    sessionMinutes,
    slotDurationMinutes,
    startMinutes,
    endMinutes,
    days,
    responses,
  ])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="size-5" />
          Schedule Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="session-duration">Session duration (hours)</Label>
            <Input
              id="session-duration"
              type="number"
              step="0.5"
              min="0.5"
              placeholder="e.g. 2.5"
              value={sessionHoursInput}
              onChange={(e) => setSessionHoursInput(e.target.value)}
              className="w-32"
            />
          </div>
          {sessionMinutes && sessionMinutes > 0 && (
            <p className="text-sm text-muted-foreground pb-1.5">
              = {sessionMinutes} minutes per day
            </p>
          )}
        </div>

        {blocks.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Best fixed daily time blocks for {totalRespondents} respondents:
          </p>
        )}

        {blocks.length === 0 && sessionMinutes && sessionMinutes > 0 && (
          <p className="text-sm text-muted-foreground">
            No time blocks fit within the poll's daily window.
          </p>
        )}

        <div className="space-y-2">
          {blocks.map((block, i) => {
            const isExpanded = expandedBlock === i
            const startTime = formatMinutesToTime(block.startMinutes)
            const endTime = formatMinutesToTime(block.endMinutes)
            const maxScore = totalRespondents * block.perDay.length
            const pct =
              maxScore > 0 ? ((block.score / maxScore) * 100).toFixed(0) : '0'

            return (
              <div
                key={block.startMinutes}
                className="rounded-lg border bg-card"
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                  onClick={() => setExpandedBlock(isExpanded ? null : i)}
                >
                  <span className="text-lg leading-none w-6 text-center">
                    {RANK_LABELS[i]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">
                      {startTime} – {endTime}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Score: {block.score.toFixed(1)} ({pct}%)
                      {' · '}
                      Worst day: {block.minDayAttendance}/{totalRespondents}
                    </p>
                  </div>
                  {isExpanded ? (
                    <ChevronDown className="size-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                  )}
                </button>

                {isExpanded && (
                  <div className="border-t px-4 py-3 space-y-3">
                    {block.perDay.map((day) => {
                      const dayTotal = day.available.length + day.maybe.length
                      return (
                        <div key={day.day} className="space-y-1">
                          <p className="text-sm font-medium">
                            {weekdayShort(day.day)}{' '}
                            <span className="text-muted-foreground font-normal">
                              — {dayTotal}/{totalRespondents} can attend
                            </span>
                          </p>
                          {day.available.length > 0 && (
                            <p className="text-sm text-green-600 dark:text-green-400 pl-3">
                              ✅ {day.available.join(', ')}
                            </p>
                          )}
                          {day.maybe.length > 0 && (
                            <p className="text-sm text-amber-600 dark:text-amber-400 pl-3">
                              ❓ {day.maybe.join(', ')}
                            </p>
                          )}
                          {day.unavailable.length > 0 && (
                            <p className="text-sm text-red-500 dark:text-red-400 pl-3">
                              ❌ {day.unavailable.join(', ')}
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
