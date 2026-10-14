import { Fragment, useCallback, useRef, useState } from 'react'
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
  /**
   * Stretch the grid to fill its parent's height and width, so the whole week
   * is visible without scrolling. The parent must have a definite height.
   */
  fit?: boolean
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
  fit = false,
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
      // Right click (or Ctrl+click on a Mac) always clears, whatever the
      // selected mode; other buttons do nothing.
      const secondary = e.button === 2 || (e.button === 0 && e.ctrlKey)
      if (e.button !== 0 && !secondary) return
      isDraggingRef.current = true
      activePaintModeRef.current = secondary ? 'clear' : paintModeRef.current
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
    <div className={cn('flex flex-col gap-3', fit && 'h-full min-h-0 gap-2')}>
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
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
            type="button"
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
            type="button"
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
              type="button"
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

      {/* A CSS grid rather than a table so that, in fit mode, the rows share
          whatever height there is. The 1px gap on a grey background draws the
          cell borders. */}
      <div
        className={cn(
          'select-none',
          fit ? 'min-h-0 flex-1 overflow-y-auto' : 'max-w-full overflow-x-auto',
        )}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onContextMenu={readOnly ? undefined : (e) => e.preventDefault()}
      >
        <div
          className={cn('grid', fit && 'h-full')}
          style={{
            gridTemplateColumns: fit
              ? `auto repeat(${days.length}, minmax(0, 1fr))`
              : `auto repeat(${days.length}, minmax(60px, 1fr))`,
            gridTemplateRows: fit
              ? `auto repeat(${timeSlots.length}, minmax(14px, 1fr))`
              : `auto repeat(${timeSlots.length}, 40px)`,
          }}
        >
          <div className="sticky top-0 left-0 z-20 bg-background" />
          {days.map((day) => (
            <div
              key={day}
              className="sticky top-0 z-10 bg-background px-1 pb-1 text-center text-xs font-medium text-muted-foreground"
            >
              {weekdayShort(day)}
            </div>
          ))}
          {timeSlots.map((minutes) => (
            <Fragment key={minutes}>
              <div
                className={cn(
                  'sticky left-0 z-10 bg-background pr-2 text-right text-xs whitespace-nowrap text-muted-foreground',
                  fit && 'text-[11px] leading-none',
                )}
              >
                {/* In fit mode rows can get short, so only label the hours. */}
                {!fit || minutes % 60 === 0 || slotDurationMinutes >= 60
                  ? formatTime(minutes)
                  : ''}
              </div>
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
                  cellBg = 'bg-blue-400 ring-2 ring-inset ring-blue-600'
                } else if (hasSlot) {
                  cellBg =
                    slots[key] === 'available' ? 'bg-green-400' : 'bg-amber-300'
                }

                return (
                  <div
                    key={key}
                    className={cn(
                      'border-t border-l border-slate-200',
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
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}
