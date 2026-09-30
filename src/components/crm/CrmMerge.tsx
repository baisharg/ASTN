import { Link } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import {
  AlertTriangle,
  ArrowLeft,
  Copy,
  GitMerge,
  Search,
  UserCheck,
  UserX,
} from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { toastError } from '~/components/social-admin/shared'
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
import { Checkbox } from '~/components/ui/checkbox'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet'
import { Spinner } from '~/components/ui/spinner'
import { useBusyAction } from '~/lib/use-busy-action'
import { cn } from '~/lib/utils'

/**
 * Merging duplicate contacts (convex/contacts/merge.ts): the side-by-side
 * comparison, the merge dialog used from the bulk bar and the person page,
 * and the sheet listing likely duplicates.
 */

type ContactId = Id<'crmContacts'>
type OrgId = Id<'organizations'>
export type ContactSummary = FunctionReturnType<
  typeof api.contacts.merge.contactSummaries
>[number]
type DuplicateGroup = FunctionReturnType<
  typeof api.contacts.merge.findDuplicates
>[number]
type Reason = DuplicateGroup['reasons'][number]

// What one merge may involve (convex/contacts/merge.ts): contacts, the
// kept one included, and history rows of all of them together.
export const MAX_MERGE_SELECTION = 5
const MAX_MERGE_HISTORY = 1000

const REASON_LABELS: Record<Reason, string> = {
  sameEmail: 'Comparten un email',
  sameLinkedin: 'Mismo LinkedIn',
  samePhone: 'Mismo teléfono',
  sameName: 'Mismo nombre',
  similarName: 'Nombre y email parecidos',
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// ── Comparison ───────────────────────────────────────────────────────────

function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="flex gap-2 text-sm">
      <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  )
}

/** One card per contact with a radio to pick the one that stays. */
function MergeCompare({
  members,
  keepId,
  onKeepChange,
  excluded,
  onExcludedChange,
  orgSlug,
  disabled,
}: {
  members: Array<ContactSummary>
  keepId: ContactId
  onKeepChange: (id: ContactId) => void
  // With three or more, some can be left out of the merge.
  excluded: Set<ContactId>
  onExcludedChange: (id: ContactId, excluded: boolean) => void
  orgSlug?: string
  disabled?: boolean
}) {
  const base = useId()
  return (
    <RadioGroup
      value={keepId}
      onValueChange={(v) => onKeepChange(v as ContactId)}
      disabled={disabled}
      aria-label="Contacto que se conserva"
      className="grid gap-3 sm:grid-cols-2"
    >
      {members.map((m) => {
        const keep = m._id === keepId
        const left = !keep && excluded.has(m._id)
        const id = `${base}-${m._id}`
        return (
          <div
            key={m._id}
            className={cn(
              'rounded-lg border p-3 transition-colors',
              keep ? 'border-primary bg-primary/5' : 'bg-background',
              left && 'opacity-60',
            )}
          >
            <div className="flex items-start gap-2">
              <RadioGroupItem id={id} value={m._id} className="mt-1" />
              <div className="min-w-0 flex-1">
                <Label htmlFor={id} className="cursor-pointer text-base">
                  {m.name}
                </Label>
                <p
                  className={cn(
                    'text-xs',
                    keep ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  {keep
                    ? 'Se conserva'
                    : left
                      ? 'Queda como está'
                      : 'Se fusiona y se borra'}
                </p>
                {!keep && members.length > 2 && (
                  <label className="mt-1 flex items-center gap-1.5 text-xs">
                    <Checkbox
                      checked={!left}
                      disabled={disabled}
                      onCheckedChange={(v) =>
                        onExcludedChange(m._id, v !== true)
                      }
                    />
                    Incluir en la fusión
                  </label>
                )}
              </div>
              {orgSlug && (
                <Link
                  to="/org/$slug/admin/crm/people/$contactId"
                  params={{ slug: orgSlug, contactId: m._id }}
                  className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
                  target="_blank"
                >
                  Ver ficha
                </Link>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {m.hasAccount && (
                <Badge
                  variant="outline"
                  className="border-green-200 bg-green-50 text-green-700"
                >
                  <UserCheck />
                  Cuenta vinculada
                </Badge>
              )}
              {m.fromAirtable && (
                <Badge
                  variant="outline"
                  className="border-yellow-200 bg-yellow-50 text-yellow-800"
                >
                  Airtable
                </Badge>
              )}
              {m.source && <Badge variant="outline">{m.source}</Badge>}
            </div>
            <dl className="mt-2 space-y-1">
              <Fact
                label="Emails"
                value={
                  [m.email, ...m.otherEmails].filter(Boolean).join(', ') ||
                  'Sin email'
                }
              />
              <Fact label="Teléfono" value={m.phone} />
              <Fact label="LinkedIn" value={m.linkedin} />
              <Fact label="Ubicación" value={m.location} />
              <Fact label="Vínculo" value={m.relationship} />
              <Fact label="Primer contacto" value={m.firstContact} />
              <Fact
                label="Historial"
                value={
                  m.activityCount > MAX_MERGE_HISTORY
                    ? `Más de ${MAX_MERGE_HISTORY} registros`
                    : plural(m.activityCount, 'registro', 'registros')
                }
              />
              <Fact
                label="Datos"
                value={plural(m.filled, 'campo completo', 'campos completos')}
              />
              <Fact label="Creado" value={formatDate(m.createdAt)} />
            </dl>
          </div>
        )
      })}
    </RadioGroup>
  )
}

// ── Merge action ─────────────────────────────────────────────────────────

function useMerge(orgId: OrgId) {
  const merge = useMutation(api.contacts.merge.mergeContacts)
  const { busy, run } = useBusyAction<'merge' | 'dismiss'>()
  const mergeInto = (
    keep: ContactSummary,
    others: Array<ContactSummary>,
    onDone?: (keepId: ContactId) => void,
  ) =>
    run(
      'merge',
      async () => {
        await merge({
          orgId,
          keepId: keep._id,
          mergeIds: others.map((o) => o._id),
        })
        toast.success(
          others.length === 1
            ? `Se fusionó ${others[0].name} en ${keep.name}`
            : `Se fusionaron ${others.length} contactos en ${keep.name}`,
        )
        onDone?.(keep._id)
      },
      toastError('No se pudo fusionar'),
    )
  return { busy, run, mergeInto }
}

function ConfirmMerge({
  open,
  onOpenChange,
  keep,
  others,
  busy,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  keep: ContactSummary | undefined
  others: Array<ContactSummary>
  busy: boolean
  onConfirm: () => void
}) {
  if (!keep) return null
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            ¿Fusionar {plural(others.length + 1, 'contacto', 'contactos')} en{' '}
            {keep.name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {others.map((o) => o.name).join(', ')}{' '}
            {others.length === 1 ? 'se borra' : 'se borran'}. Sus emails, su
            historial y los datos que falten pasan a {keep.name}. No se puede
            deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
          >
            {busy ? 'Fusionando…' : 'Fusionar'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Same order as the backend's suggestKeep: account, Airtable, filled, oldest. */
function suggestedKeep(members: Array<ContactSummary>): ContactId {
  return [...members].sort(
    (a, b) =>
      Number(b.hasAccount) - Number(a.hasAccount) ||
      Number(b.fromAirtable) - Number(a.fromAirtable) ||
      b.filled - a.filled ||
      a.createdAt - b.createdAt,
  )[0]._id
}

/** Compare, pick the one to keep, confirm and merge. */
function MergePanel({
  orgId,
  orgSlug,
  members,
  defaultKeepId,
  onMerged,
  extraActions,
}: {
  orgId: OrgId
  orgSlug?: string
  members: Array<ContactSummary>
  defaultKeepId?: ContactId
  onMerged?: (keepId: ContactId) => void
  extraActions?: ReactNode
}) {
  const [picked, setPicked] = useState<ContactId | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [excluded, setExcluded] = useState<Set<ContactId>>(() => new Set())
  const { busy, mergeInto } = useMerge(orgId)
  const keepId =
    picked && members.some((m) => m._id === picked)
      ? picked
      : (defaultKeepId ?? suggestedKeep(members))
  const keep = members.find((m) => m._id === keepId)
  const others = members.filter((m) => m._id !== keepId && !excluded.has(m._id))
  const included = [keep, ...others].filter(
    (m): m is ContactSummary => m !== undefined,
  )
  const accounts = new Set(
    included.filter((m) => m.hasAccount).map((m) => m._id),
  )
  const history = included.reduce((n, m) => n + m.activityCount, 0)
  // Merges the backend is known to refuse, with the reason.
  const blockedReason =
    included.length > MAX_MERGE_SELECTION
      ? `Se pueden fusionar hasta ${MAX_MERGE_SELECTION} contactos a la vez; sacá alguno de la fusión.`
      : history > MAX_MERGE_HISTORY
        ? `Entre todos tienen más de ${MAX_MERGE_HISTORY} registros de historial; no se pueden fusionar desde acá.`
        : null

  return (
    <div className="space-y-3">
      <MergeCompare
        members={members}
        keepId={keepId}
        onKeepChange={setPicked}
        excluded={excluded}
        onExcludedChange={(id, out) =>
          setExcluded((prev) => {
            const next = new Set(prev)
            if (out) next.add(id)
            else next.delete(id)
            return next
          })
        }
        orgSlug={orgSlug}
        disabled={busy === 'merge'}
      />
      {accounts.size > 1 && (
        <p className="flex items-center gap-2 text-sm text-amber-700">
          <AlertTriangle className="size-4 shrink-0" />
          Más de uno tiene cuenta vinculada: si son cuentas distintas, no se
          pueden fusionar.
        </p>
      )}
      {blockedReason && (
        <p className="flex items-center gap-2 text-sm text-amber-700">
          <AlertTriangle className="size-4 shrink-0" />
          {blockedReason}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {extraActions}
        <Button
          size="sm"
          disabled={busy === 'merge' || others.length === 0 || !!blockedReason}
          onClick={() => setConfirmOpen(true)}
        >
          <GitMerge className="size-4" />
          Fusionar
        </Button>
      </div>
      <ConfirmMerge
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        keep={keep}
        others={others}
        busy={busy === 'merge'}
        onConfirm={() => {
          if (!keep) return
          void mergeInto(keep, others, (id) => {
            setConfirmOpen(false)
            onMerged?.(id)
          })
        }}
      />
    </div>
  )
}

// ── Merge dialog (bulk bar, person page) ─────────────────────────────────

export function CrmMergeDialog({
  open,
  onOpenChange,
  orgId,
  orgSlug,
  ids,
  defaultKeepId,
  onMerged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: OrgId
  orgSlug?: string
  ids: Array<ContactId>
  defaultKeepId?: ContactId
  onMerged?: (keepId: ContactId) => void
}) {
  const members = useQuery(
    api.contacts.merge.contactSummaries,
    open ? { orgId, ids } : 'skip',
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Fusionar contactos</DialogTitle>
          <DialogDescription>
            Elegí cuál se conserva. Los demás se borran: sus emails, su
            historial y los datos que le falten al elegido pasan a él.
          </DialogDescription>
        </DialogHeader>
        {members === undefined ? (
          <Spinner className="mx-auto size-6" />
        ) : members.length < 2 ? (
          <p className="text-sm text-muted-foreground">
            Hacen falta al menos dos contactos.
          </p>
        ) : (
          <MergePanel
            orgId={orgId}
            orgSlug={orgSlug}
            members={members}
            defaultKeepId={defaultKeepId}
            onMerged={(id) => {
              onOpenChange(false)
              onMerged?.(id)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── "Fusionar con…" from the person page ─────────────────────────────────

type ListedContact = {
  _id: ContactId
  name: string
  email?: string
  otherEmails?: Array<string>
}

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export function MergeWithDialog({
  open,
  onOpenChange,
  orgId,
  orgSlug,
  contactId,
  onMerged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: OrgId
  orgSlug: string
  contactId: ContactId
  // After a successful merge, with the contact that was kept.
  onMerged?: (keepId: ContactId) => void
}) {
  const [search, setSearch] = useState('')
  const [other, setOther] = useState<ContactId | null>(null)
  const contacts = useQuery(
    api.crm.listContacts,
    open && !other ? { orgId } : 'skip',
  ) as Array<ListedContact> | undefined
  const members = useQuery(
    api.contacts.merge.contactSummaries,
    open && other ? { orgId, ids: [contactId, other] } : 'skip',
  )

  const matches = useMemo(() => {
    const q = fold(search.trim())
    if (!contacts || q.length < 2) return []
    return contacts
      .filter((c) => c._id !== contactId)
      .filter((c) =>
        [c.name, c.email ?? '', ...(c.otherEmails ?? [])].some((s) =>
          fold(s).includes(q),
        ),
      )
      .slice(0, 20)
  }, [contacts, search, contactId])

  const close = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      setOther(null)
      setSearch('')
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Fusionar con otro contacto</DialogTitle>
          <DialogDescription>
            {other
              ? 'Elegí cuál se conserva. El otro se borra y su información pasa al elegido.'
              : 'Buscá a la misma persona por nombre o email.'}
          </DialogDescription>
        </DialogHeader>
        {!other ? (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                autoFocus
                aria-label="Buscar contacto"
                placeholder="Nombre o email"
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {contacts === undefined ? (
              <Spinner className="mx-auto size-5" />
            ) : search.trim().length < 2 ? (
              <p className="text-sm text-muted-foreground">
                Escribí al menos dos letras.
              </p>
            ) : matches.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay contactos que coincidan.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {matches.map((c) => (
                  <li key={c._id}>
                    <button
                      type="button"
                      className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-slate-50"
                      onClick={() => setOther(c._id)}
                    >
                      <span className="text-sm font-medium">{c.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {[c.email, ...(c.otherEmails ?? [])]
                          .filter(Boolean)
                          .join(', ') || 'Sin email'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : members === undefined ? (
          <Spinner className="mx-auto size-6" />
        ) : members.length < 2 ? (
          <p className="text-sm text-muted-foreground">
            Ese contacto ya no existe.
          </p>
        ) : (
          <MergePanel
            orgId={orgId}
            orgSlug={orgSlug}
            members={members}
            defaultKeepId={contactId}
            onMerged={(id) => {
              close(false)
              onMerged?.(id)
            }}
            extraActions={
              <Button
                size="sm"
                variant="ghost"
                className="mr-auto"
                onClick={() => setOther(null)}
              >
                <ArrowLeft className="size-4" />
                Elegir otro
              </Button>
            }
          />
        )}
        {!other && (
          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)}>
              Cancelar
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Duplicates ───────────────────────────────────────────────────────────

/** The "Duplicados (N)" button and its sheet, for the contacts table. */
export function CrmDuplicatesButton({
  orgId,
  orgSlug,
}: {
  orgId: OrgId
  orgSlug: string
}) {
  const [open, setOpen] = useState(false)
  const groups = useQuery(api.contacts.merge.findDuplicates, { orgId })
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={groups === undefined}
        onClick={() => setOpen(true)}
      >
        <Copy className="size-4" />
        Duplicados{groups ? ` (${groups.length})` : ''}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>Posibles duplicados</SheetTitle>
            <SheetDescription>
              Contactos que parecen la misma persona. Elegí cuál se conserva y
              fusionalos, o marcalos como personas distintas para que no vuelvan
              a aparecer.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-6">
            {groups === undefined ? (
              <Spinner className="mx-auto size-6" />
            ) : groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No encontramos duplicados.
              </p>
            ) : (
              groups.map((g) => (
                <DuplicateGroupCard
                  key={g.ids.join('|')}
                  orgId={orgId}
                  orgSlug={orgSlug}
                  group={g}
                />
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

function DuplicateGroupCard({
  orgId,
  orgSlug,
  group,
}: {
  orgId: OrgId
  orgSlug: string
  group: DuplicateGroup
}) {
  const dismiss = useMutation(api.contacts.merge.dismissDuplicate)
  const { busy, run } = useBusyAction<'dismiss'>()
  const [open, setOpen] = useState(false)
  // History counts are read only for a group being reviewed.
  const summaries = useQuery(
    api.contacts.merge.contactSummaries,
    open && !group.blocked ? { orgId, ids: group.ids } : 'skip',
  )
  const dismissGroup = () =>
    run(
      'dismiss',
      async () => {
        await dismiss({ orgId, ids: group.ids })
        toast.success('Listo, no los vamos a sugerir de nuevo')
      },
      toastError('No se pudo guardar'),
    )
  const notSame = (
    <Button
      size="sm"
      variant="outline"
      className="mr-auto"
      disabled={busy === 'dismiss'}
      onClick={() => void dismissGroup()}
    >
      <UserX className="size-4" />
      No son la misma persona
    </Button>
  )

  return (
    <section className="space-y-3 rounded-lg border bg-slate-50/60 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {group.reasons.map((r) => (
          <Badge key={r} variant="secondary">
            {REASON_LABELS[r]}
          </Badge>
        ))}
      </div>
      {group.blocked && (
        <p className="flex items-center gap-2 text-sm text-amber-700">
          <AlertTriangle className="size-4 shrink-0" />
          Están vinculados a dos cuentas de ASTN distintas; no se pueden
          fusionar.
        </p>
      )}
      {open && !group.blocked ? (
        summaries === undefined ? (
          <Spinner className="mx-auto size-5" />
        ) : summaries.length < 2 ? (
          <p className="text-sm text-muted-foreground">
            Alguno de estos contactos ya no existe.
          </p>
        ) : (
          <MergePanel
            orgId={orgId}
            orgSlug={orgSlug}
            members={summaries}
            defaultKeepId={group.suggestedKeepId}
            extraActions={notSame}
          />
        )
      ) : (
        <>
          <ul className="space-y-1 text-sm">
            {group.members.map((m) => (
              <li key={m._id}>
                <span className="font-medium">{m.name}</span>
                <span className="text-muted-foreground">
                  {' '}
                  ·{' '}
                  {[m.email, ...m.otherEmails].filter(Boolean).join(', ') ||
                    'Sin email'}
                  {m.hasAccount && ' · cuenta vinculada'}
                  {m.fromAirtable && ' · Airtable'}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {notSame}
            {!group.blocked && (
              <Button size="sm" onClick={() => setOpen(true)}>
                <GitMerge className="size-4" />
                Revisar y fusionar
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  )
}
