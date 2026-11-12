import { useAction } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { Download, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import { PERSONAL_LINKS_PER_CALL } from '../../../convex/social/constants'
import type { Id } from '../../../convex/_generated/dataModel'
import { toastError } from './shared'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { personalLinksCsv } from '~/lib/personalLinksCsv'
import type { PersonalLinkCsvRow } from '~/lib/personalLinksCsv'

/**
 * Personal links in the admin's Guests tab: one for a single guest, or a CSV
 * for every approved guest.
 *
 * A personal link is a credential. Here it is only ever held in memory and
 * handed to the clipboard or to a downloaded file: never rendered on the
 * page, in a toast or in the console.
 */

type LinkGuest = {
  _id: Id<'socialEventGuests'>
  email: string
  name: string | null
}

type LinkResult = FunctionReturnType<
  typeof api.social.events.createPersonalLinks
>['results'][number]

type NoLinkReason = NonNullable<LinkResult['noLinkReason']>

const NO_LINK_REASONS: Record<NoLinkReason, string> = {
  account_in_use: 'Ya usa su cuenta de ASTN: entra con su email, como siempre.',
  email_not_primary:
    'Su email está en una cuenta de ASTN, pero no como email principal verificado.',
  account_has_role: 'Su cuenta administra una organización.',
  email_has_other_data:
    'Su email ya tiene datos en ASTN fuera de esta organización.',
  not_approved: 'Ya no está aprobado para este evento.',
  clerk_error: 'No se pudo crear la cuenta o el link.',
}

function noLinkText(result: LinkResult): string {
  if (!result.noLinkReason) return ''
  const text = NO_LINK_REASONS[result.noLinkReason]
  return result.clerkErrorCode ? `${text} (${result.clerkErrorCode})` : text
}

function formatExpiry(expiresAt: number): string {
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(expiresAt)
}

const WHAT_A_LINK_IS =
  'Un link personal abre la página del evento con la sesión ya iniciada como esa persona, sin registrarse ni verificar su email.'
const CREATES_ACCOUNTS =
  'A quien no tenga cuenta en ASTN se le crea una con el email con el que está invitado.'
const LINK_IS_A_KEY =
  'Quien tenga el link entra como esa persona: mandalo solo a su email. Funciona una sola vez y vence cuando terminan los 1:1 del evento (como mucho, a los 7 días). ASTN no manda ningún email.'
const NO_SECOND_LINK =
  'Solo hay link personal para cuentas que nadie usó todavía. Una vez que la persona entró, no se le puede hacer otro: después entra con su email, como siempre. No abras el link de un invitado para probarlo, porque queda usado.'

/**
 * The dialog behind "Copiar link personal": says what will happen, makes the
 * link when the admin confirms, and copies it on a second press (browsers
 * only allow copying right after a press).
 */
export function CopyPersonalLinkDialog({
  eventId,
  guest,
  open,
  onOpenChange,
}: {
  eventId: Id<'socialEvents'>
  // Stays set while the dialog closes, so its text doesn't empty out.
  guest: LinkGuest | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const createLinks = useAction(api.social.events.createPersonalLinks)
  const [working, setWorking] = useState(false)
  const [made, setMade] = useState<{
    guestId: Id<'socialEventGuests'>
    result: LinkResult
    expiresAt: number
  } | null>(null)
  // A link made for one guest is never offered for another.
  const current = made && guest && made.guestId === guest._id ? made : null

  const close = () => {
    setMade(null)
    onOpenChange(false)
  }

  const create = async () => {
    if (!guest) return
    setWorking(true)
    try {
      const response = await createLinks({ eventId, guestIds: [guest._id] })
      const result = response.results[0]
      setMade({ guestId: guest._id, result, expiresAt: response.expiresAt })
    } catch (error) {
      toastError('No se pudo crear el link')(error)
    } finally {
      setWorking(false)
    }
  }

  const copy = async () => {
    const link = current?.result.link
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      toast.success('Link personal copiado')
      close()
    } catch {
      toast.error('No se pudo copiar. Probá de nuevo.')
    }
  }

  const who = guest?.name ?? guest?.email ?? ''
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (working) return
        if (next) onOpenChange(true)
        else close()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Link personal de {who}</AlertDialogTitle>
          <AlertDialogDescription>
            {current === null
              ? `${WHAT_A_LINK_IS} ${CREATES_ACCOUNTS} ${LINK_IS_A_KEY} ${NO_SECOND_LINK}`
              : current.result.link
                ? `El link para ${guest?.email} está listo${
                    current.result.accountCreated
                      ? ' y se le creó una cuenta'
                      : ''
                  }. Vence el ${formatExpiry(current.expiresAt)}. Copialo y mandáselo solo a esa persona.`
                : `No hay link personal para ${guest?.email}. ${noLinkText(current.result)}`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11" disabled={working}>
            {current === null ? 'Cancelar' : 'Cerrar'}
          </AlertDialogCancel>
          {current === null ? (
            <Button
              className="min-h-11"
              disabled={working}
              onClick={() => void create()}
            >
              {working && <Loader2 className="size-4 mr-2 animate-spin" />}
              Crear link (y la cuenta, si no tiene)
            </Button>
          ) : (
            current.result.link && (
              <Button className="min-h-11" onClick={() => void copy()}>
                Copiar link
              </Button>
            )
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

type ExportState =
  | { step: 'idle' }
  | { step: 'working'; done: number; total: number }
  | {
      step: 'ready'
      csv: string
      expiresAt: number
      personal: number
      accountsCreated: number
      // Guests in the file with the event's plain address instead.
      withoutLink: Array<{ email: string; why: string }>
      // Guests the export did not reach because a request failed.
      missing: number
    }

function downloadCsv(csv: string) {
  const url = URL.createObjectURL(
    new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `links-personales-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  // Released after the browser has had time to start the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** The card that exports a CSV of personal links for the approved guests. */
export function PersonalLinksCard({
  eventId,
  approvedGuests,
}: {
  eventId: Id<'socialEvents'>
  approvedGuests: Array<LinkGuest>
}) {
  const createLinks = useAction(api.social.events.createPersonalLinks)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [state, setState] = useState<ExportState>({ step: 'idle' })
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const runExport = async () => {
    setConfirmOpen(false)
    const guests = approvedGuests
    const total = guests.length
    setState({ step: 'working', done: 0, total })

    const rows: Array<PersonalLinkCsvRow> = []
    const withoutLink: Array<{ email: string; why: string }> = []
    let personal = 0
    let accountsCreated = 0
    let expiresAt = 0
    let done = 0
    try {
      for (let i = 0; i < total; i += PERSONAL_LINKS_PER_CALL) {
        const batch = guests.slice(i, i + PERSONAL_LINKS_PER_CALL)
        const response = await createLinks({
          eventId,
          guestIds: batch.map((g) => g._id),
        })
        if (!mounted.current) return
        expiresAt = response.expiresAt
        for (const result of response.results) {
          const guest = batch.find((g) => g._id === result.guestId)
          if (result.accountCreated) accountsCreated++
          // Someone no longer approved is left out of the file.
          if (result.noLinkReason === 'not_approved') continue
          if (result.link) personal++
          else
            withoutLink.push({ email: result.email, why: noLinkText(result) })
          rows.push({
            name: guest?.name ?? null,
            email: result.email,
            link: result.link ?? response.eventUrl,
            signsIn: result.link !== null,
          })
        }
        done += batch.length
        setState({ step: 'working', done, total })
      }
    } catch (error) {
      if (!mounted.current) return
      toastError('La exportación se interrumpió')(error)
      if (rows.length === 0) {
        setState({ step: 'idle' })
        return
      }
    }
    setState({
      step: 'ready',
      csv: personalLinksCsv(rows),
      expiresAt,
      personal,
      accountsCreated,
      withoutLink,
      missing: total - done,
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Links personales</CardTitle>
        <CardDescription>
          {WHAT_A_LINK_IS} Podés copiar el de una persona desde la lista de
          abajo, o exportar un CSV con nombre, email y link de los aprobados
          para mandar los mails con una combinación de correspondencia.{' '}
          {CREATES_ACCOUNTS} {LINK_IS_A_KEY} {NO_SECOND_LINK}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.step === 'working' ? (
          <p className="flex items-center gap-2 text-sm" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Creando links: {state.done} de {state.total}. No cierres esta
            pestaña.
          </p>
        ) : (
          <Button
            variant="outline"
            className="min-h-11"
            disabled={approvedGuests.length === 0}
            onClick={() => setConfirmOpen(true)}
          >
            Exportar CSV de links personales (crea cuentas a quienes no tienen)
          </Button>
        )}

        {state.step === 'ready' && (
          <div className="space-y-3 rounded-lg border p-4 text-sm">
            <p>
              {state.personal} links personales listos
              {state.accountsCreated > 0
                ? ` (se crearon ${state.accountsCreated} cuentas)`
                : ''}
              . Vencen el {formatExpiry(state.expiresAt)}.
              {state.missing > 0 &&
                ` La exportación se interrumpió: faltan ${state.missing} invitados. Volvé a exportar para incluirlos.`}
            </p>
            {state.withoutLink.length > 0 && (
              <details>
                <summary className="cursor-pointer">
                  {state.withoutLink.length} van con el link común del evento
                  (columna sesion_iniciada = no) e inician sesión como siempre
                </summary>
                <ul className="mt-2 space-y-1 text-muted-foreground">
                  {state.withoutLink.map((row) => (
                    <li key={row.email}>
                      {row.email}: {row.why}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p className="text-muted-foreground">
              El archivo contiene links que inician sesión: cuidalo como una
              lista de contraseñas y borralo después de mandar los mails.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                className="min-h-11"
                onClick={() => downloadCsv(state.csv)}
              >
                <Download className="size-4 mr-2" aria-hidden />
                Descargar CSV
              </Button>
              <Button
                variant="ghost"
                className="min-h-11"
                onClick={() => setState({ step: 'idle' })}
              >
                Descartar
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Crear links personales para los {approvedGuests.length} invitados
              aprobados?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {CREATES_ACCOUNTS} Esas cuentas quedan creadas aunque después no
              mandes los links. {LINK_IS_A_KEY} Quien ya usa su cuenta de ASTN
              va en el archivo con el link común del evento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancelar</AlertDialogCancel>
            <Button className="min-h-11" onClick={() => void runExport()}>
              Crear cuentas y links
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
