import { useState } from 'react'
import { useMutation } from 'convex/react'
import { ConvexError } from 'convex/values'
import { Loader2 } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { FormSource } from '../../../convex/canonicalForms'
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
  // Courses the user may create in. Admins also get "No course".
  courses: ReadonlyArray<string>
  isAdmin: boolean
}

const NO_COURSE = '__none__'

export function OpportunityFormDialog({
  open,
  onOpenChange,
  orgId,
  slug,
  courses,
  isAdmin,
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
  const [isEOI, setIsEOI] = useState(false)
  // The course tag decides the canonical form's course and who reaches it.
  const [course, setCourse] = useState<string>(
    isAdmin ? NO_COURSE : (courses[0] ?? NO_COURSE),
  )
  // null until picked: follows the EOI checkbox.
  const [pickedFormSource, setPickedFormSource] = useState<FormSource | null>(
    null,
  )
  const formSource = pickedFormSource ?? (isEOI ? 'eoi' : 'course')
  const [courseName, setCourseName] = useState('')
  const [courseArea, setCourseArea] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave = title.trim() && description.trim()

  const handleSave = async () => {
    if (!canSave || isSaving) return
    setIsSaving(true)
    setError(null)
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
        isEOI,
        formSource,
        ...(course !== NO_COURSE && { tags: [course] }),
        courseName: courseName.trim() || undefined,
        courseArea: courseArea.trim() || undefined,
      })
      onOpenChange(false)
      void navigate({
        to: '/org/$slug/admin/opportunities/$oppId',
        params: { slug, oppId: newId },
      })
    } catch (err) {
      console.error('Failed to create opportunity:', err)
      setError(
        err instanceof ConvexError && typeof err.data === 'string'
          ? err.data
          : 'Could not create the opportunity. Please try again.',
      )
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
            Create a new opportunity. Its application form is a copy of the
            org&apos;s canonical form (Admin → Canonical forms).
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

          <div className="space-y-1">
            <Label htmlFor="opp-course">Course</Label>
            <Select value={course} onValueChange={setCourse}>
              <SelectTrigger id="opp-course">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {isAdmin && (
                  <SelectItem value={NO_COURSE}>No course</SelectItem>
                )}
                {courses.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Who can open it besides admins: people with access to this course.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="opp-course-name">Course name</Label>
            <Input
              id="opp-course-name"
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
              placeholder="e.g. el Curso de Technical AI Safety"
            />
            <p className="text-xs text-muted-foreground">
              Fills {'{{course}}'} in the canonical form&apos;s questions.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="opp-course-area">Area</Label>
            <Input
              id="opp-course-area"
              value={courseArea}
              onChange={(e) => setCourseArea(e.target.value)}
              placeholder="e.g. la seguridad en IA"
            />
            <p className="text-xs text-muted-foreground">
              Fills {'{{area}}'} in the canonical form&apos;s questions.
            </p>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={isEOI}
              onCheckedChange={(checked) => setIsEOI(checked === true)}
            />
            <span className="text-sm">
              Expression of interest (no availability)
            </span>
          </label>

          <div className="space-y-1">
            <Label htmlFor="opp-form-source">Application form</Label>
            <Select
              value={formSource}
              onValueChange={(value) =>
                setPickedFormSource(value as FormSource)
              }
            >
              <SelectTrigger id="opp-form-source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="course">Course canonical form</SelectItem>
                <SelectItem value="eoi">
                  Expression of interest canonical form
                </SelectItem>
                <SelectItem value="custom">
                  Custom form (not a course edition)
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Course editions and EOIs copy their canonical form. A custom form
              starts with name and email and is written on the opportunity, for
              exceptions such as a feedback form or a job.
            </p>
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
          {error && <p className="text-sm text-destructive">{error}</p>}
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
