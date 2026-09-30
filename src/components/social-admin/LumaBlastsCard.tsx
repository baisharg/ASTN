import { useAction } from 'convex/react'
import { Loader2, Mail, RefreshCw, Send } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '../../../convex/_generated/dataModel'
import { toastError } from './shared'
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
import { Checkbox } from '~/components/ui/checkbox'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { Textarea } from '~/components/ui/textarea'
import { errorText } from '~/lib/convex-error'
import { useBusyAction } from '~/lib/use-busy-action'
import { formatEventDateTime, zonedToEpoch } from '~/lib/zoned-time'

type Blast = FunctionReturnType<typeof api.luma.api.listBlasts>[number]

type Recipient =
  | 'approved'
  | 'checked_in'
  | 'pending_approval'
  | 'waitlist'
  | 'invited'

const RECIPIENTS: Array<{ value: Recipient; label: string }> = [
  { value: 'approved', label: 'Aprobados (van)' },
  { value: 'checked_in', label: 'Hicieron check-in en Luma' },
  { value: 'pending_approval', label: 'Pendientes de aprobación' },
  { value: 'waitlist', label: 'Lista de espera' },
  { value: 'invited', label: 'Invitados que no se anotaron' },
]

const RECIPIENT_LABELS: Record<string, string> = {
  approved: 'aprobados',
  session: 'aprobados',
  checked_in: 'con check-in',
  pending_approval: 'pendientes',
  waitlist: 'lista de espera',
  invited: 'invitados',
  declined: 'rechazados',
}

const BLAST_STATUS: Record<string, { label: string; className: string }> = {
  scheduled: {
    label: 'Programado',
    className: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  sent: {
    label: 'Enviado',
    className: 'bg-green-50 text-green-700 border-green-200',
  },
  quarantined: {
    label: 'En revisión de Luma',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
}

/**
 * Email a Luma event's guests through Luma (a "blast"), now or later, and
 * see past blasts with how many people got and opened them.
 */
export function LumaBlastsCard({
  orgId,
  lumaEventId,
  timezone,
  counts,
}: {
  orgId: Id<'organizations'>
  lumaEventId: string
  timezone: string
  // From the last guest sync, to tell the admin roughly how many get it.
  counts: {
    approved: number | null
    pending: number | null
    checkedIn: number | null
  }
}) {
  const listBlasts = useAction(api.luma.api.listBlasts)
  const sendBlast = useAction(api.luma.api.sendBlast)
  const [blasts, setBlasts] = useState<Array<Blast> | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [subject, setSubject] = useState('')
  const [content, setContent] = useState('')
  const [recipients, setRecipients] = useState<Array<Recipient>>(['approved'])
  const [schedule, setSchedule] = useState(false)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('10:00')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const { busy, run } = useBusyAction<'send'>()

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      setBlasts(await listBlasts({ orgId, lumaEventId }))
    } catch (err) {
      setLoadError(errorText(err, 'No se pudieron leer los emails de Luma'))
    } finally {
      setLoading(false)
    }
  }, [listBlasts, orgId, lumaEventId])

  useEffect(() => {
    void load()
  }, [load])

  const scheduledFor =
    schedule && date && time ? zonedToEpoch(date, time, timezone) : undefined
  const scheduleInvalid =
    schedule && (!scheduledFor || scheduledFor <= Date.now())
  const canSend =
    content.trim() !== '' && recipients.length > 0 && !scheduleInvalid

  const estimate = (() => {
    const byGroup: Partial<Record<Recipient, number | null>> = {
      approved: counts.approved,
      pending_approval: counts.pending,
      checked_in: counts.checkedIn,
    }
    // Checked-in guests are also approved; don't count them twice.
    const groups = recipients.filter(
      (r) => !(r === 'checked_in' && recipients.includes('approved')),
    )
    let total = 0
    for (const g of groups) {
      const n = byGroup[g]
      if (n === undefined || n === null) return null
      total += n
    }
    return total
  })()

  const toggleRecipient = (value: Recipient, checked: boolean) =>
    setRecipients((prev) =>
      checked ? [...prev, value] : prev.filter((r) => r !== value),
    )

  const handleSend = () =>
    run(
      'send',
      async () => {
        const result = await sendBlast({
          orgId,
          lumaEventId,
          subject,
          contentMd: content,
          recipients,
          scheduledFor,
        })
        toast.success(
          result.status === 'scheduled' && scheduledFor
            ? 'Email programado en Luma'
            : 'Email enviado a Luma para mandar',
        )
        setSubject('')
        setContent('')
        setSchedule(false)
        setConfirmOpen(false)
        await load()
      },
      (err) => {
        setConfirmOpen(false)
        toastError('No se pudo enviar el email')(err)
      },
    )

  const recipientText = recipients
    .map((r) => RECIPIENTS.find((x) => x.value === r)?.label.toLowerCase())
    .join(', ')

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Escribir un email</CardTitle>
          <CardDescription>
            Luma lo manda desde el evento a los invitados que elijas. Una vez
            enviado no se puede recuperar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (canSend) setConfirmOpen(true)
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="blast-subject">Asunto (opcional)</Label>
              <Input
                id="blast-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Si lo dejás vacío: “Nuevo mensaje en …”"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="blast-content">Mensaje</Label>
              <Textarea
                id="blast-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={8}
                required
                aria-describedby="blast-content-help"
              />
              <p
                id="blast-content-help"
                className="text-xs text-muted-foreground"
              >
                Acepta Markdown: **negrita**, _cursiva_, listas y enlaces.
              </p>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium mb-1">
                ¿A quién le llega?
              </legend>
              {RECIPIENTS.map((r) => (
                <div key={r.value} className="flex items-center gap-2">
                  <Checkbox
                    id={`blast-to-${r.value}`}
                    checked={recipients.includes(r.value)}
                    onCheckedChange={(c) =>
                      toggleRecipient(r.value, c === true)
                    }
                  />
                  <Label
                    htmlFor={`blast-to-${r.value}`}
                    className="font-normal"
                  >
                    {r.label}
                  </Label>
                </div>
              ))}
            </fieldset>
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="blast-schedule">Programar el envío</Label>
                <Switch
                  id="blast-schedule"
                  checked={schedule}
                  onCheckedChange={setSchedule}
                />
              </div>
              {schedule && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="blast-date">Fecha</Label>
                    <Input
                      id="blast-date"
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="blast-time">Hora (del evento)</Label>
                    <Input
                      id="blast-time"
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                    />
                  </div>
                  {scheduleInvalid && date && (
                    <p className="text-xs text-red-600 sm:col-span-2">
                      Elegí un momento en el futuro.
                    </p>
                  )}
                </div>
              )}
            </div>
            <Button
              type="submit"
              className="min-h-11"
              disabled={!canSend || busy !== null}
            >
              <Send className="size-4 mr-2" />
              {schedule ? 'Programar email' : 'Enviar email'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Emails enviados</CardTitle>
            <CardDescription>
              Los de Luma para este evento, del más nuevo al más viejo.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={loading}
            onClick={() => void load()}
            aria-label="Actualizar"
            title="Actualizar"
          >
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </CardHeader>
        <CardContent>
          {blasts === null ? (
            loadError ? (
              <p className="text-sm text-red-700">{loadError}</p>
            ) : (
              <Spinner className="size-6 mx-auto" />
            )
          ) : blasts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Todavía no se mandó ningún email desde este evento.
            </p>
          ) : (
            <ul className="divide-y">
              {blasts.map((b) => (
                <li key={b.id} className="py-3 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Mail className="size-4 text-muted-foreground" />
                    <span className="font-medium">
                      {b.subject || 'Sin asunto'}
                    </span>
                    <Badge
                      variant="outline"
                      className={BLAST_STATUS[b.status]?.className}
                    >
                      {BLAST_STATUS[b.status]?.label ?? b.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {b.sentAt
                      ? `Enviado ${formatEventDateTime(b.sentAt, timezone)}`
                      : b.scheduledFor
                        ? `Programado para ${formatEventDateTime(b.scheduledFor, timezone)}`
                        : null}
                    {' · '}
                    Para{' '}
                    {[
                      ...new Set(
                        b.recipients.map((r) => RECIPIENT_LABELS[r] ?? r),
                      ),
                    ].join(', ') || 'aprobados'}
                    {b.status === 'sent' &&
                      ` · ${b.recipientCount} destinatario${b.recipientCount !== 1 ? 's' : ''}, ${b.openCount} lo abri${b.openCount !== 1 ? 'eron' : 'ó'}`}
                  </p>
                  <p className="text-sm text-muted-foreground line-clamp-2 whitespace-pre-line">
                    {b.contentMd}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {schedule ? '¿Programar este email?' : '¿Enviar este email?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Le va a llegar a gente real: {recipientText}
              {estimate !== null
                ? ` (unas ${estimate} persona${estimate !== 1 ? 's' : ''} según la última sincronización)`
                : ''}
              .{' '}
              {schedule && scheduledFor
                ? `Luma lo manda el ${formatEventDateTime(scheduledFor, timezone)}.`
                : 'Luma lo manda ahora.'}{' '}
              Una vez enviado no se puede recuperar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={busy !== null}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              disabled={busy !== null}
              onClick={(e) => {
                e.preventDefault()
                void handleSend()
              }}
            >
              {busy && <Loader2 className="size-4 mr-2 animate-spin" />}
              {schedule ? 'Sí, programar' : 'Sí, enviar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
