import { Link, createFileRoute } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import { Building2, CheckCircle2, Loader2, Save, Shield } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ConvexError } from 'convex/values'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { AuthHeader } from '~/components/layout/auth-header'
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

export const Route = createFileRoute('/org/$slug/admin/settings')({
  component: OrgAdminSettings,
})

function OrgAdminSettings() {
  const { slug } = Route.useParams()

  const org = useQuery(api.orgs.directory.getOrgBySlug, { slug })
  const membership = useQuery(
    api.orgs.membership.getMembership,
    org ? { orgId: org._id } : 'skip',
  )
  const lumaConfig = useQuery(
    api.orgs.admin.getLumaConfig,
    org && membership?.role === 'admin' ? { orgId: org._id } : 'skip',
  )

  // Form state
  const [lumaCalendarUrl, setLumaCalendarUrl] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isResolved, setIsResolved] = useState(false)

  const updateLumaConfig = useMutation(api.orgs.admin.updateLumaConfig)
  const resolveLumaCalendar = useAction(api.events.sync.resolveLumaCalendar)

  // Populate form when config loads
  useEffect(() => {
    if (lumaConfig) {
      setLumaCalendarUrl(lumaConfig.lumaCalendarUrl || '')
      setIsResolved(!!lumaConfig.lumaCalendarApiId)
    }
  }, [lumaConfig])

  // Loading state
  if (org === undefined || membership === undefined) {
    return (
      <div className="min-h-screen bg-slate-50">
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto">
            <div className="animate-pulse space-y-6">
              <div className="h-12 bg-slate-100 rounded-xl w-1/3" />
              <div className="h-64 bg-slate-100 rounded-xl" />
            </div>
          </div>
        </main>
      </div>
    )
  }

  // Org not found
  if (org === null) {
    return (
      <div className="min-h-screen bg-slate-50">
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <div className="size-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
              <Building2 className="size-8 text-slate-400" />
            </div>
            <h1 className="text-2xl font-display text-foreground mb-4">
              Organization Not Found
            </h1>
            <Button asChild>
              <Link to="/">Go Home</Link>
            </Button>
          </div>
        </main>
      </div>
    )
  }

  // Not an admin
  if (!membership || membership.role !== 'admin') {
    return (
      <div className="min-h-screen bg-slate-50">
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <div className="size-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
              <Shield className="size-8 text-slate-400" />
            </div>
            <h1 className="text-2xl font-display text-foreground mb-4">
              Admin Access Required
            </h1>
            <Button asChild>
              <Link to="/org/$slug" params={{ slug }}>
                Back to Organization
              </Link>
            </Button>
          </div>
        </main>
      </div>
    )
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)

    try {
      const trimmedUrl = lumaCalendarUrl.trim()
      let calendarApiId: string | undefined

      // Auto-resolve calendar API ID from URL
      if (trimmedUrl) {
        try {
          calendarApiId = await resolveLumaCalendar({
            calendarUrl: trimmedUrl,
          })
        } catch (resolveError) {
          console.error('Failed to resolve Lu.ma calendar:', resolveError)
          toast.error(
            'Could not resolve Lu.ma calendar. Please check the URL and try again.',
          )
          setIsSaving(false)
          return
        }
      }

      await updateLumaConfig({
        orgId: org._id,
        lumaCalendarUrl: trimmedUrl || undefined,
        lumaCalendarApiId: calendarApiId,
      })
      setIsResolved(!!calendarApiId)
      toast.success('Settings saved successfully')
    } catch (error) {
      console.error('Failed to save settings:', error)
      toast.error('Failed to save settings. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <AuthHeader />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-2 text-slate-500 text-sm mb-2">
              <Link
                to="/org/$slug"
                params={{ slug }}
                className="hover:text-slate-700 transition-colors"
              >
                {org.name}
              </Link>
              <span>/</span>
              <Link
                to="/org/$slug/admin"
                params={{ slug }}
                className="hover:text-slate-700 transition-colors"
              >
                Admin
              </Link>
              <span>/</span>
              <span className="text-slate-700">Settings</span>
            </div>
            <h1 className="text-2xl font-display text-foreground">Settings</h1>
            <p className="text-slate-600 mt-1">
              Configure integrations and organization settings
            </p>
          </div>

          {/* Lu.ma Configuration */}
          <Card>
            <CardHeader>
              <CardTitle>Lu.ma Events Integration</CardTitle>
              <CardDescription>
                Connect your lu.ma calendar to display events on your
                organization page and dashboard
              </CardDescription>
            </CardHeader>
            <CardContent>
              {lumaConfig === undefined ? (
                <div className="flex justify-center py-8">
                  <Spinner className="size-6" />
                </div>
              ) : (
                <form onSubmit={handleSave} className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="lumaCalendarUrl">Lu.ma Calendar URL</Label>
                    <Input
                      id="lumaCalendarUrl"
                      type="url"
                      placeholder="https://lu.ma/your-calendar"
                      value={lumaCalendarUrl}
                      onChange={(e) => {
                        setLumaCalendarUrl(e.target.value)
                        setIsResolved(false)
                      }}
                    />
                    <p className="text-sm text-slate-500">
                      Your public lu.ma calendar URL (e.g.,
                      https://lu.ma/your-calendar). Events will be synced
                      automatically.
                    </p>
                  </div>

                  {isResolved && (
                    <div className="flex items-center gap-2 text-sm text-green-700">
                      <CheckCircle2 className="size-4" />
                      Calendar connected - events will sync daily
                    </div>
                  )}

                  {lumaConfig.eventsLastSynced && (
                    <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
                      <span className="text-slate-600">Last synced: </span>
                      <span className="text-foreground">
                        {new Date(lumaConfig.eventsLastSynced).toLocaleString()}
                      </span>
                    </div>
                  )}

                  <Button type="submit" disabled={isSaving}>
                    {isSaving ? (
                      <>
                        <Loader2 className="size-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="size-4 mr-2" />
                        Save Changes
                      </>
                    )}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          <ReplyToCard orgId={org._id} />
        </div>
      </main>
    </div>
  )
}

/**
 * Where replies to the org's emails go. They leave from
 * notifications@safetytalent.org, which nobody reads.
 */
function ReplyToCard({ orgId }: { orgId: Id<'organizations'> }) {
  const settings = useQuery(api.orgs.admin.getEmailSettings, { orgId })
  const update = useMutation(api.orgs.admin.updateReplyToEmail)
  const [value, setValue] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  if (settings === undefined) return null
  const current = value ?? settings.replyToEmail ?? ''

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    try {
      await update({ orgId, replyToEmail: current })
      setValue(null)
      toast.success('Reply-to email saved')
    } catch (err) {
      toast.error("Couldn't save", {
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
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Replies to emails</CardTitle>
        <CardDescription>
          Emails go out from notifications@safetytalent.org. When someone
          replies, the answer goes to this address.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1 flex-1 min-w-60">
            <Label htmlFor="replyToEmail">Reply-to email</Label>
            <Input
              id="replyToEmail"
              type="email"
              value={current}
              placeholder={settings.contactEmail ?? 'team@example.org'}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={isSaving || value === null}>
            Save
          </Button>
        </form>
        {settings.contactEmail && (
          <p className="text-xs text-muted-foreground mt-2">
            Empty: replies go to the contact email, {settings.contactEmail}.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
