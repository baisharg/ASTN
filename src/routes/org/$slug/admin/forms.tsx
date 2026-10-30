import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { ConvexError } from 'convex/values'
import { Loader2, Save, Shield } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { canonicalFormProblems } from '../../../../../convex/lib/formFields'
import type { FormField } from '../../../../../convex/lib/formFields'
import { AuthHeader } from '~/components/layout/auth-header'
import { FormFieldsEditor } from '~/components/opportunities/FormFieldsEditor'
import { useUnsavedChangesWarning } from '~/hooks/use-unsaved-changes'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'

export const Route = createFileRoute('/org/$slug/admin/forms')({
  component: CanonicalFormsPage,
})

type CanonicalKind = 'course' | 'eoi'

/**
 * The org's two canonical application forms. Every new opportunity copies one
 * of them (the EOI one for expressions of interest), so this is the only place
 * application questions are written.
 */
function CanonicalFormsPage() {
  const { slug } = Route.useParams()
  const org = useQuery(api.orgs.directory.getOrgBySlug, { slug })
  const membership = useQuery(
    api.orgs.membership.getMembership,
    org ? { orgId: org._id } : 'skip',
  )

  if (org === undefined || membership === undefined) {
    return (
      <div className="min-h-screen bg-slate-50">
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <Spinner className="size-8 mx-auto" />
        </main>
      </div>
    )
  }

  if (!org || !membership || membership.role !== 'admin') {
    return (
      <div className="min-h-screen bg-slate-50">
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <Shield className="size-8 text-slate-400 mx-auto mb-4" />
            <h1 className="text-2xl font-display mb-4">
              Admin Access Required
            </h1>
            <Button asChild>
              <Link to="/">Go Home</Link>
            </Button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <AuthHeader />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-3xl mx-auto">
          <div className="mb-8">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
              <Link
                to="/org/$slug/admin"
                params={{ slug }}
                className="hover:text-slate-700 transition-colors"
              >
                Admin
              </Link>
              <span>/</span>
              <span className="text-slate-700">Canonical forms</span>
            </div>
            <h1 className="text-2xl font-display font-semibold text-foreground">
              Canonical forms
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Every new opportunity copies one of these when it is created.
              Changes apply to opportunities created afterwards: one already
              taking applications keeps the form people are answering.
            </p>
          </div>

          <Tabs defaultValue="course">
            <TabsList>
              <TabsTrigger value="course">Course editions</TabsTrigger>
              <TabsTrigger value="eoi">Expressions of interest</TabsTrigger>
            </TabsList>
            <TabsContent
              value="course"
              forceMount
              className="mt-6 data-[state=inactive]:hidden"
            >
              <CanonicalFormEditor key="course" orgId={org._id} kind="course" />
            </TabsContent>
            <TabsContent
              value="eoi"
              forceMount
              className="mt-6 data-[state=inactive]:hidden"
            >
              <CanonicalFormEditor key="eoi" orgId={org._id} kind="eoi" />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  )
}

function CanonicalFormEditor({
  orgId,
  kind,
}: {
  orgId: Id<'organizations'>
  kind: CanonicalKind
}) {
  const canonical = useQuery(api.canonicalForms.get, { orgId, kind })
  const opportunities = useQuery(api.orgOpportunities.listAllByOrg, { orgId })
  const save = useMutation(api.canonicalForms.save)

  const [fields, setFields] = useState<Array<FormField>>([])
  const [loaded, setLoaded] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  if (canonical !== undefined && !loaded) {
    setFields((canonical?.formFields as Array<FormField> | undefined) ?? [])
    setLoaded(true)
  }

  const isDirty =
    canonical !== undefined &&
    JSON.stringify(fields) !==
      JSON.stringify((canonical?.formFields as Array<FormField>) ?? [])
  useUnsavedChangesWarning(isDirty && !isSaving)

  if (canonical === undefined) return <Spinner className="size-6 mx-auto" />

  const validFields = fields.filter((f) => f.label.trim())
  const problems = canonicalFormProblems(validFields)
  const sources = (opportunities ?? []).filter(
    (o) =>
      Array.isArray(o.formFields) &&
      o.formFields.length > 0 &&
      (o.isEOI ?? false) === (kind === 'eoi'),
  )

  const handleSave = async () => {
    if (problems.length > 0 || isSaving) return
    setIsSaving(true)
    try {
      await save({ orgId, kind, formFields: validFields })
      toast.success('Canonical form saved')
    } catch (err) {
      toast.error("Couldn't save the canonical form", {
        description:
          err instanceof ConvexError && typeof err.data === 'string'
            ? err.data
            : 'Please try again.',
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {kind === 'course'
            ? 'Course edition form'
            : 'Expression of interest form'}
        </CardTitle>
        <CardDescription>
          Write {'{{course}}'} wherever the course name goes and {'{{area}}'}{' '}
          wherever its area goes (e.g. &quot;¿Cómo te involucraste hasta ahora
          con {'{{area}}'}?&quot;); each opportunity fills them with its course
          name and area. Mark consent checkboxes as consents to show them
          together in one block.
          {kind === 'course'
            ? ' The weekly availability grid is added on its own and does not go here.'
            : ' Expressions of interest do not ask for availability.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!canonical && sources.length > 0 && fields.length === 0 && (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              No canonical form yet. Start from the form of an existing
              opportunity and adjust it:
            </p>
            <Select
              onValueChange={(id) => {
                const source = sources.find((o) => o._id === id)
                if (source) setFields(source.formFields as Array<FormField>)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose an opportunity…" />
              </SelectTrigger>
              <SelectContent>
                {sources.map((o) => (
                  <SelectItem key={o._id} value={o._id}>
                    {o.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <FormFieldsEditor fields={fields} onChange={setFields} />

        {problems.length > 0 && (
          <ul className="list-disc pl-5 text-sm text-amber-900">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}

        <Button
          type="button"
          onClick={() => void handleSave()}
          disabled={problems.length > 0 || isSaving}
        >
          {isSaving ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <Save className="size-4 mr-2" />
          )}
          Save canonical form
        </Button>
      </CardContent>
    </Card>
  )
}
