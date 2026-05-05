import { useMutation, useQuery } from 'convex/react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Columns3,
  EyeOff,
  Filter,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  View,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
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
import { Spinner } from '~/components/ui/spinner'
import { Textarea } from '~/components/ui/textarea'

type Collection = 'contacts' | 'organizations' | 'opportunities' | 'submissions'

// Columns config per collection — order determines display order
const COLUMN_CONFIG: Record<Collection, { key: string; label: string }[]> = {
  contacts: [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'relationship', label: 'Relationship' },
    { key: 'role', label: 'Role' },
    { key: 'title', label: 'Title' },
    { key: 'professionalField', label: 'Professional field' },
    { key: 'careerStage', label: 'Career stage' },
    { key: 'aiSafetyExperience', label: 'AI Safety exp.' },
    { key: 'skills', label: 'Skills' },
    { key: 'interests', label: 'Interests' },
    { key: 'availability', label: 'Availability' },
    { key: 'location', label: 'Location' },
    { key: 'inBuenosAires', label: 'In Buenos Aires' },
    { key: 'linkedin', label: 'LinkedIn' },
    { key: 'website', label: 'Website' },
    { key: 'contactSource', label: 'Contact source' },
    { key: 'contactPerson', label: 'Contact person' },
    { key: 'firstContact', label: 'First contact' },
    { key: 'associatedOrganizations', label: 'Orgs' },
    { key: 'participatedIn', label: 'Participated in' },
    { key: 'notes', label: 'Notes' },
  ],
  organizations: [
    { key: 'name', label: 'Name' },
    { key: 'description', label: 'Description' },
    { key: 'keyPeople', label: 'Key people' },
    { key: 'type', label: 'Type' },
    { key: 'aiStance', label: 'AI stance' },
    { key: 'mainTopic', label: 'Main topic' },
    { key: 'notes', label: 'Notes' },
    { key: 'autoSummary', label: 'Summary' },
  ],
  opportunities: [
    { key: 'title', label: 'Title' },
    { key: 'organization', label: 'Organization' },
    { key: 'location', label: 'Location' },
    { key: 'type', label: 'Type' },
    { key: 'category', label: 'Category' },
    { key: 'date', label: 'Date' },
    { key: 'status', label: 'Status' },
    { key: 'source', label: 'Source' },
  ],
  submissions: [
    { key: 'participant', label: 'Participant' },
    { key: 'period', label: 'Period' },
    { key: 'source', label: 'Source' },
  ],
}

interface CrmTableProps {
  orgId: Id<'organizations'>
  collection: Collection
}

type SortDir = 'asc' | 'desc' | null

interface SavedView {
  id: string
  name: string
  hiddenColumns: string[]
  filters: Record<string, string>
  sortKey: string | null
  sortDir: SortDir
}

const viewsStorageKey = (orgId: string, collection: Collection) =>
  `crm-views:${orgId}:${collection}`

// Submissions store dynamic columns under `record.data.*`; column keys for
// those use a `data.<headerKey>` prefix. Filter, sort, chip-count, and
// hidden-empty-columns logic all need this same lookup.
function readField(record: any, field: string): any {
  return field.startsWith('data.')
    ? record.data?.[field.slice(5)]
    : record[field]
}

// Hoisted so the sort comparator doesn't allocate options objects per pair.
const SORT_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

export function CrmTable({ orgId, collection }: CrmTableProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const [editingCell, setEditingCell] = useState<{
    id: string
    field: string
  } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([])
  const [filters, setFilters] = useState<Record<string, string>>({})
  // Filter keys whose value should match exactly (case-insensitive) instead
  // of via substring `includes`. Set when a filter is applied programmatically
  // from a chip click or auto-source view, where the displayed metadata
  // (chip count, hidden-empty-columns calculation) is computed under exact-
  // match semantics. Free-text input drops the key from this set so substring
  // semantics resume on edit.
  const [exactFilters, setExactFilters] = useState<Set<string>>(new Set())
  const [showFilters, setShowFilters] = useState(false)
  const [savedViews, setSavedViews] = useState<SavedView[]>([])
  const [activeViewId, setActiveViewId] = useState<string | null>(null)
  // `null` = dialog closed; otherwise the in-progress name from the input.
  const [savingViewName, setSavingViewName] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const raw = localStorage.getItem(viewsStorageKey(orgId, collection))
    if (raw) {
      try {
        setSavedViews(JSON.parse(raw))
      } catch {
        setSavedViews([])
      }
    } else {
      setSavedViews([])
    }
    setActiveViewId(null)
    setHiddenColumns([])
    setFilters({})
    setExactFilters((prev) => (prev.size === 0 ? prev : new Set()))
  }, [orgId, collection])

  const persistViews = useCallback(
    (views: SavedView[]) => {
      // Always update the in-memory state so the session doesn't desync from
      // the dropdown. Persistence is best-effort: incognito quota errors and
      // disabled storage shouldn't kill the save.
      setSavedViews(views)
      try {
        localStorage.setItem(
          viewsStorageKey(orgId, collection),
          JSON.stringify(views),
        )
      } catch (err) {
        console.error('Failed to persist views:', err)
        toast.error('Could not save view to local storage')
      }
    },
    [orgId, collection],
  )

  const clearExactFilters = useCallback(() => {
    setExactFilters((prev) => (prev.size === 0 ? prev : new Set()))
  }, [])

  const applyView = useCallback(
    (view: SavedView) => {
      setHiddenColumns(view.hiddenColumns)
      setFilters(view.filters)
      clearExactFilters()
      setSortKey(view.sortKey)
      setSortDir(view.sortDir)
      setActiveViewId(view.id)
    },
    [clearExactFilters],
  )

  const resetView = useCallback(() => {
    setHiddenColumns([])
    setFilters({})
    clearExactFilters()
    setSortKey(null)
    setSortDir(null)
    setActiveViewId(null)
  }, [clearExactFilters])

  const openSaveViewDialog = useCallback(() => {
    setSavingViewName('')
  }, [])

  const confirmSaveView = useCallback(() => {
    const name = savingViewName?.trim()
    if (!name) return
    const newView: SavedView = {
      id: Math.random().toString(36).slice(2, 10),
      name,
      hiddenColumns,
      filters,
      sortKey,
      sortDir,
    }
    persistViews([...savedViews, newView])
    setActiveViewId(newView.id)
    setSavingViewName(null)
  }, [
    savingViewName,
    hiddenColumns,
    filters,
    sortKey,
    sortDir,
    savedViews,
    persistViews,
  ])

  const deleteView = useCallback(
    (id: string) => {
      persistViews(savedViews.filter((v) => v.id !== id))
      if (activeViewId === id) setActiveViewId(null)
    },
    [savedViews, activeViewId, persistViews],
  )

  const toggleColumn = useCallback((key: string) => {
    setHiddenColumns((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    )
  }, [])

  // Queries — pick the right one based on collection
  const contacts = useQuery(
    api.crm.listContacts,
    collection === 'contacts'
      ? { orgId, searchQuery: searchQuery || undefined }
      : 'skip',
  )
  const organizations = useQuery(
    api.crm.listOrganizations,
    collection === 'organizations'
      ? { orgId, searchQuery: searchQuery || undefined }
      : 'skip',
  )
  const opportunities = useQuery(
    api.crm.listOpportunities,
    collection === 'opportunities'
      ? { orgId, searchQuery: searchQuery || undefined }
      : 'skip',
  )
  const submissions = useQuery(
    api.crm.listSubmissions,
    collection === 'submissions' ? { orgId } : 'skip',
  )

  // Mutations
  const updateContact = useMutation(api.crm.updateContact)
  const updateOrganization = useMutation(api.crm.updateOrganization)
  const updateOpportunity = useMutation(api.crm.updateOpportunity)
  const createEmptyContact = useMutation(api.crm.createEmptyContact)
  const createEmptyOrganization = useMutation(api.crm.createEmptyOrganization)
  const createEmptyOpportunity = useMutation(api.crm.createEmptyOpportunity)
  const deleteContact = useMutation(api.crm.deleteContact)
  const deleteOrganization = useMutation(api.crm.deleteOrganization)
  const deleteOpportunity = useMutation(api.crm.deleteOpportunity)

  const rawData = useMemo(() => {
    switch (collection) {
      case 'contacts':
        return contacts
      case 'organizations':
        return organizations
      case 'opportunities':
        return opportunities
      case 'submissions':
        return submissions
      default:
        return null
    }
  }, [collection, contacts, organizations, opportunities, submissions])

  // Apply client-side filters + sort
  const data = useMemo(() => {
    if (!rawData) return rawData
    let result = rawData as any[]

    const activeFilters = Object.entries(filters).filter(([, v]) => v.trim())
    if (activeFilters.length > 0) {
      result = result.filter((record) =>
        activeFilters.every(([field, needle]) => {
          const value = readField(record, field)
          if (value == null) return false
          const haystack = String(value).toLowerCase()
          const target = needle.toLowerCase()
          return exactFilters.has(field)
            ? haystack === target
            : haystack.includes(target)
        }),
      )
    }

    if (sortKey && sortDir) {
      const dir = sortDir === 'asc' ? 1 : -1
      // Excel imports stringify everything (XLSX `raw: false` + coerce
      // helper), so numeric/date columns live in the DB as strings. Try
      // numeric compare first; fall back to locale-aware string compare with
      // `numeric: true` so `'1c2025'` still beats `'1c2024'`.
      result = [...result].sort((a: any, b: any) => {
        const aRaw = readField(a, sortKey)
        const bRaw = readField(b, sortKey)
        const aNum = Number(aRaw)
        const bNum = Number(bRaw)
        if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
          return dir * (aNum - bNum)
        }
        return (
          dir * SORT_COLLATOR.compare(String(aRaw ?? ''), String(bRaw ?? ''))
        )
      })
    }
    return result
  }, [rawData, sortKey, sortDir, filters, exactFilters])

  // For submissions, dynamically extract column keys from `data`. Derived
  // from `rawData` (not the filtered `data`) so a zero-row filter doesn't
  // collapse the column set and break saved views referencing those keys.
  const allColumns = useMemo(() => {
    if (collection !== 'submissions') return COLUMN_CONFIG[collection]
    const base = COLUMN_CONFIG.submissions
    if (!rawData || rawData.length === 0) return base

    const dataKeys = new Set<string>()
    for (const record of rawData as any[]) {
      if (record.data) {
        for (const key of Object.keys(record.data)) {
          dataKeys.add(key)
        }
      }
    }
    const extraCols = Array.from(dataKeys)
      .sort()
      .map((key) => ({ key: `data.${key}`, label: key }))

    return [...base, ...extraCols]
  }, [collection, rawData])

  const columns = useMemo(
    () => allColumns.filter((col) => !hiddenColumns.includes(col.key)),
    [allColumns, hiddenColumns],
  )

  // Auto-generated views for submissions, one per distinct `source`.
  // Ordered by "recency": parses the most-recent `period` of each source
  // (format "1c2025", "2c2024", etc.) → year*10+semester. Falls back to
  // parsing the source name itself, then to timestamp.
  const distinctSources = useMemo(() => {
    if (collection !== 'submissions' || !rawData) return []
    const parsePeriod = (s: string | undefined): number => {
      if (!s) return 0
      const m = s.match(/(\d)\s*c\s*(\d{4})/i)
      if (m) return parseInt(m[2], 10) * 10 + parseInt(m[1], 10)
      const year = s.match(/(\d{4})/)
      return year ? parseInt(year[1], 10) * 10 : 0
    }
    const rankBySource = new Map<string, number>()
    const tsBySource = new Map<string, number>()
    for (const r of rawData as any[]) {
      if (!r.source || typeof r.source !== 'string') continue
      const rank = Math.max(parsePeriod(r.period), parsePeriod(r.source))
      const prev = rankBySource.get(r.source) ?? 0
      if (rank > prev) rankBySource.set(r.source, rank)
      const ts = r.createdAt ?? r._creationTime ?? 0
      const prevTs = tsBySource.get(r.source) ?? 0
      if (ts > prevTs) tsBySource.set(r.source, ts)
    }
    const sources = Array.from(rankBySource.keys())
    sources.sort((a, b) => {
      const ra = rankBySource.get(a) ?? 0
      const rb = rankBySource.get(b) ?? 0
      if (rb !== ra) return rb - ra
      const ta = tsBySource.get(a) ?? 0
      const tb = tsBySource.get(b) ?? 0
      if (tb !== ta) return tb - ta
      return a.localeCompare(b)
    })
    return sources
  }, [collection, rawData])

  const applySourceView = useCallback(
    (sourceValue: string) => {
      if (!rawData) return
      const filtered = (rawData as any[]).filter(
        (r) => r.source === sourceValue,
      )
      const emptyKeys = allColumns
        .filter((col) => {
          return !filtered.some((record) => {
            const val = readField(record, col.key)
            return val != null && val !== ''
          })
        })
        .map((c) => c.key)
      setFilters({ source: sourceValue })
      // `emptyKeys` was computed over the exact-match subset, so the active
      // filter must use exact match — otherwise substring rows leak in and
      // their populated columns stay hidden.
      setExactFilters(new Set(['source']))
      setHiddenColumns(emptyKeys)
      setSortKey(null)
      setSortDir(null)
      setActiveViewId(`auto-source-${sourceValue}`)
    },
    [rawData, allColumns],
  )

  const hideEmptyColumns = useCallback(() => {
    if (!data || (data as any[]).length === 0) return
    const emptyKeys = allColumns
      .filter((col) => {
        return !(data as any[]).some((record) => {
          const val = readField(record, col.key)
          return val != null && val !== ''
        })
      })
      .map((c) => c.key)
    setHiddenColumns((prev) => Array.from(new Set([...prev, ...emptyKeys])))
  }, [allColumns, data])

  // Distinct values per visible column — for chip-based filter shortcuts.
  // Only show chips if column has a small-to-medium number of distinct values.
  const MAX_DISTINCT_FOR_CHIPS = 20
  const MAX_CHIPS_SHOWN = 12
  const distinctByColumn = useMemo(() => {
    const out: Record<string, { value: string; count: number }[]> = {}
    if (!rawData) return out
    for (const col of columns) {
      const counts = new Map<string, number>()
      for (const record of rawData as any[]) {
        const raw = readField(record, col.key)
        if (raw == null || raw === '') continue
        const str = String(raw)
        counts.set(str, (counts.get(str) ?? 0) + 1)
      }
      if (counts.size === 0 || counts.size > MAX_DISTINCT_FOR_CHIPS) continue
      out[col.key] = Array.from(counts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, MAX_CHIPS_SHOWN)
    }
    return out
  }, [rawData, columns])

  const handleSort = useCallback(
    (key: string) => {
      if (sortKey === key) {
        if (sortDir === 'asc') setSortDir('desc')
        else if (sortDir === 'desc') {
          setSortKey(null)
          setSortDir(null)
        }
      } else {
        setSortKey(key)
        setSortDir('asc')
      }
    },
    [sortKey, sortDir],
  )

  const handleStartEdit = useCallback(
    (id: string, field: string, currentValue: string) => {
      setEditingCell({ id, field })
      setEditValue(currentValue ?? '')
    },
    [],
  )

  const handleSaveEdit = useCallback(async () => {
    if (!editingCell) return
    const { id, field } = editingCell
    // Capture previous value for undo
    const record = (rawData as any[] | null | undefined)?.find(
      (r) => r._id === id,
    )
    const previousValue = record ? record[field] : undefined
    const newValue = editValue
    const unchanged = String(previousValue ?? '') === String(newValue ?? '')

    const runUpdate = async (value: any) => {
      if (collection === 'contacts') {
        await updateContact({
          orgId,
          id: id as Id<'crmContacts'>,
          field,
          value,
        })
      } else if (collection === 'organizations') {
        await updateOrganization({
          orgId,
          id: id as Id<'crmOrganizations'>,
          field,
          value,
        })
      } else if (collection === 'opportunities') {
        await updateOpportunity({
          orgId,
          id: id as Id<'crmOpportunities'>,
          field,
          value,
        })
      }
    }

    try {
      await runUpdate(newValue)
      if (!unchanged) {
        toast.success('Saved', {
          duration: 6000,
          action: {
            label: 'Undo',
            onClick: () => {
              runUpdate(previousValue).catch((e) =>
                console.error('Undo failed:', e),
              )
            },
          },
        })
      }
    } catch (err) {
      console.error('Failed to save:', err)
      toast.error('Failed to save')
    }
    setEditingCell(null)
  }, [
    editingCell,
    editValue,
    collection,
    orgId,
    rawData,
    updateContact,
    updateOrganization,
    updateOpportunity,
  ])

  const handleCancelEdit = useCallback(() => {
    setEditingCell(null)
  }, [])

  const handleDeleteRow = useCallback(
    async (id: string) => {
      try {
        if (collection === 'contacts') {
          await deleteContact({ orgId, id: id as Id<'crmContacts'> })
        } else if (collection === 'organizations') {
          await deleteOrganization({
            orgId,
            id: id as Id<'crmOrganizations'>,
          })
        } else if (collection === 'opportunities') {
          await deleteOpportunity({
            orgId,
            id: id as Id<'crmOpportunities'>,
          })
        }
        toast.success('Deleted')
      } catch (err) {
        console.error('Failed to delete:', err)
        toast.error('Failed to delete')
      }
    },
    [collection, orgId, deleteContact, deleteOrganization, deleteOpportunity],
  )

  const handleAddRow = useCallback(async () => {
    try {
      let newId: string | null = null
      if (collection === 'contacts') {
        newId = await createEmptyContact({ orgId })
      } else if (collection === 'organizations') {
        newId = await createEmptyOrganization({ orgId })
      } else if (collection === 'opportunities') {
        newId = await createEmptyOpportunity({ orgId })
      }
      if (newId) {
        const firstField = collection === 'opportunities' ? 'title' : 'name'
        const defaultValue =
          collection === 'contacts'
            ? 'New contact'
            : collection === 'organizations'
              ? 'New organization'
              : 'New opportunity'
        setEditingCell({ id: newId, field: firstField })
        setEditValue(defaultValue)
      }
    } catch (err) {
      console.error('Failed to add row:', err)
    }
  }, [
    collection,
    orgId,
    createEmptyContact,
    createEmptyOrganization,
    createEmptyOpportunity,
  ])

  const getCellValue = (record: any, key: string): string => {
    if (key.startsWith('data.')) {
      const dataKey = key.slice(5)
      const val = record.data?.[dataKey]
      return val != null ? String(val) : ''
    }
    const val = record[key]
    if (val === true) return 'Yes'
    if (val === false) return 'No'
    return val != null ? String(val) : ''
  }

  if (data === undefined || data === null) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-8" />
      </div>
    )
  }

  const records = data as any[]
  const isEditable = collection !== 'submissions'

  return (
    <div className="space-y-4">
      {/* Toolbar: search + views + columns + filter + new row */}
      <div className="flex items-center gap-2 flex-wrap">
        {collection !== 'submissions' && (
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder={`Search ${collection}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        )}

        {/* Views dropdown */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <View className="size-4 mr-1.5" />
              {activeViewId
                ? (savedViews.find((v) => v.id === activeViewId)?.name ??
                  'View')
                : 'Views'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 p-0">
            <div
              className="p-1 max-h-96 overflow-y-auto"
              onWheel={(e) => e.stopPropagation()}
            >
              <DropdownMenuLabel>Saved views</DropdownMenuLabel>
              {savedViews.length === 0 ? (
                <DropdownMenuItem disabled>No saved views</DropdownMenuItem>
              ) : (
                savedViews.map((view) => (
                  <div
                    key={view.id}
                    className="flex items-center justify-between"
                  >
                    <DropdownMenuItem
                      className="flex-1"
                      onClick={() => applyView(view)}
                    >
                      {view.name}
                      {activeViewId === view.id && (
                        <span className="ml-auto text-xs text-muted-foreground">
                          ●
                        </span>
                      )}
                    </DropdownMenuItem>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteView(view.id)
                      }}
                      className="px-2 text-muted-foreground hover:text-destructive"
                      title="Delete view"
                      aria-label={`Delete view "${view.name}"`}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                ))
              )}
              {distinctSources.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>By source (auto)</DropdownMenuLabel>
                  {distinctSources.map((source) => {
                    const viewId = `auto-source-${source}`
                    return (
                      <DropdownMenuItem
                        key={source}
                        onClick={() => applySourceView(source)}
                      >
                        <span className="truncate">{source}</span>
                        {activeViewId === viewId && (
                          <span className="ml-auto text-xs text-muted-foreground">
                            ●
                          </span>
                        )}
                      </DropdownMenuItem>
                    )
                  })}
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={openSaveViewDialog}>
                <Save className="size-4 mr-2" />
                Save current view
              </DropdownMenuItem>
              <DropdownMenuItem onClick={resetView}>
                <X className="size-4 mr-2" />
                Reset
              </DropdownMenuItem>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Columns visibility */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Columns3 className="size-4 mr-1.5" />
              Columns
              {hiddenColumns.length > 0 && (
                <span className="ml-1 text-xs text-muted-foreground">
                  ({allColumns.length - hiddenColumns.length}/
                  {allColumns.length})
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 p-0">
            <div className="p-1">
              <DropdownMenuLabel>Show columns</DropdownMenuLabel>
              <div className="flex gap-1 px-2 pb-1">
                <button
                  onClick={() =>
                    hiddenColumns.length > 0
                      ? setHiddenColumns([])
                      : setHiddenColumns(allColumns.map((c) => c.key))
                  }
                  className="flex-1 text-xs text-muted-foreground hover:text-foreground border rounded px-2 py-1"
                >
                  {hiddenColumns.length > 0 ? 'Show all' : 'Hide all'}
                </button>
                <button
                  onClick={hideEmptyColumns}
                  className="flex-1 text-xs text-muted-foreground hover:text-foreground border rounded px-2 py-1 flex items-center justify-center gap-1"
                  title="Hide columns with no data in visible rows"
                >
                  <EyeOff className="size-3" />
                  Hide empty
                </button>
              </div>
              <DropdownMenuSeparator />
            </div>
            <div
              className="max-h-72 overflow-y-auto px-1 pb-1"
              onWheel={(e) => e.stopPropagation()}
            >
              {allColumns.map((col) => (
                <DropdownMenuItem
                  key={col.key}
                  onSelect={(e) => {
                    e.preventDefault()
                    toggleColumn(col.key)
                  }}
                  className="gap-2"
                >
                  <Checkbox
                    checked={!hiddenColumns.includes(col.key)}
                    onCheckedChange={() => toggleColumn(col.key)}
                  />
                  <span className="truncate">{col.label}</span>
                </DropdownMenuItem>
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Filters toggle */}
        <Button
          variant={showFilters ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowFilters((v) => !v)}
        >
          <Filter className="size-4 mr-1.5" />
          Filters
          {Object.values(filters).filter((v) => v.trim()).length > 0 && (
            <span className="ml-1 text-xs">
              ({Object.values(filters).filter((v) => v.trim()).length})
            </span>
          )}
        </Button>

        {collection !== 'submissions' && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleAddRow()}
          >
            <Plus className="size-4 mr-1.5" />
            New row
          </Button>
        )}
      </div>

      {/* Filters panel (compact: only active filters) */}
      {showFilters && (
        <div className="border rounded-lg p-3 bg-muted/30 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Plus className="size-3.5 mr-1" />
                  Add filter
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 p-0">
                <DropdownMenuLabel>Pick column</DropdownMenuLabel>
                <div
                  className="max-h-72 overflow-y-auto p-1"
                  onWheel={(e) => e.stopPropagation()}
                >
                  {columns
                    .filter((c) => !(c.key in filters))
                    .map((col) => (
                      <DropdownMenuItem
                        key={col.key}
                        onSelect={() =>
                          setFilters((prev) => ({ ...prev, [col.key]: '' }))
                        }
                      >
                        <span className="truncate">{col.label}</span>
                      </DropdownMenuItem>
                    ))}
                  {columns.filter((c) => !(c.key in filters)).length === 0 && (
                    <DropdownMenuItem disabled>
                      All columns already filtered
                    </DropdownMenuItem>
                  )}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            {Object.keys(filters).length > 0 && (
              <button
                onClick={() => {
                  setFilters({})
                  clearExactFilters()
                }}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <X className="size-3" />
                Clear all
              </button>
            )}
          </div>

          {Object.keys(filters).length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              No active filters. Click "Add filter" to get started.
            </p>
          ) : (
            <div className="space-y-2">
              {Object.keys(filters).map((key) => {
                const col = allColumns.find((c) => c.key === key)
                if (!col) return null
                const chips = distinctByColumn[key] ?? []
                const currentFilter = filters[key] ?? ''
                return (
                  <div
                    key={key}
                    className="bg-background border rounded-md p-2 space-y-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium w-32 truncate">
                        {col.label}
                      </span>
                      <Input
                        placeholder="contains..."
                        value={currentFilter}
                        onChange={(e) => {
                          setFilters((prev) => ({
                            ...prev,
                            [key]: e.target.value,
                          }))
                          // Free-text edit reverts to substring semantics.
                          setExactFilters((prev) => {
                            if (!prev.has(key)) return prev
                            const next = new Set(prev)
                            next.delete(key)
                            return next
                          })
                        }}
                        className="h-7 text-sm flex-1"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setFilters((prev) => {
                            const next = { ...prev }
                            delete next[key]
                            return next
                          })
                          setExactFilters((prev) => {
                            if (!prev.has(key)) return prev
                            const next = new Set(prev)
                            next.delete(key)
                            return next
                          })
                        }}
                        className="text-muted-foreground hover:text-destructive"
                        title="Remove filter"
                        aria-label={`Remove filter for ${col.label}`}
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                    {chips.length > 0 && (
                      <div className="flex flex-wrap gap-1 pl-[8.5rem]">
                        {chips.map((chip) => {
                          const isActive = currentFilter === chip.value
                          return (
                            <button
                              key={chip.value}
                              onClick={() => {
                                setFilters((prev) => ({
                                  ...prev,
                                  [key]: isActive ? '' : chip.value,
                                }))
                                // Pin chip → exact match (so `active` doesn't
                                // also include `inactive`); deactivating a
                                // chip releases that pin.
                                setExactFilters((prev) => {
                                  const next = new Set(prev)
                                  if (isActive) next.delete(key)
                                  else next.add(key)
                                  return next
                                })
                              }}
                              className={`text-xs rounded-full px-2 py-0.5 border transition-colors truncate max-w-[14rem] ${
                                isActive
                                  ? 'bg-primary text-primary-foreground border-primary'
                                  : 'bg-background hover:bg-accent text-muted-foreground'
                              }`}
                              title={chip.value}
                            >
                              {chip.value}
                              <span
                                className={`ml-1 ${isActive ? 'opacity-70' : 'opacity-50'}`}
                              >
                                {chip.count}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Results count */}
      <p className="text-sm text-muted-foreground">
        {records.length} {records.length === 1 ? 'record' : 'records'}
      </p>

      {/* Table */}
      <div className="border rounded-lg overflow-auto max-h-[600px]">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 sticky top-0 z-10">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors"
                  onClick={() => handleSort(col.key)}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {sortKey === col.key ? (
                      sortDir === 'asc' ? (
                        <ArrowUp className="size-3" />
                      ) : (
                        <ArrowDown className="size-3" />
                      )
                    ) : (
                      <ArrowUpDown className="size-3 opacity-30" />
                    )}
                  </div>
                </th>
              ))}
              {isEditable && <th className="w-8" />}
            </tr>
          </thead>
          <tbody className="divide-y">
            {records.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (isEditable ? 1 : 0)}
                  className="text-center py-12 text-muted-foreground"
                >
                  No records yet. Import data to get started.
                </td>
              </tr>
            ) : (
              records.map((record: any) => (
                <tr key={record._id} className="group/row hover:bg-muted/30">
                  {columns.map((col) => {
                    const isEditing =
                      editingCell?.id === record._id &&
                      editingCell?.field === col.key
                    const cellValue = getCellValue(record, col.key)

                    const isLongValue =
                      cellValue.length > 60 || cellValue.includes('\n')

                    return (
                      <td
                        key={col.key}
                        className="px-3 py-2 max-w-[250px] group relative align-top"
                      >
                        {isEditing ? (
                          <div className="flex items-start gap-1">
                            {isLongValue ? (
                              <Textarea
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (
                                    e.key === 'Enter' &&
                                    (e.metaKey || e.ctrlKey)
                                  ) {
                                    e.preventDefault()
                                    void handleSaveEdit()
                                  }
                                  if (e.key === 'Escape') handleCancelEdit()
                                }}
                                className="text-sm min-h-[80px] w-full"
                                autoFocus
                              />
                            ) : (
                              <Input
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void handleSaveEdit()
                                  if (e.key === 'Escape') handleCancelEdit()
                                }}
                                className="h-7 text-sm"
                                autoFocus
                              />
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2"
                              onClick={() => void handleSaveEdit()}
                            >
                              OK
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            {cellValue ? (
                              isLongValue ? (
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button className="truncate text-left hover:text-foreground transition-colors cursor-pointer">
                                      {cellValue}
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent
                                    align="start"
                                    className="w-96 max-h-96 overflow-auto whitespace-pre-wrap text-sm"
                                  >
                                    {cellValue}
                                  </PopoverContent>
                                </Popover>
                              ) : (
                                <span className="truncate" title={cellValue}>
                                  {cellValue}
                                </span>
                              )
                            ) : (
                              <span className="truncate text-muted-foreground/50">
                                —
                              </span>
                            )}
                            {isEditable && !col.key.startsWith('data.') && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleStartEdit(
                                    record._id,
                                    col.key,
                                    cellValue,
                                  )
                                }
                                aria-label={`Edit ${col.label}`}
                                className="opacity-0 group-hover:opacity-100 transition-opacity ml-auto shrink-0"
                              >
                                <Pencil className="size-3 text-muted-foreground hover:text-foreground" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    )
                  })}
                  {isEditable && (
                    <td className="px-2 text-center align-middle">
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="opacity-0 group-hover/row:opacity-100 focus:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-1 inline-flex"
                            title="Delete row"
                            aria-label="Delete row"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          side="left"
                          align="start"
                          className="w-auto p-2"
                        >
                          <div className="flex items-center gap-2 text-sm">
                            <span>Delete this row?</span>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-7"
                              onClick={() => void handleDeleteRow(record._id)}
                            >
                              Yes
                            </Button>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog
        open={savingViewName !== null}
        onOpenChange={(open) => {
          if (!open) setSavingViewName(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save current view</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="View name"
            value={savingViewName ?? ''}
            onChange={(e) => setSavingViewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && savingViewName?.trim()) {
                e.preventDefault()
                confirmSaveView()
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSavingViewName(null)}>
              Cancel
            </Button>
            <Button
              onClick={confirmSaveView}
              disabled={!savingViewName?.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
