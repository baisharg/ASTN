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
import { CanonicalEmailsEditor } from '~/components/canonicals/CanonicalEmailsEditor'
import { CanonicalFeedbackEditor } from '~/components/canonicals/CanonicalFeedbackEditor'
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
 * The org's canonicals: the two application forms every new opportunity
 * copies (the EOI one for expressions of interest), the two feedback surveys
 * a new survey starts from, and the emails every new course edition uses.
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
              <span className="text-slate-700">Canonicals</span>
            </div>
            <h1 className="text-2xl font-display font-semibold text-foreground">
              Canonicals
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              What every new opportunity starts with. Changes apply to what is
              created afterwards: an opportunity already running keeps its own
              copy.
            </p>
          </div>

          <Tabs defaultValue="course">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="course">Course form</TabsTrigger>
              <TabsTrigger value="eoi">Expression of interest</TabsTrigger>
              <TabsTrigger value="feedback">Course feedback</TabsTrigger>
              <TabsTrigger value="feedback_anonymous">
                Anonymous feedback
              </TabsTrigger>
              <TabsTrigger value="emails">Emails</TabsTrigger>
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
            <TabsContent
              value="feedback"
              forceMount
              className="mt-6 data-[state=inactive]:hidden"
            >
              <CanonicalFeedbackEditor orgId={org._id} anonymous={false} />
            </TabsContent>
            <TabsContent
              value="feedback_anonymous"
              forceMount
              className="mt-6 data-[state=inactive]:hidden"
            >
              <CanonicalFeedbackEditor orgId={org._id} anonymous />
            </TabsContent>
            <TabsContent
              value="emails"
              forceMount
              className="mt-6 data-[state=inactive]:hidden"
            >
              <CanonicalEmailsEditor orgId={org._id} />
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
          Write {'{{course}}'} for the course (&quot;el Curso de
          Biocustodia&quot;) and {'{{area}}'} for its field (&quot;la
          biocustodia&quot;); each opportunity fills them from its course. Mark
          consent checkboxes as consents to show them together in one block.
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
