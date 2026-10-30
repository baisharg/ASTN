import { createContext, useContext, useState } from 'react'
import { useAction, useMutation, useQuery } from 'convex/react'
import {
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  Loader2,
} from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { FormField } from '../../../convex/lib/formFields'
import { DynamicResponseViewer } from '~/components/opportunities/DynamicResponseViewer'
import { Card } from '~/components/ui/card'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'
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
  | 'next_edition'
  | 'rejected'
  | 'redirected'
  | 'waitlisted'
  | 'participated'

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  submitted: 'Submitted',
  under_review: 'Under Review',
  accepted: 'Accepted',
  next_edition: 'Next edition',
  rejected: 'Rejected',
  redirected: 'Fit for another course',
  waitlisted: 'Waitlisted',
  participated: 'Participated',
}

const STATUS_COLORS: Record<ApplicationStatus, string> = {
  submitted: 'bg-blue-50 text-blue-700 border-blue-200',
  under_review: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  accepted: 'bg-green-50 text-green-700 border-green-200',
  next_edition: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  redirected: 'bg-orange-50 text-orange-700 border-orange-200',
  waitlisted: 'bg-purple-50 text-purple-700 border-purple-200',
  participated: 'bg-teal-50 text-teal-700 border-teal-200',
}

// Course readers see the table but cannot change statuses.
const ReadOnlyContext = createContext(false)

export function ApplicationsTable({
  opportunityId,
  opportunityTitle,
  formFields,
  readOnly = false,
}: {
  opportunityId: Id<'orgOpportunities'>
  opportunityTitle: string
  formFields: Array<FormField>
  readOnly?: boolean
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
  const nextEditionLinks = useQuery(
    api.opportunityApplications.getNextEditionLinks,
    { opportunityId },
  )
  const exportCsv = useAction(api.opportunityApplications.exportApplications)

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const csv = await exportCsv({
        opportunityId,
        statusFilter:
          statusFilter !== 'all'
            ? (statusFilter as ApplicationStatus)
            : undefined,
      })
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `applications-${opportunityTitle.toLowerCase().replace(/\s+/g, '-')}${statusFilter !== 'all' ? `-${statusFilter}` : ''}.csv`
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

  return (
    <ReadOnlyContext.Provider value={readOnly}>
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
                <SelectItem value="next_edition">Next edition</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="redirected">
                  Fit for another course
                </SelectItem>
                <SelectItem value="waitlisted">Waitlisted</SelectItem>
                <SelectItem value="participated">Participated</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={isExporting}
            >
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
            <ResultCount
              total={applications.length}
              incomplete={applications.filter((a) => a.availabilityOnly).length}
              status={
                statusFilter !== 'all'
                  ? (statusFilter as ApplicationStatus)
                  : undefined
              }
            />

            {/* Header — fixed columns, the same for every opportunity */}
            <div
              className="grid gap-2 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider"
              style={{ gridTemplateColumns: COLUMNS }}
            >
              <span>First name</span>
              <span>Last name</span>
              <span>Email</span>
              <span>Submitted</span>
              <span>Status</span>
              <span />
            </div>

            {applications.map((app) => {
              const r = app.responses as Record<string, unknown>
              const isExpanded = expandedId === app._id
              return (
                <Card key={app._id}>
                  {/* Clicking the row expands it; the status cell changes the
                    status without expanding. */}
                  <div
                    role="button"
                    tabIndex={0}
                    className="w-full cursor-pointer text-left"
                    onClick={() => setExpandedId(isExpanded ? null : app._id)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setExpandedId(isExpanded ? null : app._id)
                      }
                    }}
                  >
                    <div
                      className="grid gap-2 items-center px-4 py-3 text-sm"
                      style={{ gridTemplateColumns: COLUMNS }}
                    >
                      <span className="truncate">{app.firstName}</span>
                      <span className="truncate">{app.lastName}</span>
                      <span
                        className="truncate text-muted-foreground"
                        title={app.email}
                      >
                        {app.email}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {new Date(app.submittedAt).toLocaleDateString()}
                        {app.availabilityOnly && (
                          <span
                            className="block text-amber-700"
                            title="Gave availability through the poll's open link without filling the application form"
                          >
                            Incomplete application
                          </span>
                        )}
                      </span>
                      {/* Stops clicks (also inside the dropdown, which React
                        bubbles through its portal) from toggling the row. */}
                      <span
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <StatusSelect
                          value={app.status as ApplicationStatus}
                          onChange={(next) => handleStatusChange(app._id, next)}
                          className={cn(
                            'h-7 w-[140px] px-2 text-xs',
                            STATUS_COLORS[app.status as ApplicationStatus],
                          )}
                        />
                        {app.autoAcceptedFrom && (
                          <span
                            className="block text-[11px] text-green-700 mt-0.5"
                            title={`Accepted automatically: marked Next edition in ${nextEditionLinks?.autoAcceptedFrom[app._id] ?? 'an earlier edition'}`}
                          >
                            Auto-accepted
                          </span>
                        )}
                        {app.nextEditionAcceptedIn && (
                          <span
                            className="block text-[11px] text-muted-foreground mt-0.5 truncate"
                            title={`Accepted in ${nextEditionLinks?.acceptedIn[app._id] ?? 'a later edition'}`}
                          >
                            → Accepted in{' '}
                            {nextEditionLinks?.acceptedIn[app._id] ??
                              'a later edition'}
                          </span>
                        )}
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="size-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="size-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t px-4 py-4">
                      {app.availabilityOnly && (
                        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          Incomplete application: this person gave their
                          availability through the poll&apos;s open link and
                          never filled the application form, so only their name
                          and email are here.
                        </p>
                      )}
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
    </ReadOnlyContext.Provider>
  )
}

const COLUMNS = '1fr 1fr 1.5fr 120px 150px 32px'

// Counts what the table shows, so it follows the status filter.
function ResultCount({
  total,
  incomplete,
  status,
}: {
  total: number
  incomplete: number
  status?: ApplicationStatus
}) {
  const noun = total === 1 ? 'application' : 'applications'
  return (
    <p className="px-4 text-sm text-muted-foreground">
      <span className="font-medium text-foreground">{total}</span>{' '}
      {status ? `${noun} with status "${STATUS_LABELS[status]}"` : noun}
      {incomplete > 0 && (
        <span className="text-amber-700"> · {incomplete} incomplete</span>
      )}
    </p>
  )
}

function StatusSelect({
  value,
  onChange,
  className,
}: {
  value: ApplicationStatus
  onChange: (next: ApplicationStatus) => void
  className?: string
}) {
  const readOnly = useContext(ReadOnlyContext)
  return (
    <Select
      value={value}
      onValueChange={(val) => onChange(val as ApplicationStatus)}
      disabled={readOnly}
    >
      <SelectTrigger className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(STATUS_LABELS) as Array<ApplicationStatus>).map((s) => (
          <SelectItem key={s} value={s}>
            {STATUS_LABELS[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
        <StatusSelect
          value={status}
          onChange={(next) => onStatusChange(applicationId, next)}
          className="w-[160px]"
        />
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
