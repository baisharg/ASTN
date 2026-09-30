import {
  Link,
  createFileRoute,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import {
  CalendarDays,
  ClipboardList,
  FileText,
  GitMerge,
  GraduationCap,
  Link2,
  Pencil,
  Plus,
  Presentation,
  StickyNote,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../../../../../../convex/_generated/api'
import type { Doc, Id } from '../../../../../../../convex/_generated/dataModel'
import type {
  CrmColumn,
  CrmRecord,
  FieldDef,
} from '~/components/crm/fieldValues'
import {
  buildColumns,
  coreColumns,
  readValue,
} from '~/components/crm/fieldValues'
import { FieldInput } from '~/components/crm/CrmFieldControls'
import { MergeWithDialog } from '~/components/crm/CrmMerge'
import { useCrmActions } from '~/components/crm/useCrmActions'
import {
  GUEST_STATUS_LABELS,
  OrgAdminGate,
  PageShell,
  toastError,
} from '~/components/social-admin/shared'
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
import { Card } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Spinner } from '~/components/ui/spinner'
import { Textarea } from '~/components/ui/textarea'
import { useBusyAction } from '~/lib/use-busy-action'
import { cn } from '~/lib/utils'

export const Route = createFileRoute('/org/$slug/admin/crm/people/$contactId')({
  component: PersonRoute,
})

function PersonRoute() {
  const { slug, contactId } = Route.useParams()
  return (
    <OrgAdminGate slug={slug}>
      {(org) => (
        <PersonPage
          key={contactId}
          org={org}
          slug={slug}
          contactId={contactId as Id<'crmContacts'>}
        />
      )}
    </OrgAdminGate>
  )
}

// ── Types from getPerson (returns v.any) ─────────────────────────────────

type TimelineKind =
  | 'application'
  | 'event'
  | 'program'
  | 'session'
  | 'form'
  | 'note'
type TimelineSource = 'app' | 'luma' | 'airtable' | 'manual'

type TimelineItem = {
  kind: TimelineKind
  title: string
  status: string | null
  at: number | null
  source: TimelineSource
  href: string | null
  activityId: Id<'crmActivities'> | null
  details: Record<string, unknown> | null
}

type Person = {
  contact: Doc<'crmContacts'>
  emails: Array<string>
  profile: {
    name: string | null
    headline: string | null
    location: string | null
    linkedinUrl: string | null
    seeking: string | null
    canHelpWith: string | null
    careerGoals: string | null
    skills: Array<string>
    interests: Array<string>
  } | null
  timeline: Array<TimelineItem>
}

// ── Field layout ─────────────────────────────────────────────────────────

const FIELD_GROUPS: Array<{ title: string; keys: Array<string> }> = [
  {
    title: 'Perfil profesional',
    keys: [
      'title',
      'professionalField',
      'careerStage',
      'aiSafetyExperience',
      'skills',
      'interests',
      'availability',
    ],
  },
  {
    title: 'Relación con la organización',
    keys: [
      'relationship',
      'role',
      'contactSource',
      'contactPerson',
      'firstContact',
      'associatedOrganizations',
      'participatedIn',
      'inBuenosAires',
    ],
  },
  { title: 'Luma', keys: ['lumaApproved', 'lumaCheckedIn', 'lumaTags'] },
]

const CONTACT_INFO_KEYS = ['phone', 'linkedin', 'website', 'location']

// ── Timeline labels ──────────────────────────────────────────────────────

const KIND_META: Record<TimelineKind, { label: string; icon: LucideIcon }> = {
  application: { label: 'Postulación', icon: FileText },
  event: { label: 'Evento', icon: CalendarDays },
  program: { label: 'Programa', icon: GraduationCap },
  session: { label: 'Sesión', icon: Presentation },
  form: { label: 'Formulario', icon: ClipboardList },
  note: { label: 'Nota', icon: StickyNote },
}

const SOURCE_META: Record<
  TimelineSource,
  { label: string; className: string }
> = {
  app: { label: 'ASTN', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  luma: {
    label: 'Luma',
    className: 'bg-pink-50 text-pink-700 border-pink-200',
  },
  airtable: {
    label: 'Airtable',
    className: 'bg-yellow-50 text-yellow-800 border-yellow-200',
  },
  manual: {
    label: 'Manual',
    className: 'bg-slate-50 text-slate-600 border-slate-200',
  },
}

const STATUS_LABELS: Record<string, string> = {
  ...GUEST_STATUS_LABELS,
  checked_in: 'Hizo check-in',
  submitted: 'Enviada',
  under_review: 'En revisión',
  accepted: 'Aceptada',
  next_edition: 'Próxima edición',
  rejected: 'Rechazada',
  redirected: 'Derivada a otro curso',
  waitlisted: 'En espera',
  participated: 'Participó',
  pending: 'Pendiente',
  enrolled: 'Inscripto',
  completed: 'Completó',
  withdrawn: 'Se bajó',
  removed: 'Dado de baja',
}

function formatWhen(at: number | null): string {
  if (!at) return 'Sin fecha'
  return new Date(at).toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// ── Page ─────────────────────────────────────────────────────────────────

function PersonPage({
  org,
  slug,
  contactId,
}: {
  org: Doc<'organizations'>
  slug: string
  contactId: Id<'crmContacts'>
}) {
  const person = useQuery(api.contacts.people.getPerson, {
    orgId: org._id,
    contactId,
  }) as Person | null | undefined
  const defs = useQuery(api.contacts.records.listFields, {
    orgId: org._id,
    collection: 'contacts',
  })

  if (person === undefined || defs === undefined) {
    return (
      <PageShell>
        <Spinner className="size-8 mx-auto" />
      </PageShell>
    )
  }

  if (person === null) {
    return (
      <PageShell>
        <div className="max-w-lg mx-auto py-12 text-center space-y-4">
          <p className="text-lg font-medium">
            Este contacto ya no existe (puede haber sido fusionado)
          </p>
          <Button asChild variant="outline">
            <Link to="/org/$slug/admin/crm" params={{ slug }}>
              Volver al CRM
            </Link>
          </Button>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <div className="max-w-6xl mx-auto space-y-6">
        <nav
          aria-label="Ruta"
          className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
        >
          <Link
            to="/org/$slug"
            params={{ slug }}
            className="hover:text-slate-700"
          >
            {org.name}
          </Link>
          <span aria-hidden>/</span>
          <Link
            to="/org/$slug/admin"
            params={{ slug }}
            className="hover:text-slate-700"
          >
            Admin
          </Link>
          <span aria-hidden>/</span>
          <Link
            to="/org/$slug/admin/crm"
            params={{ slug }}
            className="hover:text-slate-700"
          >
            CRM
          </Link>
          <span aria-hidden>/</span>
          <span className="text-slate-700 truncate">{person.contact.name}</span>
        </nav>

        <PersonHeader org={org} slug={slug} person={person} />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-6 min-w-0">
            {person.profile && <AppProfileCard profile={person.profile} />}
            <PersonFields org={org} contact={person.contact} defs={defs} />
          </div>
          <Timeline
            org={org}
            contactId={contactId}
            timeline={person.timeline}
          />
        </div>
      </div>
    </PageShell>
  )
}

// ── Header ───────────────────────────────────────────────────────────────

function PersonHeader({
  org,
  slug,
  person,
}: {
  org: Doc<'organizations'>
  slug: string
  person: Person
}) {
  const { contact, profile } = person
  const { save } = useCrmActions(org._id, 'contacts')
  const setOtherEmails = useMutation(api.contacts.people.setOtherEmails)
  const deleteRecords = useMutation(api.contacts.bulk.deleteRecords)
  const navigate = useNavigate()
  const { busy, run } = useBusyAction<'emails' | 'delete'>()
  const [editingName, setEditingName] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)

  const core = useMemo(() => coreColumns('contacts'), [])
  const column = (key: string) => core.find((c) => c.key === key) as CrmColumn
  const record = contact as CrmRecord
  const others = contact.otherEmails ?? []

  const updateOthers = (next: Array<string>) =>
    run(
      'emails',
      async () => {
        await setOtherEmails({
          orgId: org._id,
          contactId: contact._id,
          emails: next,
        })
        setNewEmail('')
      },
      toastError('No se pudieron guardar los emails'),
    )

  const addEmail = () => {
    const email = newEmail.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Ese email no parece válido')
      return
    }
    if (email === contact.email || others.includes(email)) {
      setNewEmail('')
      return
    }
    void updateOthers([...others, email])
  }

  const remove = () =>
    run(
      'delete',
      async () => {
        await navigate({ to: '/org/$slug/admin/crm', params: { slug } })
        await deleteRecords({
          orgId: org._id,
          collection: 'contacts',
          ids: [contact._id],
        })
        toast.success(`Se eliminó a ${contact.name}`)
      },
      toastError('No se pudo eliminar el contacto'),
    )

  return (
    <Card className="p-5 gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          {editingName ? (
            <form
              className="flex items-center gap-2"
              onSubmit={async (e) => {
                e.preventDefault()
                const input = e.currentTarget.elements.namedItem(
                  'name',
                ) as HTMLInputElement
                const ok = await save(record, column('name'), input.value)
                if (ok) setEditingName(false)
              }}
            >
              <Label htmlFor="person-name" className="sr-only">
                Nombre
              </Label>
              <Input
                id="person-name"
                name="name"
                autoFocus
                defaultValue={contact.name}
                className="text-lg font-semibold max-w-md"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEditingName(false)
                }}
              />
              <Button type="submit" size="sm">
                Guardar
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setEditingName(false)}
              >
                Cancelar
              </Button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-display font-semibold truncate">
                {contact.name}
              </h1>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                onClick={() => setEditingName(true)}
                aria-label="Editar nombre"
              >
                <Pencil className="size-4" />
              </Button>
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {contact.userId ? (
              <Badge
                variant="outline"
                className="bg-green-50 text-green-700 border-green-200"
              >
                <UserCheck />
                Cuenta vinculada{profile?.name ? `: ${profile.name}` : ''}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                <Link2 />
                Sin cuenta en ASTN
              </Badge>
            )}
            {profile?.headline && (
              <span className="text-sm text-muted-foreground">
                {profile.headline}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMergeOpen(true)}
          >
            <GitMerge className="size-4" />
            Fusionar con…
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="size-4" />
            Eliminar
          </Button>
        </div>
      </div>
      <MergeWithDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        orgId={org._id}
        orgSlug={slug}
        contactId={contact._id}
        onMerged={(keepId) => {
          // This contact was merged into another: go to the one kept.
          if (keepId !== contact._id) {
            void navigate({
              to: '/org/$slug/admin/crm/people/$contactId',
              params: { slug, contactId: keepId },
            })
          }
        }}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="person-email">Email principal</Label>
          <FieldInput
            id="person-email"
            column={column('email')}
            value={readValue(record, column('email'))}
            onSave={(v) => save(record, column('email'), v)}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-1 lg:col-span-2">
          <Label htmlFor="person-other-email">Otros emails</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            {others.map((email) => (
              <span
                key={email}
                className="inline-flex items-center gap-1 rounded-full border bg-slate-50 py-0.5 pl-2.5 pr-1 text-sm"
              >
                {email}
                <button
                  type="button"
                  disabled={busy === 'emails'}
                  onClick={() =>
                    void updateOthers(others.filter((x) => x !== email))
                  }
                  aria-label={`Quitar ${email}`}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-slate-200 hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault()
                addEmail()
              }}
            >
              <Input
                id="person-other-email"
                type="email"
                placeholder="otro@email.com"
                className="h-8 w-52"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={!newEmail.trim() || busy === 'emails'}
              >
                <Plus className="size-4" />
                Agregar
              </Button>
            </form>
          </div>
          <p className="text-xs text-muted-foreground">
            Sirven para unir postulaciones, eventos e imports hechos con otro
            email.
          </p>
        </div>
        {CONTACT_INFO_KEYS.map((key) => (
          <div key={key} className="space-y-1.5">
            <Label htmlFor={`person-${key}`}>{column(key).label}</Label>
            <FieldInput
              id={`person-${key}`}
              column={column(key)}
              value={readValue(record, column(key))}
              onSave={(v) => save(record, column(key), v)}
            />
          </div>
        ))}
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar a {contact.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borra el contacto y su historial en el CRM. Su cuenta,
              postulaciones y registros a eventos no se tocan. No se puede
              deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={busy === 'delete'}
              onClick={(e) => {
                e.preventDefault()
                void remove()
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

// ── App profile ──────────────────────────────────────────────────────────

function AppProfileCard({
  profile,
}: {
  profile: NonNullable<Person['profile']>
}) {
  const rows: Array<[string, string | null]> = [
    ['Ubicación', profile.location],
    ['Busca', profile.seeking],
    ['Puede ayudar con', profile.canHelpWith],
    ['Objetivos', profile.careerGoals],
    ['Habilidades', profile.skills.join(', ') || null],
    ['Intereses', profile.interests.join(', ') || null],
  ]
  const filled = rows.filter(([, v]) => v)
  if (filled.length === 0) return null
  return (
    <Card className="p-5 gap-3">
      <h2 className="font-semibold">Perfil en ASTN</h2>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {filled.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs font-medium text-muted-foreground">
              {label}
            </dt>
            <dd className="text-sm whitespace-pre-wrap break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}

// ── Fields ───────────────────────────────────────────────────────────────

function PersonFields({
  org,
  contact,
  defs,
}: {
  org: Doc<'organizations'>
  contact: Doc<'crmContacts'>
  defs: Array<FieldDef>
}) {
  const { save, createOption } = useCrmActions(org._id, 'contacts')
  const [showHidden, setShowHidden] = useState(false)
  const record = contact as CrmRecord

  const sections = useMemo(() => {
    const fields = buildColumns('contacts', defs).filter((c) => !c.core)
    const byKey = new Map(fields.map((c) => [c.key, c]))
    const used = new Set<string>()
    const out: Array<{ title: string; columns: Array<CrmColumn> }> = []
    for (const group of FIELD_GROUPS) {
      const columns = group.keys
        .map((k) => byKey.get(k))
        .filter((c): c is CrmColumn => !!c && !c.def?.hidden)
      columns.forEach((c) => used.add(c.key))
      if (columns.length) out.push({ title: group.title, columns })
    }
    const rest = fields.filter((c) => !used.has(c.key) && !c.def?.hidden)
    if (rest.length) out.push({ title: 'Otros campos', columns: rest })
    const hidden = fields.filter((c) => c.def?.hidden)
    return { out, hidden }
  }, [defs])

  const notes = coreColumns('contacts').find(
    (c) => c.key === 'notes',
  ) as CrmColumn

  const renderField = (column: CrmColumn) => {
    const id = `field-${column.key}`
    const wide = column.type === 'longText' || column.type === 'multiSelect'
    return (
      <div
        key={column.key}
        className={cn('space-y-1.5 min-w-0', wide && 'sm:col-span-2')}
      >
        <Label htmlFor={id}>{column.label}</Label>
        <FieldInput
          id={id}
          column={column}
          value={readValue(record, column)}
          onSave={(v) => save(record, column, v)}
          onCreateOption={
            column.def
              ? (v) => createOption(column.def as FieldDef, v)
              : undefined
          }
        />
      </div>
    )
  }

  return (
    <>
      {sections.out.map((section) => (
        <Card key={section.title} className="p-5 gap-4">
          <h2 className="font-semibold">{section.title}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {section.columns.map(renderField)}
          </div>
        </Card>
      ))}
      <Card className="p-5 gap-4">
        <h2 className="font-semibold">Notas</h2>
        <Label htmlFor="field-notes" className="sr-only">
          Notas
        </Label>
        <FieldInput
          id="field-notes"
          column={notes}
          value={readValue(record, notes)}
          onSave={(v) => save(record, notes, v)}
        />
      </Card>
      {sections.hidden.length > 0 && (
        <Card className="p-5 gap-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">
              Campos ocultos ({sections.hidden.length})
            </h2>
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={showHidden}
              onClick={() => setShowHidden((v) => !v)}
            >
              {showHidden ? 'Ocultar' : 'Mostrar'}
            </Button>
          </div>
          {showHidden && (
            <div className="grid gap-4 sm:grid-cols-2">
              {sections.hidden.map(renderField)}
            </div>
          )}
        </Card>
      )}
    </>
  )
}

// ── Timeline ─────────────────────────────────────────────────────────────

function Timeline({
  org,
  contactId,
  timeline,
}: {
  org: Doc<'organizations'>
  contactId: Id<'crmContacts'>
  timeline: Array<TimelineItem>
}) {
  const addActivity = useMutation(api.contacts.people.addActivity)
  const deleteActivity = useMutation(api.contacts.people.deleteActivity)
  const { busy, run } = useBusyAction<string>()
  const [note, setNote] = useState('')

  const addNote = () =>
    run(
      'note',
      async () => {
        await addActivity({
          orgId: org._id,
          contactId,
          kind: 'note',
          title: note.trim(),
        })
        setNote('')
      },
      toastError('No se pudo guardar la nota'),
    )

  const remove = (activityId: Id<'crmActivities'>) =>
    run(
      `delete:${activityId}`,
      () => deleteActivity({ orgId: org._id, activityId }),
      toastError('No se pudo borrar'),
    )

  return (
    <Card className="p-5 gap-4 self-start">
      <h2 className="font-semibold">Historial</h2>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (note.trim()) void addNote()
        }}
      >
        <Label htmlFor="new-note" className="sr-only">
          Nueva nota
        </Label>
        <Textarea
          id="new-note"
          placeholder="Agregar una nota…"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && note.trim()) {
              e.preventDefault()
              void addNote()
            }
          }}
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            size="sm"
            disabled={!note.trim() || busy === 'note'}
          >
            Agregar nota
          </Button>
        </div>
      </form>

      {timeline.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no hay nada en el historial.
        </p>
      ) : (
        <ol className="relative space-y-4 border-l pl-5 ml-2">
          {timeline.map((item, index) => (
            <TimelineEntry
              key={item.activityId ?? `${item.kind}:${item.title}:${index}`}
              item={item}
              deleting={busy === `delete:${item.activityId}`}
              onDelete={
                item.activityId && item.source === 'manual'
                  ? () => void remove(item.activityId as Id<'crmActivities'>)
                  : undefined
              }
            />
          ))}
        </ol>
      )}
    </Card>
  )
}

function TimelineEntry({
  item,
  deleting,
  onDelete,
}: {
  item: TimelineItem
  deleting: boolean
  onDelete?: () => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const meta = KIND_META[item.kind]
  const source = SOURCE_META[item.source]
  const Icon = meta.icon
  const details = item.details
    ? Object.entries(item.details).filter(
        ([, v]) => v !== null && v !== undefined && v !== '',
      )
    : []

  const title =
    item.kind === 'note' ? (
      <p className="text-sm whitespace-pre-wrap break-words">{item.title}</p>
    ) : item.href ? (
      <a
        href={item.href}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
          e.preventDefault()
          router.history.push(item.href as string)
        }}
        className="text-sm font-medium hover:underline break-words"
      >
        {item.title}
      </a>
    ) : (
      <p className="text-sm font-medium break-words">{item.title}</p>
    )

  return (
    <li className="relative">
      <span
        className="absolute -left-[31px] top-0 flex size-5 items-center justify-center rounded-full border bg-background"
        aria-hidden
      >
        <Icon className="size-3 text-muted-foreground" />
      </span>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground/80">{meta.label}</span>
        <span aria-hidden>·</span>
        <time>{formatWhen(item.at)}</time>
        <Badge
          variant="outline"
          className={cn('px-1.5 py-0 text-[10px]', source.className)}
        >
          {source.label}
        </Badge>
        {onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto size-6 text-muted-foreground hover:text-destructive"
            disabled={deleting}
            onClick={onDelete}
            aria-label={`Borrar ${meta.label.toLowerCase()}`}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
      <div className="mt-0.5">{title}</div>
      {item.status && (
        <p className="text-xs text-muted-foreground">
          {STATUS_LABELS[item.status] ?? item.status}
        </p>
      )}
      {details.length > 0 && (
        <div className="mt-1">
          <button
            type="button"
            className="text-xs text-blue-700 hover:underline"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Ocultar detalles' : `Ver detalles (${details.length})`}
          </button>
          {open && (
            <dl className="mt-1 space-y-1 rounded-md bg-slate-50 p-2 text-xs">
              {details.map(([key, value]) => (
                <div key={key}>
                  <dt className="font-medium text-muted-foreground">{key}</dt>
                  <dd className="whitespace-pre-wrap break-words">
                    {typeof value === 'string'
                      ? value
                      : Array.isArray(value)
                        ? value.join(', ')
                        : JSON.stringify(value)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </li>
  )
}
