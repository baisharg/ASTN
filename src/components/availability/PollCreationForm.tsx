import { useState } from 'react'
import { useMutation } from 'convex/react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import {
  WEEKDAY_SHORT,
  normalizeDays,
} from '../../../convex/lib/availabilityWeek'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { cn } from '~/lib/utils'

interface PollCreationFormProps {
  opportunityId: string // Id<'orgOpportunities'>
  onCreated?: () => void
}

const timeOptions: Array<{ value: number; label: string }> = []
for (let m = 360; m <= 1320; m += 30) {
  const h = Math.floor(m / 60)
  const min = m % 60
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  const label =
    min === 0
      ? `${h12}:00 ${period}`
      : `${h12}:${String(min).padStart(2, '0')} ${period}`
  timeOptions.push({ value: m, label })
}

const TIMEZONES = [
  'America/Argentina/Buenos_Aires',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Pacific/Auckland',
] as const

const SLOT_DURATIONS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '60 min' },
] as const

// Default selection: weekdays (Mon–Fri). Admin can toggle any day on/off.
const DEFAULT_DAYS = [0, 1, 2, 3, 4]

function getDefaultTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if ((TIMEZONES as ReadonlyArray<string>).includes(tz)) {
      return tz
    }
  } catch {
    // Fallback below
  }
  return 'America/Argentina/Buenos_Aires'
}

export function PollCreationForm({
  opportunityId,
  onCreated,
}: PollCreationFormProps) {
  const [title, setTitle] = useState('')
  const [days, setDays] = useState<Array<number>>(DEFAULT_DAYS)
  const [startTime, setStartTime] = useState(540)
  const [endTime, setEndTime] = useState(1080)
  const [slotDuration, setSlotDuration] = useState(30)
  const [timezone, setTimezone] = useState(getDefaultTimezone)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const createPoll = useMutation(api.availabilityPolls.createPoll)

  // Collect every reason the form can't be submitted, so we can show the admin
  // exactly what's missing instead of just disabling the button silently.
  const validationErrors: Array<string> = []
  if (title.trim() === '') validationErrors.push('Add a title.')
  if (days.length === 0)
    validationErrors.push('Select at least one day of the week.')
  if (endTime <= startTime)
    validationErrors.push('End time must be after start time.')

  const isFormValid = validationErrors.length === 0

  function toggleDay(day: number) {
    setDays((prev) =>
      prev.includes(day)
        ? prev.filter((d) => d !== day)
        : normalizeDays([...prev, day]),
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isFormValid) return

    setIsSubmitting(true)
    try {
      await createPoll({
        opportunityId: opportunityId as Id<'orgOpportunities'>,
        title: title.trim(),
        days: normalizeDays(days),
        startMinutes: startTime,
        endMinutes: endTime,
        slotDurationMinutes: slotDuration,
        timezone,
      })
      toast.success('Poll created')
      onCreated?.()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to create poll',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create Availability Poll</CardTitle>
        <CardDescription>
          Ask participants about a generic week. Pick which days to include and
          the daily time window — no specific calendar dates.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="poll-title">Title</Label>
            <Input
              id="poll-title"
              type="text"
              required
              placeholder="e.g. Course schedule availability"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Days of the week */}
          <div className="space-y-2">
            <Label>Days of the week</Label>
            <div className="flex flex-wrap gap-2">
              {WEEKDAY_SHORT.map((label, day) => {
                const selected = days.includes(day)
                return (
                  <Button
                    key={day}
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-pressed={selected}
                    className={cn(
                      'min-w-[52px]',
                      selected &&
                        'bg-primary text-primary-foreground border-primary hover:bg-primary/90 hover:text-primary-foreground',
                    )}
                    onClick={() => toggleDay(day)}
                  >
                    {label}
                  </Button>
                )
              })}
            </div>
          </div>

          {/* Time fields - two columns */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Start Time</Label>
              <Select
                value={String(startTime)}
                onValueChange={(v) => setStartTime(Number(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select start time" />
                </SelectTrigger>
                <SelectContent>
                  {timeOptions.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>End Time</Label>
              <Select
                value={String(endTime)}
                onValueChange={(v) => setEndTime(Number(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select end time" />
                </SelectTrigger>
                <SelectContent>
                  {timeOptions.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Slot Duration */}
          <div className="space-y-2">
            <Label>Slot Duration</Label>
            <Select
              value={String(slotDuration)}
              onValueChange={(v) => setSlotDuration(Number(v))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select slot duration" />
              </SelectTrigger>
              <SelectContent>
                {SLOT_DURATIONS.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Timezone */}
          <div className="space-y-2">
            <Label>Timezone</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Why the button is disabled (no silent failures) */}
          {!isFormValid && (
            <ul className="space-y-1 text-sm text-amber-600">
              {validationErrors.map((err) => (
                <li key={err}>• {err}</li>
              ))}
            </ul>
          )}

          {/* Submit */}
          <Button
            type="submit"
            disabled={!isFormValid || isSubmitting}
            className="w-full"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="animate-spin" />
                Creating...
              </>
            ) : (
              'Create Poll'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
