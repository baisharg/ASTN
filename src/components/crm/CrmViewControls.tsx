import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Check,
  ChevronDown,
  Columns3,
  Filter,
  Layers,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  View,
  X,
} from 'lucide-react'
import { useState } from 'react'
import type { CrmColumn, FilterOp, ViewFilter, ViewSort } from './fieldValues'
import {
  OPS_BY_TYPE,
  defaultFilterValue,
  filterIsActive,
  isEmptyValue,
  isGroupable,
  opLabel,
  opNeedsValue,
} from './fieldValues'
import { TagPicker, ValueDisplay } from './CrmFieldControls'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Input } from '~/components/ui/input'
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

// ── Filters ──────────────────────────────────────────────────────────────

export function FilterPopover({
  columns,
  filters,
  onChange,
}: {
  columns: Array<CrmColumn>
  filters: Array<ViewFilter>
  onChange: (filters: Array<ViewFilter>) => void
}) {
  const byKey = new Map(columns.map((c) => [c.key, c]))
  const active = filters.filter(filterIsActive).length

  const addFilter = () => {
    const column = columns[0]
    const op = OPS_BY_TYPE[column.type][0]
    onChange([
      ...filters,
      { field: column.key, op, value: defaultFilterValue(column, op) },
    ])
  }

  const update = (index: number, next: ViewFilter) =>
    onChange(filters.map((f, i) => (i === index ? next : f)))

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant={active ? 'secondary' : 'outline'} size="sm">
          <Filter className="size-4" />
          Filtrar
          {active > 0 && (
            <Badge variant="default" className="ml-0.5 px-1.5">
              {active}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(40rem,95vw)] p-3">
        <div className="space-y-2">
          <p className="text-sm font-medium">Filtros</p>
          {filters.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Sin filtros. Se muestran todos los registros.
            </p>
          )}
          {filters.map((filter, index) => {
            const column = byKey.get(filter.field)
            return (
              <FilterRow
                key={index}
                index={index}
                filter={filter}
                column={column ?? null}
                columns={columns}
                onChange={(next) => update(index, next)}
                onRemove={() => onChange(filters.filter((_, i) => i !== index))}
              />
            )
          })}
          <div className="flex items-center justify-between pt-1">
            <Button variant="ghost" size="sm" onClick={addFilter}>
              <Plus className="size-4" />
              Agregar filtro
            </Button>
            {filters.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => onChange([])}>
                <X className="size-4" />
                Quitar todos
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function FilterRow({
  index,
  filter,
  column,
  columns,
  onChange,
  onRemove,
}: {
  index: number
  filter: ViewFilter
  column: CrmColumn | null
  columns: Array<CrmColumn>
  onChange: (filter: ViewFilter) => void
  onRemove: () => void
}) {
  const ops = column ? OPS_BY_TYPE[column.type] : []
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2">
      <Select
        value={column ? filter.field : undefined}
        onValueChange={(key) => {
          const next = columns.find((c) => c.key === key)
          if (!next) return
          const op = OPS_BY_TYPE[next.type][0]
          onChange({ field: key, op, value: defaultFilterValue(next, op) })
        }}
      >
        <SelectTrigger
          size="sm"
          className="w-40"
          aria-label={`Campo del filtro ${index + 1}`}
        >
          <SelectValue placeholder="Campo borrado" />
        </SelectTrigger>
        <SelectContent>
          {columns.map((c) => (
            <SelectItem key={c.key} value={c.key}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {column && (
        <Select
          value={filter.op}
          onValueChange={(op) => {
            const nextOp = op as FilterOp
            // Keep the value when it still fits the new operator.
            const keep =
              opNeedsValue(nextOp) &&
              opNeedsValue(filter.op) &&
              filter.value !== undefined
            onChange({
              ...filter,
              op: nextOp,
              value: keep ? filter.value : defaultFilterValue(column, nextOp),
            })
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-40"
            aria-label={`Condición del filtro ${index + 1}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ops.map((op) => (
              <SelectItem key={op} value={op}>
                {opLabel(op, column.type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {column && opNeedsValue(filter.op) && (
        <div className="min-w-40 flex-1">
          <FilterValueInput
            index={index}
            column={column}
            value={filter.value}
            onChange={(value) => onChange({ ...filter, value })}
          />
        </div>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="size-8 ml-auto"
        onClick={onRemove}
        aria-label={`Quitar filtro ${index + 1}`}
      >
        <X className="size-4" />
      </Button>
    </div>
  )
}

function FilterValueInput({
  index,
  column,
  value,
  onChange,
}: {
  index: number
  column: CrmColumn
  value: unknown
  onChange: (value: unknown) => void
}) {
  const [open, setOpen] = useState(false)
  const label = `Valor del filtro ${index + 1}`
  switch (column.type) {
    case 'checkbox':
      return (
        <Select
          value={value === false ? 'false' : 'true'}
          onValueChange={(v) => onChange(v === 'true')}
        >
          <SelectTrigger size="sm" className="w-full" aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">marcado</SelectItem>
            <SelectItem value="false">sin marcar</SelectItem>
          </SelectContent>
        </Select>
      )
    case 'singleSelect':
    case 'multiSelect': {
      if (!column.def) return null
      const list = Array.isArray(value) ? value.map(String) : []
      return (
        <TagPicker
          def={column.def}
          multi
          value={list}
          onChange={(next) => onChange(Array.isArray(next) ? next : [])}
          open={open}
          onOpenChange={setOpen}
        >
          <button
            type="button"
            aria-label={label}
            className="flex min-h-8 w-full items-center gap-1 rounded-md border bg-background px-2 py-1 text-left text-sm hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {isEmptyValue(list) ? (
              <span className="text-muted-foreground">Elegir opciones…</span>
            ) : (
              <ValueDisplay column={column} value={list} wrap />
            )}
            <ChevronDown className="ml-auto size-4 shrink-0 opacity-50" />
          </button>
        </TagPicker>
      )
    }
    case 'date':
      return (
        <Input
          type="date"
          className="h-8"
          aria-label={label}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'number':
      return (
        <Input
          type="number"
          className="h-8"
          aria-label={label}
          value={
            typeof value === 'string' || typeof value === 'number' ? value : ''
          }
          onChange={(e) => onChange(e.target.value)}
        />
      )
    default:
      return (
        <Input
          className="h-8"
          aria-label={label}
          placeholder="Texto…"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}

// ── Sort ─────────────────────────────────────────────────────────────────

export function SortPopover({
  columns,
  sort,
  onChange,
}: {
  columns: Array<CrmColumn>
  sort: Array<ViewSort>
  onChange: (sort: Array<ViewSort>) => void
}) {
  const unused = columns.filter((c) => !sort.some((s) => s.field === c.key))
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant={sort.length ? 'secondary' : 'outline'} size="sm">
          <ArrowDownUp className="size-4" />
          Ordenar
          {sort.length > 0 && (
            <Badge variant="default" className="ml-0.5 px-1.5">
              {sort.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(26rem,95vw)] p-3">
        <div className="space-y-2">
          <p className="text-sm font-medium">Orden</p>
          {sort.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Sin orden. También podés hacer clic en el encabezado de una
              columna.
            </p>
          )}
          {sort.map((rule, index) => (
            <div key={rule.field} className="flex items-center gap-2">
              <Select
                value={rule.field}
                onValueChange={(field) =>
                  onChange(
                    sort.map((s, i) => (i === index ? { ...s, field } : s)),
                  )
                }
              >
                <SelectTrigger
                  size="sm"
                  className="flex-1"
                  aria-label={`Campo del orden ${index + 1}`}
                >
                  <SelectValue placeholder="Campo borrado" />
                </SelectTrigger>
                <SelectContent>
                  {columns
                    .filter(
                      (c) =>
                        c.key === rule.field ||
                        !sort.some((s) => s.field === c.key),
                    )
                    .map((c) => (
                      <SelectItem key={c.key} value={c.key}>
                        {c.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Select
                value={rule.dir}
                onValueChange={(dir) =>
                  onChange(
                    sort.map((s, i) =>
                      i === index ? { ...s, dir: dir as 'asc' | 'desc' } : s,
                    ),
                  )
                }
              >
                <SelectTrigger
                  size="sm"
                  className="w-36"
                  aria-label={`Dirección del orden ${index + 1}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="asc">Ascendente</SelectItem>
                  <SelectItem value="desc">Descendente</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => onChange(sort.filter((_, i) => i !== index))}
                aria-label={`Quitar orden ${index + 1}`}
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
          {unused.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange([...sort, { field: unused[0].key, dir: 'asc' }])
              }
            >
              <Plus className="size-4" />
              Agregar orden
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function SortIcon({ dir }: { dir: 'asc' | 'desc' | null }) {
  if (dir === 'asc') return <ArrowUp className="size-3" aria-hidden />
  if (dir === 'desc') return <ArrowDown className="size-3" aria-hidden />
  return null
}

// ── Group ────────────────────────────────────────────────────────────────

export function GroupSelect({
  columns,
  groupBy,
  onChange,
}: {
  columns: Array<CrmColumn>
  groupBy: string | null
  onChange: (groupBy: string | null) => void
}) {
  const groupable = columns.filter(isGroupable)
  const current = groupable.find((c) => c.key === groupBy)
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant={current ? 'secondary' : 'outline'} size="sm">
          <Layers className="size-4" />
          {current ? `Agrupado: ${current.label}` : 'Agrupar'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-80 w-60 overflow-y-auto"
      >
        <DropdownMenuLabel>Agrupar por</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onChange(null)}>
          <Check
            className={groupBy ? 'opacity-0' : 'opacity-100'}
            aria-hidden
          />
          Sin agrupar
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {groupable.map((c) => (
          <DropdownMenuItem key={c.key} onSelect={() => onChange(c.key)}>
            <Check
              className={groupBy === c.key ? 'opacity-100' : 'opacity-0'}
              aria-hidden
            />
            <span className="truncate">{c.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ── Columns ──────────────────────────────────────────────────────────────

export function ColumnsPopover({
  columns,
  visible,
  onChange,
  onReset,
}: {
  columns: Array<CrmColumn>
  visible: Array<string>
  onChange: (visible: Array<string>) => void
  onReset: () => void
}) {
  const shown = visible
    .map((key) => columns.find((c) => c.key === key))
    .filter((c): c is CrmColumn => !!c)
  const hidden = columns.filter((c) => !visible.includes(c.key))

  const move = (key: string, delta: number) => {
    const i = visible.indexOf(key)
    const j = i + delta
    if (i === -1 || j < 0 || j >= visible.length) return
    const next = [...visible]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 className="size-4" />
          Columnas
          <span className="text-xs text-muted-foreground">
            {shown.length}/{columns.length}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-medium">Columnas visibles</p>
          <Button variant="ghost" size="sm" className="h-7" onClick={onReset}>
            <RotateCcw className="size-3.5" />
            Restablecer
          </Button>
        </div>
        <ul className="max-h-80 overflow-y-auto p-1">
          {shown.map((c, i) => (
            <li
              key={c.key}
              className="flex items-center gap-2 rounded px-2 py-1 hover:bg-accent/50"
            >
              <Checkbox
                id={`col-${c.key}`}
                checked
                disabled={c.key === 'name'}
                onCheckedChange={() =>
                  onChange(visible.filter((k) => k !== c.key))
                }
              />
              <label
                htmlFor={`col-${c.key}`}
                className="flex-1 truncate text-sm"
              >
                {c.label}
              </label>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                disabled={i === 0}
                onClick={() => move(c.key, -1)}
                aria-label={`Mover ${c.label} a la izquierda`}
              >
                <ArrowUp className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                disabled={i === shown.length - 1}
                onClick={() => move(c.key, 1)}
                aria-label={`Mover ${c.label} a la derecha`}
              >
                <ArrowDown className="size-3.5" />
              </Button>
            </li>
          ))}
          {hidden.length > 0 && (
            <li className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
              Ocultas
            </li>
          )}
          {hidden.map((c) => (
            <li
              key={c.key}
              className="flex items-center gap-2 rounded px-2 py-1 hover:bg-accent/50"
            >
              <Checkbox
                id={`col-${c.key}`}
                checked={false}
                onCheckedChange={() => onChange([...visible, c.key])}
              />
              <label
                htmlFor={`col-${c.key}`}
                className="flex-1 truncate text-sm text-muted-foreground"
              >
                {c.label}
              </label>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

// ── Saved views ──────────────────────────────────────────────────────────

export type SavedViewSummary = { _id: string; name: string }

export function ViewsMenu({
  views,
  activeId,
  dirty,
  onApply,
  onSave,
  onSaveAs,
  onDelete,
  onReset,
}: {
  views: Array<SavedViewSummary>
  activeId: string | null
  dirty: boolean
  onApply: (id: string) => void
  onSave: () => void
  onSaveAs: () => void
  onDelete: (id: string) => void
  onReset: () => void
}) {
  const active = views.find((v) => v._id === activeId)
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-56">
          <View className="size-4" />
          <span className="truncate">{active ? active.name : 'Todos'}</span>
          {dirty && (
            <span
              className="size-1.5 shrink-0 rounded-full bg-amber-500"
              aria-label="con cambios sin guardar"
            />
          )}
          <ChevronDown className="size-4 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Vistas compartidas</DropdownMenuLabel>
        <DropdownMenuItem onSelect={onReset}>
          <Check
            className={activeId ? 'opacity-0' : 'opacity-100'}
            aria-hidden
          />
          Todos (sin filtros)
        </DropdownMenuItem>
        <div className="max-h-64 overflow-y-auto">
          {views.map((view) => (
            <div key={view._id} className="flex items-center">
              <DropdownMenuItem
                className="flex-1 min-w-0"
                onSelect={() => onApply(view._id)}
              >
                <Check
                  className={
                    activeId === view._id ? 'opacity-100' : 'opacity-0'
                  }
                  aria-hidden
                />
                <span className="truncate">{view.name}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-muted-foreground focus:text-destructive"
                onSelect={() => onDelete(view._id)}
                aria-label={`Borrar la vista ${view.name}`}
              >
                <Trash2 className="size-3.5" />
              </DropdownMenuItem>
            </div>
          ))}
        </div>
        <DropdownMenuSeparator />
        {active && (
          <DropdownMenuItem disabled={!dirty} onSelect={onSave}>
            <Save className="size-4" />
            Guardar cambios en «{active.name}»
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onSaveAs}>
          <Plus className="size-4" />
          Guardar como vista nueva…
        </DropdownMenuItem>
        {dirty && (
          <DropdownMenuItem
            onSelect={() => (activeId ? onApply(activeId) : onReset())}
          >
            <RotateCcw className="size-4" />
            Descartar cambios
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
