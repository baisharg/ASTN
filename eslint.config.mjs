import { defineConfig, globalIgnores } from 'eslint/config'
import convexPlugin from '@convex-dev/eslint-plugin'
import tseslint from 'typescript-eslint'

// Files whose public functions declare their access level with the wrappers
// in convex/lib/access.ts. In these, a bare query/mutation/action from
// _generated/server is an error; internal functions may stay bare.
const ACCESS_DECLARED_FILES = [
  'convex/orgOpportunities.ts',
  'convex/opportunityApplications.ts',
  'convex/availabilityPolls.ts',
  'convex/feedbackSurveys.ts',
  'convex/applicationInvites.ts',
  'convex/emails/outbox.ts',
  'convex/emails/templateLibrary.ts',
  'convex/emails/outboxSend.ts',
  'convex/emails/adminBroadcastAction.ts',
]

export default defineConfig([
  tseslint.configs.base,
  ...convexPlugin.configs.recommended,
  {
    files: ACCESS_DECLARED_FILES,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/_generated/server'],
              importNames: ['query', 'mutation', 'action'],
              message:
                'Declare the access level: use publicQuery, memberQuery, courseQuery, orgQuery (and their mutation/action forms) from convex/lib/access.ts.',
            },
          ],
        },
      ],
    },
  },
  globalIgnores(['convex/_generated']),
])
