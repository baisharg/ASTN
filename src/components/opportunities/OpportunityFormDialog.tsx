import { useState } from 'react'
import { useMutation } from 'convex/react'
import { Loader2 } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Button } from '~/components/ui/button'
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

type OpportunityType = 'course' | 'fellowship' | 'job' | 'other'
type OpportunityStatus = 'active' | 'closed' | 'draft'

interface OpportunityFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: Id<'organizations'>
  slug: string
}

export function OpportunityFormDialog({
  open,
  onOpenChange,
  orgId,
  slug,
}: OpportunityFormDialogProps) {
  const navigate = useNavigate()
  const createOpp = useMutation(api.orgOpportunities.create)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<OpportunityType>('course')
  const [status, setStatus] = useState<OpportunityStatus>('draft')
  const [deadlineStr, setDeadlineStr] = useState('')
  const [externalUrl, setExternalUrl] = useState('')
  const [featured, setFeatured] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const canSave = title.trim() && description.trim()

  const handleSave = async () => {
    if (!canSave || isSaving) return
    setIsSaving(true)
    try {
      const deadline = deadlineStr ? new Date(deadlineStr).getTime() : undefined
      const newId = await createOpp({
        orgId,
        title: title.trim(),
        description: description.trim(),
        type,
        status,
        deadline,
        externalUrl: externalUrl.trim() || undefined,
        featured,
      })
      onOpenChange(false)
      void navigate({
        to: '/org/$slug/admin/opportunities/$oppId',
        params: { slug, oppId: newId },
      })
    } catch (err) {
      console.error('Failed to create opportunity:', err)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Opportunity</DialogTitle>
          <DialogDescription>
            Create a new opportunity. You can add application form fields after
            creation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor="opp-title">
              Title <span className="text-red-500">*</span>
            </Label>
            <Input
              id="opp-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Technical AI Safety Course"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="opp-desc">
              Description <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="opp-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Brief description shown on the apply page"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Type</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as OpportunityType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="course">Course</SelectItem>
                  <SelectItem value="fellowship">Fellowship</SelectItem>
                  <SelectItem value="job">Job</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as OpportunityStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="opp-deadline">Deadline (optional)</Label>
              <Input
                id="opp-deadline"
                type="date"
                value={deadlineStr}
                onChange={(e) => setDeadlineStr(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="opp-url">External URL (optional)</Label>
              <Input
                id="opp-url"
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={featured}
              onCheckedChange={(checked) => setFeatured(checked === true)}
            />
            <span className="text-sm">
              Featured opportunity (shown on org landing page)
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Opportunity'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
