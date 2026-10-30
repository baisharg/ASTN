import { useQuery } from 'convex/react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'

// Current edition in the brand green, earlier ones in fading greys.
const CURRENT_COLOR = '#15803d'
const PAST_COLORS = ['#475569', '#64748b', '#94a3b8', '#cbd5e1']

/**
 * Accumulated applications per day for this edition next to the previous
 * editions of the same course, so the team can see early whether this one is
 * filling faster or slower and which outreach moved it.
 */
export function ApplicationsTimeline({
  opportunityId,
}: {
  opportunityId: Id<'orgOpportunities'>
}) {
  const timeline = useQuery(api.opportunityApplications.applicationTimeline, {
    opportunityId,
  })
  if (!timeline) return null
  const { anchor, editions } = timeline
  if (editions.every((e) => e.points.length === 0)) return null

  // One row per day from the earliest to the latest point, carrying each
  // edition's running total forward so the lines read as steps.
  const days = editions.flatMap((e) => e.points.map((p) => p.day))
  const first = Math.min(...days)
  const last = Math.max(...days)
  const rows: Array<Record<string, number>> = []
  const running = new Map<string, number>()
  const byDay = editions.map(
    (e) => new Map(e.points.map((p) => [p.day, p.total])),
  )
  const lastDayOf = editions.map((e) => e.points.at(-1)?.day ?? first)
  for (let day = first; day <= last; day++) {
    const row: Record<string, number> = { day }
    editions.forEach((e, i) => {
      const total = byDay[i].get(day)
      if (total !== undefined) running.set(e.opportunityId, total)
      // Stop each line at its own last application instead of drawing a
      // flat tail to the end of the longest edition.
      if (day <= lastDayOf[i] || e.isCurrent) {
        row[e.opportunityId] = running.get(e.opportunityId) ?? 0
      }
    })
    rows.push(row)
  }

  const dayLabel = (day: number) =>
    anchor === 'deadline'
      ? day === 0
        ? 'Deadline'
        : day < 0
          ? `${-day}d before`
          : `${day}d after`
      : `Day ${day + 1}`

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Applications over time</CardTitle>
        <CardDescription>
          Accumulated applications per day
          {anchor === 'deadline'
            ? ', counted to each edition’s deadline'
            : ', from each edition’s first application'}
          .{' '}
          {editions.length > 1
            ? 'Grey lines are earlier editions of the same course.'
            : 'Earlier editions of the same course show up here once they share its course tag.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={rows} margin={{ left: -16, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="day"
              type="number"
              domain={[first, last]}
              tickFormatter={dayLabel}
              tick={{ fontSize: 11 }}
            />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip
              labelFormatter={(day) => dayLabel(Number(day))}
              formatter={(value, name) => [
                value,
                editions.find((e) => e.opportunityId === name)?.title ?? name,
              ]}
            />
            <Legend
              formatter={(value) =>
                editions.find((e) => e.opportunityId === value)?.title ?? value
              }
              wrapperStyle={{ fontSize: 12 }}
            />
            {editions.map((e, i) => (
              <Line
                key={e.opportunityId}
                dataKey={e.opportunityId}
                type="stepAfter"
                dot={false}
                stroke={
                  e.isCurrent
                    ? CURRENT_COLOR
                    : PAST_COLORS[Math.min(i - 1, PAST_COLORS.length - 1)]
                }
                strokeWidth={e.isCurrent ? 2.5 : 1.5}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
