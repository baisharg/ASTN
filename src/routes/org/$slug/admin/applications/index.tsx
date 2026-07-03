import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { useState } from 'react'
import { Building2, FileText, Shield } from 'lucide-react'
import { api } from '../../../../../../convex/_generated/api'
import type { FormField } from '../../../../../../convex/lib/formFields'
import { AuthHeader } from '~/components/layout/auth-header'
import { ApplicationsTable } from '~/components/opportunities/ApplicationsTable'
import { Card } from '~/components/ui/card'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { useDotGridStyle } from '~/hooks/use-dot-grid-style'

export const Route = createFileRoute('/org/$slug/admin/applications/')({
  component: AdminApplicationsPage,
})

function AdminApplicationsPage() {
  const { slug } = Route.useParams()
  const dotGridStyle = useDotGridStyle()

  const org = useQuery(api.orgs.directory.getOrgBySlug, { slug })
  const membership = useQuery(
    api.orgs.membership.getMembership,
    org ? { orgId: org._id } : 'skip',
  )
  const allOpportunities = useQuery(
    api.orgOpportunities.listAllByOrg,
    org && membership?.role === 'admin' ? { orgId: org._id } : 'skip',
  )

  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string>('')

  // Loading
  if (org === undefined || membership === undefined) {
    return (
      <div className="min-h-screen" style={dotGridStyle}>
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-5xl mx-auto">
            <Spinner className="size-8 mx-auto" />
          </div>
        </main>
      </div>
    )
  }

  if (!org) {
    return (
      <div className="min-h-screen" style={dotGridStyle}>
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <Building2 className="size-8 text-slate-400 mx-auto mb-4" />
            <h1 className="text-2xl font-display mb-4">
              Organization Not Found
            </h1>
          </div>
        </main>
      </div>
    )
  }

  if (!membership || membership.role !== 'admin') {
    return (
      <div className="min-h-screen" style={dotGridStyle}>
        <AuthHeader />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-lg mx-auto text-center py-12">
            <Shield className="size-8 text-slate-400 mx-auto mb-4" />
            <h1 className="text-2xl font-display mb-4">
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

  // Determine which opportunity to show
  const opportunities = allOpportunities ?? []
  const featured = opportunities.find((o) => o.featured)
  const currentId =
    selectedOpportunityId || featured?._id || opportunities[0]?._id || ''
  const currentOpportunity = opportunities.find((o) => o._id === currentId)

  return (
    <div className="min-h-screen" style={dotGridStyle}>
      <AuthHeader />
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-5xl mx-auto">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
            <Link
              to="/org/$slug/admin"
              params={{ slug }}
              className="hover:text-slate-700 transition-colors"
            >
              Admin
            </Link>
            <span>/</span>
            <span className="text-slate-700">Applications</span>
          </div>

          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-display font-semibold text-foreground">
                Applications
              </h1>
              <p className="text-muted-foreground mt-1">
                Review and manage opportunity applications
              </p>
            </div>
          </div>

          {/* Opportunity Picker */}
          {opportunities.length > 1 && (
            <div className="mb-4">
              <Select
                value={currentId}
                onValueChange={setSelectedOpportunityId}
              >
                <SelectTrigger className="w-full max-w-md">
                  <SelectValue placeholder="Select opportunity..." />
                </SelectTrigger>
                <SelectContent>
                  {opportunities.map((opp) => (
                    <SelectItem key={opp._id} value={opp._id}>
                      {opp.title}
                      {opp.featured ? ' (Featured)' : ''}
                      {opp.status !== 'active' ? ` [${opp.status}]` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {currentOpportunity ? (
            <ApplicationsTable
              opportunityId={currentOpportunity._id}
              opportunityTitle={currentOpportunity.title}
              formFields={
                (currentOpportunity.formFields ?? []) as Array<FormField>
              }
            />
          ) : (
            <Card className="p-8 text-center">
              <FileText className="size-8 text-slate-400 mx-auto mb-4" />
              <p className="text-muted-foreground">
                No opportunities created yet. Create an opportunity to start
                receiving applications.
              </p>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}
