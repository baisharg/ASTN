import { useMutation } from 'convex/react'
import { ConvexError } from 'convex/values'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { weekdayShort } from '../../../convex/lib/availabilityWeek'
import { timeOptions } from './PollCreationForm'
import { Button } from '~/components/ui/button'
import { Label } from '~/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { cn } from '~/lib/utils'

/**
 * Change an existing poll's hours and days. Answers survive: they are keyed
 * by day and start minute, so a slot taken out of the range is only hidden.
 */
export function PollHoursEditor({
  pollId,
  days,
  startMinutes,
  endMinutes,
  slotDurationMinutes,
}: {
  pollId: Id<'availabilityPolls'>
  days: Array<number>
  startMinutes: number
  endMinutes: number
  slotDurationMinutes: number
}) {
  const updatePoll = useMutation(api.availabilityPolls.updatePoll)
  const [nextDays, setNextDays] = useState(days)
  const [start, setStart] = useState(startMinutes)
  const [end, setEnd] = useState(endMinutes)
  const [isSaving, setIsSaving] = useState(false)

  const options = timeOptions.filter((o) => o.value % slotDurationMinutes === 0)
  const changed =
    start !== startMinutes ||
    end !== endMinutes ||
    nextDays.join() !== days.join()

  const toggleDay = (day: number) =>
    setNextDays((prev) =>
      prev.includes(day)
        ? prev.filter((d) => d !== day)
        : [...prev, day].sort((a, b) => a - b),
    )

  const save = async () => {
    setIsSaving(true)
    try {
      await updatePoll({
        pollId,
        startMinutes: start,
        endMinutes: end,
        days: nextDays,
      })
      toast.success('Poll hours saved')
    } catch (err) {
      toast.error("Couldn't change the hours", {
        description:
          err instanceof ConvexError && typeof err.data === 'string'
            ? err.data
            : 'Please try again.',
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      <Label>Days and hours</Label>
      <div className="flex flex-wrap gap-1.5">
        {[0, 1, 2, 3, 4, 5, 6].map((day) => (
          <button
            key={day}
            type="button"
            onClick={() => toggleDay(day)}
            aria-pressed={nextDays.includes(day)}
            className={cn(
              'rounded-md border px-2.5 py-1 text-xs',
              nextDays.includes(day)
                ? 'border-slate-800 bg-slate-800 text-white'
                : 'border-slate-300 bg-white text-slate-700',
            )}
          >
            {weekdayShort(day)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={String(start)}
          onValueChange={(v) => setStart(Number(v))}
        >
          <SelectTrigger className="w-32" aria-label="From">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options
              .filter((o) => o.value < end)
              .map((o) => (
                <SelectItem key={o.value} value={String(o.value)}>
                  {o.label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">to</span>
        <Select value={String(end)} onValueChange={(v) => setEnd(Number(v))}>
          <SelectTrigger className="w-32" aria-label="To">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options
              .filter((o) => o.value > start)
              .map((o) => (
                <SelectItem key={o.value} value={String(o.value)}>
                  {o.label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!changed || nextDays.length === 0 || isSaving}
          onClick={() => void save()}
        >
          Save
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Answers already given are kept; slots outside the new hours are hidden,
        not deleted.
      </p>
    </div>
  )
}
