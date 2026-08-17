import { useMutation, useQuery } from 'convex/react'
import { Loader2, Save, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { FormField } from '../../../convex/lib/formFields'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'

/**
 * Load-from / save-to controls for the org's form template library, shown
 * above the question editor. Deliberately the same pair of moves the Emails
 * tab already offers for email template sets, so there is one idea to learn
 * rather than two.
 *
 * Loading replaces the questions in the editor with a copy of the template's.
 * Nothing is persisted until the surrounding form is saved, so a mistaken load
 * is undone by leaving without saving.
 */
export function FormTemplateBar({
  orgId,
  kind,
  fields,
  onLoad,
  disabled,
  saveOnly,
}: {
  orgId: Id<'organizations'>
  kind: 'application' | 'feedback'
  fields: Array<FormField>
  onLoad: (fields: Array<FormField>) => void
  disabled?: boolean
  /**
   * Save half only. For forms whose questions can no longer be edited — a
   * published survey — where capturing them into the library is still useful
   * but loading one into them is meaningless.
   */
  saveOnly?: boolean
}) {
  const templates = useQuery(api.formTemplates.listForOrg, { orgId, kind })
  const createTemplate = useMutation(api.formTemplates.create)
  const removeTemplate = useMutation(api.formTemplates.remove)

  const [selectedId, setSelectedId] = useState<string>('')
  const [isNaming, setIsNaming] = useState(false)
  const [name, setName] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const validFields = fields.filter((f) => f.label.trim())
  const selected = templates?.find((t) => t._id === selectedId)

  const handleLoad = (id: string) => {
    const template = templates?.find((t) => t._id === id)
    if (!template) return
    setSelectedId(id)
    onLoad(template.formFields as Array<FormField>)
    toast.success(`Loaded "${template.name}" — these questions are a copy`)
  }

  const handleSave = async () => {
    if (isSaving) return
    setIsSaving(true)
    try {
      await createTemplate({
        orgId,
        name,
        kind,
        formFields: validFields,
      })
      toast.success(`Saved "${name.trim()}" to the template library`)
      setIsNaming(false)
      setName('')
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not save the template',
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    try {
      await removeTemplate({ templateId: selected._id })
      toast.success(`Deleted "${selected.name}"`)
      setSelectedId('')
    } catch {
      toast.error('Could not delete the template')
    }
  }

  return (
    <div className="rounded-md border border-input p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {!saveOnly && (
        <Select
          value={selectedId}
          onValueChange={handleLoad}
          disabled={disabled || !templates || templates.length === 0}
        >
          <SelectTrigger className="w-full sm:w-64">
            <SelectValue
              placeholder={
                templates && templates.length === 0
                  ? 'No saved templates yet'
                  : 'Load a template…'
              }
            />
          </SelectTrigger>
          <SelectContent>
            {(templates ?? []).map((t) => (
              <SelectItem key={t._id} value={t._id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        )}

        {!isNaming ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || validFields.length === 0}
            onClick={() => setIsNaming(true)}
          >
            <Save className="size-4 mr-1" />
            Save as template
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Template name"
              className="w-48"
            />
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={isSaving || !name.trim()}
            >
              {isSaving && <Loader2 className="size-4 mr-1 animate-spin" />}
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsNaming(false)
                setName('')
              }}
            >
              Cancel
            </Button>
          </div>
        )}

        {selected && !isNaming && !saveOnly && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-red-600"
            onClick={handleDelete}
            disabled={disabled}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {saveOnly
          ? 'Saves these questions to the organisation-wide library so a future course can start from them. The survey itself is not changed.'
          : 'Templates are shared across the whole organisation. Loading one copies its questions into the editor below — edit them freely, the template is not changed.'}
      </p>
    </div>
  )
}
