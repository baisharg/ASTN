import { useMutation } from 'convex/react'
import { FileUp, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { labelToKey } from '../../../convex/lib/formFields'
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
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'

type TargetCollection =
  | 'contacts'
  | 'organizations'
  | 'opportunities'
  | 'submissions'

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

// Per-sheet header→normalized-key map so the NFD/regex/split/map work in
// `labelToKey` runs once per header instead of once per (header × row).
function buildHeaderMap(headers: string[]): Map<string, string | null> {
  const map = new Map<string, string | null>()
  for (const key of headers) {
    const norm = labelToKey(key)
    map.set(key, norm && norm !== key ? norm : null)
  }
  return map
}

// For typed collections (contacts/orgs/opps), preserve the original Excel
// header so backend `??` chains can match accented Spanish headers like
// `record['Teléfono']` directly. For submissions the non-promoted keys land
// in the flexible `data` bag verbatim, so duplicating each key as both
// `Período` and `periodo` would store every field twice — emit only the
// camelCase normalization there.
function normalizeRow(
  row: Record<string, any>,
  headerMap: Map<string, string | null>,
  preserveOriginal: boolean,
): Record<string, any> {
  const out: Record<string, any> = {}
  for (const [key, value] of Object.entries(row)) {
    const coerced = coerceCellValue(value)
    if (preserveOriginal && !key.startsWith('_')) out[key] = coerced
    // headerMap is built from `Object.keys(rows[0])`, so a column whose
    // first data row is blank is missing from the map — fall back to a live
    // `labelToKey` so submissions don't silently drop those answers when
    // `preserveOriginal` is false.
    const norm = headerMap.get(key) ?? labelToKey(key)
    if (norm && norm !== key) out[norm] = coerced
  }
  return out
}

interface CrmImportDialogProps {
  orgId: Id<'organizations'>
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface SheetPreview {
  name: string
  headers: string[]
  rowCount: number
  rows: Record<string, any>[]
}

type ImportStatus =
  | 'idle'
  | 'parsing'
  | 'previewing'
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
  const [sheets, setSheets] = useState<SheetPreview[]>([])
  const [sheetMappings, setSheetMappings] = useState<
    Record<string, TargetCollection | ''>
  >({})
  const [importResults, setImportResults] = useState<
    { sheet: string; count: number; collection: string }[]
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

        const parsedSheets: SheetPreview[] = workbook.SheetNames.map((name) => {
          const sheet = workbook.Sheets[name]
          // `raw: false` formats numeric/date cells the way Excel renders them,
          // so phone-number and date columns arrive as strings instead of
          // failing `v.string()` validation downstream. We deliberately do NOT
          // pass `defval: ''` — blank cells must stay omitted so the backend's
          // `record.phone ?? record.Phone ?? record.telefono ?? …` chains can
          // fall through to populated language variants.
          const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, {
            raw: false,
          })
          const headers = rows.length > 0 ? Object.keys(rows[0]) : []

          return {
            name,
            headers,
            rowCount: rows.length,
            rows,
          }
        })

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

  const handleImport = useCallback(async () => {
    setStatus('importing')
    setErrorMsg('')
    const results: { sheet: string; count: number; collection: string }[] = []
    // Track the in-flight sheet so a thrown error in a later batch can name
    // *which* sheet broke (without blaming the previously completed ones).
    let currentSheet: string | null = null
    let partialCount = 0

    try {
      for (const sheet of sheets) {
        const target = sheetMappings[sheet.name]
        if (!target) continue

        // Convex mutations have a size limit, so batch in chunks of 50
        const BATCH_SIZE = 50
        let totalInserted = 0
        currentSheet = sheet.name
        partialCount = 0
        const headerMap = buildHeaderMap(sheet.headers)
        const preserveOriginal = target !== 'submissions'

        for (let i = 0; i < sheet.rows.length; i += BATCH_SIZE) {
          const batch = sheet.rows
            .slice(i, i + BATCH_SIZE)
            .map((row) => normalizeRow(row, headerMap, preserveOriginal))

          switch (target) {
            case 'contacts':
              totalInserted += await insertContacts({
                orgId,
                records: batch,
              })
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

  const mappedSheetCount = Object.values(sheetMappings).filter(Boolean).length

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
              Found {sheets.length} sheet(s). Map each one to a CRM collection:
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
              <Button onClick={handleImport} disabled={mappedSheetCount === 0}>
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
