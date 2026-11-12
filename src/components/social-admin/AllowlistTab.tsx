import { useAction, useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import {
  FileUp,
  Loader2,
  Plus,
  Search,
  Trash2,
  Upload,
  UserPlus,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import {
  MAX_PREAPPROVED_GUESTS_PER_ADD,
  PREAPPROVED_ADD_APPROVED_LIMIT,
} from '../../../convex/social/constants'
import { GUEST_STATUS_LABELS, toastError } from './shared'
import type { AdminEvent, GuestStatus } from './shared'
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
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Checkbox } from '~/components/ui/checkbox'
import { Label } from '~/components/ui/label'
import { Spinner } from '~/components/ui/spinner'
import { errorText } from '~/lib/convex-error'
import { parseAllowlistCsv } from '~/lib/parse-allowlist-csv'
import type { ParsedAllowlist } from '~/lib/parse-allowlist-csv'
import { useBusyAction } from '~/lib/use-busy-action'

const CHUNK_SIZE = 2000

const SOURCE_LABELS = {
  csv: 'CSV',
  approval: 'Aprobado',
  manual: 'A mano',
  luma: 'Luma',
} as const

type ImportResult = FunctionReturnType<typeof api.social.events.importAllowlist>
type AllowlistEntry = FunctionReturnType<
  typeof api.social.events.listAllowlist
>[number]
type AddToEventResult = FunctionReturnType<
  typeof api.social.events.addPreapprovedGuests
>

function people(count: number): string {
  return `${count} persona${count !== 1 ? 's' : ''}`
}

function addToEventSummary(r: AddToEventResult): string {
  const parts = [`${r.added} agregada${r.added !== 1 ? 's' : ''}`]
  if (r.alreadyGuest > 0) {
    parts.push(
      `${r.alreadyGuest} ya estaba${r.alreadyGuest !== 1 ? 'n' : ''} en el evento`,
    )
  }
  if (r.invalid > 0) {
    parts.push(
      `${r.invalid} no se pud${r.invalid !== 1 ? 'ieron' : 'o'} agregar`,
    )
  }
  return parts.join(' · ')
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

export function AllowlistTab({ event }: { event: AdminEvent }) {
  const orgId = event.orgId
  const lumaLinked = !!event.lumaEventId
  const entries = useQuery(api.social.events.listAllowlist, { orgId })
  const guests = useQuery(api.social.events.listGuests, { eventId: event._id })
  const importAllowlist = useMutation(api.social.events.importAllowlist)
  const removeEntry = useMutation(api.social.events.removeFromAllowlist)
  const addPreapprovedGuests = useMutation(
    api.social.events.addPreapprovedGuests,
  )

  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedAllowlist | null>(null)
  const [manualEmail, setManualEmail] = useState('')
  const [manualName, setManualName] = useState('')
  const [search, setSearch] = useState('')
  // Separate trackers: removing a row must not clear an import's spinner.
  const importAction = useBusyAction<'import'>()
  const manualAction = useBusyAction<'add'>()
  const removeAction = useBusyAction<Id<'orgAllowlist'>>()
  const addToEventAction = useBusyAction<'add-to-event'>()
  const addingToEvent = addToEventAction.busy !== null
  // Who to add to this event. Starts empty: the admin picks each person.
  const [selected, setSelected] = useState<ReadonlySet<Id<'orgAllowlist'>>>(
    new Set(),
  )
  // The people the open confirmation is about, fixed when it opens so the
  // list changing underneath doesn't change what gets added. Stays set while
  // the dialog closes, so its text doesn't empty out mid-animation.
  const [addTarget, setAddTarget] = useState<Array<AllowlistEntry>>([])
  const [addOpen, setAddOpen] = useState(false)
  const importing = importAction.busy !== null
  const addingManual = manualAction.busy !== null
  const removing = removeAction.busy

  const handleFile = async (file: File) => {
    try {
      const text = await file.text()
      const result = parseAllowlistCsv(text)
      setFileName(file.name)
      setParsed(result)
      if (result.rows.length === 0) {
        toast.error('No encontramos emails en el archivo')
      }
    } catch {
      toast.error('No se pudo leer el archivo')
    }
  }

  const clearFile = () => {
    setParsed(null)
    setFileName(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleImport = async () => {
    if (!parsed || parsed.rows.length === 0) return
    const rows = parsed.rows
    const total: ImportResult = {
      added: 0,
      alreadyListed: 0,
      invalid: parsed.invalid,
      approvedPending: 0,
    }
    await importAction.run(
      'import',
      async () => {
        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
          const r = await importAllowlist({
            orgId,
            rows: rows.slice(i, i + CHUNK_SIZE),
            source: 'csv',
          })
          total.added += r.added
          total.alreadyListed += r.alreadyListed
          total.invalid += r.invalid
          total.approvedPending += r.approvedPending
        }
        toast.success('Lista importada', {
          description: importSummary(total),
        })
        clearFile()
      },
      (err) => {
        const processed = total.added + total.alreadyListed
        const detail = errorText(err, '')
        toast.error('La importación se cortó', {
          description:
            [
              processed > 0 ? `Se llegaron a procesar ${processed} filas.` : '',
              detail,
            ]
              .filter(Boolean)
              .join(' ') || undefined,
        })
      },
    )
  }

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!manualEmail.trim()) return
    await manualAction.run(
      'add',
      async () => {
        const r = await importAllowlist({
          orgId,
          rows: [
            {
              email: manualEmail.trim(),
              name: manualName.trim() || undefined,
            },
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
      },
      toastError('No se pudo agregar'),
    )
  }

  const handleRemove = (entryId: Id<'orgAllowlist'>) =>
    removeAction.run(
      entryId,
      () => removeEntry({ entryId }),
      toastError('No se pudo quitar'),
    )

  const q = search.trim().toLowerCase()
  const visible = (entries ?? [])
    .filter(
      (e) =>
        !q || e.email.includes(q) || (e.name ?? '').toLowerCase().includes(q),
    )
    .sort((a, b) => b.addedAt - a.addedAt)

  // People who already have a guest row for this event can't be added again.
  const guestStatusByEmail = new Map<string, GuestStatus>(
    (guests ?? []).map((g) => [g.email, g.status]),
  )
  const canAdd = (e: AllowlistEntry) =>
    guests !== undefined && !guestStatusByEmail.has(e.email)
  const selectedEntries = (entries ?? []).filter(
    (e) => selected.has(e._id) && canAdd(e),
  )
  const listedEntries = visible.filter(canAdd)
  // How many one press can add: the batch limit, or less when the event is
  // close to the approved guests it takes from this list.
  const room = Math.max(0, PREAPPROVED_ADD_APPROVED_LIMIT - event.approvedCount)
  const maxPerAdd = Math.min(MAX_PREAPPROVED_GUESTS_PER_ADD, room)

  const toggleSelected = (entryId: Id<'orgAllowlist'>, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(entryId)
      else next.delete(entryId)
      return next
    })

  const openAddToEvent = (target: Array<AllowlistEntry>) => {
    setAddTarget(target)
    setAddOpen(true)
  }

  const handleAddToEvent = async () => {
    const result = await addToEventAction.run(
      'add-to-event',
      () =>
        addPreapprovedGuests({
          eventId: event._id,
          entryIds: addTarget.map((e) => e._id),
        }),
      toastError('No se pudieron agregar al evento'),
    )
    if (!result) return
    const description = [
      addToEventSummary(result),
      lumaLinked && result.added > 0
        ? 'Luma las está agregando y les manda un email.'
        : '',
    ]
      .filter(Boolean)
      .join(' ')
    if (result.added > 0) {
      toast.success('Agregadas al evento como invitadas aprobadas', {
        description,
      })
    } else {
      toast.info('No se agregó a nadie', { description })
    }
    setSelected(new Set())
    setAddOpen(false)
  }

  return (
    <div className="space-y-6">
      <LumaContactsCard orgId={orgId} />
      <Card>
        <CardHeader>
          <CardTitle>Lista de preaprobados</CardTitle>
          <CardDescription>
            Quienes están en esta lista quedan aprobados apenas se anotan, acá o
            en Luma, en los eventos publicados que tengan prendido “Aprobar
            automáticamente a las personas preaprobadas” (está en la
            Configuración de cada evento). Aprobar a alguien lo agrega a esta
            lista. La lista es de la organización: es la misma para todos sus
            eventos.
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
                  {parsed.declined > 0 &&
                    ` · ${parsed.declined} rechazado${parsed.declined !== 1 ? 's' : ''} en Luma, que no se importa${parsed.declined !== 1 ? 'n' : ''}`}
                </p>
              </div>
              {parsed.rows.length > 0 && (
                <div
                  className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-1"
                  role="note"
                >
                  <p>
                    Importar preaprueba a estas personas. Si alguna tiene una
                    inscripción pendiente en un evento publicado que todavía no
                    pasó y que aprueba automáticamente a los preaprobados, queda
                    aprobada en el momento; en los eventos vinculados con Luma
                    también se aprueba allá, y Luma puede mandarle un email.
                  </p>
                  {parsed.notApproved > 0 && (
                    <p>
                      {parsed.notApproved === 1
                        ? '1 fila no figura como aprobada en Luma (pendiente, en lista de espera o invitada): se importa igual.'
                        : `${parsed.notApproved} filas no figuran como aprobadas en Luma (pendientes, en lista de espera o invitadas): se importan igual.`}
                    </p>
                  )}
                </div>
              )}
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
              <div className="rounded-md border p-4 space-y-3">
                <div className="space-y-1">
                  <p className="font-medium">Sumar a este evento</p>
                  <p className="text-sm text-muted-foreground">
                    Elegí personas de la lista para sumarlas a «{event.title}»
                    como invitadas aprobadas, sin que tengan que anotarse.{' '}
                    {lumaLinked
                      ? 'El evento está vinculado con Luma: Luma también las agrega como invitadas y les manda un email.'
                      : 'El evento no está vinculado con Luma: no se les manda ningún email.'}{' '}
                    {room === 0
                      ? `El evento ya tiene ${event.approvedCount} invitados aprobados y desde acá no se pueden sumar más.`
                      : room < MAX_PREAPPROVED_GUESTS_PER_ADD
                        ? `El evento tiene ${event.approvedCount} invitados aprobados: desde acá se pueden sumar hasta ${room} más.`
                        : `Hasta ${MAX_PREAPPROVED_GUESTS_PER_ADD} por vez.`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    className="min-h-11"
                    disabled={
                      selectedEntries.length === 0 ||
                      selectedEntries.length > maxPerAdd
                    }
                    onClick={() => openAddToEvent(selectedEntries)}
                  >
                    <UserPlus className="size-4 mr-2" />
                    Agregar al evento las elegidas ({selectedEntries.length})
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={
                      listedEntries.length === 0 ||
                      listedEntries.length > maxPerAdd
                    }
                    onClick={() => openAddToEvent(listedEntries)}
                  >
                    Agregar al evento todas las listadas acá (
                    {listedEntries.length})
                  </Button>
                  {selected.size > 0 && (
                    <Button
                      variant="ghost"
                      className="min-h-11"
                      onClick={() => setSelected(new Set())}
                    >
                      Quitar la selección
                    </Button>
                  )}
                </div>
                {maxPerAdd > 0 &&
                  (selectedEntries.length > maxPerAdd ||
                    listedEntries.length > maxPerAdd) && (
                    <p className="text-xs text-muted-foreground">
                      Se pueden agregar hasta {maxPerAdd} por vez: elegí menos
                      personas o acotá la lista con la búsqueda.
                      {lumaLinked &&
                        ' Entre una tanda y la siguiente esperá un minuto, que es lo que Luma tarda en recibirlas.'}
                    </p>
                  )}
              </div>
              <div className="overflow-x-auto -mx-6 px-6">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3">
                        <span className="sr-only">Elegir para este evento</span>
                      </th>
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
                        <td className="py-1.5 pr-3">
                          <Checkbox
                            className="size-5"
                            checked={selected.has(e._id) && canAdd(e)}
                            disabled={!canAdd(e)}
                            onCheckedChange={(v) =>
                              toggleSelected(e._id, v === true)
                            }
                            aria-label={`Elegir a ${e.email} para este evento`}
                          />
                        </td>
                        <td className="py-1.5 pr-3">
                          {e.email}
                          {guestStatusByEmail.has(e.email) && (
                            <Badge variant="outline" className="ml-2">
                              En el evento:{' '}
                              {
                                GUEST_STATUS_LABELS[
                                  guestStatusByEmail.get(e.email)!
                                ]
                              }
                            </Badge>
                          )}
                        </td>
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

      <AlertDialog
        open={addOpen}
        onOpenChange={(open) => {
          if (!addingToEvent) setAddOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Agregar {people(addTarget.length)} a este evento?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {addTarget.length === 1 ? 'Queda' : 'Quedan'} como{' '}
              {addTarget.length === 1
                ? 'invitada aprobada'
                : 'invitadas aprobadas'}{' '}
              de «{event.title}» sin anotarse.{' '}
              {lumaLinked
                ? `El evento está vinculado con Luma: Luma también ${addTarget.length === 1 ? 'la agrega como invitada y le' : 'las agrega como invitadas y les'} manda un email. Ese email no se puede deshacer.`
                : `El evento no está vinculado con Luma, así que ahora no se manda ningún email. Si más adelante lo vinculás, Luma ${addTarget.length === 1 ? 'la agrega como invitada y le' : 'las agrega como invitadas y les'} escribe.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="text-sm text-muted-foreground space-y-0.5">
            {addTarget.slice(0, 5).map((e) => (
              <li key={e._id} className="truncate">
                {e.email}
                {e.name ? ` · ${e.name}` : ''}
              </li>
            ))}
            {addTarget.length > 5 && <li>y {addTarget.length - 5} más</li>}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={addingToEvent}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              disabled={addingToEvent}
              onClick={(e) => {
                e.preventDefault()
                void handleAddToEvent()
              }}
            >
              {addingToEvent && (
                <Loader2 className="size-4 mr-2 animate-spin" />
              )}
              {lumaLinked
                ? `Agregar ${people(addTarget.length)} y que Luma les escriba`
                : `Agregar ${people(addTarget.length)} al evento`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/**
 * Pull the org's Luma contacts into the CRM. Pre-approving everyone Luma
 * counts as approved at a past event is opt-in.
 */
function LumaContactsCard({ orgId }: { orgId: Id<'organizations'> }) {
  const importLumaContacts = useAction(api.social.lumaCrm.importLumaContacts)
  const { busy, run } = useBusyAction<'luma'>()
  // Off unless asked for: it pre-approves a lot of people nobody reviewed.
  const [allowlistApproved, setAllowlistApproved] = useState(false)

  const onImport = async () => {
    const result = await run(
      'luma',
      () => importLumaContacts({ orgId, allowlistApproved }),
      toastError('No pudimos importar los contactos de Luma'),
    )
    if (!result) return
    const parts = [
      `${result.total} contactos en Luma`,
      `${result.created} nuevos en el CRM`,
      `${result.updated} actualizados`,
    ]
    if (allowlistApproved) parts.push(`${result.allowlisted} preaprobados`)
    toast.success(parts.join(' · '))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contactos de Luma</CardTitle>
        <CardDescription>
          Trae a todas las personas del calendario de Luma al CRM, con cuántos
          eventos les aprobaron y a cuántos hicieron check-in. No pisa datos que
          ya estén en el CRM. Podés repetirlo cuando quieras.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-2">
          <Checkbox
            id="luma-allowlist"
            checked={allowlistApproved}
            onCheckedChange={(v) => setAllowlistApproved(v === true)}
            aria-describedby="luma-allowlist-help"
            className="mt-0.5"
          />
          <div className="space-y-1">
            <Label
              htmlFor="luma-allowlist"
              className="font-normal leading-snug"
            >
              Además, preaprobar a todas las personas que alguna vez quedaron
              aprobadas en un evento de Luma
            </Label>
            <p
              id="luma-allowlist-help"
              className="text-xs text-muted-foreground"
            >
              Incluye a todos los que se anotaron en eventos sin aprobación,
              donde cualquiera queda aprobado al anotarse. Suma a la lista de
              preaprobados a gente que nadie revisó.
            </p>
          </div>
        </div>
        <Button onClick={onImport} disabled={busy !== null}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          Importar desde Luma
        </Button>
      </CardContent>
    </Card>
  )
}
