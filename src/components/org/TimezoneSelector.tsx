import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '~/lib/utils'
import { Button } from '~/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '~/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover'

interface TimezoneSelectorProps {
  value: string
  onChange: (timezone: string) => void
  /** For a `<Label htmlFor>` pointing at the trigger button. */
  id?: string
}

// Get UTC offset for a timezone
function getTimezoneOffset(timezone: string): string {
  try {
    const date = new Date()
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    })
    const parts = formatter.formatToParts(date)
    const offsetPart = parts.find((p) => p.type === 'timeZoneName')
    return offsetPart?.value || ''
  } catch {
    return ''
  }
}

// Get browser's default timezone
function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}

export function TimezoneSelector({
  value,
  onChange,
  id,
}: TimezoneSelectorProps) {
  const [open, setOpen] = useState(false)

  // Get all IANA timezones
  const timezones = useMemo(() => {
    try {
      const zones = Intl.supportedValuesOf('timeZone')
      return zones.map((tz) => ({
        value: tz,
        label: tz.replace(/_/g, ' '),
        offset: getTimezoneOffset(tz),
      }))
    } catch {
      // Fallback for older browsers
      return [
        { value: 'UTC', label: 'UTC', offset: 'UTC' },
        {
          value: 'America/New_York',
          label: 'America/New York',
          offset: 'UTC-5',
        },
        { value: 'America/Chicago', label: 'America/Chicago', offset: 'UTC-6' },
        { value: 'America/Denver', label: 'America/Denver', offset: 'UTC-7' },
        {
          value: 'America/Los_Angeles',
          label: 'America/Los Angeles',
          offset: 'UTC-8',
        },
        { value: 'Europe/London', label: 'Europe/London', offset: 'UTC+0' },
        { value: 'Europe/Paris', label: 'Europe/Paris', offset: 'UTC+1' },
        { value: 'Asia/Tokyo', label: 'Asia/Tokyo', offset: 'UTC+9' },
      ]
    }
  }, [])

  const selectedTimezone = timezones.find((tz) => tz.value === value)
  const displayValue = selectedTimezone
    ? `${selectedTimezone.label} (${selectedTimezone.offset})`
    : 'Select timezone...'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{displayValue}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search timezone..." />
          <CommandList>
            <CommandEmpty>No timezone found.</CommandEmpty>
            <CommandGroup>
              {/* Browser default at top */}
              {!value && (
                <CommandItem
                  value={getBrowserTimezone()}
                  onSelect={() => {
                    onChange(getBrowserTimezone())
                    setOpen(false)
                  }}
                  className="text-primary"
                >
                  <Check className={cn('mr-2 size-4', 'opacity-0')} />
                  Use browser timezone ({getBrowserTimezone()})
                </CommandItem>
              )}
              {timezones.map((tz) => (
                <CommandItem
                  key={tz.value}
                  value={tz.value}
                  onSelect={() => {
                    onChange(tz.value)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 size-4',
                      value === tz.value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="flex-1">{tz.label}</span>
                  <span className="text-muted-foreground text-sm">
                    {tz.offset}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// Export for default value
export { getBrowserTimezone }
