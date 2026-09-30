import { Check, Plus, X } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { CrmColumn, FieldDef, FieldValue } from './fieldValues'
import { isEmptyValue, optionClasses, optionColor } from './fieldValues'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '~/components/ui/command'
import { Input } from '~/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover'
import { Textarea } from '~/components/ui/textarea'
import { cn } from '~/lib/utils'

// ── Display ──────────────────────────────────────────────────────────────

export function OptionTag({
  value,
  color,
  className,
}: {
  value: string
  color: string | undefined
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center truncate rounded-full border px-2 py-0.5 text-xs font-medium',
        optionClasses(color),
        className,
      )}
      title={value}
    >
      <span className="truncate">{value}</span>
    </span>
  )
}

export function hrefFor(type: CrmColumn['type'], value: string): string {
  if (type === 'email') return `mailto:${value}`
  if (type === 'phone') return `tel:${value.replace(/[^\d+]/g, '')}`
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

export function formatDate(value: string): string {
  const [y, m, d] = value.split('-')
  return y && m && d ? `${d}/${m}/${y}` : value
}

/** Read-only rendering of a value; `wrap` lets tags wrap onto new lines. */
export function ValueDisplay({
  column,
  value,
  wrap = false,
}: {
  column: CrmColumn
  value: FieldValue
  wrap?: boolean
}) {
  if (isEmptyValue(value)) {
    return <span className="text-muted-foreground/50">—</span>
  }
  switch (column.type) {
    case 'singleSelect':
    case 'multiSelect': {
      const list = Array.isArray(value) ? value : [String(value)]
      return (
        <span
          className={cn(
            'flex min-w-0 gap-1',
            wrap ? 'flex-wrap' : 'overflow-hidden',
          )}
        >
          {list.map((v) => (
            <OptionTag
              key={v}
              value={v}
              color={optionColor(column.def, v)}
              className={wrap ? undefined : 'shrink-0'}
            />
          ))}
        </span>
      )
    }
    case 'checkbox':
      return <span>{value === true ? 'Sí' : 'No'}</span>
    case 'date':
      return <span>{formatDate(String(value))}</span>
    case 'number':
      return (
        <span className="tabular-nums">
          {typeof value === 'number' ? value.toLocaleString('es-AR') : value}
        </span>
      )
    case 'url':
    case 'email':
    case 'phone': {
      const text = String(value)
      return (
        <a
          href={hrefFor(column.type, text)}
          target={column.type === 'url' ? '_blank' : undefined}
          rel="noreferrer"
          className="truncate text-blue-700 underline-offset-2 hover:underline"
          onClick={(e) => e.stopPropagation()}
          title={text}
        >
          {column.type === 'url'
            ? text.replace(/^https?:\/\/(www\.)?/i, '')
            : text}
        </a>
      )
    }
    default:
      return (
        <span
          className={wrap ? 'whitespace-pre-wrap' : 'truncate'}
          title={String(value)}
        >
          {String(value)}
        </span>
      )
  }
}

// ── Tag picker ───────────────────────────────────────────────────────────

/**
 * Keyboard-friendly picker for select fields. Multi-select toggles stay
 * open; single-select closes on pick. Unknown values can be created as new
 * options when `onCreateOption` is given.
 */
export function TagPicker({
  def,
  multi,
  value,
  onChange,
  onCreateOption,
  open,
  onOpenChange,
  children,
  align = 'start',
}: {
  def: FieldDef
  multi: boolean
  value: FieldValue
  onChange: (next: FieldValue) => void
  onCreateOption?: (value: string) => Promise<boolean>
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  align?: 'start' | 'center' | 'end'
}) {
  const [query, setQuery] = useState('')
  // Local copy so fast toggles build on each other before the server echoes.
  const [draft, setDraft] = useState<Array<string>>(() => toList(value))
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setDraft(toList(value))
      setQuery('')
    }
  }

  const pick = (option: string) => {
    if (multi) {
      const next = draft.includes(option)
        ? draft.filter((x) => x !== option)
        : [...draft, option]
      setDraft(next)
      onChange(next.length ? next : null)
    } else {
      onChange(draft[0] === option ? null : option)
      onOpenChange(false)
    }
  }

  const trimmed = query.trim()
  const canCreate =
    !!onCreateOption &&
    trimmed !== '' &&
    !def.options.some((o) => o.value.toLowerCase() === trimmed.toLowerCase())

  const create = async () => {
    if (!onCreateOption) return
    const ok = await onCreateOption(trimmed)
    if (!ok) return
    setQuery('')
    pick(trimmed)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-64 p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <Command>
          <CommandInput
            placeholder={onCreateOption ? 'Buscar o crear…' : 'Buscar…'}
            value={query}
            onValueChange={setQuery}
            aria-label={`Opciones de ${def.label}`}
          />
          <CommandList className="max-h-64">
            <CommandEmpty>
              {canCreate ? null : 'No hay opciones que coincidan.'}
            </CommandEmpty>
            {def.options.length > 0 && (
              <CommandGroup>
                {def.options.map((o) => {
                  const selected = draft.includes(o.value)
                  return (
                    <CommandItem
                      key={o.value}
                      value={o.value}
                      onSelect={() => pick(o.value)}
                      aria-selected={selected}
                      className="gap-2"
                    >
                      <Check
                        className={cn(
                          'size-4 shrink-0',
                          selected ? 'opacity-100' : 'opacity-0',
                        )}
                        aria-hidden
                      />
                      <OptionTag value={o.value} color={o.color} />
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
            {canCreate && (
              <CommandGroup forceMount>
                <CommandItem
                  forceMount
                  value={`__create__${trimmed}`}
                  onSelect={() => void create()}
                  className="gap-2"
                >
                  <Plus className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">Crear «{trimmed}»</span>
                </CommandItem>
              </CommandGroup>
            )}
            {!multi && draft.length > 0 && !trimmed && (
              <CommandGroup>
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onChange(null)
                    onOpenChange(false)
                  }}
                  className="gap-2 text-muted-foreground"
                >
                  <X className="size-4 shrink-0" aria-hidden />
                  Quitar valor
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function toList(value: FieldValue): Array<string> {
  if (Array.isArray(value)) return value
  if (typeof value === 'string' && value) return [value]
  return []
}

// ── Form input (person page) ─────────────────────────────────────────────

/**
 * An always-visible editor for one field, saving on blur (text), on change
 * (checkbox, date) or on pick (selects).
 */
export function FieldInput({
  id,
  column,
  value,
  onSave,
  onCreateOption,
}: {
  id: string
  column: CrmColumn
  value: FieldValue
  onSave: (value: FieldValue) => Promise<boolean>
  onCreateOption?: (value: string) => Promise<boolean>
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const serverText =
    value === null || value === undefined || typeof value === 'boolean'
      ? ''
      : Array.isArray(value)
        ? value.join(', ')
        : String(value)

  switch (column.type) {
    case 'checkbox':
      return (
        <div className="flex h-9 items-center">
          <Checkbox
            id={id}
            checked={value === true}
            onCheckedChange={(checked) => void onSave(checked === true)}
          />
        </div>
      )
    case 'singleSelect':
    case 'multiSelect': {
      if (!column.def) return null
      return (
        <TagPicker
          def={column.def}
          multi={column.type === 'multiSelect'}
          value={value}
          onChange={(next) => void onSave(next)}
          onCreateOption={onCreateOption}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
        >
          <button
            id={id}
            type="button"
            className="flex min-h-9 w-full items-center rounded-md border bg-background px-2 py-1 text-left text-sm shadow-xs hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {isEmptyValue(value) ? (
              <span className="text-muted-foreground">Elegir…</span>
            ) : (
              <ValueDisplay column={column} value={value} wrap />
            )}
          </button>
        </TagPicker>
      )
    }
    case 'longText':
      return (
        <Textarea
          id={id}
          key={serverText}
          defaultValue={serverText}
          rows={3}
          onBlur={(e) => {
            if (e.target.value !== serverText) void onSave(e.target.value)
          }}
        />
      )
    case 'date':
      return (
        <Input
          id={id}
          key={serverText}
          type="date"
          defaultValue={serverText}
          onBlur={(e) => {
            if (e.target.value !== serverText)
              void onSave(e.target.value || null)
          }}
        />
      )
    case 'number':
      return (
        <Input
          id={id}
          key={serverText}
          type="number"
          inputMode="decimal"
          defaultValue={serverText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          onBlur={(e) => {
            const raw = e.target.value.trim()
            if (raw === serverText) return
            const n = Number(raw)
            if (raw && !Number.isFinite(n)) return
            void onSave(raw ? n : null)
          }}
        />
      )
    default:
      return (
        <Input
          id={id}
          key={serverText}
          type={
            column.type === 'email'
              ? 'email'
              : column.type === 'url'
                ? 'url'
                : 'text'
          }
          defaultValue={serverText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          onBlur={async (e) => {
            const input = e.currentTarget
            if (input.value === serverText) return
            const ok = await onSave(input.value)
            if (!ok) input.value = serverText
          }}
        />
      )
  }
}
