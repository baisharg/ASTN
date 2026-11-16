// Where every public Convex function stands in the permission tests. A new
// query, mutation or action fails coverage.test.ts until it is added to the
// matrix (matrix.cases.helpers.ts) or listed here with its reason.

/** Covered by scenarios.test.ts instead of the table (what each person sees). */
export const COVERED_BY_SCENARIOS: Record<string, string> = {
  'orgOpportunities:listAllByOrg':
    'filters the list per person; scenarios.test.ts checks what each actor sees',
  'courseAccess:myAccess':
    'answers about the caller only; scenarios.test.ts checks each actor',
  'availabilityPolls:getApplicationAvailability':
    "the poll grid plus the caller's own answers only; scenarios.test.ts checks nobody sees another person's",
  'orgOpportunities:listByOrg':
    'public list of active opportunities; scenarios.test.ts checks drafts stay out',
}

/**
 * Public on purpose, or acting only on the caller's own data. One reason each.
 * Anything here that should check a role does not belong here.
 */
export const PUBLIC_OR_OWN: Record<string, string> = {
  // Links and pages for applicants and respondents
  'applicationInvites:getInvite':
    'personal apply link: the token in the link is the credential',
  'availabilityPolls:getPollByToken':
    'public poll page, reached by the poll link token',
  'availabilityPolls:getPollByRespondentToken':
    'personal poll link: the respondent token is the credential',
  'availabilityPolls:getResponseByRespondent':
    'personal poll link: reads one respondent answer',
  'availabilityPolls:submitResponse': 'personal poll link: respondent submits',
  'availabilityPolls:submitOpenResponse':
    'public poll link: anyone with the link gives availability',
  'feedbackSurveys:getSurveyByToken': 'public survey page, by link token',
  'feedbackSurveys:getSurveyByRespondentToken':
    'personal survey link: respondent token is the credential',
  'feedbackSurveys:getResponseByRespondent':
    'personal survey link: reads one respondent answer',
  'feedbackSurveys:submitResponse': 'personal survey link: respondent submits',
  'feedbackSurveys:submitAnonymousResponse':
    'public anonymous survey link: anyone with the link answers',
  // Applying
  'opportunityApplications:submit': 'a signed-in person applies for themselves',
  'opportunityApplications:submitGuest':
    'public apply form for people without an account',
  'opportunityApplications:claimGuestApplications':
    "links the caller's own guest applications to their account",
  'opportunityApplications:getMyApplication': "the caller's own application",
  'opportunityApplications:getPreviousResponsesForOpportunity':
    "the caller's own earlier answers",
  // Public listings
  'orgOpportunities:getFeatured': 'public: the featured active opportunity',
  'orgOpportunities:listBaishCourses':
    'public: the stable list of active BAISH courses for the website',
  // Organization applications (an org asks to join the platform)
  'orgApplications:submit': 'a signed-in person asks to add their org',
  'orgApplications:getMyApplications': "the caller's own org applications",
  'orgApplications:getMyEmail': "the caller's own email",
  'orgApplications:withdraw':
    'checked against the applicant inside the function',
  'orgApplications:checkPlatformAdmin':
    'tells the caller whether they themselves are a platform admin',
  // Engagement and events for the signed-in member
  'engagement/queries:getMemberEngagement': "the caller's own engagement",
  'events/sync:resolveLumaCalendar':
    'no login needed: it only fetches a luma.com calendar page for a slug (low risk, worth gating if abused)',
  'social/events:getEventPage': 'public event page by slug',
  'social/events:getApprovedCount': 'public count of approved guests',
  'social/events:getMyRegistration': "the caller's own registration",
  'social/events:register': 'a signed-in person registers for an event',
  'social/events:linkMyGuest': "links the caller's own guest row",
  'social/events:closeMyUnusedPersonalLinks':
    "closes the caller's own personal links",
}

/**
 * Whole files that are public listings, or act on the signed-in person's own
 * data, or belong to areas that are not in the matrix yet. A file in the
 * matrix cannot be listed here.
 */
export const FILES_OUTSIDE_THE_MATRIX: Record<string, string> = {
  // Own data of the signed-in person
  accountDeletion: 'own account',
  consent: 'own consent record',
  userMigration: 'own account migration',
  profiles: "the caller's own profile",
  matches: "the caller's own matches",
  careerActions: "the caller's own actions",
  notifications: "the caller's own notifications",
  pushTokens: "the caller's own push tokens",
  attendance: "the caller's own attendance",
  adminAgentChat: "the caller's own agent chat history",
  facilitatorAgentChat: "the caller's own agent chat history",
  'agent/threadOps': "the caller's own agent threads",
  'agent/mutations': "the caller's own agent proposals",
  'agent/queries': "the caller's own agent threads",
  'enrichment/queries': "the caller's own enrichment chat",
  'enrichment/streaming': "the caller's own enrichment chat",
  'enrichment/extraction': "the caller's own profile extraction",
  extraction: "the caller's own profile extraction",
  feedback: 'in-app feedback from the signed-in person',
  upload: 'upload URLs for the signed-in person',
  skills: 'public skills taxonomy',
  playground:
    'agent playground API of @convex-dev/agent: guarded by a shared playground API key, not by a role; needs the agent component registered to test',
  // Public listings
  opportunities: 'public listing of the global opportunities',
  organizations: 'public organization directory',
  'orgs/directory': 'public org pages and the invite-token check',
  'orgs/discovery': 'public org discovery',
  'orgs/membership': "the caller's own memberships (join, leave)",
  'events/queries': 'public events of an org',
  // Areas the matrix does not cover yet. Each is access-checked in the code
  // (org admin or the signed-in person); none is exercised here.
  programs: 'not in the matrix yet: programs, modules, sessions, RSVPs',
  course: 'not in the matrix yet: live course sessions and prompts',
  coworkingSpaces: 'not in the matrix yet: co-working spaces',
  spaceBookings: 'not in the matrix yet: space bookings',
  guestBookings: 'not in the matrix yet: guest visits',
  guestProfiles: 'not in the matrix yet: guest profiles',
  'social/bookings': 'not in the matrix yet: in-person 1:1 bookings',
  'social/checkin': 'not in the matrix yet: event check-in',
  'social/meetings': 'not in the matrix yet: in-person 1:1 meetings',
  'social/suggestions': 'not in the matrix yet: in-person suggestions',
  'social/lumaCrm': 'not in the matrix yet: Luma contacts import',
  'luma/api': 'not in the matrix yet: Luma API actions',
  'contacts/airtable': 'not in the matrix yet: Airtable import actions',
}
