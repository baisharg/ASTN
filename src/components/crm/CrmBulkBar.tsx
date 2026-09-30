import { useMutation } from 'convex/react'
import { ChevronDown, GitMerge, Pencil, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { CrmCollection, CrmColumn, FieldValue } from './fieldValues'
import { isEmptyValue } from './fieldValues'
import { TagPicker, ValueDisplay } from './CrmFieldControls'
import { useCrmActions } from './useCrmActions'
import { CrmMergeDialog, MAX_MERGE_SELECTION } from './CrmMerge'
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
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Label } from '~/components/ui/label'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { useBusyAction } from '~/lib/use-busy-action'

const BULK_EDIT_CHUNK = 500
const BULK_DELETE_CHUNK = 200

function chunks<T>(list: Array<T>, size: number): Array<Array<T>> {
  const out: Array<Array<T>> = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

export function CrmBulkBar({
  orgId,
  orgSlug,
  collection,
  ids,
  columns,
  onClear,
}: {
  orgId: Id<'organizations'>
  orgSlug: string
  collection: CrmCollection
  ids: Array<string>
  columns: Array<CrmColumn>
  onClear: () => void
}) {
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const mergeable = collection === 'contacts' && ids.length >= 2
  const canMerge = mergeable && ids.length <= MAX_MERGE_SELECTION
  const deleteRecords = useMutation(api.contacts.bulk.deleteRecords)
  const { busy, run } = useBusyAction<'delete'>()
  const noun =
    collection === 'contacts'
      ? ['contacto', 'contactos']
      : ['organización', 'organizaciones']

  const confirmDelete = () =>
    run(
      'delete',
      async () => {
        let deleted = 0
        for (const part of chunks(ids, BULK_DELETE_CHUNK)) {
          deleted += await deleteRecords({ orgId, collection, ids: part })
        }
        toast.success(`Se eliminaron ${plural(deleted, noun[0], noun[1])}`)
        setDeleteOpen(false)
        onClear()
      },
      toastError('No se pudieron eliminar'),
    )

  return (
    <div
      role="region"
      aria-label="Acciones sobre la selección"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2"
    >
      <span className="text-sm font-medium">
        {plural(ids.length, 'seleccionado', 'seleccionados')}
      </span>
      <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
        <Pencil className="size-4" />
        Editar campo…
      </Button>
      {mergeable && (
        <Button
          size="sm"
          variant="outline"
          disabled={!canMerge}
          onClick={() => setMergeOpen(true)}
        >
          <GitMerge className="size-4" />
          {canMerge ? 'Fusionar' : `Fusionar (hasta ${MAX_MERGE_SELECTION})`}
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        className="text-destructive hover:text-destructive"
        onClick={() => setDeleteOpen(true)}
      >
        <Trash2 className="size-4" />
        Eliminar
      </Button>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear}>
        <X className="size-4" />
        Quitar selección
      </Button>

      <BulkEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        orgId={orgId}
        collection={collection}
        ids={ids}
        columns={columns}
      />

      {canMerge && (
        <CrmMergeDialog
          open={mergeOpen}
          onOpenChange={setMergeOpen}
          orgId={orgId}
          orgSlug={orgSlug}
          ids={ids as Array<Id<'crmContacts'>>}
          onMerged={onClear}
        />
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Eliminar {plural(ids.length, noun[0], noun[1])}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {collection === 'contacts'
                ? 'También se borra su historial en el CRM. Las cuentas, postulaciones y registros a eventos no se tocan. No se puede deshacer.'
                : 'No se puede deshacer.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === 'delete'}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy === 'delete'}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault()
                void confirmDelete()
              }}
            >
              {busy === 'delete' ? 'Eliminando…' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

type Mode = 'set' | 'add' | 'remove'

function BulkEditDialog({
  open,
  onOpenChange,
  orgId,
  collection,
  ids,
  columns,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: Id<'organizations'>
  collection: CrmCollection
  ids: Array<string>
  columns: Array<CrmColumn>
}) {
  const editable = columns.filter(
    (c) =>
      !c.core &&
      (c.type === 'multiSelect' ||
        c.type === 'singleSelect' ||
        c.type === 'checkbox'),
  )
  const [fieldKey, setFieldKey] = useState<string>('')
  const [mode, setMode] = useState<Mode>('add')
  const [value, setValue] = useState<FieldValue>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const bulkSetField = useMutation(api.contacts.records.bulkSetField)
  const { createOption } = useCrmActions(orgId, collection)
  const { busy, run } = useBusyAction<'apply'>()

  const column = editable.find((c) => c.key === fieldKey) ?? null

  const reset = () => {
    setFieldKey('')
    setMode('add')
    setValue(null)
  }

  const chooseField = (key: string) => {
    const next = editable.find((c) => c.key === key)
    setFieldKey(key)
    setMode(next?.type === 'multiSelect' ? 'add' : 'set')
    setValue(next?.type === 'checkbox' ? true : null)
  }

  const needsValue = column?.type === 'multiSelect' && mode !== 'set'
  const canApply =
    !!column && (!needsValue || !isEmptyValue(value)) && ids.length > 0

  const apply = () =>
    run(
      'apply',
      async () => {
        if (!column) return
        const payload: FieldValue =
          column.type === 'multiSelect'
            ? Array.isArray(value) && value.length
              ? value
              : mode === 'set'
                ? null
                : []
            : value
        let changed = 0
        for (const part of chunks(ids, BULK_EDIT_CHUNK)) {
          changed += await bulkSetField({
            orgId,
            collection,
            ids: part,
            key: column.key,
            mode: column.type === 'multiSelect' ? mode : 'set',
            value: payload,
          })
        }
        toast.success(
          changed === 0
            ? 'No hubo cambios'
            : `Se actualizaron ${plural(changed, 'registro', 'registros')}`,
        )
        onOpenChange(false)
        reset()
      },
      toastError('No se pudo aplicar el cambio'),
    )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Editar {plural(ids.length, 'registro', 'registros')}
          </DialogTitle>
          <DialogDescription>
            Cambiá un campo de selección o casilla en todos los seleccionados.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bulk-field">Campo</Label>
            <Select value={fieldKey} onValueChange={chooseField}>
              <SelectTrigger id="bulk-field" className="w-full">
                <SelectValue placeholder="Elegí un campo" />
              </SelectTrigger>
              <SelectContent>
                {editable.map((c) => (
                  <SelectItem key={c.key} value={c.key}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {column?.type === 'multiSelect' && (
            <RadioGroup
              value={mode}
              onValueChange={(m) => setMode(m as Mode)}
              className="flex flex-wrap gap-4"
              aria-label="Qué hacer con las etiquetas"
            >
              {(
                [
                  ['add', 'Agregar'],
                  ['remove', 'Quitar'],
                  ['set', 'Reemplazar todo'],
                ] as const
              ).map(([m, label]) => (
                <div key={m} className="flex items-center gap-2">
                  <RadioGroupItem value={m} id={`bulk-mode-${m}`} />
                  <Label htmlFor={`bulk-mode-${m}`} className="font-normal">
                    {label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          )}

          {column?.type === 'checkbox' && (
            <div className="space-y-1.5">
              <Label htmlFor="bulk-check">Valor</Label>
              <Select
                value={value === false ? 'false' : 'true'}
                onValueChange={(v) => setValue(v === 'true')}
              >
                <SelectTrigger id="bulk-check" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Marcar</SelectItem>
                  <SelectItem value="false">Desmarcar</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {column?.def &&
            (column.type === 'multiSelect' ||
              column.type === 'singleSelect') && (
              <div className="space-y-1.5">
                <Label htmlFor="bulk-value">
                  {column.type === 'singleSelect'
                    ? 'Valor (vacío para borrarlo)'
                    : mode === 'remove'
                      ? 'Etiquetas a quitar'
                      : mode === 'add'
                        ? 'Etiquetas a agregar'
                        : 'Etiquetas (vacío para borrarlas)'}
                </Label>
                <TagPicker
                  def={column.def}
                  multi={column.type === 'multiSelect'}
                  value={value}
                  onChange={setValue}
                  onCreateOption={
                    mode === 'remove'
                      ? undefined
                      : (v) => createOption(column.def!, v)
                  }
                  open={pickerOpen}
                  onOpenChange={setPickerOpen}
                >
                  <button
                    id="bulk-value"
                    type="button"
                    className="flex min-h-9 w-full items-center gap-1 rounded-md border bg-background px-2 py-1 text-left text-sm shadow-xs hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {isEmptyValue(value) ? (
                      <span className="text-muted-foreground">Elegir…</span>
                    ) : (
                      <ValueDisplay column={column} value={value} wrap />
                    )}
                    <ChevronDown className="ml-auto size-4 shrink-0 opacity-50" />
                  </button>
                </TagPicker>
              </div>
            )}

          {editable.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No hay campos de selección o casilla. Creá uno desde «Campos».
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => void apply()}
            disabled={!canApply || busy === 'apply'}
          >
            {busy === 'apply' ? 'Aplicando…' : 'Aplicar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
