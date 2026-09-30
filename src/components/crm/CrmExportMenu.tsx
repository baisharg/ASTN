import { useConvex, useQuery } from 'convex/react'
import { Download, Loader2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { CrmCollection } from '../../../convex/lib/crmFields'
import { CRM_FIELDS, withFieldDefs } from '../../../convex/lib/crmFields'
import { neutralizeCsvFormula } from './fieldValues'
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
  contacts: 'Contactos',
  organizations: 'Organizaciones',
  opportunities: 'Oportunidades',
  submissions: 'Formularios',
}

const SHEET_NAMES: Record<CrmCollection, string> = {
  contacts: 'Contacts',
  organizations: 'Organizations',
  opportunities: 'Opportunities',
  submissions: 'Submissions',
}

type ExportData = Record<CrmCollection, Array<Record<string, any>>>
type FieldDefs = Partial<
  Record<CrmCollection, ReadonlyArray<{ key: string; label: string }>>
>

// Contacts and organizations keep configurable values in `fields`; lists
// become comma-separated text and checkboxes Sí/No.
function exportValue(row: Record<string, any>, key: string): unknown {
  const value = row[key] ?? row.fields?.[key]
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  return value ?? ''
}

// Turn raw CRM rows into export objects keyed by human labels, so the file is
// readable and round-trips back through the import dialog's alias matching.
// Typed collections emit their schema fields in registry order; submissions
// promote participant/period/source then flatten the variable `data` bag.
function toExportRows(
  collection: CrmCollection,
  rows: Array<Record<string, any>>,
  defs: FieldDefs,
): Array<Record<string, any>> {
  const fields = withFieldDefs(CRM_FIELDS[collection], defs[collection] ?? [])

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
    for (const f of fields) out[f.label] = exportValue(row, f.key)
    return out
  })
}

// CSV only: headers and text cells can't start a formula. (In .xlsx, text
// cells stay text, so the workbook export doesn't need this.)
function csvSafeRows(
  rows: Array<Record<string, any>>,
): Array<Record<string, any>> {
  return rows.map((row) => {
    const out: Record<string, any> = {}
    for (const [key, value] of Object.entries(row)) {
      out[neutralizeCsvFormula(key)] =
        typeof value === 'string' ? neutralizeCsvFormula(value) : value
    }
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
  const contactDefs = useQuery(api.contacts.records.listFields, {
    orgId,
    collection: 'contacts',
  })
  const organizationDefs = useQuery(api.contacts.records.listFields, {
    orgId,
    collection: 'organizations',
  })
  const defs = useMemo<FieldDefs>(
    () => ({
      contacts: contactDefs ?? [],
      organizations: organizationDefs ?? [],
    }),
    [contactDefs, organizationDefs],
  )

  const fetchAll = useCallback(
    () => convex.query(api.crm.exportAll, { orgId }) as Promise<ExportData>,
    [convex, orgId],
  )

  const exportCsv = useCallback(async () => {
    setBusy(true)
    try {
      const all = await fetchAll()
      const rows = toExportRows(
        activeCollection,
        all[activeCollection] ?? [],
        defs,
      )
      const ws = XLSX.utils.json_to_sheet(csvSafeRows(rows))
      const csv = XLSX.utils.sheet_to_csv(ws)
      // Prepend a BOM so Excel opens accented UTF-8 columns correctly.
      const blob = new Blob(['﻿' + csv], {
        type: 'text/csv;charset=utf-8;',
      })
      triggerDownload(blob, `${orgSlug}-${activeCollection}.csv`)
    } finally {
      setBusy(false)
    }
  }, [fetchAll, activeCollection, orgSlug, defs])

  const exportXlsx = useCallback(async () => {
    setBusy(true)
    try {
      const all = await fetchAll()
      const wb = XLSX.utils.book_new()
      for (const collection of Object.keys(
        SHEET_NAMES,
      ) as Array<CrmCollection>) {
        const rows = toExportRows(collection, all[collection] ?? [], defs)
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
  }, [fetchAll, orgSlug, defs])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={busy}>
          {busy ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <Download className="size-4 mr-2" />
          )}
          Exportar
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Descargar</DropdownMenuLabel>
        <DropdownMenuItem onClick={exportCsv}>
          {COLLECTION_LABELS[activeCollection]} (todos, CSV)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={exportXlsx}>
          Todo el CRM en Excel (.xlsx)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
