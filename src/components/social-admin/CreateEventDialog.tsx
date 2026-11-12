import { useNavigate } from '@tanstack/react-router'
import { useAction, useMutation } from 'convex/react'
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import {
  EMPTY_EVENT_DETAILS,
  EventDetailsFields,
  useEventDetailsForm,
} from './EventDetailsFields'
import {
  EMPTY_LUMA_EVENT,
  LumaEventFields,
  lumaArgs,
  useLumaEventForm,
} from './LumaEventForm'
import { toastError } from './shared'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Spinner } from '~/components/ui/spinner'
import { errorText } from '~/lib/convex-error'
import { useBusyAction } from '~/lib/use-busy-action'

// Where a new event is created.
type Place = 'luma_and_astn' | 'astn'

// A Luma event this dialog created whose ASTN event couldn't be created.
type LumaOnlyEvent = { lumaEventId: string; name: string; error: string }

/**
 * The one way to create an event. An org connected to Luma chooses between
 * an event on its Luma calendar managed in ASTN, and an event that only
 * exists in ASTN; any other org gets the ASTN form directly.
 */
export function CreateEventDialog({
  open,
  onOpenChange,
  orgId,
  slug,
  lumaConnected,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: Id<'organizations'>
  slug: string
  // Undefined while it is still loading.
  lumaConnected: boolean | undefined
}) {
  const createAstnEvent = useMutation(api.social.events.createEvent)
  const createLumaEvent = useAction(api.luma.api.createEvent)
  const manageInAstn = useMutation(api.luma.admin.manageInAstn)
  const navigate = useNavigate()
  const { busy, run } = useBusyAction<'create' | 'manage'>()

  // Both forms live here, so what was typed survives going back to the
  // choice or closing the dialog.
  const astnForm = useEventDetailsForm(EMPTY_EVENT_DETAILS)
  const lumaForm = useLumaEventForm(EMPTY_LUMA_EVENT)
  const [chosen, setChosen] = useState<Place | null>(null)
  const [lumaOnly, setLumaOnly] = useState<LumaOnlyEvent | null>(null)
  // Why the last attempt to create the Luma event failed.
  const [lumaCreateError, setLumaCreateError] = useState<string | null>(null)

  const place: Place | null = lumaConnected ? chosen : 'astn'

  // Closing goes back to the first step; what was typed in the forms stays.
  const close = () => {
    setChosen(null)
    setLumaOnly(null)
    setLumaCreateError(null)
    onOpenChange(false)
  }

  const handleOpenChange = (next: boolean) => {
    // Not while a request is running: its result would have nowhere to show.
    if (busy !== null) return
    if (next) onOpenChange(true)
    else close()
  }

  const openAstnEvent = (eventId: Id<'socialEvents'>) => {
    close()
    void navigate({
      to: '/org/$slug/admin/events/$eventId',
      params: { slug, eventId },
    })
  }

  const handleCreateAstn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!astnForm.canSave || busy) return
    const result = await run(
      'create',
      () => {
        const { endAt, ...args } = astnForm.toArgs()
        return createAstnEvent({ orgId, ...args, endAt: endAt ?? undefined })
      },
      toastError('No se pudo crear el evento'),
    )
    if (!result) return
    toast.success('Evento creado como borrador')
    openAstnEvent(result.eventId)
  }

  // Creates the ASTN event that manages a Luma event. Safe to repeat: an
  // event that is already managed returns its ASTN event.
  const manage = async (lumaEventId: string, name: string) => {
    try {
      const { eventId } = await manageInAstn({ orgId, lumaEventId })
      toast.success('Evento creado en Luma y, como borrador, en ASTN')
      setLumaOnly(null)
      openAstnEvent(eventId)
    } catch (err) {
      console.error(err)
      setLumaOnly({
        lumaEventId,
        name,
        error: errorText(err, 'No se pudo crear el evento en ASTN'),
      })
    }
  }

  const handleCreateLuma = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!lumaForm.canSave || busy) return
    const args = lumaArgs(lumaForm.values)
    setLumaCreateError(null)
    await run(
      'create',
      async () => {
        let created: { lumaEventId: string }
        try {
          created = await createLumaEvent({ orgId, ...args })
        } catch (err) {
          console.error(err)
          // The action creates the event and then reads it back, so a
          // failure doesn't say whether Luma has the event: the form shows
          // the error with what to check before trying again.
          setLumaCreateError(
            errorText(err, 'No llegó la respuesta al crear el evento en Luma.'),
          )
          return
        }
        // The Luma event exists from here on: the form is emptied so it
        // can't be created a second time.
        lumaForm.setValues(EMPTY_LUMA_EVENT)
        await manage(created.lumaEventId, args.name)
      },
      toastError('No se pudo crear el evento'),
    )
  }

  const handleRetryManage = () => {
    if (!lumaOnly || busy) return
    const { lumaEventId, name } = lumaOnly
    void run(
      'manage',
      () => manage(lumaEventId, name),
      toastError('No se pudo crear el evento en ASTN'),
    )
  }

  const cancelButton = (
    <Button
      type="button"
      variant="outline"
      className="min-h-11"
      disabled={busy !== null}
      onClick={() => handleOpenChange(false)}
    >
      Cancelar
    </Button>
  )
  const backButton = lumaConnected && (
    <Button
      type="button"
      variant="ghost"
      className="min-h-11 sm:mr-auto"
      disabled={busy !== null}
      onClick={() => setChosen(null)}
    >
      <ArrowLeft className="size-4 mr-2" />
      Elegir otra opción
    </Button>
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        {lumaConnected === undefined ? (
          <>
            <DialogHeader>
              <DialogTitle>Crear evento</DialogTitle>
              <DialogDescription>Cargando…</DialogDescription>
            </DialogHeader>
            <Spinner className="size-6 mx-auto" />
          </>
        ) : lumaOnly ? (
          <>
            <DialogHeader>
              <DialogTitle>El evento quedó solo en Luma</DialogTitle>
              <DialogDescription>
                “{lumaOnly.name}” ya está creado en Luma, pero no se pudo crear
                en ASTN.
              </DialogDescription>
            </DialogHeader>
            <div
              role="alert"
              className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
            >
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p>{lumaOnly.error}</p>
                <p>
                  No lo crees de nuevo: quedaría duplicado en Luma. Probá otra
                  vez acá o, más tarde, buscalo en la lista de eventos y tocá
                  “Gestionar en ASTN”.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={busy !== null}
                onClick={() => handleOpenChange(false)}
              >
                Cerrar
              </Button>
              <Button
                type="button"
                className="min-h-11"
                disabled={busy !== null}
                onClick={handleRetryManage}
              >
                {busy === 'manage' && (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                )}
                Probar otra vez en ASTN
              </Button>
            </DialogFooter>
          </>
        ) : place === null ? (
          <>
            <DialogHeader>
              <DialogTitle>Crear evento</DialogTitle>
              <DialogDescription>¿Dónde lo querés crear?</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <PlaceOption
                title="En Luma y ASTN"
                description="Se crea en el calendario de Luma, con la visibilidad que elijas, y queda vinculado a un evento de ASTN en borrador: inscripciones y aprobaciones sincronizadas, 1:1 y check-in en la puerta."
                onClick={() => setChosen('luma_and_astn')}
              />
              <PlaceOption
                title="Solo en ASTN"
                description="No aparece en Luma. Empieza como borrador y lo podés vincular con un evento de Luma más adelante."
                onClick={() => setChosen('astn')}
              />
            </div>
            <DialogFooter>{cancelButton}</DialogFooter>
          </>
        ) : place === 'astn' ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {lumaConnected ? 'Crear evento solo en ASTN' : 'Crear evento'}
              </DialogTitle>
              <DialogDescription>
                Empieza como borrador. Nadie lo ve hasta que lo publiques.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreateAstn} className="space-y-4">
              <EventDetailsFields form={astnForm} idPrefix="new-event" />
              <DialogFooter>
                {backButton}
                {cancelButton}
                <Button
                  type="submit"
                  className="min-h-11"
                  disabled={!astnForm.canSave || busy !== null}
                >
                  {busy && <Loader2 className="size-4 mr-2 animate-spin" />}
                  Crear evento
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Crear evento en Luma y ASTN</DialogTitle>
              <DialogDescription>
                En Luma se publica al crearlo, con la visibilidad que elijas. En
                ASTN empieza como borrador.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreateLuma} className="space-y-4">
              <LumaEventFields form={lumaForm} idPrefix="new-luma-event" />
              {lumaCreateError && (
                <div
                  role="alert"
                  className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
                >
                  <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p>{lumaCreateError}</p>
                    <p>
                      Puede que el evento igual se haya creado en Luma. Antes de
                      intentar de nuevo, cerrá esta ventana, tocá “Sincronizar”
                      y fijate si aparece en la lista: si aparece, tocá
                      “Gestionar en ASTN” en ese evento.
                    </p>
                  </div>
                </div>
              )}
              <DialogFooter>
                {backButton}
                {cancelButton}
                <Button
                  type="submit"
                  className="min-h-11"
                  disabled={!lumaForm.canSave || busy !== null}
                >
                  {busy && <Loader2 className="size-4 mr-2 animate-spin" />}
                  Crear en Luma y ASTN
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function PlaceOption({
  title,
  description,
  onClick,
}: {
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-lg border p-4 text-left transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="block font-medium text-foreground">{title}</span>
      <span className="block text-sm text-muted-foreground mt-1">
        {description}
      </span>
    </button>
  )
}
