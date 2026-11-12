import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { Doc } from '../../../../../../convex/_generated/dataModel'
import {
  AdminEventsList,
  useAdminEvents,
} from '~/components/social-admin/AdminEventsList'
import { CreateEventDialog } from '~/components/social-admin/CreateEventDialog'
import {
  LumaSyncButton,
  LumaSyncStatus,
} from '~/components/social-admin/LumaSyncControls'
import { OrgAdminGate, PageShell } from '~/components/social-admin/shared'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'

export const Route = createFileRoute('/org/$slug/admin/events/')({
  component: AdminEventsRoute,
})

function AdminEventsRoute() {
  const { slug } = Route.useParams()
  return (
    <OrgAdminGate slug={slug}>
      {(org) => <AdminEventsPage org={org} slug={slug} />}
    </OrgAdminGate>
  )
}

/**
 * Every event of the org in one list: the ones on its Luma calendar and the
 * ones that only exist in ASTN.
 */
function AdminEventsPage({
  org,
  slug,
}: {
  org: Doc<'organizations'>
  slug: string
}) {
  const events = useAdminEvents(org._id)
  const [dialogOpen, setDialogOpen] = useState(false)
  const lumaConnected = events?.lumaConnected

  return (
    <PageShell>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
          <Link
            to="/org/$slug/admin"
            params={{ slug }}
            className="hover:text-slate-700 transition-colors"
          >
            Admin
          </Link>
          <span>/</span>
          <span className="text-slate-700">Eventos</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div>
            <h1 className="text-2xl font-display font-semibold text-foreground">
              Eventos
            </h1>
            <p className="text-muted-foreground mt-1">
              Inscripciones, aprobación de invitados, 1:1 y check-in.
              {lumaConnected &&
                ' Incluye los eventos del calendario de Luma, con sus invitados.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {lumaConnected && <LumaSyncButton orgId={org._id} />}
            <Button className="min-h-11" onClick={() => setDialogOpen(true)}>
              <Plus className="size-4 mr-2" />
              Crear evento
            </Button>
          </div>
        </div>

        {lumaConnected && <LumaSyncStatus orgId={org._id} />}

        {events === undefined ? (
          <div className="py-12 text-center">
            <Spinner className="size-8 mx-auto" />
          </div>
        ) : (
          <>
            <AdminEventsList
              events={events}
              orgId={org._id}
              slug={slug}
              onCreate={() => setDialogOpen(true)}
            />
            {!events.lumaConnected ? (
              <p className="mt-6 text-sm text-muted-foreground">
                Luma no está conectado para esta organización, así que acá solo
                están los eventos de ASTN. La clave de la API de Luma es de un
                solo calendario: se usa en la organización cuyo calendario de
                Luma (en los ajustes) coincide con ese.
              </p>
            ) : (
              !events.hasLumaEvents && (
                <p className="mt-6 text-sm text-muted-foreground">
                  No hay eventos de Luma todavía. Si ya los hay en Luma, revisá
                  que el calendario esté configurado en los ajustes de la
                  organización y sincronizá.
                </p>
              )
            )}
          </>
        )}

        <CreateEventDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          orgId={org._id}
          slug={slug}
          lumaConnected={lumaConnected}
        />
      </div>
    </PageShell>
  )
}
