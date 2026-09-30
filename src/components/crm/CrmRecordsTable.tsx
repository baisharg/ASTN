import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import {
  ChevronDown,
  ChevronRight,
  Download,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings2,
  X,
} from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Doc, Id } from '../../../convex/_generated/dataModel'
import type {
  CrmCollection,
  CrmColumn,
  CrmRecord,
  FieldValue,
  RecordGroup,
  ViewFilter,
  ViewState,
} from './fieldValues'
import {
  EMPTY_GROUP_KEY,
  EMPTY_VIEW,
  applyView,
  buildColumns,
  defaultVisibleKeys,
  downloadText,
  groupRecords,
  isGroupable,
  isSelectType,
  readValue,
  sameView,
  searchHaystack,
  toCsv,
} from './fieldValues'
import { OptionTag, TagPicker, ValueDisplay } from './CrmFieldControls'
import {
  ColumnsPopover,
  FilterPopover,
  GroupSelect,
  SortIcon,
  SortPopover,
  ViewsMenu,
} from './CrmViewControls'
import { CrmBulkBar } from './CrmBulkBar'
import { CrmDuplicatesButton } from './CrmMerge'
import { CrmFieldManager } from './CrmFieldManager'
import { useCrmActions } from './useCrmActions'
import { toastError } from '~/components/social-admin/shared'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover'
import { Spinner } from '~/components/ui/spinner'
import { Textarea } from '~/components/ui/textarea'
import { useBusyAction } from '~/lib/use-busy-action'
import { cn } from '~/lib/utils'

const PAGE_SIZE = 200

type SavedView = Doc<'crmViews'>

function viewState(view: SavedView | undefined): ViewState {
  if (!view) return EMPTY_VIEW
  return {
    filters: view.filters as Array<ViewFilter>,
    sort: view.sort,
    columns: view.columns ?? null,
    groupBy: view.groupBy ?? null,
  }
}

function columnWidth(column: CrmColumn): number {
  if (column.key === 'name') return 220
  switch (column.type) {
    case 'longText':
      return 260
    case 'multiSelect':
      return 220
    case 'singleSelect':
      return 170
    case 'checkbox':
      return 96
    case 'date':
      return 124
    case 'number':
      return 110
    case 'url':
    case 'email':
      return 210
    case 'phone':
      return 150
    default:
      return 180
  }
}

const activeViewKey = (orgId: string, collection: string) =>
  `crm-active-view:${orgId}:${collection}`
const legacyViewsKey = (orgId: string, collection: string) =>
  `crm-views:${orgId}:${collection}`

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Storage is a convenience here; ignore quota or privacy-mode errors.
  }
}

type Editing = { id: string; key: string } | null

export function CrmRecordsTable({
  orgId,
  orgSlug,
  collection,
}: {
  orgId: Id<'organizations'>
  orgSlug: string
  collection: CrmCollection
}) {
  const contacts = useQuery(
    api.crm.listContacts,
    collection === 'contacts' ? { orgId } : 'skip',
  )
  const organizations = useQuery(
    api.crm.listOrganizations,
    collection === 'organizations' ? { orgId } : 'skip',
  )
  const records = (collection === 'contacts' ? contacts : organizations) as
    | Array<CrmRecord>
    | undefined
  const defs = useQuery(api.contacts.records.listFields, { orgId, collection })
  const views = useQuery(api.contacts.people.listViews, {
    orgId,
    collection,
  }) as Array<SavedView> | undefined

  const saveViewMutation = useMutation(api.contacts.people.saveView)
  const deleteViewMutation = useMutation(api.contacts.people.deleteView)
  const linkAccounts = useMutation(api.contacts.people.linkAccounts)
  const { save, createOption } = useCrmActions(orgId, collection)
  const { busy, run } = useBusyAction<'link' | 'saveView'>()

  const [view, setView] = useState<ViewState>(EMPTY_VIEW)
  const [activeViewId, setActiveViewId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [editing, setEditing] = useState<Editing>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [fieldsOpen, setFieldsOpen] = useState(false)
  const [saveAsName, setSaveAsName] = useState<string | null>(null)
  const [newRecordOpen, setNewRecordOpen] = useState(false)

  const columns = useMemo(
    () => buildColumns(collection, defs ?? []),
    [collection, defs],
  )
  const columnsByKey = useMemo(
    () => new Map(columns.map((c) => [c.key, c])),
    [columns],
  )
  const visibleKeys = useMemo(() => {
    const keys = view.columns ?? defaultVisibleKeys(columns)
    return keys.filter((k) => columnsByKey.has(k))
  }, [view.columns, columns, columnsByKey])
  const visibleColumns = useMemo(
    () => visibleKeys.map((k) => columnsByKey.get(k) as CrmColumn),
    [visibleKeys, columnsByKey],
  )

  const haystacks = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of records ?? []) map.set(r._id, searchHaystack(r, columns))
    return map
  }, [records, columns])

  const filtered = useMemo(
    () => applyView(records ?? [], view, columnsByKey, search, haystacks),
    [records, view, columnsByKey, search, haystacks],
  )

  const groupColumn = view.groupBy ? columnsByKey.get(view.groupBy) : undefined
  const groups = useMemo(
    () =>
      groupColumn && isGroupable(groupColumn)
        ? groupRecords(filtered, groupColumn)
        : null,
    [filtered, groupColumn],
  )

  const activeView = views?.find((v) => v._id === activeViewId)
  const dirty = !sameView(view, viewState(activeView))

  // Selection only ever holds records that still exist.
  const recordIds = useMemo(
    () => new Set((records ?? []).map((r) => r._id as string)),
    [records],
  )
  const selectedIds = useMemo(
    () => [...selected].filter((id) => recordIds.has(id)),
    [selected, recordIds],
  )

  // ── Views: restore last active, migrate old localStorage views ──────
  const restoredRef = useRef(false)
  useEffect(() => {
    if (!views || restoredRef.current) return
    restoredRef.current = true
    const last = readStorage(activeViewKey(orgId, collection))
    const found = views.find((v) => v._id === last)
    if (found) {
      setActiveViewId(found._id)
      setView(viewState(found))
    }
  }, [views, orgId, collection])

  const migratedRef = useRef(false)
  useEffect(() => {
    if (!views || !defs?.length || migratedRef.current) return
    migratedRef.current = true
    const key = legacyViewsKey(orgId, collection)
    const raw = readStorage(key)
    if (!raw) return
    writeStorage(key, null)
    let legacy: Array<{
      name?: string
      hiddenColumns?: Array<string>
      filters?: Record<string, string>
      sortKey?: string | null
      sortDir?: 'asc' | 'desc' | null
    }> = []
    try {
      legacy = JSON.parse(raw)
    } catch {
      return
    }
    const cols = buildColumns(collection, defs)
    const byKey = new Map(cols.map((c) => [c.key, c]))
    const taken = new Set(views.map((v) => v.name))
    const work = legacy
      .filter((l) => l.name && !taken.has(l.name))
      .map((l) => {
        const filters: Array<ViewFilter> = []
        for (const [field, value] of Object.entries(l.filters ?? {})) {
          const column = byKey.get(field)
          if (!column || !value.trim()) continue
          if (column.type === 'singleSelect') {
            filters.push({ field, op: 'is', value: [value] })
          } else if (column.type === 'multiSelect') {
            filters.push({ field, op: 'hasAny', value: [value] })
          } else if (column.type === 'checkbox') {
            filters.push({ field, op: 'is', value: value === 'Yes' })
          } else {
            filters.push({ field, op: 'contains', value })
          }
        }
        const hidden = new Set(l.hiddenColumns ?? [])
        return saveViewMutation({
          orgId,
          collection,
          name: l.name as string,
          filters,
          sort:
            l.sortKey && l.sortDir && byKey.has(l.sortKey)
              ? [{ field: l.sortKey, dir: l.sortDir }]
              : [],
          columns: hidden.size
            ? cols.map((c) => c.key).filter((k) => !hidden.has(k))
            : undefined,
        })
      })
    if (work.length) {
      Promise.all(work)
        .then(() =>
          toast.success(
            `Tus vistas guardadas se pasaron a vistas compartidas (${work.length})`,
          ),
        )
        .catch(toastError('No se pudieron migrar tus vistas guardadas'))
    }
  }, [views, defs, orgId, collection, saveViewMutation])

  const applySavedView = useCallback(
    (id: string | null) => {
      const found = views?.find((v) => v._id === id)
      setActiveViewId(found ? found._id : null)
      setView(viewState(found))
      setLimit(PAGE_SIZE)
      writeStorage(activeViewKey(orgId, collection), found ? found._id : null)
    },
    [views, orgId, collection],
  )

  const persistView = (viewId: string | undefined, name: string) =>
    run(
      'saveView',
      async () => {
        const id = await saveViewMutation({
          orgId,
          collection,
          viewId: viewId as Id<'crmViews'> | undefined,
          name,
          filters: view.filters.map((f) => ({
            field: f.field,
            op: f.op,
            value: f.value,
          })),
          sort: view.sort,
          columns: view.columns ?? undefined,
          groupBy: view.groupBy ?? undefined,
        })
        setActiveViewId(id)
        writeStorage(activeViewKey(orgId, collection), id)
        setSaveAsName(null)
        toast.success(`Vista «${name}» guardada`)
      },
      toastError('No se pudo guardar la vista'),
    )

  const removeView = (id: string) => {
    const name = views?.find((v) => v._id === id)?.name ?? ''
    deleteViewMutation({ orgId, viewId: id as Id<'crmViews'> })
      .then(() => {
        if (activeViewId === id) applySavedView(null)
        toast.success(`Vista «${name}» borrada`)
      })
      .catch(toastError('No se pudo borrar la vista'))
  }

  const patchView = (patch: Partial<ViewState>) =>
    setView((prev) => ({ ...prev, ...patch }))

  // ── Editing ───────────────────────────────────────────────────────────
  const stopEdit = useCallback((focus?: { id: string; key: string }) => {
    setEditing(null)
    if (focus) {
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(
            `[data-cell="${CSS.escape(`${focus.id}:${focus.key}`)}"]`,
          )
          ?.focus()
      })
    }
  }, [])

  const saveCell = useCallback(
    (record: CrmRecord, column: CrmColumn, value: FieldValue) =>
      // Tag toggles and checkboxes are one click to revert; text edits
      // get an undo.
      save(record, column, value, {
        undo: !isSelectType(column.type) && column.type !== 'checkbox',
      }),
    [save],
  )

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r._id))
  const someFilteredSelected = filtered.some((r) => selected.has(r._id))

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) for (const r of filtered) next.delete(r._id)
      else for (const r of filtered) next.add(r._id)
      return next
    })
  }

  const headerSort = (key: string) => {
    const current = view.sort.length === 1 && view.sort[0].field === key
    const dir = current ? view.sort[0].dir : null
    patchView({
      sort:
        dir === null
          ? [{ field: key, dir: 'asc' }]
          : dir === 'asc'
            ? [{ field: key, dir: 'desc' }]
            : [],
    })
  }

  const exportCsv = () => {
    const name = activeView?.name ?? 'todos'
    const slug = name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .toLowerCase()
    downloadText(
      toCsv(filtered, visibleColumns),
      `${orgSlug}-${collection}-${slug}.csv`,
      'text/csv;charset=utf-8;',
    )
  }

  const runLinkAccounts = () =>
    run(
      'link',
      async () => {
        const n = await linkAccounts({ orgId })
        toast.success(
          n === 0
            ? 'No había contactos nuevos para vincular'
            : `Se vincularon ${n} ${n === 1 ? 'contacto' : 'contactos'} con su cuenta`,
        )
      },
      toastError('No se pudieron vincular las cuentas'),
    )

  // ── Rows to render (groups flattened, capped) ─────────────────────────
  type Item =
    | { kind: 'group'; group: RecordGroup<CrmRecord> }
    | { kind: 'row'; record: CrmRecord; groupKey: string }
  const items = useMemo(() => {
    const out: Array<Item> = []
    if (groups) {
      for (const group of groups) {
        out.push({ kind: 'group', group })
        if (collapsed.has(group.key)) continue
        for (const record of group.records) {
          out.push({ kind: 'row', record, groupKey: group.key })
        }
      }
    } else {
      for (const record of filtered) {
        out.push({ kind: 'row', record, groupKey: '' })
      }
    }
    return out
  }, [groups, filtered, collapsed])

  if (records === undefined || defs === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-8" />
      </div>
    )
  }

  const shown = items.slice(0, limit)
  const colSpan = visibleColumns.length + 1
  const noun =
    collection === 'contacts'
      ? ['contacto', 'contactos']
      : ['organización', 'organizaciones']
  const filterable = columns

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search
            className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            placeholder={`Buscar ${noun[1]}…`}
            aria-label={`Buscar ${noun[1]}`}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setLimit(PAGE_SIZE)
            }}
            className="h-8 pl-8 pr-8"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Borrar búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <ViewsMenu
          views={views ?? []}
          activeId={activeViewId}
          dirty={dirty}
          onApply={applySavedView}
          onReset={() => applySavedView(null)}
          onSave={() =>
            activeView && void persistView(activeView._id, activeView.name)
          }
          onSaveAs={() => setSaveAsName('')}
          onDelete={removeView}
        />
        <FilterPopover
          columns={filterable}
          filters={view.filters}
          onChange={(filters) => {
            patchView({ filters })
            setLimit(PAGE_SIZE)
          }}
        />
        <SortPopover
          columns={columns}
          sort={view.sort}
          onChange={(sort) => patchView({ sort })}
        />
        <GroupSelect
          columns={columns}
          groupBy={view.groupBy}
          onChange={(groupBy) => {
            patchView({ groupBy })
            setCollapsed(new Set())
          }}
        />
        <ColumnsPopover
          columns={columns}
          visible={visibleKeys}
          onChange={(keys) => patchView({ columns: keys })}
          onReset={() => patchView({ columns: null })}
        />
        <Button variant="outline" size="sm" onClick={() => setFieldsOpen(true)}>
          <Settings2 className="size-4" />
          Campos
        </Button>
        {collection === 'contacts' && (
          <CrmDuplicatesButton orgId={orgId} orgSlug={orgSlug} />
        )}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" aria-label="Más acciones">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={exportCsv}>
              <Download className="size-4" />
              Exportar esta vista (CSV)
            </DropdownMenuItem>
            {collection === 'contacts' && (
              <DropdownMenuItem
                disabled={busy === 'link'}
                onSelect={() => void runLinkAccounts()}
              >
                <Link2 className="size-4" />
                Vincular cuentas por email
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() => setNewRecordOpen(true)}
        >
          <Plus className="size-4" />
          {collection === 'contacts' ? 'Nuevo contacto' : 'Nueva organización'}
        </Button>
      </div>

      {selectedIds.length > 0 && (
        <CrmBulkBar
          orgId={orgId}
          orgSlug={orgSlug}
          collection={collection}
          ids={selectedIds}
          columns={columns}
          onClear={() => setSelected(new Set())}
        />
      )}

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {filtered.length === records.length
          ? `${records.length} ${records.length === 1 ? noun[0] : noun[1]}`
          : `${filtered.length} de ${records.length} ${noun[1]}`}
        {groups && ` · ${groups.length} grupos`}
      </p>

      {/* Table */}
      <div className="max-h-[70vh] overflow-auto rounded-lg border bg-background">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-20 bg-slate-50">
            <tr>
              <th className="sticky left-0 z-10 w-10 border-b bg-slate-50 px-3 py-2">
                <Checkbox
                  aria-label="Seleccionar todos los visibles"
                  checked={
                    allFilteredSelected
                      ? true
                      : someFilteredSelected
                        ? 'indeterminate'
                        : false
                  }
                  onCheckedChange={toggleAll}
                />
              </th>
              {visibleColumns.map((column, i) => {
                const sortRule =
                  view.sort.length > 0 && view.sort[0].field === column.key
                    ? view.sort[0].dir
                    : null
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={
                      sortRule === 'asc'
                        ? 'ascending'
                        : sortRule === 'desc'
                          ? 'descending'
                          : undefined
                    }
                    style={{
                      minWidth: columnWidth(column),
                      maxWidth: columnWidth(column) + 80,
                    }}
                    className={cn(
                      'border-b px-3 py-2 text-left font-medium text-muted-foreground',
                      i === 0 &&
                        column.key === 'name' &&
                        'sticky left-10 z-10 bg-slate-50',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => headerSort(column.key)}
                      className="inline-flex max-w-full items-center gap-1 whitespace-nowrap hover:text-foreground"
                      title={`Ordenar por ${column.label}`}
                    >
                      <span className="truncate">{column.label}</span>
                      <SortIcon dir={sortRule} />
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td
                  colSpan={colSpan}
                  className="py-12 text-center text-muted-foreground"
                >
                  {records.length === 0
                    ? `Todavía no hay ${noun[1]}. Importá un Excel o creá uno.`
                    : 'Ningún registro coincide con la búsqueda y los filtros.'}
                </td>
              </tr>
            )}
            {shown.map((item) =>
              item.kind === 'group' ? (
                <GroupHeader
                  key={`g:${item.group.key}`}
                  group={item.group}
                  colSpan={colSpan}
                  collapsed={collapsed.has(item.group.key)}
                  isCheckbox={groupColumn?.type === 'checkbox'}
                  onToggle={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev)
                      if (next.has(item.group.key)) next.delete(item.group.key)
                      else next.add(item.group.key)
                      return next
                    })
                  }
                />
              ) : (
                <Row
                  key={`${item.groupKey}:${item.record._id}`}
                  record={item.record}
                  columns={visibleColumns}
                  selected={selected.has(item.record._id)}
                  editingKey={
                    editing?.id === item.record._id ? editing.key : null
                  }
                  personSlug={collection === 'contacts' ? orgSlug : null}
                  onToggleSelect={toggleSelect}
                  onStartEdit={setEditing}
                  onStopEdit={stopEdit}
                  onSave={saveCell}
                  onCreateOption={createOption}
                />
              ),
            )}
          </tbody>
        </table>
      </div>
      {items.length > limit && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLimit((l) => l + PAGE_SIZE)}
          >
            Mostrar más ({items.length - limit} filas restantes)
          </Button>
        </div>
      )}

      <CrmFieldManager
        open={fieldsOpen}
        onOpenChange={setFieldsOpen}
        orgId={orgId}
        collection={collection}
        defs={defs}
      />

      <Dialog
        open={saveAsName !== null}
        onOpenChange={(open) => !open && setSaveAsName(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Guardar vista</DialogTitle>
            <DialogDescription>
              Las vistas son compartidas: las ven todos los admins de la
              organización. Guardan filtros, orden, agrupación y columnas.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const name = saveAsName?.trim()
              if (name) void persistView(undefined, name)
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="view-name">Nombre</Label>
              <Input
                id="view-name"
                autoFocus
                value={saveAsName ?? ''}
                onChange={(e) => setSaveAsName(e.target.value)}
                placeholder="Ej.: Core en Buenos Aires"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSaveAsName(null)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={!saveAsName?.trim() || busy === 'saveView'}
              >
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <NewRecordDialog
        open={newRecordOpen}
        onOpenChange={setNewRecordOpen}
        orgId={orgId}
        orgSlug={orgSlug}
        collection={collection}
      />
    </div>
  )
}

// ── Group header ─────────────────────────────────────────────────────────

function GroupHeader({
  group,
  colSpan,
  collapsed,
  isCheckbox,
  onToggle,
}: {
  group: RecordGroup<CrmRecord>
  colSpan: number
  collapsed: boolean
  isCheckbox: boolean
  onToggle: () => void
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="border-b bg-slate-50/70 px-2 py-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="sticky left-2 inline-flex items-center gap-2 text-sm font-medium"
        >
          {collapsed ? (
            <ChevronRight className="size-4" aria-hidden />
          ) : (
            <ChevronDown className="size-4" aria-hidden />
          )}
          {group.key === EMPTY_GROUP_KEY || isCheckbox ? (
            <span
              className={
                group.key === EMPTY_GROUP_KEY ? 'text-muted-foreground' : ''
              }
            >
              {group.label}
            </span>
          ) : (
            <OptionTag value={group.label} color={group.color} />
          )}
          <span className="text-xs font-normal text-muted-foreground">
            {group.records.length}
          </span>
        </button>
      </td>
    </tr>
  )
}

// ── Row ──────────────────────────────────────────────────────────────────

type RowProps = {
  record: CrmRecord
  columns: Array<CrmColumn>
  selected: boolean
  editingKey: string | null
  personSlug: string | null
  onToggleSelect: (id: string) => void
  onStartEdit: (editing: Editing) => void
  onStopEdit: (focus?: { id: string; key: string }) => void
  onSave: (
    record: CrmRecord,
    column: CrmColumn,
    value: FieldValue,
  ) => Promise<boolean>
  onCreateOption: (
    def: NonNullable<CrmColumn['def']>,
    value: string,
  ) => Promise<boolean>
}

const Row = memo(function Row({
  record,
  columns,
  selected,
  editingKey,
  personSlug,
  onToggleSelect,
  onStartEdit,
  onStopEdit,
  onSave,
  onCreateOption,
}: RowProps) {
  return (
    <tr
      className={cn(
        'group/row',
        selected ? 'bg-primary/5' : 'hover:bg-slate-50',
      )}
    >
      <td
        className={cn(
          'sticky left-0 z-[1] border-b px-3 py-1.5 align-top',
          selected ? 'bg-blue-50' : 'bg-background group-hover/row:bg-slate-50',
        )}
      >
        <Checkbox
          aria-label={`Seleccionar ${record.name}`}
          checked={selected}
          onCheckedChange={() => onToggleSelect(record._id)}
          className="mt-0.5"
        />
      </td>
      {columns.map((column, i) => (
        <td
          key={column.key}
          style={{
            minWidth: columnWidth(column),
            maxWidth: columnWidth(column) + 80,
          }}
          className={cn(
            'border-b px-3 py-1.5 align-top',
            i === 0 &&
              column.key === 'name' &&
              cn(
                'sticky left-10 z-[1]',
                selected
                  ? 'bg-blue-50'
                  : 'bg-background group-hover/row:bg-slate-50',
              ),
          )}
        >
          <Cell
            record={record}
            column={column}
            editing={editingKey === column.key}
            personHref={
              column.key === 'name' && personSlug
                ? { slug: personSlug, contactId: record._id }
                : null
            }
            onStartEdit={() => onStartEdit({ id: record._id, key: column.key })}
            onStopEdit={(refocus) =>
              onStopEdit(
                refocus ? { id: record._id, key: column.key } : undefined,
              )
            }
            onSave={(value) => onSave(record, column, value)}
            onCreateOption={
              column.def
                ? (value) =>
                    onCreateOption(
                      column.def as NonNullable<CrmColumn['def']>,
                      value,
                    )
                : undefined
            }
          />
        </td>
      ))}
    </tr>
  )
})

// ── Cell ─────────────────────────────────────────────────────────────────

function Cell({
  record,
  column,
  editing,
  personHref,
  onStartEdit,
  onStopEdit,
  onSave,
  onCreateOption,
}: {
  record: CrmRecord
  column: CrmColumn
  editing: boolean
  personHref: { slug: string; contactId: string } | null
  onStartEdit: () => void
  onStopEdit: (refocus: boolean) => void
  onSave: (value: FieldValue) => Promise<boolean>
  onCreateOption?: (value: string) => Promise<boolean>
}) {
  const value = readValue(record, column)
  const cellId = `${record._id}:${column.key}`

  if (column.type === 'checkbox') {
    return (
      <Checkbox
        data-cell={cellId}
        aria-label={`${column.label} de ${record.name}`}
        checked={value === true}
        onCheckedChange={(checked) => void onSave(checked === true)}
        className="mt-0.5"
      />
    )
  }

  const editButton = (
    <button
      type="button"
      data-cell={cellId}
      onClick={onStartEdit}
      aria-label={`Editar ${column.label} de ${record.name}`}
      className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/cell:opacity-100"
    >
      <Pencil className="size-3" />
    </button>
  )

  const display =
    personHref && typeof value === 'string' ? (
      <Link
        to="/org/$slug/admin/crm/people/$contactId"
        params={personHref}
        className="truncate font-medium text-foreground hover:underline"
        title={value}
      >
        {value}
      </Link>
    ) : (
      <ValueDisplay column={column} value={value} />
    )

  if (
    editing &&
    (column.type === 'singleSelect' || column.type === 'multiSelect') &&
    column.def
  ) {
    return (
      <TagPicker
        def={column.def}
        multi={column.type === 'multiSelect'}
        value={value}
        onChange={(next) => void onSave(next)}
        onCreateOption={onCreateOption}
        open
        onOpenChange={(open) => !open && onStopEdit(true)}
        align="start"
      >
        <div className="flex min-h-6 min-w-0 items-center gap-1">{display}</div>
      </TagPicker>
    )
  }

  if (editing && column.type === 'longText') {
    return (
      <LongTextEditor
        label={column.label}
        initial={typeof value === 'string' ? value : ''}
        onDone={async (next) => {
          if (next !== null) await onSave(next)
          onStopEdit(true)
        }}
      >
        <div className="flex min-h-6 min-w-0 items-center gap-1">{display}</div>
      </LongTextEditor>
    )
  }

  if (editing) {
    return (
      <InlineInput
        column={column}
        initial={value}
        onDone={async (next) => {
          if (next !== undefined) await onSave(next)
          onStopEdit(true)
        }}
      />
    )
  }

  return (
    <div
      className="group/cell flex min-h-6 min-w-0 items-center gap-1"
      onDoubleClick={onStartEdit}
    >
      {display}
      {editButton}
    </div>
  )
}

function InlineInput({
  column,
  initial,
  onDone,
}: {
  column: CrmColumn
  initial: FieldValue
  onDone: (value: FieldValue | undefined) => void
}) {
  const text =
    initial === null || typeof initial === 'boolean' || Array.isArray(initial)
      ? ''
      : String(initial)
  const [draft, setDraft] = useState(text)
  const finished = useRef(false)

  const finish = (commit: boolean) => {
    if (finished.current) return
    finished.current = true
    if (!commit || draft === text) return onDone(undefined)
    if (column.type === 'number') {
      const raw = draft.trim()
      const n = Number(raw)
      if (raw && !Number.isFinite(n)) return onDone(undefined)
      return onDone(raw ? n : null)
    }
    if (column.type === 'date') return onDone(draft || null)
    return onDone(draft)
  }

  return (
    <Input
      autoFocus
      aria-label={column.label}
      type={
        column.type === 'number'
          ? 'number'
          : column.type === 'date'
            ? 'date'
            : column.type === 'email'
              ? 'email'
              : 'text'
      }
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finish(false)
        }
      }}
      onBlur={() => finish(true)}
      className="h-7 text-sm"
    />
  )
}

function LongTextEditor({
  label,
  initial,
  onDone,
  children,
}: {
  label: string
  initial: string
  onDone: (value: string | null) => void
  children: React.ReactNode
}) {
  const [draft, setDraft] = useState(initial)
  const finished = useRef(false)
  const finish = (commit: boolean) => {
    if (finished.current) return
    finished.current = true
    onDone(commit && draft !== initial ? draft : null)
  }
  return (
    <Popover open onOpenChange={(open) => !open && finish(true)}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-96 space-y-2 p-2">
        <Textarea
          autoFocus
          aria-label={label}
          value={draft}
          rows={6}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              finish(true)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              finish(false)
            }
          }}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            ⌘/Ctrl + Enter para guardar
          </span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => finish(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={() => finish(true)}>
              Guardar
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ── New record ───────────────────────────────────────────────────────────

function NewRecordDialog({
  open,
  onOpenChange,
  orgId,
  orgSlug,
  collection,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: Id<'organizations'>
  orgSlug: string
  collection: CrmCollection
}) {
  const createContact = useMutation(api.crm.createContactWithFields)
  const createOrganization = useMutation(api.crm.createOrganizationWithFields)
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const { busy, run } = useBusyAction<'create'>()
  const isContact = collection === 'contacts'

  const submit = () =>
    run(
      'create',
      async () => {
        if (isContact) {
          const id = await createContact({
            orgId,
            fields: { name: name.trim(), email: email.trim() || undefined },
          })
          onOpenChange(false)
          void navigate({
            to: '/org/$slug/admin/crm/people/$contactId',
            params: { slug: orgSlug, contactId: id },
          })
        } else {
          await createOrganization({ orgId, fields: { name: name.trim() } })
          toast.success(`Se creó «${name.trim()}»`)
          onOpenChange(false)
        }
        setName('')
        setEmail('')
      },
      toastError('No se pudo crear'),
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isContact ? 'Nuevo contacto' : 'Nueva organización'}
          </DialogTitle>
          {isContact && (
            <DialogDescription>
              Después vas a poder completar el resto en su ficha.
            </DialogDescription>
          )}
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) void submit()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="new-record-name">Nombre</Label>
            <Input
              id="new-record-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {isContact && (
            <div className="space-y-1.5">
              <Label htmlFor="new-record-email">Email (opcional)</Label>
              <Input
                id="new-record-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!name.trim() || busy === 'create'}>
              Crear
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
