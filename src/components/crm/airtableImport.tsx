import { useAction } from 'convex/react'
import { AlertCircle, CheckCircle2, ChevronDown, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../../convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '../../../convex/_generated/dataModel'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '~/components/ui/collapsible'

type Report = FunctionReturnType<
  typeof api.contacts.airtable.previewAirtableImport
>

const TARGET_LABEL: Record<Report['rows'][number]['target'], string> = {
  contacts: 'Contactos',
  organizations: 'Organizaciones',
  activities: 'Historial',
}

function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'data' in e && typeof e.data === 'string') {
    return e.data
  }
  return e instanceof Error ? e.message : 'Algo salió mal'
}

/**
 * Admin card: preview the Airtable import (what would be created, updated,
 * and where ASTN and Airtable disagree), then run it.
 */
export function AirtableImportCard({ orgId }: { orgId: Id<'organizations'> }) {
  const previewImport = useAction(api.contacts.airtable.previewAirtableImport)
  const runImport = useAction(api.contacts.airtable.runAirtableImport)
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null)
  const [preview, setPreview] = useState<Report | null>(null)
  const [result, setResult] = useState<Report | null>(null)
  const [overwrite, setOverwrite] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const review = async () => {
    setBusy('preview')
    setError(null)
    setResult(null)
    try {
      setPreview(await previewImport({ orgId }))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const run = async () => {
    setBusy('import')
    setError(null)
    try {
      setResult(await runImport({ orgId, overwriteConflicts: overwrite }))
      setPreview(null)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Importar desde Airtable</CardTitle>
        <CardDescription>
          Trae personas, organizaciones, formularios, programas, sesiones y
          postulaciones a TAIS desde Airtable. Se puede repetir: no duplica
          registros ni borra valores que ya estén en ASTN.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!preview && (
          <Button onClick={review} disabled={busy !== null} variant="outline">
            {busy === 'preview' && <Loader2 className="size-4 animate-spin" />}
            {busy === 'preview'
              ? 'Leyendo Airtable…'
              : 'Revisar importación de Airtable'}
          </Button>
        )}

        {error && (
          <p className="text-destructive flex items-center gap-2 text-sm">
            <AlertCircle className="size-4 shrink-0" />
            {error}
          </p>
        )}

        {preview && (
          <div className="space-y-4">
            <ReportTable report={preview} />
            <ConflictList report={preview} />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={overwrite}
                onCheckedChange={(v) => setOverwrite(v === true)}
                disabled={busy !== null}
              />
              Usar los valores de Airtable en conflictos
            </label>
            <div className="flex gap-2">
              <Button onClick={run} disabled={busy !== null}>
                {busy === 'import' && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                {busy === 'import' ? 'Importando…' : 'Importar'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setPreview(null)}
                disabled={busy !== null}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="size-4 text-green-600" />
              Importación terminada
            </p>
            <ReportTable report={result} />
            {result.conflictCount > 0 && (
              <p className="text-muted-foreground text-sm">
                {overwrite
                  ? `${result.conflictCount} conflictos resueltos con el valor de Airtable.`
                  : `${result.conflictCount} conflictos: se mantuvo el valor de ASTN.`}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ReportTable({ report }: { report: Report }) {
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-left">
            <tr>
              <th className="py-1 pr-3 font-medium">Tabla de Airtable</th>
              <th className="py-1 pr-3 font-medium">En ASTN</th>
              <th className="py-1 pr-3 text-right font-medium">Nuevos</th>
              <th className="py-1 pr-3 text-right font-medium">Actualizados</th>
              <th className="py-1 pr-3 text-right font-medium">Sin cambios</th>
              <th className="py-1 text-right font-medium">Omitidos</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {report.rows.map((row) => (
              <tr key={`${row.source}|${row.target}`} className="border-t">
                <td className="py-1 pr-3">{row.source}</td>
                <td className="py-1 pr-3">{TARGET_LABEL[row.target]}</td>
                <td className="py-1 pr-3 text-right">{row.created}</td>
                <td className="py-1 pr-3 text-right">{row.updated}</td>
                <td className="py-1 pr-3 text-right">{row.unchanged}</td>
                <td className="py-1 text-right">{row.skipped}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground text-sm">
        Campos: {report.fields.created} nuevos, {report.fields.updated} con
        opciones nuevas.
        {report.duplicatePersonas > 0 &&
          ` ${report.duplicatePersonas} ${
            report.duplicatePersonas === 1
              ? 'persona repetida en Airtable se combina'
              : 'personas repetidas en Airtable se combinan'
          } con otra que tiene el mismo email.`}
      </p>
    </div>
  )
}

function ConflictList({ report }: { report: Report }) {
  if (report.conflictCount === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No hay conflictos entre ASTN y Airtable.
      </p>
    )
  }
  const byField = new Map<string, Report['conflicts']>()
  for (const c of report.conflicts) {
    const list = byField.get(c.label) ?? []
    list.push(c)
    byField.set(c.label, list)
  }
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-medium">
        <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
        {report.conflictCount}{' '}
        {report.conflictCount === 1 ? 'conflicto' : 'conflictos'} (ASTN y
        Airtable tienen valores distintos; por defecto queda el de ASTN)
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-3">
        {[...byField].map(([label, list]) => (
          <div key={label}>
            <p className="text-sm font-medium">
              {label} ({list.length})
            </p>
            <ul className="text-muted-foreground mt-1 space-y-0.5 text-sm">
              {list.map((c, i) => (
                <li key={i} className="break-words">
                  <span className="text-foreground">{c.record}</span>
                  {c.duplicate
                    ? `: fila repetida en Airtable. Se importa «${c.current}», se descarta «${c.incoming}»`
                    : `: ASTN «${c.current}» · Airtable «${c.incoming}»`}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {report.conflicts.length < report.conflictCount && (
          <p className="text-muted-foreground text-sm">
            Se muestran {report.conflicts.length} de {report.conflictCount}.
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
