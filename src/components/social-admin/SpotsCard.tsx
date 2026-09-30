import { useMutation } from 'convex/react'
import { ImageUp, Loader2, Plus, Save, Trash2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { toastError } from './shared'
import type { AdminEvent } from './shared'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { useBusyAction } from '~/lib/use-busy-action'
import { cn } from '~/lib/utils'

type Spot = { key: string; number: number; label: string; x: number; y: number }

const MAX_FLOOR_PLAN_BYTES = 10 * 1024 * 1024

let keyCounter = 0
const newKey = () => `spot-${++keyCounter}`

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

function nextNumber(spots: Array<Spot>): number {
  const used = new Set(spots.map((s) => s.number))
  let n = 1
  while (used.has(n)) n++
  return n
}

function serialize(
  spots: Array<{ number: number; label?: string; x: number; y: number }>,
) {
  return JSON.stringify(
    [...spots]
      .sort((a, b) => a.number - b.number)
      .map((s) => [
        s.number,
        (s.label ?? '').trim(),
        Math.round(s.x * 1000),
        Math.round(s.y * 1000),
      ]),
  )
}

export function SpotsCard({ event }: { event: AdminEvent }) {
  const generateUploadUrl = useMutation(
    api.social.events.generateFloorPlanUploadUrl,
  )
  const setFloorPlan = useMutation(api.social.events.setFloorPlan)
  const setSpotsMutation = useMutation(api.social.events.setSpots)

  const [spots, setSpots] = useState<Array<Spot>>(() =>
    event.spots.map((s) => ({
      key: newKey(),
      number: s.number,
      label: s.label ?? '',
      x: s.x,
      y: s.y,
    })),
  )
  const [selected, setSelected] = useState<string | null>(null)
  const { busy, run } = useBusyAction<'upload' | 'remove' | 'save'>()
  const uploading = busy === 'upload' || busy === 'remove'
  const saving = busy === 'save'

  const planRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const drag = useRef<{
    key: string
    pointerId: number
    startX: number
    startY: number
    moved: boolean
  } | null>(null)

  const dirty = serialize(spots) !== serialize(event.spots)

  const pointToFraction = (clientX: number, clientY: number) => {
    const rect = planRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return null
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height),
    }
  }

  const addSpot = (x: number, y: number) => {
    const spot: Spot = {
      key: newKey(),
      number: nextNumber(spots),
      label: '',
      x,
      y,
    }
    setSpots((prev) => [...prev, spot])
    setSelected(spot.key)
  }

  const updateSpot = (key: string, patch: Partial<Spot>) =>
    setSpots((prev) =>
      prev.map((s) => (s.key === key ? { ...s, ...patch } : s)),
    )

  const removeSpot = (key: string) => {
    setSpots((prev) => prev.filter((s) => s.key !== key))
    setSelected((cur) => (cur === key ? null : cur))
  }

  const handlePlanClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const point = pointToFraction(e.clientX, e.clientY)
    if (point) addSpot(point.x, point.y)
  }

  const handleSpotPointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    key: string,
  ) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = {
      key,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    }
  }

  const handleSpotPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    if (
      !d.moved &&
      Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4
    ) {
      return
    }
    d.moved = true
    const point = pointToFraction(e.clientX, e.clientY)
    if (point) updateSpot(d.key, point)
  }

  const handleSpotPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    drag.current = null
  }

  const handleSpotKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    spot: Spot,
  ) => {
    const step = e.shiftKey ? 0.05 : 0.01
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const move = moves[e.key] as [number, number] | undefined
    if (move) {
      e.preventDefault()
      updateSpot(spot.key, {
        x: clamp01(spot.x + move[0]),
        y: clamp01(spot.y + move[1]),
      })
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      removeSpot(spot.key)
    }
  }

  const handleUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Subí una imagen (PNG, JPG o similar)')
      return
    }
    if (file.size > MAX_FLOOR_PLAN_BYTES) {
      toast.error('La imagen pesa más de 10 MB')
      return
    }
    await run(
      'upload',
      async () => {
        const url = await generateUploadUrl({ eventId: event._id })
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': file.type },
          body: file,
        })
        if (!res.ok) throw new Error(`Upload failed (${res.status})`)
        const { storageId } = (await res.json()) as {
          storageId: Id<'_storage'>
        }
        await setFloorPlan({ eventId: event._id, storageId })
        toast.success('Plano subido')
      },
      toastError('No se pudo subir el plano'),
    )
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleRemovePlan = () =>
    run(
      'remove',
      async () => {
        await setFloorPlan({ eventId: event._id, storageId: null })
        toast.success(
          'Plano quitado. Los lugares quedan sobre un salón genérico.',
        )
      },
      toastError('No se pudo quitar el plano'),
    )

  const handleSave = () =>
    run(
      'save',
      async () => {
        await setSpotsMutation({
          eventId: event._id,
          spots: [...spots]
            .sort((a, b) => a.number - b.number)
            .map((s) => ({
              number: s.number,
              label: s.label.trim() || undefined,
              x: s.x,
              y: s.y,
            })),
        })
        toast.success('Lugares guardados')
      },
      toastError('No se pudieron guardar los lugares'),
    )

  const sortedSpots = [...spots].sort((a, b) => a.number - b.number)
  const numberCounts = new Map<number, number>()
  for (const s of spots) {
    numberCounts.set(s.number, (numberCounts.get(s.number) ?? 0) + 1)
  }
  const hasDuplicateNumbers = [...numberCounts.values()].some((n) => n > 1)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lugares de reunión ({spots.length})</CardTitle>
        <CardDescription>
          Cada pareja que arranca un 1:1 recibe un lugar libre y lo ve marcado
          en el plano. Tocá el plano para agregar un lugar y arrastralo para
          moverlo. Con un lugar seleccionado, las flechas lo mueven y Suprimir
          lo quita.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            id={`floor-plan-${event._id}`}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleUpload(file)
            }}
          />
          <Button
            variant="outline"
            className="min-h-11"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <ImageUp className="size-4 mr-2" />
            )}
            {event.floorPlanUrl ? 'Cambiar plano' : 'Subir plano (opcional)'}
          </Button>
          {event.floorPlanUrl && (
            <Button
              variant="ghost"
              className="min-h-11"
              disabled={uploading}
              onClick={() => void handleRemovePlan()}
            >
              <X className="size-4 mr-2" />
              Quitar plano
            </Button>
          )}
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => addSpot(0.5, 0.5)}
          >
            <Plus className="size-4 mr-2" />
            Agregar lugar
          </Button>
        </div>

        {/* The plan. Clicking empty space adds a spot; the buttons below and
            the keyboard handlers on each spot cover the same actions. */}
        <div
          ref={planRef}
          onClick={handlePlanClick}
          className={cn(
            'relative select-none cursor-crosshair overflow-hidden rounded-lg border',
            !event.floorPlanUrl &&
              'aspect-[4/3] border-2 border-dashed border-slate-300 bg-slate-50 bg-[linear-gradient(to_right,rgb(226_232_240)_1px,transparent_1px),linear-gradient(to_bottom,rgb(226_232_240)_1px,transparent_1px)] bg-[size:10%_10%]',
          )}
        >
          {event.floorPlanUrl ? (
            <img
              src={event.floorPlanUrl}
              alt="Plano del lugar"
              draggable={false}
              className="block w-full pointer-events-none"
            />
          ) : (
            <span className="absolute inset-x-0 bottom-2 text-center text-xs text-muted-foreground pointer-events-none">
              Salón (sin plano)
            </span>
          )}
          {spots.map((spot) => (
            <button
              key={spot.key}
              type="button"
              aria-label={`Lugar ${spot.number}${spot.label ? `: ${spot.label}` : ''}`}
              aria-pressed={selected === spot.key}
              className={cn(
                'absolute size-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary text-primary-foreground text-sm font-semibold shadow-md cursor-grab active:cursor-grabbing touch-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/60',
                selected === spot.key && 'ring-4 ring-amber-400',
              )}
              style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%` }}
              onClick={(e) => {
                e.stopPropagation()
                setSelected(spot.key)
              }}
              onPointerDown={(e) => handleSpotPointerDown(e, spot.key)}
              onPointerMove={handleSpotPointerMove}
              onPointerUp={handleSpotPointerUp}
              onPointerCancel={handleSpotPointerUp}
              onKeyDown={(e) => handleSpotKeyDown(e, spot)}
            >
              {spot.number}
            </button>
          ))}
        </div>

        {sortedSpots.length > 0 && (
          <ul className="divide-y rounded-md border">
            {sortedSpots.map((spot) => (
              <li
                key={spot.key}
                className={cn(
                  'flex items-center gap-2 px-3 py-2',
                  selected === spot.key && 'bg-amber-50',
                )}
              >
                <label className="sr-only" htmlFor={`${spot.key}-number`}>
                  Número del lugar
                </label>
                <Input
                  id={`${spot.key}-number`}
                  type="number"
                  min={1}
                  value={spot.number}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10)
                    if (Number.isFinite(n) && n > 0) {
                      updateSpot(spot.key, { number: n })
                    }
                  }}
                  onFocus={() => setSelected(spot.key)}
                  aria-invalid={
                    (numberCounts.get(spot.number) ?? 0) > 1 || undefined
                  }
                  className="w-20"
                />
                <label className="sr-only" htmlFor={`${spot.key}-label`}>
                  Nombre del lugar {spot.number}
                </label>
                <Input
                  id={`${spot.key}-label`}
                  value={spot.label}
                  onChange={(e) =>
                    updateSpot(spot.key, { label: e.target.value })
                  }
                  onFocus={() => setSelected(spot.key)}
                  placeholder="Nombre opcional (ej. Ventanas, Barra)"
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  aria-label={`Quitar lugar ${spot.number}`}
                  onClick={() => removeSpot(spot.key)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {hasDuplicateNumbers && (
          <p className="text-sm text-red-600">
            Hay lugares con el mismo número. Cada lugar necesita uno distinto.
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button
            className="min-h-11"
            disabled={!dirty || saving || hasDuplicateNumbers}
            onClick={() => void handleSave()}
          >
            {saving ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Save className="size-4 mr-2" />
            )}
            Guardar lugares
          </Button>
          {dirty && (
            <span className="text-sm text-muted-foreground">
              Hay cambios sin guardar
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Los lugares no se pueden cambiar mientras hay reuniones en curso.
        </p>
      </CardContent>
    </Card>
  )
}
