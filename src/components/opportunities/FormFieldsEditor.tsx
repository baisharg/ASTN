import { useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
} from 'lucide-react'
import { labelToKey } from '../../../convex/lib/formFields'
import type { FormField, FormFieldKind } from '../../../convex/lib/formFields'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Textarea } from '~/components/ui/textarea'
import { Checkbox } from '~/components/ui/checkbox'
import { Badge } from '~/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'

interface FormFieldsEditorProps {
  fields: Array<FormField>
  onChange: (fields: Array<FormField>) => void
}

const KIND_LABELS: Record<FormFieldKind, string> = {
  text: 'Text',
  textarea: 'Long Text',
  email: 'Email',
  url: 'URL',
  select: 'Dropdown',
  multi_select: 'Multi Select',
  checkbox: 'Checkbox',
  radio: 'Yes/No Radio',
  section_header: 'Section Header',
  rating: 'Rating (1-5)',
  nps: 'NPS (0-10)',
  image: 'Image Upload',
}

const KIND_COLORS: Record<FormFieldKind, string> = {
  text: 'bg-blue-50 text-blue-700',
  textarea: 'bg-blue-50 text-blue-700',
  email: 'bg-cyan-50 text-cyan-700',
  url: 'bg-cyan-50 text-cyan-700',
  select: 'bg-amber-50 text-amber-700',
  multi_select: 'bg-amber-50 text-amber-700',
  checkbox: 'bg-green-50 text-green-700',
  radio: 'bg-green-50 text-green-700',
  section_header: 'bg-slate-100 text-slate-700',
  rating: 'bg-purple-50 text-purple-700',
  nps: 'bg-orange-50 text-orange-700',
  image: 'bg-pink-50 text-pink-700',
}

export function FormFieldsEditor({ fields, onChange }: FormFieldsEditorProps) {
  const [expandedIndex, setExpandedIndex] = useState<number>(-1)

  const moveField = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= fields.length) return
    const updated = [...fields]
    ;[updated[index], updated[newIndex]] = [updated[newIndex], updated[index]]
    if (expandedIndex === index) setExpandedIndex(newIndex)
    else if (expandedIndex === newIndex) setExpandedIndex(index)
    onChange(updated)
  }

  const removeField = (index: number) => {
    onChange(fields.filter((_, i) => i !== index))
    if (expandedIndex === index) setExpandedIndex(-1)
    else if (expandedIndex > index) setExpandedIndex(expandedIndex - 1)
  }

  const updateField = (index: number, updates: Partial<FormField>) => {
    const updated = [...fields]
    updated[index] = { ...updated[index], ...updates }
    onChange(updated)
  }

  const addNewField = () => {
    const newField: FormField = { key: '', kind: 'text', label: '' }
    onChange([...fields, newField])
    setExpandedIndex(fields.length)
  }

  const toggleExpand = (index: number) => {
    setExpandedIndex(expandedIndex === index ? -1 : index)
  }

  return (
    <div className="space-y-2">
      {fields.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-muted-foreground">
          No form fields yet. Add fields to build your application form.
        </div>
      )}

      {fields.map((field, idx) => {
        const isExpanded = expandedIndex === idx
        const isSectionHeader = field.kind === 'section_header'

        return (
          <div
            key={`field-${idx}`}
            className={`rounded-lg border ${isSectionHeader ? 'border-slate-300 bg-slate-50' : 'bg-white'} ${isExpanded ? 'ring-2 ring-primary/20' : ''}`}
          >
            {/* Collapsed row */}
            <div
              className="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none"
              onClick={() => toggleExpand(idx)}
            >
              <div
                className="flex flex-col gap-0.5"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => moveField(idx, -1)}
                  disabled={idx === 0}
                  className="p-0.5 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ArrowUp className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => moveField(idx, 1)}
                  disabled={idx === fields.length - 1}
                  className="p-0.5 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ArrowDown className="size-3" />
                </button>
              </div>

              <Badge variant="outline" className={KIND_COLORS[field.kind]}>
                {KIND_LABELS[field.kind]}
              </Badge>

              <div className="flex-1 min-w-0">
                <span
                  className={`text-sm font-medium ${!field.label ? 'text-muted-foreground italic' : ''}`}
                >
                  {field.label || 'Untitled field'}
                </span>
                {field.description && !isExpanded && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {field.description}
                  </p>
                )}
              </div>

              {field.required && (
                <span className="text-xs text-red-500 font-medium shrink-0">
                  Required
                </span>
              )}

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  removeField(idx)
                }}
                className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors"
              >
                <Trash2 className="size-4" />
              </button>

              {isExpanded ? (
                <ChevronDown className="size-4 text-slate-400 shrink-0" />
              ) : (
                <ChevronRight className="size-4 text-slate-400 shrink-0" />
              )}
            </div>

            {/* Expanded inline editor */}
            {isExpanded && (
              <FieldEditor
                field={field}
                onChange={(updates) => updateField(idx, updates)}
              />
            )}
          </div>
        )
      })}

      <Button type="button" variant="outline" size="sm" onClick={addNewField}>
        <Plus className="size-4 mr-1" />
        Add field
      </Button>
    </div>
  )
}

function FieldEditor({
  field,
  onChange,
}: {
  field: FormField
  onChange: (updates: Partial<FormField>) => void
}) {
  const needsOptions = ['select', 'multi_select', 'radio'].includes(field.kind)
  const isTextarea = field.kind === 'textarea'
  const isMultiSelect = field.kind === 'multi_select'
  const isSectionHeader = field.kind === 'section_header'
  const isRating = field.kind === 'rating'

  const autoKey = labelToKey(field.label)

  return (
    <div className="px-3 pb-3 pt-1 border-t space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Field type</Label>
          <Select
            value={field.kind}
            onValueChange={(v) => onChange({ kind: v as FormFieldKind })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(
                Object.entries(KIND_LABELS) as Array<[FormFieldKind, string]>
              ).map(([k, l]) => (
                <SelectItem key={k} value={k}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Label</Label>
          <Input
            value={field.label}
            onChange={(e) => {
              const newLabel = e.target.value
              const updates: Partial<FormField> = { label: newLabel }
              // Auto-update key when it matches the auto-generated value
              if (!field.key || field.key === autoKey) {
                updates.key = labelToKey(newLabel)
              }
              onChange(updates)
            }}
            placeholder="e.g. First name"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">
          Key{' '}
          <span className="text-muted-foreground font-normal">
            (auto from label)
          </span>
        </Label>
        <Input
          value={field.key}
          onChange={(e) => onChange({ key: e.target.value })}
          placeholder={autoKey || 'fieldKey'}
          className="font-mono text-xs"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Description (optional)</Label>
        <Textarea
          value={field.description ?? ''}
          onChange={(e) =>
            onChange({ description: e.target.value || undefined })
          }
          rows={2}
          placeholder="Help text shown below the label"
        />
      </div>

      {!isSectionHeader && (
        <div className="space-y-1">
          <Label className="text-xs">Placeholder (optional)</Label>
          <Input
            value={field.placeholder ?? ''}
            onChange={(e) =>
              onChange({ placeholder: e.target.value || undefined })
            }
          />
        </div>
      )}

      {isRating && (
        <div className="space-y-1">
          <Label className="text-xs">
            Custom labels (optional, 5 lines for 1-5)
          </Label>
          <Textarea
            value={field.options?.join('\n') ?? ''}
            onChange={(e) => {
              const lines = e.target.value.split('\n')
              onChange({
                options: lines.some((l) => l.trim())
                  ? lines.map((l) => l.trimStart())
                  : undefined,
              })
            }}
            rows={5}
            placeholder={'Poor\nFair\nGood\nVery Good\nExcellent'}
          />
        </div>
      )}

      {needsOptions && (
        <div className="space-y-1">
          <Label className="text-xs">Options (one per line)</Label>
          <Textarea
            value={field.options?.join('\n') ?? ''}
            onChange={(e) => {
              const lines = e.target.value.split('\n')
              onChange({
                options: lines.some((l) => l.trim())
                  ? lines.map((l) => l.trimStart())
                  : undefined,
              })
            }}
            rows={4}
            placeholder={'Option 1\nOption 2\nOption 3'}
          />
        </div>
      )}

      {isMultiSelect && (
        <div className="space-y-1">
          <Label className="text-xs">Max selections (optional)</Label>
          <Input
            type="number"
            value={field.maxSelections ?? ''}
            onChange={(e) =>
              onChange({
                maxSelections: e.target.value
                  ? Number(e.target.value)
                  : undefined,
              })
            }
            placeholder="Unlimited"
            min={1}
          />
        </div>
      )}

      {isTextarea && (
        <div className="space-y-1">
          <Label className="text-xs">Rows (optional)</Label>
          <Input
            type="number"
            value={field.rows ?? ''}
            onChange={(e) =>
              onChange({
                rows: e.target.value ? Number(e.target.value) : undefined,
              })
            }
            placeholder="4"
            min={1}
            max={20}
          />
        </div>
      )}

      {!isSectionHeader && (
        <label className="flex items-center gap-2 cursor-pointer pt-1">
          <Checkbox
            checked={field.required ?? false}
            onCheckedChange={(checked) =>
              onChange({ required: checked === true || undefined })
            }
          />
          <span className="text-sm">Required</span>
        </label>
      )}
    </div>
  )
}
