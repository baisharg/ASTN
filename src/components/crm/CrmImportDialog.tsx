import { useMutation } from 'convex/react'
import { FileUp, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { labelToKey } from '../../../convex/lib/formFields'
import type { CrmCollection } from '../../../convex/lib/crmFields'
import {
  CRM_FIELDS,
  DATA_TARGET,
  NOTES_TARGET,
  SKIP_TARGET,
  suggestFieldKey,
} from '../../../convex/lib/crmFields'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'

type TargetCollection = CrmCollection

// `mapping[sheetName][excelHeader]` → a canonical field key, or one of the
// special sentinels: NOTES_TARGET (append to `notes`), DATA_TARGET (keep in a
// submission's flexible `data` bag), or SKIP_TARGET (drop the column).
type ColumnMapping = Record<string, Record<string, string>>

// XLSX may emit numbers, Dates, or booleans in cells whose target column is a
// `v.string()`. Coerce non-null primitives to strings; pass through structured
// values untouched (they are either dropped or end up under `data` for
// submissions, which is `v.any()`).
function coerceCellValue(value: unknown): unknown {
  if (value == null) return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  return value
}

// Safe stringification for display / notes concatenation — coerced cells are
// usually strings already, but a structured cell would otherwise stringify to
// "[object Object]" (and trips the linter's no-base-to-string rule).
function cellToText(value: unknown): string {
  if (value == null) return ''
  switch (typeof value) {
    case 'string':
      return value
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value)
    case 'object':
      return JSON.stringify(value)
    default:
      return ''
  }
}

// Build the canonical record sent to the backend from a raw Excel row plus the
// confirmed column mapping. Field-mapped columns write directly to their key;
// NOTES_TARGET columns are concatenated (label-prefixed) into `notes`;
// DATA_TARGET columns land in the submission `data` bag keyed by camelCase.
function buildRecord(
  row: Record<string, any>,
  mapping: Record<string, string>,
  collection: TargetCollection,
): Record<string, any> {
  const out: Record<string, any> = {}
  const notesParts: Array<string> = []
  const data: Record<string, any> = {}

  for (const [header, rawValue] of Object.entries(row)) {
    const target = mapping[header] ?? SKIP_TARGET
    if (target === SKIP_TARGET) continue

    const value = coerceCellValue(rawValue)
    if (value == null || value === '') continue

    if (target === NOTES_TARGET) {
      notesParts.push(`${header}: ${cellToText(value)}`)
    } else if (target === DATA_TARGET) {
      const key = labelToKey(header)
      if (key) data[key] = value
    } else if (target === 'notes') {
      // A column explicitly mapped to the Notes field carries its value raw
      // (no `Header:` prefix) — that's the user's real notes content.
      notesParts.push(cellToText(value))
    } else {
      out[target] = value
    }
  }

  if (collection === 'submissions') {
    out.data = data
  } else if (notesParts.length > 0) {
    out.notes = notesParts.join('\n')
  }
  return out
}

// Initial per-column guess: known alias → that field; otherwise an orphan,
// which defaults to the data bag for submissions or to Notes for typed
// collections (so nothing is silently dropped — the user can still override
// any column to Skip in the mapping step).
function buildInitialMapping(
  headers: Array<string>,
  collection: TargetCollection,
): Record<string, string> {
  const fields = CRM_FIELDS[collection]
  const orphanDefault =
    collection === 'submissions' ? DATA_TARGET : NOTES_TARGET
  const mapping: Record<string, string> = {}
  for (const header of headers) {
    if (header.startsWith('_')) {
      mapping[header] = SKIP_TARGET
      continue
    }
    mapping[header] = suggestFieldKey(header, fields) ?? orphanDefault
  }
  return mapping
}

interface CrmImportDialogProps {
  orgId: Id<'organizations'>
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface SheetPreview {
  name: string
  headers: Array<string>
  rowCount: number
  rows: Array<Record<string, any>>
}

type ImportStatus =
  | 'idle'
  | 'parsing'
  | 'previewing'
  | 'mapping'
  | 'importing'
  | 'done'
  | 'error'

export function CrmImportDialog({
  orgId,
  open,
  onOpenChange,
}: CrmImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<ImportStatus>('idle')
  const [sheets, setSheets] = useState<Array<SheetPreview>>([])
  const [sheetMappings, setSheetMappings] = useState<
    Record<string, TargetCollection | ''>
  >({})
  const [columnMappings, setColumnMappings] = useState<ColumnMapping>({})
  const [importResults, setImportResults] = useState<
    Array<{ sheet: string; count: number; collection: string }>
  >([])
  const [errorMsg, setErrorMsg] = useState('')

  const insertContacts = useMutation(api.crm.insertContacts)
  const insertOrganizations = useMutation(api.crm.insertOrganizations)
  const insertOpportunities = useMutation(api.crm.insertOpportunities)
  const insertSubmissions = useMutation(api.crm.insertSubmissions)

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      setStatus('parsing')
      setErrorMsg('')

      try {
        const buffer = await file.arrayBuffer()
        const workbook = XLSX.read(buffer, { type: 'array' })

        const parsedSheets: Array<SheetPreview> = workbook.SheetNames.map(
          (name) => {
            const sheet = workbook.Sheets[name]
            // `raw: false` formats numeric/date cells the way Excel renders
            // them, so phone-number and date columns arrive as strings instead
            // of failing `v.string()` validation downstream.
            const rows: Array<Record<string, any>> = XLSX.utils.sheet_to_json(
              sheet,
              { raw: false },
            )
            // Union of keys across all rows, not just row[0] — a column that's
            // blank in the first row still needs a mapping entry, otherwise it
            // would be silently dropped at import time.
            const headerSet = new Set<string>()
            for (const r of rows)
              for (const k of Object.keys(r)) headerSet.add(k)
            const headers = [...headerSet]

            return { name, headers, rowCount: rows.length, rows }
          },
        )

        setSheets(parsedSheets)

        // Auto-map sheets by name. Accept Spanish keywords too so BAISH's
        // existing Airtable sheet names (Personas, Organizaciones, etc.) still
        // auto-map to the new English collections.
        const autoMappings: Record<string, TargetCollection | ''> = {}
        for (const sheet of parsedSheets) {
          const lower = sheet.name.toLowerCase()
          if (lower.includes('contact') || lower.includes('persona'))
            autoMappings[sheet.name] = 'contacts'
          else if (lower.includes('organiza'))
            autoMappings[sheet.name] = 'organizations'
          else if (
            lower.includes('opportunit') ||
            lower.includes('oportunid') ||
            lower.includes('job')
          )
            autoMappings[sheet.name] = 'opportunities'
          else if (
            lower.includes('submission') ||
            lower.includes('response') ||
            lower.includes('formulari') ||
            lower.includes('form') ||
            lower.includes('survey')
          )
            autoMappings[sheet.name] = 'submissions'
          else autoMappings[sheet.name] = ''
        }
        setSheetMappings(autoMappings)
        setColumnMappings({})
        setStatus('previewing')
      } catch (err) {
        console.error('Parse error:', err)
        setErrorMsg(
          'Failed to parse file. Make sure it is a valid Excel or CSV file.',
        )
        setStatus('error')
      }
    },
    [],
  )

  // Move from sheet→collection step to the per-column mapping step, seeding an
  // auto-suggested column mapping for every mapped sheet.
  const goToMapping = useCallback(() => {
    const next: ColumnMapping = {}
    for (const sheet of sheets) {
      const collection = sheetMappings[sheet.name]
      if (!collection) continue
      next[sheet.name] = buildInitialMapping(sheet.headers, collection)
    }
    setColumnMappings(next)
    setStatus('mapping')
  }, [sheets, sheetMappings])

  const handleImport = useCallback(async () => {
    setStatus('importing')
    setErrorMsg('')
    const results: Array<{
      sheet: string
      count: number
      collection: string
    }> = []
    // Track the in-flight sheet so a thrown error in a later batch can name
    // *which* sheet broke (without blaming the previously completed ones).
    let currentSheet: string | null = null
    let partialCount = 0

    try {
      for (const sheet of sheets) {
        const target = sheetMappings[sheet.name]
        if (!target) continue

        const mapping = columnMappings[sheet.name] ?? {}
        // Convex mutations have a size limit, so batch in chunks of 50
        const BATCH_SIZE = 50
        let totalInserted = 0
        currentSheet = sheet.name
        partialCount = 0

        for (let i = 0; i < sheet.rows.length; i += BATCH_SIZE) {
          const batch = sheet.rows
            .slice(i, i + BATCH_SIZE)
            .map((row) => buildRecord(row, mapping, target))

          switch (target) {
            case 'contacts':
              totalInserted += await insertContacts({ orgId, records: batch })
              break
            case 'organizations':
              totalInserted += await insertOrganizations({
                orgId,
                records: batch,
              })
              break
            case 'opportunities':
              totalInserted += await insertOpportunities({
                orgId,
                records: batch,
              })
              break
            case 'submissions':
              totalInserted += await insertSubmissions({
                orgId,
                records: batch,
              })
              break
          }
          partialCount = totalInserted
        }

        results.push({
          sheet: sheet.name,
          count: totalInserted,
          collection: target,
        })
      }

      setImportResults(results)
      setStatus('done')
    } catch (err: any) {
      console.error('Import error:', err)
      const baseMsg = err.message || 'Import failed'
      let partial = ''
      if (currentSheet) {
        partial =
          partialCount > 0
            ? ` Imported ${partialCount} row${partialCount === 1 ? '' : 's'} from "${currentSheet}" before the error.`
            : ` Failed on sheet "${currentSheet}".`
      }
      setErrorMsg(baseMsg + partial)
      setImportResults(results)
      setStatus('error')
    }
  }, [
    sheets,
    sheetMappings,
    columnMappings,
    orgId,
    insertContacts,
    insertOrganizations,
    insertOpportunities,
    insertSubmissions,
  ])

  const handleReset = useCallback(() => {
    setStatus('idle')
    setSheets([])
    setSheetMappings({})
    setColumnMappings({})
    setImportResults([])
    setErrorMsg('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  // Reset whenever the dialog closes so reopening always lands on the empty
  // file picker — covers X button, Escape, click-outside, and Done in one
  // place. (The component itself stays mounted between opens because the
  // parent renders it unconditionally.)
  useEffect(() => {
    if (!open) handleReset()
  }, [open, handleReset])

  const setColumnTarget = useCallback(
    (sheetName: string, header: string, target: string) => {
      setColumnMappings((prev) => ({
        ...prev,
        [sheetName]: { ...prev[sheetName], [header]: target },
      }))
    },
    [],
  )

  const mappedSheetCount = Object.values(sheetMappings).filter(Boolean).length
  const mappedSheets = useMemo(
    () => sheets.filter((s) => sheetMappings[s.name]),
    [sheets, sheetMappings],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Excel / CSV</DialogTitle>
        </DialogHeader>

        {status === 'idle' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload an Excel (.xlsx) or CSV file. Each sheet will be mapped to
              a CRM collection (Contacts, Organizations, Opportunities, or
              Submissions).
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <FileUp className="size-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium">Click to select file</p>
              <p className="text-sm text-muted-foreground mt-1">
                .xlsx, .xls, or .csv
              </p>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>
        )}

        {status === 'parsing' && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
            <span className="ml-3 text-muted-foreground">Parsing file...</span>
          </div>
        )}

        {status === 'previewing' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Found {sheets.length} sheet(s). Map each one to a CRM collection —
              you'll match the columns next:
            </p>

            {sheets.map((sheet) => (
              <div
                key={sheet.name}
                className="flex items-center gap-3 p-3 border rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{sheet.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {sheet.rowCount} rows &middot;{' '}
                    {sheet.headers.slice(0, 4).join(', ')}
                    {sheet.headers.length > 4
                      ? ` +${sheet.headers.length - 4} more`
                      : ''}
                  </p>
                </div>
                <Select
                  value={sheetMappings[sheet.name] || 'skip'}
                  onValueChange={(v) =>
                    setSheetMappings((prev) => ({
                      ...prev,
                      [sheet.name]: v === 'skip' ? '' : (v as TargetCollection),
                    }))
                  }
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="skip">Skip</SelectItem>
                    <SelectItem value="contacts">Contacts</SelectItem>
                    <SelectItem value="organizations">Organizations</SelectItem>
                    <SelectItem value="opportunities">Opportunities</SelectItem>
                    <SelectItem value="submissions">Submissions</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleReset}>
                Cancel
              </Button>
              <Button onClick={goToMapping} disabled={mappedSheetCount === 0}>
                Next: map columns
              </Button>
            </div>
          </div>
        )}

        {status === 'mapping' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Match each column to a field. Auto-detected matches are pre-filled
              — adjust anything that's off. Unmatched columns default to Notes /
              data so nothing is dropped.
            </p>

            <div className="max-h-[55vh] overflow-y-auto space-y-5 pr-1">
              {mappedSheets.map((sheet) => {
                const collection = sheetMappings[sheet.name] as TargetCollection
                const mapping = columnMappings[sheet.name] ?? {}
                const fields = CRM_FIELDS[collection]
                const sample = sheet.rows[0] ?? {}

                const missingRequired = fields
                  .filter((f) => f.required)
                  .filter((f) => !Object.values(mapping).includes(f.key))

                return (
                  <ColumnMapSection
                    key={sheet.name}
                    sheet={sheet}
                    collection={collection}
                    mapping={mapping}
                    fields={fields}
                    sample={sample}
                    missingRequired={missingRequired.map((f) => f.label)}
                    onChange={(header, target) =>
                      setColumnTarget(sheet.name, header, target)
                    }
                  />
                )
              })}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setStatus('previewing')}>
                Back
              </Button>
              <Button onClick={handleImport}>
                Import {mappedSheetCount} sheet(s)
              </Button>
            </div>
          </div>
        )}

        {status === 'importing' && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
            <span className="ml-3 text-muted-foreground">
              Importing records...
            </span>
          </div>
        )}

        {status === 'done' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="size-5" />
              <span className="font-medium">Import complete!</span>
            </div>
            {importResults.map((r) => (
              <p key={r.sheet} className="text-sm text-muted-foreground">
                <span className="font-medium">{r.sheet}</span>: {r.count}{' '}
                records imported to {r.collection}
              </p>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleReset}>
                Import another file
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="size-5" />
              <span className="font-medium">Error</span>
            </div>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
            {importResults.length > 0 && (
              <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Sheets imported before the error:
                </p>
                {importResults.map((r) => (
                  <p key={r.sheet} className="text-sm">
                    <span className="font-medium">{r.sheet}</span>: {r.count}{' '}
                    record{r.count === 1 ? '' : 's'} → {r.collection}
                  </p>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleReset}>
                Try again
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

interface ColumnMapSectionProps {
  sheet: SheetPreview
  collection: TargetCollection
  mapping: Record<string, string>
  fields: (typeof CRM_FIELDS)[TargetCollection]
  sample: Record<string, any>
  missingRequired: Array<string>
  onChange: (header: string, target: string) => void
}

function ColumnMapSection({
  sheet,
  collection,
  mapping,
  fields,
  sample,
  missingRequired,
  onChange,
}: ColumnMapSectionProps) {
  const orphanLabel =
    collection === 'submissions' ? 'Keep in data' : 'Add to Notes'
  const orphanValue = collection === 'submissions' ? DATA_TARGET : NOTES_TARGET

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-medium text-sm">{sheet.name}</p>
        <span className="text-xs text-muted-foreground capitalize">
          → {collection}
        </span>
      </div>

      {missingRequired.length > 0 && (
        <p className="text-xs text-amber-600">
          No column mapped to required field
          {missingRequired.length > 1 ? 's' : ''}: {missingRequired.join(', ')}.
          Those rows will use a placeholder.
        </p>
      )}

      <div className="space-y-1.5">
        {sheet.headers
          .filter((h) => !h.startsWith('_'))
          .map((header) => {
            const sampleVal = coerceCellValue(sample[header])
            return (
              <div key={header} className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate" title={header}>
                    {header}
                  </p>
                  {sampleVal != null && sampleVal !== '' && (
                    <p className="text-xs text-muted-foreground truncate">
                      e.g. {cellToText(sampleVal)}
                    </p>
                  )}
                </div>
                <Select
                  value={mapping[header] ?? SKIP_TARGET}
                  onValueChange={(v) => onChange(header, v)}
                >
                  <SelectTrigger className="w-[180px] shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {fields.map((f) => (
                      <SelectItem key={f.key} value={f.key}>
                        {f.label}
                      </SelectItem>
                    ))}
                    <SelectSeparator />
                    <SelectItem value={orphanValue}>{orphanLabel}</SelectItem>
                    <SelectItem value={SKIP_TARGET}>Skip</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )
          })}
      </div>
    </div>
  )
}
