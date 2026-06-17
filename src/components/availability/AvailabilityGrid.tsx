import { useCallback, useRef, useState } from 'react'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { weekdayShort } from '../../../convex/lib/availabilityWeek'

type SlotStatus = 'available' | 'maybe'
type PaintMode = SlotStatus | 'clear'

interface AvailabilityGridProps {
  days: Array<number>
  startMinutes: number
  endMinutes: number
  slotDurationMinutes: number
  timezone: string
  slots: Record<string, SlotStatus>
  onSlotsChange: (slots: Record<string, SlotStatus>) => void
  readOnly?: boolean
  finalizedSlot?: { day: number; startMinutes: number; endMinutes: number }
}

const formatTime = (minutes: number) => {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return m === 0
    ? `${h12} ${period}`
    : `${h12}:${String(m).padStart(2, '0')} ${period}`
}

function generateTimeSlots(
  startMinutes: number,
  endMinutes: number,
  slotDurationMinutes: number,
): Array<number> {
  const slots: Array<number> = []
  for (let m = startMinutes; m < endMinutes; m += slotDurationMinutes) {
    slots.push(m)
  }
  return slots
}

function isFinalized(
  day: number,
  slotMinutes: number,
  slotDuration: number,
  finalizedSlot?: AvailabilityGridProps['finalizedSlot'],
): boolean {
  if (!finalizedSlot) return false
  if (day !== finalizedSlot.day) return false
  const slotEnd = slotMinutes + slotDuration
  return (
    slotMinutes >= finalizedSlot.startMinutes &&
    slotEnd <= finalizedSlot.endMinutes
  )
}

export function AvailabilityGrid({
  days,
  startMinutes,
  endMinutes,
  slotDurationMinutes,
  slots,
  onSlotsChange,
  readOnly = false,
  finalizedSlot,
}: AvailabilityGridProps) {
  const [paintMode, setPaintMode] = useState<PaintMode>('available')
  const paintModeRef = useRef<PaintMode>(paintMode)
  const isDraggingRef = useRef(false)
  const activePaintModeRef = useRef<PaintMode>('available')
  const lastPointerTypeRef = useRef<string>('')

  const timeSlots = generateTimeSlots(
    startMinutes,
    endMinutes,
    slotDurationMinutes,
  )

  const paintCell = useCallback(
    (key: string) => {
      const mode = activePaintModeRef.current
      const next = { ...slots }
      if (mode === 'clear') {
        delete next[key]
      } else {
        next[key] = mode
      }
      onSlotsChange(next)
    },
    [slots, onSlotsChange],
  )

  const handlePointerDown = useCallback(
    (key: string, e: React.PointerEvent) => {
      if (readOnly) return
      lastPointerTypeRef.current = e.pointerType
      if (e.pointerType === 'touch') return // touch taps handled by onClick
      isDraggingRef.current = true
      activePaintModeRef.current = paintModeRef.current
      paintCell(key)
    },
    [readOnly, paintCell],
  )

  const handleCellClick = useCallback(
    (key: string) => {
      if (readOnly) return
      if (lastPointerTypeRef.current !== 'touch') return // mouse handled via pointer events
      activePaintModeRef.current = paintModeRef.current
      paintCell(key)
    },
    [readOnly, paintCell],
  )

  const handlePointerEnter = useCallback(
    (key: string) => {
      if (readOnly || !isDraggingRef.current) return
      paintCell(key)
    },
    [readOnly, paintCell],
  )

  const handlePointerUp = useCallback(() => {
    isDraggingRef.current = false
  }, [])

  return (
    <div className="flex flex-col gap-3">
      {!readOnly && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className={cn(
              paintMode === 'available' &&
                'bg-green-400 text-white hover:bg-green-500 hover:text-white',
            )}
            onClick={() => {
              setPaintMode('available')
              paintModeRef.current = 'available'
            }}
          >
            Available
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              paintMode === 'maybe' &&
                'bg-amber-300 text-black hover:bg-amber-400 hover:text-black',
            )}
            onClick={() => {
              setPaintMode('maybe')
              paintModeRef.current = 'maybe'
            }}
          >
            Maybe
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              paintMode === 'clear' &&
                'bg-slate-300 text-black hover:bg-slate-400 hover:text-black',
            )}
            onClick={() => {
              setPaintMode('clear')
              paintModeRef.current = 'clear'
            }}
          >
            Clear
          </Button>
          {Object.keys(slots).length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-muted-foreground"
              onClick={() => onSlotsChange({})}
            >
              Clear All
            </Button>
          )}
        </div>
      )}

      <div
        className="select-none overflow-x-auto"
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <table className="border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-background p-1" />
              {days.map((day) => (
                <th
                  key={day}
                  className="min-w-[60px] px-1 pb-1 text-center text-xs font-medium text-muted-foreground"
                >
                  <div>{weekdayShort(day)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {timeSlots.map((minutes) => (
              <tr key={minutes}>
                <td className="sticky left-0 z-10 bg-background pr-2 text-right text-xs whitespace-nowrap text-muted-foreground">
                  {formatTime(minutes)}
                </td>
                {days.map((day) => {
                  const key = `${day}|${minutes}`
                  const hasSlot = key in slots
                  const finalized = isFinalized(
                    day,
                    minutes,
                    slotDurationMinutes,
                    finalizedSlot,
                  )

                  let cellBg = 'bg-slate-100'
                  if (finalized) {
                    cellBg = 'bg-blue-400 ring-2 ring-blue-600'
                  } else if (hasSlot) {
                    cellBg =
                      slots[key] === 'available'
                        ? 'bg-green-400'
                        : 'bg-amber-300'
                  }

                  return (
                    <td
                      key={key}
                      className={cn(
                        'h-[40px] min-w-[60px] border border-slate-200',
                        cellBg,
                        !readOnly && 'cursor-pointer',
                      )}
                      onPointerDown={
                        readOnly
                          ? undefined
                          : (e) => {
                              handlePointerDown(key, e)
                            }
                      }
                      onPointerEnter={
                        readOnly
                          ? undefined
                          : () => {
                              handlePointerEnter(key)
                            }
                      }
                      onClick={
                        readOnly
                          ? undefined
                          : () => {
                              handleCellClick(key)
                            }
                      }
                    />
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
