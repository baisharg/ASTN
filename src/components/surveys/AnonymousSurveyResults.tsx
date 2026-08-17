import { ChevronDown, ChevronRight, Download } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ResponseFieldValue, escapeCSV } from './SurveyResultsTable'
import type { FormField } from '../../../convex/lib/formFields'
import type { Id } from '../../../convex/_generated/dataModel'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'

interface AnonymousResponse {
  _id: Id<'anonymousSurveyResponses'>
  responses: Record<string, unknown>
  submittedAt: number
}

/**
 * Results for an anonymous survey. There is no roster and no name on any row,
 * so this shows the answers and nothing else — no "pending" column, no way to
 * remove a person, and the submission date is the only metadata that exists.
 * Rows are numbered by arrival purely so they can be referred to; the number
 * says nothing about who sent them.
 */
export function AnonymousSurveyResults({
  formFields,
  responses,
  surveyTitle,
  imageUrls,
}: {
  formFields: Array<FormField>
  responses: Array<AnonymousResponse>
  surveyTitle: string
  /** storage id -> displayable url, for `image` fields. */
  imageUrls?: Record<string, string>
}) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const inputFields = formFields.filter((f) => f.kind !== 'section_header')

  const ordered = [...responses].sort((a, b) => a.submittedAt - b.submittedAt)

  const handleExportCsv = () => {
    const headers = ['Submitted', ...inputFields.map((f) => f.label)]
    const rows = ordered.map((r) => [
      new Date(r.submittedAt).toISOString(),
      ...inputFields.map((f) => {
        const val = r.responses[f.key]
        if (val === undefined || val === null) return ''
        if (Array.isArray(val)) return val.join('; ')
        return typeof val === 'object'
          ? JSON.stringify(val)
          : String(val as string | number)
      }),
    ])

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => escapeCSV(cell)).join(','))
      .join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${surveyTitle.toLowerCase().replace(/\s+/g, '-')}-anonymous-responses.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('CSV exported')
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            Anonymous responses ({ordered.length})
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={ordered.length === 0}
          >
            <Download className="size-4 mr-1" />
            Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {ordered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No responses yet. Publish the survey and share the link with the
            group.
          </p>
        ) : (
          <div className="space-y-1">
            {ordered.map((r, i) => {
              const isExpanded = expanded === r._id
              return (
                <div key={r._id} className="rounded-md border">
                  <div
                    className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-50 transition-colors"
                    onClick={() => setExpanded(isExpanded ? null : r._id)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="size-4 text-slate-400 shrink-0" />
                    ) : (
                      <ChevronRight className="size-4 text-slate-400 shrink-0" />
                    )}
                    <span className="text-sm font-medium flex-1">
                      Response {i + 1}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(r.submittedAt).toLocaleDateString()}
                    </span>
                  </div>
                  {isExpanded && (
                    <div className="px-3 pb-3 pt-1 border-t space-y-2">
                      {inputFields.map((field) => (
                        <div key={field.key} className="text-sm">
                          <span className="text-muted-foreground">
                            {field.label}:
                          </span>{' '}
                          <ResponseFieldValue
                            val={r.responses[field.key]}
                            field={field}
                            imageUrls={imageUrls}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
