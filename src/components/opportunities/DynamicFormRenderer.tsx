import { useMutation } from 'convex/react'
import { useState } from 'react'
import { api } from '../../../convex/_generated/api'
import type { FormField } from '../../../convex/lib/formFields'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Textarea } from '~/components/ui/textarea'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'

/** Generous enough for a phone photo, small enough to stop accidents. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

interface DynamicFormRendererProps {
  formFields: Array<FormField>
  responses: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  /**
   * Survey token (personal or, for an anonymous survey, the generic one) that
   * authorises uploads for `image` fields. Respondents are guests, so this
   * token is what stands in for a login. Omit it where uploads do not apply —
   * previews, and forms outside surveys — and image fields will say so rather
   * than offer a control that cannot work.
   */
  uploadToken?: string
}

export function DynamicFormRenderer({
  formFields,
  responses,
  onChange,
  uploadToken,
}: DynamicFormRendererProps) {
  // Group fields into sections. Each section_header starts a new card.
  // Fields before the first section_header go into an untitled card.
  const sections: Array<{
    title?: string
    description?: string
    fields: Array<FormField>
  }> = []
  let current: {
    title?: string
    description?: string
    fields: Array<FormField>
  } = {
    fields: [],
  }

  for (const field of formFields) {
    if (field.kind === 'section_header') {
      if (current.fields.length > 0 || current.title) {
        sections.push(current)
      }
      current = {
        title: field.label,
        description: field.description,
        fields: [],
      }
    } else {
      current.fields.push(field)
    }
  }
  if (current.fields.length > 0 || current.title) {
    sections.push(current)
  }

  return (
    <div className="space-y-6">
      {sections.map((section, sIdx) => (
        <Card key={sIdx}>
          {section.title && (
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
              {section.description && (
                <p className="text-sm text-muted-foreground whitespace-pre-line">
                  {section.description}
                </p>
              )}
            </CardHeader>
          )}
          <CardContent
            className={section.title ? 'space-y-4' : 'space-y-4 pt-6'}
          >
            {section.fields.map((field) => (
              <FieldRenderer
                key={field.key}
                field={field}
                value={responses[field.key]}
                onChange={(val) => onChange(field.key, val)}
                uploadToken={uploadToken}
              />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function FieldRenderer({
  field,
  value,
  onChange,
  uploadToken,
}: {
  field: FormField
  value: unknown
  onChange: (val: unknown) => void
  uploadToken?: string
}) {
  switch (field.kind) {
    case 'image':
      return (
        <ImageField
          field={field}
          value={value}
          onChange={onChange}
          uploadToken={uploadToken}
        />
      )

    case 'text':
    case 'email':
    case 'url':
      return (
        <div className="space-y-2">
          <Label htmlFor={field.key}>
            {field.label}
            {field.required && <span className="text-red-500"> *</span>}
          </Label>
          {field.description && (
            <p className="text-xs text-muted-foreground whitespace-pre-line">
              {field.description}
            </p>
          )}
          <Input
            id={field.key}
            type={field.kind}
            value={
              typeof value === 'string'
                ? value
                : typeof value === 'number'
                  ? String(value)
                  : ''
            }
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
          />
        </div>
      )

    case 'textarea':
      return (
        <div className="space-y-2">
          <Label htmlFor={field.key}>
            {field.label}
            {field.required && <span className="text-red-500"> *</span>}
          </Label>
          {field.description && (
            <p className="text-xs text-muted-foreground whitespace-pre-line">
              {field.description}
            </p>
          )}
          <Textarea
            id={field.key}
            value={
              typeof value === 'string'
                ? value
                : typeof value === 'number'
                  ? String(value)
                  : ''
            }
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            rows={field.rows ?? 4}
          />
        </div>
      )

    case 'select':
      return (
        <div className="space-y-2">
          <Label>
            {field.label}
            {field.required && <span className="text-red-500"> *</span>}
          </Label>
          {field.description && (
            <p className="text-xs text-muted-foreground whitespace-pre-line">
              {field.description}
            </p>
          )}
          <Select
            value={
              typeof value === 'string'
                ? value
                : typeof value === 'number'
                  ? String(value)
                  : ''
            }
            onValueChange={(val) => onChange(val)}
          >
            <SelectTrigger>
              <SelectValue placeholder={field.placeholder ?? 'Select...'} />
            </SelectTrigger>
            <SelectContent>
              {(field.options ?? []).map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )

    case 'multi_select':
      return (
        <MultiSelectField field={field} value={value} onChange={onChange} />
      )

    case 'checkbox':
      return (
        <div className="space-y-2">
          {field.description && (
            <div className="space-y-1">
              <Label>{field.label}</Label>
              <p className="text-xs text-muted-foreground whitespace-pre-line">
                {field.description}
              </p>
            </div>
          )}
          <label className="flex items-start gap-2 cursor-pointer">
            <Checkbox
              checked={value === true}
              onCheckedChange={(checked) => onChange(checked === true)}
              className="mt-0.5"
            />
            <span className="text-sm">
              {field.description ? `Yes` : field.label}
            </span>
          </label>
        </div>
      )

    case 'radio':
      return (
        <div className="space-y-2">
          <Label>
            {field.label}
            {field.required && <span className="text-red-500"> *</span>}
          </Label>
          {field.description && (
            <p className="text-xs text-muted-foreground whitespace-pre-line">
              {field.description}
            </p>
          )}
          <div className="flex gap-4">
            {(field.options ?? ['Yes', 'No']).map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-2 cursor-pointer"
              >
                <input
                  type="radio"
                  name={field.key}
                  checked={
                    opt === 'Yes'
                      ? value === true
                      : opt === 'No'
                        ? value === false
                        : value === opt
                  }
                  onChange={() => {
                    if (opt === 'Yes') onChange(true)
                    else if (opt === 'No') onChange(false)
                    else onChange(opt)
                  }}
                  className="size-4 accent-primary"
                />
                <span className="text-sm">{opt}</span>
              </label>
            ))}
          </div>
        </div>
      )

    case 'rating': {
      const labels =
        field.options?.length === 5 ? field.options : ['1', '2', '3', '4', '5']
      const current = typeof value === 'number' ? value : null
      return (
        <div className="space-y-2">
          <Label>
            {field.label}
            {field.required && <span className="text-red-500"> *</span>}
          </Label>
          {field.description && (
            <p className="text-xs text-muted-foreground whitespace-pre-line">
              {field.description}
            </p>
          )}
          <div className="flex gap-2">
            {labels.map((label, i) => {
              const score = i + 1
              const isSelected = current === score
              return (
                <button
                  key={score}
                  type="button"
                  onClick={() => onChange(score)}
                  className={`flex-1 py-2 px-3 rounded-md border text-sm font-medium transition-colors ${
                    isSelected
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-slate-200 text-slate-600 hover:border-primary hover:text-primary'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      )
    }

    case 'nps': {
      const current = typeof value === 'number' ? value : null
      return (
        <div className="space-y-2">
          <Label>
            {field.label}
            {field.required && <span className="text-red-500"> *</span>}
          </Label>
          {field.description && (
            <p className="text-xs text-muted-foreground whitespace-pre-line">
              {field.description}
            </p>
          )}
          <div className="flex gap-1">
            {Array.from({ length: 11 }, (_, i) => {
              const isSelected = current === i
              const bg = isSelected
                ? i <= 6
                  ? 'bg-red-500 text-white border-red-500'
                  : i <= 8
                    ? 'bg-yellow-500 text-white border-yellow-500'
                    : 'bg-green-500 text-white border-green-500'
                : 'border-slate-200 text-slate-600 hover:border-slate-400'
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onChange(i)}
                  className={`flex-1 py-2 rounded-md border text-sm font-medium transition-colors ${bg}`}
                >
                  {i}
                </button>
              )
            })}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Not at all likely</span>
            <span>Extremely likely</span>
          </div>
        </div>
      )
    }

    default:
      return null
  }
}

function MultiSelectField({
  field,
  value,
  onChange,
}: {
  field: FormField
  value: unknown
  onChange: (val: unknown) => void
}) {
  const selected = Array.isArray(value) ? (value as Array<string>) : []
  const max = field.maxSelections ?? Infinity

  const toggle = (opt: string) => {
    if (selected.includes(opt)) {
      onChange(selected.filter((v) => v !== opt))
    } else if (selected.length < max) {
      onChange([...selected, opt])
    }
  }

  return (
    <div className="space-y-2">
      <Label>
        {field.label}
        {field.required && <span className="text-red-500"> *</span>}
      </Label>
      {field.description && (
        <p className="text-xs text-muted-foreground whitespace-pre-line">
          {field.description}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {(field.options ?? []).map((opt) => {
          const isSelected = selected.includes(opt)
          const isDisabled = !isSelected && selected.length >= max
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(opt)}
              disabled={isDisabled}
              className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                isSelected
                  ? 'bg-primary text-primary-foreground border-primary'
                  : isDisabled
                    ? 'opacity-40 cursor-not-allowed border-slate-200 text-slate-400'
                    : 'border-slate-300 text-slate-600 hover:border-primary hover:text-primary'
              }`}
            >
              {opt}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Upload control for an `image` form field. The response value is the Convex
 * storage id as a plain string; the preview shown after upload comes from the
 * local file, so no extra round trip is needed to display what was just sent.
 */
function ImageField({
  field,
  value,
  onChange,
  uploadToken,
}: {
  field: FormField
  value: unknown
  onChange: (val: unknown) => void
  uploadToken?: string
}) {
  const generateUploadUrl = useMutation(api.upload.generateSurveyUploadUrl)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasUpload = typeof value === 'string' && value.length > 0

  const handleFile = async (file: File | undefined) => {
    if (!file || !uploadToken || isUploading) return
    if (!file.type.startsWith('image/')) {
      setError('That file is not an image. Pick a JPG or PNG.')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('That image is over 10 MB. Pick a smaller one.')
      return
    }
    setError(null)
    setIsUploading(true)
    try {
      const uploadUrl = await generateUploadUrl({ token: uploadToken })
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!res.ok) throw new Error(`Upload failed (${res.status})`)
      const { storageId } = (await res.json()) as { storageId: string }
      onChange(storageId)
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return URL.createObjectURL(file)
      })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not upload the image. Try again.',
      )
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={field.key}>
        {field.label}
        {field.required && <span className="text-red-500"> *</span>}
      </Label>
      {field.description && (
        <p className="text-xs text-muted-foreground whitespace-pre-line">
          {field.description}
        </p>
      )}

      {!uploadToken ? (
        <p className="text-xs text-muted-foreground italic">
          Image uploads are only available on the live form.
        </p>
      ) : (
        <div className="flex items-center gap-3">
          {previewUrl && (
            <img
              src={previewUrl}
              alt=""
              className="size-16 rounded-md object-cover border"
            />
          )}
          <div className="space-y-1">
            <Input
              id={field.key}
              type="file"
              accept="image/*"
              disabled={isUploading}
              onChange={(e) => void handleFile(e.target.files?.[0])}
              className="max-w-xs"
            />
            {isUploading && (
              <p className="text-xs text-muted-foreground">Uploading…</p>
            )}
            {!isUploading && hasUpload && (
              <p className="text-xs text-green-600">
                Image uploaded. Choose another file to replace it.
              </p>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
