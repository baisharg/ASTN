import { useMutation, useQuery } from 'convex/react'
import { FileUp, Loader2, Plus, Search, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { errorMessage } from './shared'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Spinner } from '~/components/ui/spinner'
import { parseAllowlistCsv } from '~/lib/parse-allowlist-csv'
import type { ParsedAllowlist } from '~/lib/parse-allowlist-csv'

const CHUNK_SIZE = 2000

const SOURCE_LABELS = {
  csv: 'CSV',
  approval: 'Aprobado',
  manual: 'A mano',
} as const

type ImportResult = {
  added: number
  alreadyListed: number
  invalid: number
  approvedPending: number
}

function importSummary(r: ImportResult): string {
  const parts = [
    `${r.added} agregado${r.added !== 1 ? 's' : ''}`,
    `${r.alreadyListed} ya estaba${r.alreadyListed !== 1 ? 'n' : ''}`,
  ]
  if (r.invalid > 0) {
    parts.push(
      `${r.invalid} email${r.invalid !== 1 ? 's' : ''} inválido${r.invalid !== 1 ? 's' : ''}`,
    )
  }
  if (r.approvedPending > 0) {
    parts.push(
      `${r.approvedPending} pendiente${r.approvedPending !== 1 ? 's' : ''} aprobado${r.approvedPending !== 1 ? 's' : ''}`,
    )
  }
  return parts.join(' · ')
}

export function AllowlistTab({ orgId }: { orgId: Id<'organizations'> }) {
  const entries = useQuery(api.social.events.listAllowlist, { orgId })
  const importAllowlist = useMutation(api.social.events.importAllowlist)
  const removeEntry = useMutation(api.social.events.removeFromAllowlist)

  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedAllowlist | null>(null)
  const [importing, setImporting] = useState(false)
  const [manualEmail, setManualEmail] = useState('')
  const [manualName, setManualName] = useState('')
  const [addingManual, setAddingManual] = useState(false)
  const [search, setSearch] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)

  const handleFile = async (file: File) => {
    try {
      const text = await file.text()
      const result = parseAllowlistCsv(text)
      setFileName(file.name)
      setParsed(result)
      if (result.rows.length === 0) {
        toast.error('No encontramos emails en el archivo')
      }
    } catch (err) {
      toast.error('No se pudo leer el archivo', {
        description: errorMessage(err),
      })
    }
  }

  const clearFile = () => {
    setParsed(null)
    setFileName(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleImport = async () => {
    if (!parsed || parsed.rows.length === 0) return
    setImporting(true)
    const total: ImportResult = {
      added: 0,
      alreadyListed: 0,
      invalid: parsed.invalid,
      approvedPending: 0,
    }
    try {
      for (let i = 0; i < parsed.rows.length; i += CHUNK_SIZE) {
        const r = await importAllowlist({
          orgId,
          rows: parsed.rows.slice(i, i + CHUNK_SIZE),
          source: 'csv',
        })
        total.added += r.added
        total.alreadyListed += r.alreadyListed
        total.invalid += r.invalid
        total.approvedPending += r.approvedPending
      }
      toast.success('Lista importada', { description: importSummary(total) })
      clearFile()
    } catch (err) {
      toast.error('La importación se cortó', {
        description:
          total.added + total.alreadyListed > 0
            ? `Se llegaron a procesar ${total.added + total.alreadyListed} filas. ${errorMessage(err) ?? ''}`
            : errorMessage(err),
      })
    } finally {
      setImporting(false)
    }
  }

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!manualEmail.trim()) return
    setAddingManual(true)
    try {
      const r = await importAllowlist({
        orgId,
        rows: [
          { email: manualEmail.trim(), name: manualName.trim() || undefined },
        ],
        source: 'manual',
      })
      if (r.invalid > 0) toast.error('Ese email no parece válido')
      else if (r.alreadyListed > 0) toast.info('Ya estaba en la lista')
      else {
        toast.success(
          r.approvedPending > 0
            ? 'Agregado. Estaba pendiente y quedó aprobado.'
            : 'Agregado a la lista',
        )
        setManualEmail('')
        setManualName('')
      }
    } catch (err) {
      toast.error('No se pudo agregar', { description: errorMessage(err) })
    } finally {
      setAddingManual(false)
    }
  }

  const handleRemove = async (entryId: Id<'orgAllowlist'>) => {
    setRemoving(entryId)
    try {
      await removeEntry({ entryId })
    } catch (err) {
      toast.error('No se pudo quitar', { description: errorMessage(err) })
    } finally {
      setRemoving(null)
    }
  }

  const q = search.trim().toLowerCase()
  const visible = (entries ?? [])
    .filter(
      (e) =>
        !q || e.email.includes(q) || (e.name ?? '').toLowerCase().includes(q),
    )
    .sort((a, b) => b.addedAt - a.addedAt)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Lista de preaprobados</CardTitle>
          <CardDescription>
            Quienes están en esta lista quedan aprobados apenas se registran,
            acá o en Luma. Aprobar a alguien lo agrega a esta lista. La lista es
            de la organización y vale para todos sus eventos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="sr-only"
            id="allowlist-csv"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleFile(file)
            }}
          />
          {!parsed ? (
            <div className="space-y-2">
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => fileRef.current?.click()}
              >
                <FileUp className="size-4 mr-2" />
                Subir CSV
              </Button>
              <p className="text-xs text-muted-foreground">
                Una columna de emails, o una fila de encabezado con columnas
                como <span className="font-mono">email</span> y{' '}
                <span className="font-mono">nombre</span>. El export de
                invitados de Luma sirve tal cual.
              </p>
            </div>
          ) : (
            <div className="rounded-md border p-4 space-y-3">
              <div>
                <p className="font-medium">{fileName}</p>
                <p className="text-sm text-muted-foreground">
                  {parsed.rows.length} email
                  {parsed.rows.length !== 1 ? 's' : ''} para importar
                  {parsed.invalid > 0 &&
                    ` · ${parsed.invalid} fila${parsed.invalid !== 1 ? 's' : ''} sin email válido`}
                  {parsed.duplicates > 0 &&
                    ` · ${parsed.duplicates} repetido${parsed.duplicates !== 1 ? 's' : ''}`}
                </p>
              </div>
              {parsed.rows.length > 0 && (
                <ul className="text-sm text-muted-foreground space-y-0.5">
                  {parsed.rows.slice(0, 5).map((r) => (
                    <li key={r.email} className="truncate">
                      {r.email}
                      {r.name ? ` · ${r.name}` : ''}
                    </li>
                  ))}
                  {parsed.rows.length > 5 && (
                    <li>y {parsed.rows.length - 5} más</li>
                  )}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  className="min-h-11"
                  disabled={importing || parsed.rows.length === 0}
                  onClick={() => void handleImport()}
                >
                  {importing ? (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="size-4 mr-2" />
                  )}
                  Importar {parsed.rows.length}
                </Button>
                <Button
                  variant="ghost"
                  className="min-h-11"
                  disabled={importing}
                  onClick={clearFile}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          <form
            onSubmit={handleManualAdd}
            className="flex flex-col sm:flex-row gap-2 sm:items-end pt-2 border-t"
          >
            <div className="space-y-1 flex-1">
              <Label htmlFor="allowlist-email">Agregar a mano</Label>
              <Input
                id="allowlist-email"
                type="email"
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                placeholder="email@ejemplo.com"
                className="min-h-11"
              />
            </div>
            <div className="space-y-1 flex-1">
              <Label htmlFor="allowlist-name" className="sr-only">
                Nombre (opcional)
              </Label>
              <Input
                id="allowlist-name"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="Nombre (opcional)"
                className="min-h-11"
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              className="min-h-11"
              disabled={addingManual || !manualEmail.trim()}
            >
              {addingManual ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Plus className="size-4 mr-2" />
              )}
              Agregar
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {entries === undefined
              ? 'Personas en la lista'
              : `${entries.length} persona${entries.length !== 1 ? 's' : ''} en la lista`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {entries === undefined ? (
            <Spinner className="size-6 mx-auto" />
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              La lista está vacía. Subí un CSV o aprobá gente desde la pestaña
              Invitados.
            </p>
          ) : (
            <>
              <div className="relative">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nombre o email"
                  aria-label="Buscar en la lista"
                  className="pl-9"
                />
              </div>
              <div className="overflow-x-auto -mx-6 px-6">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Email</th>
                      <th className="py-2 pr-3 font-medium">Nombre</th>
                      <th className="py-2 pr-3 font-medium">Cómo entró</th>
                      <th className="py-2 pr-3 font-medium">Fecha</th>
                      <th className="py-2">
                        <span className="sr-only">Acciones</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((e) => (
                      <tr key={e._id} className="border-b last:border-0">
                        <td className="py-1.5 pr-3">{e.email}</td>
                        <td className="py-1.5 pr-3 text-muted-foreground">
                          {e.name ?? '—'}
                        </td>
                        <td className="py-1.5 pr-3">
                          {SOURCE_LABELS[e.source]}
                        </td>
                        <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">
                          {new Date(e.addedAt).toLocaleDateString('es-AR')}
                        </td>
                        <td className="py-1.5 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-11"
                            aria-label={`Quitar ${e.email} de la lista`}
                            disabled={removing === e._id}
                            onClick={() => void handleRemove(e._id)}
                          >
                            {removing === e._id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Trash2 className="size-4" />
                            )}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {visible.length === 0 && (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    Nadie coincide con la búsqueda.
                  </p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
