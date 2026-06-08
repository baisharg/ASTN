import { useConvex } from 'convex/react'
import { Download, Loader2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import * as XLSX from 'xlsx'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { CrmCollection } from '../../../convex/lib/crmFields'
import { CRM_FIELDS } from '../../../convex/lib/crmFields'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'

const COLLECTION_LABELS: Record<CrmCollection, string> = {
  contacts: 'Contacts',
  organizations: 'Organizations',
  opportunities: 'Opportunities',
  submissions: 'Submissions',
}

const SHEET_NAMES: Record<CrmCollection, string> = {
  contacts: 'Contacts',
  organizations: 'Organizations',
  opportunities: 'Opportunities',
  submissions: 'Submissions',
}

type ExportData = Record<CrmCollection, Array<Record<string, any>>>

// Turn raw CRM rows into export objects keyed by human labels, so the file is
// readable and round-trips back through the import dialog's alias matching.
// Typed collections emit their schema fields in registry order; submissions
// promote participant/period/source then flatten the variable `data` bag.
function toExportRows(
  collection: CrmCollection,
  rows: Array<Record<string, any>>,
): Array<Record<string, any>> {
  const fields = CRM_FIELDS[collection]

  if (collection === 'submissions') {
    return rows.map((row) => {
      const out: Record<string, any> = {}
      for (const f of fields) out[f.label] = row[f.key] ?? ''
      const data = row.data && typeof row.data === 'object' ? row.data : {}
      for (const [k, val] of Object.entries(data)) out[k] = val ?? ''
      return out
    })
  }

  return rows.map((row) => {
    const out: Record<string, any> = {}
    for (const f of fields) out[f.label] = row[f.key] ?? ''
    return out
  })
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

interface CrmExportMenuProps {
  orgId: Id<'organizations'>
  orgSlug: string
  activeCollection: CrmCollection
}

export function CrmExportMenu({
  orgId,
  orgSlug,
  activeCollection,
}: CrmExportMenuProps) {
  const convex = useConvex()
  const [busy, setBusy] = useState(false)

  const fetchAll = useCallback(
    () => convex.query(api.crm.exportAll, { orgId }) as Promise<ExportData>,
    [convex, orgId],
  )

  const exportCsv = useCallback(async () => {
    setBusy(true)
    try {
      const all = await fetchAll()
      const rows = toExportRows(activeCollection, all[activeCollection] ?? [])
      const ws = XLSX.utils.json_to_sheet(rows)
      const csv = XLSX.utils.sheet_to_csv(ws)
      // Prepend a BOM so Excel opens accented UTF-8 columns correctly.
      const blob = new Blob(['﻿' + csv], {
        type: 'text/csv;charset=utf-8;',
      })
      triggerDownload(blob, `${orgSlug}-${activeCollection}.csv`)
    } finally {
      setBusy(false)
    }
  }, [fetchAll, activeCollection, orgSlug])

  const exportXlsx = useCallback(async () => {
    setBusy(true)
    try {
      const all = await fetchAll()
      const wb = XLSX.utils.book_new()
      for (const collection of Object.keys(
        SHEET_NAMES,
      ) as Array<CrmCollection>) {
        const rows = toExportRows(collection, all[collection] ?? [])
        const ws = XLSX.utils.json_to_sheet(rows)
        XLSX.utils.book_append_sheet(wb, ws, SHEET_NAMES[collection])
      }
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      triggerDownload(blob, `${orgSlug}-crm.xlsx`)
    } finally {
      setBusy(false)
    }
  }, [fetchAll, orgSlug])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={busy}>
          {busy ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <Download className="size-4 mr-2" />
          )}
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Download</DropdownMenuLabel>
        <DropdownMenuItem onClick={exportCsv}>
          {COLLECTION_LABELS[activeCollection]} as CSV
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={exportXlsx}>
          All collections as Excel (.xlsx)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
