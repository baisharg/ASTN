import { ChevronDown, ChevronRight, Download, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { FormField } from '../../../convex/lib/formFields'
import type { Id } from '../../../convex/_generated/dataModel'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'

interface Respondent {
  _id: Id<'surveyRespondents'>
  respondentName: string
  applicationId: Id<'opportunityApplications'>
  userId?: string
  hasResponded: boolean
  response?: {
    _id: Id<'surveyResponses'>
    responses: Record<string, unknown>
    submittedAt: number
  }
}

interface SurveyResultsTableProps {
  formFields: Array<FormField>
  respondents: Array<Respondent>
  surveyTitle: string
  onRemoveRespondent?: (id: Id<'surveyRespondents'>, name: string) => void
}

export function SurveyResultsTable({
  formFields,
  respondents,
  surveyTitle,
  onRemoveRespondent,
}: SurveyResultsTableProps) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  const inputFields = formFields.filter((f) => f.kind !== 'section_header')

  const handleExportCsv = () => {
    const headers = ['Name', 'Status', ...inputFields.map((f) => f.label)]
    const rows = respondents.map((r) => {
      const status = r.hasResponded ? 'Responded' : 'Pending'
      const fieldValues = inputFields.map((f) => {
        if (!r.response) return ''
        const val = r.response.responses[f.key]
        if (val === undefined || val === null) return ''
        if (Array.isArray(val)) return val.join('; ')
        return typeof val === 'object'
          ? JSON.stringify(val)
          : String(val as string | number)
      })
      return [r.respondentName, status, ...fieldValues]
    })

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => escapeCSV(cell)).join(','))
      .join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${surveyTitle.toLowerCase().replace(/\s+/g, '-')}-responses.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('CSV exported')
  }

  const responded = respondents.filter((r) => r.hasResponded)
  const pending = respondents.filter((r) => !r.hasResponded)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            Responses ({responded.length}/{respondents.length})
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={responded.length === 0}
          >
            <Download className="size-4 mr-1" />
            Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {respondents.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No respondents yet. Create the survey and send email invites.
          </p>
        ) : (
          <div className="space-y-1">
            {/* Responded */}
            {responded.map((r) => (
              <RespondentRow
                key={r._id}
                respondent={r}
                inputFields={inputFields}
                isExpanded={expandedRow === r._id}
                onToggle={() =>
                  setExpandedRow(expandedRow === r._id ? null : r._id)
                }
              />
            ))}
            {/* Pending */}
            {pending.length > 0 && (
              <div className="pt-2 mt-2 border-t">
                <p className="text-xs text-muted-foreground mb-1 px-2">
                  Pending ({pending.length})
                </p>
                {pending.map((r) => (
                  <div
                    key={r._id}
                    className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground"
                  >
                    <span className="flex-1">{r.respondentName}</span>
                    <Badge variant="outline" className="text-xs">
                      Pending
                    </Badge>
                    {onRemoveRespondent && (
                      <button
                        type="button"
                        onClick={() =>
                          onRemoveRespondent(r._id, r.respondentName)
                        }
                        className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors"
                        title={`Remove ${r.respondentName}`}
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function RespondentRow({
  respondent,
  inputFields,
  isExpanded,
  onToggle,
}: {
  respondent: Respondent
  inputFields: Array<FormField>
  isExpanded: boolean
  onToggle: () => void
}) {
  const r = respondent.response
  if (!r) return null

  return (
    <div className="rounded-md border">
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={onToggle}
      >
        {isExpanded ? (
          <ChevronDown className="size-4 text-slate-400 shrink-0" />
        ) : (
          <ChevronRight className="size-4 text-slate-400 shrink-0" />
        )}
        <span className="text-sm font-medium flex-1">
          {respondent.respondentName}
        </span>
        <span className="text-xs text-muted-foreground">
          {new Date(r.submittedAt).toLocaleDateString()}
        </span>
      </div>
      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t space-y-2">
          {inputFields.map((field) => {
            const val = r.responses[field.key]
            return (
              <div key={field.key} className="text-sm">
                <span className="text-muted-foreground">{field.label}:</span>{' '}
                <span className="font-medium">{formatValue(val, field)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function formatValue(val: unknown, field: FormField): string {
  if (val === undefined || val === null) return '—'
  if (field.kind === 'rating') {
    const num = Number(val)
    const labels = field.options?.length === 5 ? field.options : null
    return labels ? `${num} — ${labels[num - 1]}` : `${num}/5`
  }
  if (field.kind === 'nps') return `${String(val as string | number)}/10`
  if (field.kind === 'checkbox') return val === true ? 'Yes' : 'No'
  if (Array.isArray(val)) return val.join(', ')
  return typeof val === 'object'
    ? JSON.stringify(val)
    : String(val as string | number)
}

export function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
