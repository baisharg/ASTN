import { useState } from 'react'
import { X } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { Input } from '~/components/ui/input'

interface TagsInputProps {
  value: Array<string>
  onChange: (tags: Array<string>) => void
  /** Existing tags in the org, offered as click-to-add suggestions. */
  suggestions?: Array<string>
  placeholder?: string
}

const has = (tags: Array<string>, tag: string) =>
  tags.some((t) => t.toLowerCase() === tag.toLowerCase())

export function TagsInput({
  value,
  onChange,
  suggestions = [],
  placeholder = 'Add a tag and press Enter…',
}: TagsInputProps) {
  const [draft, setDraft] = useState('')

  const addTag = (raw: string) => {
    const tag = raw.trim()
    if (!tag || has(value, tag)) {
      setDraft('')
      return
    }
    onChange([...value, tag])
    setDraft('')
  }

  const removeTag = (tag: string) => {
    onChange(value.filter((t) => t !== tag))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(draft)
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      removeTag(value[value.length - 1])
    }
  }

  // Suggestions matching the current draft and not already selected.
  const filteredSuggestions = suggestions
    .filter((s) => !has(value, s))
    .filter((s) => s.toLowerCase().includes(draft.trim().toLowerCase()))
    .slice(0, 8)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1 pr-1">
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="rounded-sm hover:bg-black/10 p-0.5"
              aria-label={`Remove ${tag}`}
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
      </div>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => addTag(draft)}
        placeholder={placeholder}
      />
      {filteredSuggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Suggestions:</span>
          {filteredSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => addTag(s)}
              className="text-xs rounded-full border border-dashed border-input px-2 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
