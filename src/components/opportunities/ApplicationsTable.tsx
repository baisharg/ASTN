import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import {
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  Loader2,
  Mail,
} from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { FormField } from '../../../convex/lib/formFields'
import { DynamicResponseViewer } from '~/components/opportunities/DynamicResponseViewer'
import { Card } from '~/components/ui/card'
import { Button } from '~/components/ui/button'
import { Badge } from '~/components/ui/badge'
import { Spinner } from '~/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'

export type ApplicationStatus =
  | 'submitted'
  | 'under_review'
  | 'accepted'
  | 'rejected'
  | 'waitlisted'
  | 'participated'

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  submitted: 'Submitted',
  under_review: 'Under Review',
  accepted: 'Accepted',
  rejected: 'Rejected',
  waitlisted: 'Waitlisted',
  participated: 'Participated',
}

const STATUS_COLORS: Record<ApplicationStatus, string> = {
  submitted: 'bg-blue-50 text-blue-700 border-blue-200',
  under_review: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  accepted: 'bg-green-50 text-green-700 border-green-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  waitlisted: 'bg-purple-50 text-purple-700 border-purple-200',
  participated: 'bg-teal-50 text-teal-700 border-teal-200',
}

export function ApplicationsTable({
  slug,
  opportunityId,
  opportunityTitle,
  formFields,
}: {
  slug: string
  opportunityId: Id<'orgOpportunities'>
  opportunityTitle: string
  formFields: Array<FormField>
}) {
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  const applications = useQuery(api.opportunityApplications.listByOpportunity, {
    opportunityId,
    statusFilter:
      statusFilter !== 'all' ? (statusFilter as ApplicationStatus) : undefined,
  })
  const updateStatus = useMutation(api.opportunityApplications.updateStatus)
  const exportCsv = useAction(api.opportunityApplications.exportApplications)

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const csv = await exportCsv({ opportunityId })
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `applications-${opportunityTitle.toLowerCase().replace(/\s+/g, '-')}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Export failed:', err)
    } finally {
      setIsExporting(false)
    }
  }

  const handleStatusChange = async (
    applicationId: Id<'opportunityApplications'>,
    newStatus: ApplicationStatus,
  ) => {
    await updateStatus({ applicationId, status: newStatus })
  }

  // Derive summary columns from first 3 input fields
  const inputFields = formFields.filter((f) => f.kind !== 'section_header')
  const summaryFields = inputFields.slice(0, 3)

  return (
    <div>
      {/* Filters & Export */}
      <div className="flex items-center justify-between mb-4 gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Filter:</span>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="under_review">Under Review</SelectItem>
              <SelectItem value="accepted">Accepted</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="waitlisted">Waitlisted</SelectItem>
              <SelectItem value="participated">Participated</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link
              to="/org/$slug/admin/opportunities/$oppId/email"
              params={{ slug, oppId: opportunityId }}
            >
              <Mail className="size-4 mr-2" />
              Email Applicants
            </Link>
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={isExporting}>
            {isExporting ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Download className="size-4 mr-2" />
            )}
            Export CSV
          </Button>
        </div>
      </div>

      {/* Table */}
      {applications === undefined ? (
        <div className="py-12 text-center">
          <Spinner className="size-8 mx-auto" />
        </div>
      ) : applications.length === 0 ? (
        <Card className="p-8 text-center">
          <FileText className="size-8 text-slate-400 mx-auto mb-4" />
          <p className="text-muted-foreground">
            {statusFilter !== 'all'
              ? `No ${STATUS_LABELS[statusFilter as ApplicationStatus].toLowerCase()} applications.`
              : 'No applications received yet.'}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {/* Header — dynamic columns */}
          <div
            className="grid gap-2 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider"
            style={{
              gridTemplateColumns: `${summaryFields.map(() => '1fr').join(' ')} 120px 100px 32px`,
            }}
          >
            {summaryFields.map((f) => (
              <span key={f.key} className="truncate">
                {f.label}
              </span>
            ))}
            <span>Submitted</span>
            <span>Status</span>
            <span />
          </div>

          {applications.map((app) => {
            const r = app.responses as Record<string, unknown>
            const isExpanded = expandedId === app._id
            return (
              <Card key={app._id}>
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => setExpandedId(isExpanded ? null : app._id)}
                >
                  <div
                    className="grid gap-2 items-center px-4 py-3 text-sm"
                    style={{
                      gridTemplateColumns: `${summaryFields.map(() => '1fr').join(' ')} 120px 100px 32px`,
                    }}
                  >
                    {summaryFields.map((f) => (
                      <span
                        key={f.key}
                        className="truncate text-muted-foreground"
                      >
                        {formatCellValue(r[f.key])}
                      </span>
                    ))}
                    <span className="text-muted-foreground text-xs">
                      {new Date(app.submittedAt).toLocaleDateString()}
                    </span>
                    <span>
                      <Badge
                        variant="outline"
                        className={STATUS_COLORS[app.status as ApplicationStatus]}
                      >
                        {STATUS_LABELS[app.status as ApplicationStatus]}
                      </Badge>
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="size-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="size-4 text-muted-foreground" />
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t px-4 py-4">
                    <ApplicationDetail
                      responses={r}
                      formFields={formFields}
                      status={app.status as ApplicationStatus}
                      applicationId={app._id}
                      onStatusChange={handleStatusChange}
                    />
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function formatCellValue(val: unknown): string {
  if (val === undefined || val === null) return ''
  if (Array.isArray(val)) return val.join(', ')
  if (typeof val === 'boolean') return val ? 'Yes' : 'No'
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val as string | number)
}

function ApplicationDetail({
  responses,
  formFields,
  status,
  applicationId,
  onStatusChange,
}: {
  responses: Record<string, unknown>
  formFields: Array<FormField>
  status: ApplicationStatus
  applicationId: Id<'opportunityApplications'>
  onStatusChange: (
    id: Id<'opportunityApplications'>,
    s: ApplicationStatus,
  ) => void
}) {
  return (
    <div className="space-y-6">
      {formFields.length > 0 ? (
        <DynamicResponseViewer formFields={formFields} responses={responses} />
      ) : (
        <FallbackResponseViewer responses={responses} />
      )}

      {/* Status update */}
      <div className="flex items-center gap-3 pt-4 border-t">
        <span className="text-sm font-medium">Update status:</span>
        <Select
          value={status}
          onValueChange={(val) =>
            onStatusChange(applicationId, val as ApplicationStatus)
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="under_review">Under Review</SelectItem>
            <SelectItem value="accepted">Accepted</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="waitlisted">Waitlisted</SelectItem>
            <SelectItem value="participated">Participated</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

/** Fallback for opportunities without formFields — shows raw key/value pairs */
function FallbackResponseViewer({
  responses,
}: {
  responses: Record<string, unknown>
}) {
  return (
    <div className="space-y-2">
      {Object.entries(responses)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([key, val]) => (
          <div key={key}>
            <span className="text-xs text-muted-foreground">{key}</span>
            <p className="text-sm whitespace-pre-wrap">
              {formatCellValue(val)}
            </p>
          </div>
        ))}
    </div>
  )
}
