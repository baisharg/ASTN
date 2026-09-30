import { useMutation } from 'convex/react'
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { CrmCollection, CrmFieldType, FieldDef } from './fieldValues'
import {
  FIELD_SOURCE_LABELS,
  FIELD_TYPE_LABELS,
  OPTION_COLORS,
  OPTION_COLOR_LABELS,
  OPTION_SWATCH_CLASSES,
  coreColumns,
  paletteColor,
  isSelectType,
} from './fieldValues'
import { OptionTag } from './CrmFieldControls'
import { toastError } from '~/components/social-admin/shared'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet'
import { errorText } from '~/lib/convex-error'
import { useBusyAction } from '~/lib/use-busy-action'
import { cn } from '~/lib/utils'

const COLLECTION_TITLES: Record<CrmCollection, string> = {
  contacts: 'Campos de contactos',
  organizations: 'Campos de organizaciones',
}

export function CrmFieldManager({
  open,
  onOpenChange,
  orgId,
  collection,
  defs,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: Id<'organizations'>
  collection: CrmCollection
  defs: Array<FieldDef>
}) {
  const updateField = useMutation(api.contacts.records.updateField)
  const reorderFields = useMutation(api.contacts.records.reorderFields)
  const deleteField = useMutation(api.contacts.records.deleteField)
  const { busy, run } = useBusyAction<string>()
  // null = closed, 'new' = create, otherwise the field being edited.
  const [editing, setEditing] = useState<FieldDef | 'new' | null>(null)
  const [deleting, setDeleting] = useState<FieldDef | null>(null)

  const ordered = [...defs].sort((a, b) => a.order - b.order)

  const move = (index: number, delta: number) => {
    const j = index + delta
    if (j < 0 || j >= ordered.length) return
    const ids = ordered.map((d) => d._id)
    ;[ids[index], ids[j]] = [ids[j], ids[index]]
    void run(
      'reorder',
      () => reorderFields({ orgId, fieldIds: ids }),
      toastError('No se pudo reordenar'),
    )
  }

  const toggleHidden = (def: FieldDef) =>
    run(
      `hide:${def._id}`,
      () => updateField({ orgId, fieldId: def._id, hidden: !def.hidden }),
      toastError('No se pudo cambiar la visibilidad'),
    )

  const confirmDelete = () => {
    if (!deleting) return
    const def = deleting
    void run(
      `delete:${def._id}`,
      async () => {
        await deleteField({ orgId, fieldId: def._id })
        toast.success(`Se borró el campo «${def.label}»`)
        setDeleting(null)
      },
      toastError('No se pudo borrar el campo'),
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-lg">
        <SheetHeader className="border-b">
          <SheetTitle>{COLLECTION_TITLES[collection]}</SheetTitle>
          <SheetDescription>
            Ocultar un campo lo saca de la tabla por defecto; sus datos se
            mantienen. Los campos predefinidos no se pueden borrar.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <Button onClick={() => setEditing('new')} className="w-full">
            <Plus className="size-4" />
            Nuevo campo
          </Button>

          <p className="text-xs text-muted-foreground">
            Columnas fijas:{' '}
            {coreColumns(collection)
              .map((c) => c.label)
              .join(', ')}
            .
          </p>

          <ul className="divide-y rounded-lg border" aria-label="Campos">
            {ordered.map((def, index) => (
              <li
                key={def._id}
                className={cn(
                  'flex items-center gap-2 px-2 py-2',
                  def.hidden && 'bg-muted/40',
                )}
              >
                <div className="flex flex-col">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    disabled={index === 0 || busy === 'reorder'}
                    onClick={() => move(index, -1)}
                    aria-label={`Subir ${def.label}`}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    disabled={
                      index === ordered.length - 1 || busy === 'reorder'
                    }
                    onClick={() => move(index, 1)}
                    aria-label={`Bajar ${def.label}`}
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'truncate text-sm font-medium',
                      def.hidden && 'text-muted-foreground',
                    )}
                  >
                    {def.label}
                  </p>
                  <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    {FIELD_TYPE_LABELS[def.type]}
                    {isSelectType(def.type) &&
                      ` · ${def.options.length} ${def.options.length === 1 ? 'opción' : 'opciones'}`}
                    <Badge
                      variant="outline"
                      className="ml-1 px-1.5 py-0 text-[10px]"
                    >
                      {FIELD_SOURCE_LABELS[def.source]}
                    </Badge>
                    {def.hidden && (
                      <Badge
                        variant="outline"
                        className="px-1.5 py-0 text-[10px]"
                      >
                        Oculto
                      </Badge>
                    )}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => setEditing(def)}
                  aria-label={`Editar ${def.label}`}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={busy === `hide:${def._id}`}
                  onClick={() => void toggleHidden(def)}
                  aria-label={
                    def.hidden ? `Mostrar ${def.label}` : `Ocultar ${def.label}`
                  }
                  title={def.hidden ? 'Mostrar' : 'Ocultar'}
                >
                  {def.hidden ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  disabled={def.source === 'builtin'}
                  onClick={() => setDeleting(def)}
                  aria-label={`Borrar ${def.label}`}
                  title={
                    def.source === 'builtin'
                      ? 'Los campos predefinidos solo se pueden ocultar'
                      : 'Borrar'
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </div>

        {editing !== null && (
          <FieldDialog
            key={editing === 'new' ? 'new' : editing._id}
            orgId={orgId}
            collection={collection}
            def={editing === 'new' ? null : editing}
            onClose={() => setEditing(null)}
          />
        )}

        <AlertDialog
          open={deleting !== null}
          onOpenChange={(o) => !o && setDeleting(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                ¿Borrar el campo «{deleting?.label}»?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Se borran también sus valores en todos los registros. Si solo
                querés sacarlo de la vista, ocultalo. No se puede deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                disabled={busy?.startsWith('delete:')}
                onClick={(e) => {
                  e.preventDefault()
                  confirmDelete()
                }}
              >
                Borrar campo
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  )
}

// ── Create / edit dialog ─────────────────────────────────────────────────

type OptionDraft = {
  /** The option's value on the server, for renames; null when new. */
  original: string | null
  value: string
  color: string | undefined
}

const CREATABLE_TYPES: Array<CrmFieldType> = [
  'text',
  'longText',
  'singleSelect',
  'multiSelect',
  'checkbox',
  'date',
  'number',
  'url',
  'email',
  'phone',
]

function FieldDialog({
  orgId,
  collection,
  def,
  onClose,
}: {
  orgId: Id<'organizations'>
  collection: CrmCollection
  def: FieldDef | null
  onClose: () => void
}) {
  const createField = useMutation(api.contacts.records.createField)
  const updateField = useMutation(api.contacts.records.updateField)
  const { busy, run } = useBusyAction<'save'>()
  const [label, setLabel] = useState(def?.label ?? '')
  const [type, setType] = useState<CrmFieldType>(def?.type ?? 'singleSelect')
  const [options, setOptions] = useState<Array<OptionDraft>>(
    () =>
      def?.options.map((o) => ({
        original: o.value,
        value: o.value,
        color: o.color,
      })) ?? [],
  )
  const [newOption, setNewOption] = useState('')
  const [error, setError] = useState<string | null>(null)

  const selectType = isSelectType(type)
  const trimmedValues = options.map((o) => o.value.trim())
  const duplicate = trimmedValues.find(
    (v, i) => v && trimmedValues.indexOf(v) !== i,
  )
  const blank = trimmedValues.some((v) => !v)

  const addOption = () => {
    const value = newOption.trim()
    if (!value) return
    if (options.some((o) => o.value.trim() === value)) {
      setError(`Ya existe la opción «${value}»`)
      return
    }
    setOptions((prev) => [
      ...prev,
      {
        original: null,
        value,
        color: OPTION_COLORS[(prev.length + 1) % OPTION_COLORS.length],
      },
    ])
    setNewOption('')
    setError(null)
  }

  const save = () =>
    run(
      'save',
      async () => {
        setError(null)
        const cleanOptions = options.map((o) => ({
          value: o.value.trim(),
          ...(o.color ? { color: o.color } : {}),
        }))
        if (def) {
          const renameOptions = options
            .filter((o) => o.original !== null && o.original !== o.value.trim())
            .map((o) => ({ from: o.original as string, to: o.value.trim() }))
          await updateField({
            orgId,
            fieldId: def._id,
            label: label.trim() !== def.label ? label.trim() : undefined,
            options: selectType ? cleanOptions : undefined,
            renameOptions: renameOptions.length ? renameOptions : undefined,
          })
          toast.success(`Se guardó «${label.trim()}»`)
        } else {
          await createField({
            orgId,
            collection,
            label: label.trim(),
            type,
            options: selectType ? cleanOptions : undefined,
          })
          toast.success(`Se creó el campo «${label.trim()}»`)
        }
        onClose()
      },
      (err) => setError(errorText(err, 'No se pudo guardar el campo')),
    )

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {def ? `Editar «${def.label}»` : 'Nuevo campo'}
          </DialogTitle>
          {def && (
            <DialogDescription>
              {FIELD_TYPE_LABELS[def.type]} · {FIELD_SOURCE_LABELS[def.source]}.
              Renombrar una opción cambia el valor en todos los registros.
            </DialogDescription>
          )}
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (label.trim() && !duplicate && !blank) void save()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="field-label">Nombre</Label>
            <Input
              id="field-label"
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          {!def && (
            <div className="space-y-1.5">
              <Label htmlFor="field-type">Tipo</Label>
              <Select
                value={type}
                onValueChange={(t) => setType(t as CrmFieldType)}
              >
                <SelectTrigger id="field-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CREATABLE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {FIELD_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {selectType && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Opciones</legend>
              {options.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Todavía no hay opciones.
                </p>
              )}
              <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {options.map((option, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <ColorPicker
                      color={option.color}
                      label={option.value || 'opción'}
                      onChange={(color) =>
                        setOptions((prev) =>
                          prev.map((o, i) =>
                            i === index ? { ...o, color } : o,
                          ),
                        )
                      }
                    />
                    <Input
                      className="h-8"
                      aria-label={`Opción ${index + 1}`}
                      value={option.value}
                      onChange={(e) =>
                        setOptions((prev) =>
                          prev.map((o, i) =>
                            i === index ? { ...o, value: e.target.value } : o,
                          ),
                        )
                      }
                    />
                    {option.original !== null &&
                      option.original !== option.value.trim() && (
                        <span
                          className="shrink-0 text-xs text-muted-foreground"
                          title={`Antes: ${option.original}`}
                        >
                          renombrada
                        </span>
                      )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      onClick={() =>
                        setOptions((prev) => prev.filter((_, i) => i !== index))
                      }
                      aria-label={`Quitar la opción ${option.value}`}
                    >
                      <X className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Input
                  className="h-8"
                  aria-label="Nueva opción"
                  placeholder="Nueva opción"
                  value={newOption}
                  onChange={(e) => setNewOption(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addOption()
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addOption}
                  disabled={!newOption.trim()}
                >
                  <Plus className="size-4" />
                  Agregar
                </Button>
              </div>
              {options.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1" aria-hidden>
                  {options
                    .filter((o) => o.value.trim())
                    .map((o, i) => (
                      <OptionTag key={i} value={o.value} color={o.color} />
                    ))}
                </div>
              )}
            </fieldset>
          )}

          {(error || duplicate || blank) && (
            <p role="alert" className="text-sm text-destructive">
              {error ??
                (duplicate
                  ? `La opción «${duplicate}» está repetida`
                  : 'Hay una opción vacía')}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={
                !label.trim() || !!duplicate || blank || busy === 'save'
              }
            >
              {busy === 'save' ? 'Guardando…' : def ? 'Guardar' : 'Crear campo'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ColorPicker({
  color,
  label,
  onChange,
}: {
  color: string | undefined
  label: string
  onChange: (color: string) => void
}) {
  const [open, setOpen] = useState(false)
  const current = paletteColor(color)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Color de ${label}: ${OPTION_COLOR_LABELS[current]}`}
          className="flex size-8 shrink-0 items-center justify-center rounded-md border hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className={cn(
              'size-4 rounded-full',
              OPTION_SWATCH_CLASSES[current],
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <div
          className="grid grid-cols-5 gap-1"
          role="group"
          aria-label="Colores"
        >
          {OPTION_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={OPTION_COLOR_LABELS[c]}
              aria-pressed={c === current}
              onClick={() => {
                onChange(c)
                setOpen(false)
              }}
              className={cn(
                'flex size-7 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                c === current && 'ring-2 ring-foreground/40',
              )}
            >
              <span
                className={cn('size-4 rounded-full', OPTION_SWATCH_CLASSES[c])}
              />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
