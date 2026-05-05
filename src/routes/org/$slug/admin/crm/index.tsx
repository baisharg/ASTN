import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import {
  Database,
  Upload,
  Users,
  Building2,
  Briefcase,
  FileText,
  Shield,
} from 'lucide-react'
import { useState } from 'react'
import { api } from '../../../../../../convex/_generated/api'
import { AuthHeader } from '~/components/layout/auth-header'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { CrmTable } from '~/components/crm/CrmTable'
import { CrmImportDialog } from '~/components/crm/CrmImportDialog'

export const Route = createFileRoute('/org/$slug/admin/crm/')({
  component: CrmDashboard,
})

type CollectionTab =
  | 'contacts'
  | 'organizations'
  | 'opportunities'
  | 'submissions'

const TAB_CONFIG: Record<
  CollectionTab,
  { label: string; icon: typeof Users; collection: string }
> = {
  contacts: { label: 'Contacts', icon: Users, collection: 'crmContacts' },
  organizations: {
    label: 'Organizations',
    icon: Building2,
    collection: 'crmOrganizations',
  },
  opportunities: {
    label: 'Opportunities',
    icon: Briefcase,
    collection: 'crmOpportunities',
  },
  submissions: {
    label: 'Submissions',
    icon: FileText,
    collection: 'crmSubmissions',
  },
}

function CrmDashboard() {
  const { slug } = Route.useParams()
  const [activeTab, setActiveTab] = useState<CollectionTab>('contacts')
  const [importOpen, setImportOpen] = useState(false)

  const org = useQuery(api.orgs.directory.getOrgBySlug, { slug })
  const membership = useQuery(
    api.orgs.membership.getMembership,
    org ? { orgId: org._id } : 'skip',
  )
  // O(1) read from the `crmCounts` aggregate — one row per org, populated
  // by `bumpCount` on every insert/delete and seeded by the `backfillCrmCounts`
  // internalMutation.
  const isAdmin = org != null && membership?.role === 'admin'
  const stats = useQuery(
    api.crm.getStats,
    isAdmin ? { orgId: org._id } : 'skip',
  )

  if (org === undefined || membership === undefined) {
    return (
      <div className="min-h-screen">
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-center py-20">
            <Spinner className="size-8" />
          </div>
        </main>
      </div>
    )
  }

  if (org === null) {
    return (
      <div className="min-h-screen">
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="text-center py-12">
            <p className="text-muted-foreground">Organization not found</p>
          </div>
        </main>
      </div>
    )
  }

  if (!membership || membership.role !== 'admin') {
    return (
      <div className="min-h-screen">
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <div className="size-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
              <Shield className="size-8 text-slate-400" />
            </div>
            <h1 className="text-2xl font-display text-foreground mb-4">
              Admin Access Required
            </h1>
            <p className="text-slate-600 mb-6">
              You need to be an admin of this organization to access this page.
            </p>
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

  return (
    <div className="min-h-screen">
      <AuthHeader />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
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
              <span className="text-slate-700">CRM</span>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-display font-semibold text-foreground flex items-center gap-2">
                  <Database className="size-6" />
                  CRM Database
                </h1>
                <p className="text-muted-foreground mt-1">
                  Manage your organization's contacts, organizations,
                  opportunities, and form responses
                </p>
              </div>
              <Button onClick={() => setImportOpen(true)}>
                <Upload className="size-4 mr-2" />
                Import Excel/CSV
              </Button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid gap-4 sm:grid-cols-4 mb-8">
            {(
              Object.entries(TAB_CONFIG) as [
                CollectionTab,
                (typeof TAB_CONFIG)[CollectionTab],
              ][]
            ).map(([key, config]) => {
              const Icon = config.icon
              const count = stats?.[key]
              return (
                <Card
                  key={key}
                  className={`cursor-pointer transition-colors ${activeTab === key ? 'ring-2 ring-primary' : 'hover:bg-accent/50'}`}
                  onClick={() => setActiveTab(key)}
                >
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-slate-500">
                      {config.label}
                    </CardTitle>
                    <Icon className="size-4 text-slate-400" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-foreground">
                      {count !== undefined ? (
                        count
                      ) : (
                        <Spinner className="size-6" />
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Tabs + Table */}
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as CollectionTab)}
          >
            <TabsList>
              {(
                Object.entries(TAB_CONFIG) as [
                  CollectionTab,
                  (typeof TAB_CONFIG)[CollectionTab],
                ][]
              ).map(([key, config]) => {
                const Icon = config.icon
                return (
                  <TabsTrigger key={key} value={key}>
                    <Icon className="size-4 mr-1.5" />
                    {config.label}
                  </TabsTrigger>
                )
              })}
            </TabsList>

            <TabsContent value="contacts" className="mt-4">
              <CrmTable orgId={org._id} collection="contacts" />
            </TabsContent>
            <TabsContent value="organizations" className="mt-4">
              <CrmTable orgId={org._id} collection="organizations" />
            </TabsContent>
            <TabsContent value="opportunities" className="mt-4">
              <CrmTable orgId={org._id} collection="opportunities" />
            </TabsContent>
            <TabsContent value="submissions" className="mt-4">
              <CrmTable orgId={org._id} collection="submissions" />
            </TabsContent>
          </Tabs>
        </div>
      </main>

      {/* Import Dialog */}
      <CrmImportDialog
        orgId={org._id}
        open={importOpen}
        onOpenChange={setImportOpen}
      />
    </div>
  )
}
