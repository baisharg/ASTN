import { Navigate, createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

const searchSchema = z.object({
  step: z
    .enum([
      'basic',
      'education',
      'work',
      'goals',
      'skills',
      'preferences',
      'privacy',
    ])
    .optional()
    // Old links (e.g. ?step=enrichment, a removed step) open the profile.
    .catch(undefined),
})

export const Route = createFileRoute('/profile/edit')({
  validateSearch: searchSchema,
  component: ProfileEditRedirect,
})

function ProfileEditRedirect() {
  const { step } = Route.useSearch()

  return (
    <Navigate to="/profile" search={step ? { section: step } : {}} replace />
  )
}
