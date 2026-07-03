import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

// Legacy auth tables (from @convex-dev/auth) — kept temporarily for user ID migration.
// Remove after all users have migrated to Clerk IDs.
const legacyAuthTables = {
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
  }).index('email', ['email']),
  authSessions: defineTable({
    userId: v.id('users'),
    expirationTime: v.number(),
  }).index('userId', ['userId']),
  authAccounts: defineTable({
    userId: v.id('users'),
    provider: v.string(),
    providerAccountId: v.string(),
    secret: v.optional(v.string()),
    emailVerified: v.optional(v.string()),
    phoneVerified: v.optional(v.string()),
  })
    .index('providerAndAccountId', ['provider', 'providerAccountId'])
    .index('userId', ['userId']),
  authRefreshTokens: defineTable({
    sessionId: v.id('authSessions'),
    expirationTime: v.number(),
    firstUsedTime: v.optional(v.number()),
    parentRefreshTokenId: v.optional(v.id('authRefreshTokens')),
  }).index('sessionId', ['sessionId']),
  authVerificationCodes: defineTable({
    accountId: v.id('authAccounts'),
    provider: v.string(),
    code: v.string(),
    expirationTime: v.number(),
    verifier: v.optional(v.string()),
    emailVerified: v.optional(v.string()),
    phoneVerified: v.optional(v.string()),
  })
    .index('accountId', ['accountId'])
    .index('code', ['code']),
  authVerifiers: defineTable({
    sessionId: v.optional(v.id('authSessions')),
    signature: v.optional(v.string()),
  }),
  authRateLimits: defineTable({
    identifier: v.string(),
    numAttempts: v.number(),
    lastAttemptTime: v.number(),
  }).index('identifier', ['identifier']),
}

export default defineSchema({
  ...legacyAuthTables,

  // Profile tables
  profiles: defineTable({
    userId: v.string(),
    email: v.optional(v.string()),

    // Basic info
    name: v.optional(v.string()),
    pronouns: v.optional(v.string()),
    location: v.optional(v.string()),
    headline: v.optional(v.string()),
    linkedinUrl: v.optional(v.string()),
    preferredLanguage: v.optional(v.string()), // ISO 639-1: "es", "en", "pt", etc.

    // Education (array of entries)
    education: v.optional(
      v.array(
        v.object({
          institution: v.string(),
          degree: v.optional(v.string()),
          field: v.optional(v.string()),
          startYear: v.optional(v.number()),
          endYear: v.optional(v.number()),
          current: v.optional(v.boolean()),
        }),
      ),
    ),

    // Work history (array of entries)
    workHistory: v.optional(
      v.array(
        v.object({
          organization: v.string(),
          title: v.string(),
          startDate: v.optional(v.number()), // Unix timestamp
          endDate: v.optional(v.number()), // Unix timestamp
          current: v.optional(v.boolean()),
          description: v.optional(v.string()),
        }),
      ),
    ),

    // Skills (from taxonomy)
    skills: v.optional(v.array(v.string())),

    // Career goals and interests
    careerGoals: v.optional(v.string()),
    aiSafetyInterests: v.optional(v.array(v.string())),
    seeking: v.optional(v.string()),

    // LLM-generated content
    enrichmentSummary: v.optional(v.string()),
    hasEnrichmentConversation: v.optional(v.boolean()),

    // Profile agent thread
    agentThreadId: v.optional(v.string()),

    // Privacy settings (section-level)
    privacySettings: v.optional(
      v.object({
        defaultVisibility: v.union(
          v.literal('public'),
          v.literal('connections'),
          v.literal('private'),
        ),
        sectionVisibility: v.optional(
          v.object({
            basicInfo: v.optional(v.string()),
            education: v.optional(v.string()),
            workHistory: v.optional(v.string()),
            skills: v.optional(v.string()),
            careerGoals: v.optional(v.string()),
          }),
        ),
        hiddenFromOrgs: v.optional(v.array(v.string())),
        locationDiscoverable: v.optional(v.boolean()), // Opt-in for location-based org suggestions
        attendancePrivacyDefaults: v.optional(
          v.object({
            showOnProfile: v.boolean(), // Whether attendance appears on profile
            showToOtherOrgs: v.boolean(), // Whether non-host orgs can see attendance
          }),
        ),
      }),
    ),

    // Match staleness tracking (set when match-affecting fields change)
    matchesStaleAt: v.optional(v.number()),

    // Match preferences (hard filters + LLM-enforced constraints)
    matchPreferences: v.optional(
      v.object({
        // Programmatic hard filters (applied before LLM)
        remotePreference: v.optional(
          v.union(
            v.literal('remote_only'),
            v.literal('on_site_ok'),
            v.literal('no_preference'),
          ),
        ),
        roleTypes: v.optional(v.array(v.string())),
        experienceLevels: v.optional(v.array(v.string())),

        // LLM-enforced constraints (opportunity data is free-text, can't filter programmatically)
        willingToRelocate: v.optional(v.boolean()),
        workAuthorization: v.optional(v.string()),
        minimumSalaryUSD: v.optional(v.number()),
        availability: v.optional(
          v.union(
            v.literal('immediately'),
            v.literal('within_1_month'),
            v.literal('within_3_months'),
            v.literal('within_6_months'),
            v.literal('not_available'),
          ),
        ),
        commitmentTypes: v.optional(
          v.array(
            v.union(
              v.literal('full_time'),
              v.literal('part_time'),
              v.literal('contract'),
              v.literal('fellowship'),
              v.literal('internship'),
              v.literal('volunteer'),
            ),
          ),
        ),
      }),
    ),

    // Match computation progress (set during batch processing, cleared on completion)
    matchProgress: v.optional(
      v.object({
        totalBatches: v.number(),
        completedBatches: v.number(),
        totalOpportunities: v.number(),
        startedAt: v.number(),
      }),
    ),

    // Completeness tracking
    completedSections: v.optional(v.array(v.string())),

    // Notification preferences (for email alerts and digests)
    notificationPreferences: v.optional(
      v.object({
        matchAlerts: v.object({
          enabled: v.boolean(),
        }),
        weeklyDigest: v.object({
          enabled: v.boolean(),
        }),
        deadlineReminders: v.optional(v.object({ enabled: v.boolean() })),
        timezone: v.string(), // IANA timezone, e.g., "America/New_York"
      }),
    ),

    // Event notification preferences (for event announcements and reminders)
    eventNotificationPreferences: v.optional(
      v.object({
        frequency: v.union(
          v.literal('all'),
          v.literal('daily'),
          v.literal('weekly'),
          v.literal('none'),
        ),
        reminderTiming: v.optional(
          v.object({
            oneWeekBefore: v.boolean(),
            oneDayBefore: v.boolean(),
            oneHourBefore: v.boolean(),
          }),
        ),
        mutedOrgIds: v.optional(v.array(v.id('organizations'))),
      }),
    ),

    // Consent tracking (GDPR + AI processing consent)
    consentedAt: v.optional(v.number()), // Unix timestamp when user consented
    consentVersion: v.optional(v.string()), // e.g. "v1" — bump to re-consent on policy changes

    // Metadata
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_user', ['userId']),

  // Enrichment conversation messages
  enrichmentMessages: defineTable({
    profileId: v.id('profiles'),
    role: v.union(v.literal('user'), v.literal('assistant')),
    content: v.string(),
    actionId: v.optional(v.id('careerActions')), // Links to completed action for completion chat
    createdAt: v.number(),
  })
    .index('by_profile', ['profileId', 'createdAt'])
    .index('by_action', ['actionId', 'createdAt']),

  // Extractions from enrichment (pending review)
  enrichmentExtractions: defineTable({
    profileId: v.id('profiles'),
    field: v.string(),
    extractedValue: v.string(),
    status: v.union(
      v.literal('pending'),
      v.literal('accepted'),
      v.literal('rejected'),
      v.literal('edited'),
    ),
    editedValue: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_profile', ['profileId']),

  // Agent tool call tracking (for approve/undo UI)
  agentToolCalls: defineTable({
    profileId: v.id('profiles'),
    threadId: v.string(),
    toolName: v.string(),
    displayText: v.string(),
    updates: v.string(), // JSON of what was written
    previousValues: v.string(), // JSON snapshot for undo
    status: v.union(
      v.literal('proposed'),
      v.literal('pending'),
      v.literal('approved'),
      v.literal('undone'),
      v.literal('denied'),
    ),
    requiresManualApproval: v.optional(v.boolean()),
    editedUpdates: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_thread_and_createdAt', ['threadId', 'createdAt'])
    .index('by_profile', ['profileId']),

  // Uploaded documents (resumes, CVs) for data extraction
  uploadedDocuments: defineTable({
    userId: v.string(), // Owner of the document
    storageId: v.id('_storage'), // Reference to Convex storage
    fileName: v.string(), // Original filename
    fileSize: v.number(), // Size in bytes
    mimeType: v.string(), // e.g., "application/pdf"
    status: v.union(
      v.literal('pending_extraction'),
      v.literal('extracting'),
      v.literal('extracted'),
      v.literal('failed'),
    ),
    uploadedAt: v.number(), // Unix timestamp
    errorMessage: v.optional(v.string()), // For failed status
    extractionStartedAt: v.optional(v.number()), // Timestamp-based CAS for extraction dedup
    // Extracted data from LLM (stored for user review before applying to profile)
    extractedData: v.optional(
      v.object({
        name: v.optional(v.string()),
        email: v.optional(v.string()),
        location: v.optional(v.string()),
        education: v.optional(
          v.array(
            v.object({
              institution: v.string(),
              degree: v.optional(v.string()),
              field: v.optional(v.string()),
              startYear: v.optional(v.number()),
              endYear: v.optional(v.number()),
              current: v.optional(v.boolean()),
            }),
          ),
        ),
        workHistory: v.optional(
          v.array(
            v.object({
              organization: v.string(),
              title: v.string(),
              startDate: v.optional(v.string()), // YYYY-MM format from LLM
              endDate: v.optional(v.string()), // YYYY-MM format or "present"
              current: v.optional(v.boolean()),
              description: v.optional(v.string()),
            }),
          ),
        ),
        skills: v.optional(v.array(v.string())), // Matched ASTN skill names
        rawSkills: v.optional(v.array(v.string())), // Original skills from document
      }),
    ),
  })
    .index('by_user', ['userId'])
    .index('by_user_and_status', ['userId', 'status'])
    .index('by_status', ['status']),

  // Skills taxonomy
  skillsTaxonomy: defineTable({
    name: v.string(),
    category: v.string(),
    description: v.optional(v.string()),
    aliases: v.optional(v.array(v.string())),
  })
    .index('by_category', ['category'])
    .searchIndex('search_name', {
      searchField: 'name',
      filterFields: ['category'],
    }),

  // Organizations (for privacy selection and future features)
  organizations: defineTable({
    name: v.string(),
    slug: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    logoStorageId: v.optional(v.id('_storage')), // Convex storage reference for uploaded logo
    description: v.optional(v.string()), // Brief org description for display
    city: v.optional(v.string()), // e.g., "Buenos Aires", "San Francisco"
    country: v.optional(v.string()), // e.g., "Argentina", "United States"
    coordinates: v.optional(v.object({ lat: v.number(), lng: v.number() })), // For map display
    isGlobal: v.optional(v.boolean()), // True for orgs without specific location
    hasCoworkingSpace: v.optional(v.boolean()), // Denormalized flag for quick checks
    memberCount: v.optional(v.number()), // Denormalized for display

    // Phase 31: Self-configuration fields
    contactEmail: v.optional(v.string()),
    website: v.optional(v.string()),
    socialLinks: v.optional(
      v.array(
        v.object({
          platform: v.string(), // "twitter", "linkedin", "github", "discord", etc.
          url: v.string(),
        }),
      ),
    ),

    // Lu.ma integration for events
    lumaCalendarUrl: v.optional(v.string()), // Public calendar URL (e.g., "https://lu.ma/baish") for embed
    lumaCalendarApiId: v.optional(v.string()), // Calendar API ID (e.g., "cal-0oFAsTn5vpwcAwb") for free sync
    lumaApiKey: v.optional(v.string()), // Deprecated - was for paid API sync
    eventsLastSynced: v.optional(v.number()), // Timestamp of last sync
  })
    .index('by_name', ['name'])
    .index('by_slug', ['slug'])
    .index('by_country', ['country'])
    .index('by_city_country', ['city', 'country'])
    .index('by_isGlobal', ['isGlobal'])
    .searchIndex('search_name', {
      searchField: 'name',
    }),

  // Organization memberships
  orgMemberships: defineTable({
    userId: v.string(),
    orgId: v.id('organizations'),
    role: v.union(v.literal('admin'), v.literal('member')),
    directoryVisibility: v.union(v.literal('visible'), v.literal('hidden')),
    joinedAt: v.number(),
    invitedBy: v.optional(v.id('orgMemberships')),
  })
    .index('by_user', ['userId'])
    .index('by_user_and_org', ['userId', 'orgId'])
    .index('by_org', ['orgId'])
    .index('by_org_and_directoryVisibility', ['orgId', 'directoryVisibility'])
    .index('by_org_role', ['orgId', 'role']),

  // Organization invite links
  orgInviteLinks: defineTable({
    orgId: v.id('organizations'),
    token: v.string(), // Unique invite token (UUID)
    createdBy: v.id('orgMemberships'),
    createdAt: v.number(),
    expiresAt: v.optional(v.number()), // Optional expiration
  })
    .index('by_token', ['token'])
    .index('by_org', ['orgId']),

  // Co-working spaces (Phase 31)
  coworkingSpaces: defineTable({
    orgId: v.id('organizations'),
    name: v.string(), // e.g., "Main Co-working Space"
    capacity: v.number(), // Max people per day
    timezone: v.string(), // IANA timezone, e.g., "America/Argentina/Buenos_Aires"

    // Operating hours: array of 7 objects (0=Sunday through 6=Saturday)
    operatingHours: v.array(
      v.object({
        dayOfWeek: v.number(), // 0-6 (Sunday-Saturday)
        openMinutes: v.number(), // Minutes from midnight (e.g., 540 = 9:00 AM)
        closeMinutes: v.number(), // Minutes from midnight (e.g., 1080 = 6:00 PM)
        isClosed: v.boolean(), // True if closed this day
      }),
    ),

    // Landing page content
    description: v.optional(v.string()), // About the space
    address: v.optional(v.string()), // Street address
    addressNote: v.optional(v.string()), // Directions/access notes
    coverImageStorageId: v.optional(v.id('_storage')), // Cover image storage ref
    coverImageUrl: v.optional(v.string()), // Resolved URL
    amenities: v.optional(v.array(v.string())), // e.g. ["WiFi", "Coffee", "Standing Desks"]
    houseRules: v.optional(v.string()), // Newline-separated rules

    // Guest access configuration
    guestAccessEnabled: v.boolean(), // Whether guests can apply to visit

    // Custom visit application fields (Phase 33 renders these)
    customVisitFields: v.optional(
      v.array(
        v.object({
          fieldId: v.string(), // Unique ID for this field (e.g., "project", "dietary")
          label: v.string(), // Display label
          type: v.union(
            v.literal('text'),
            v.literal('textarea'),
            v.literal('select'),
            v.literal('checkbox'),
          ),
          required: v.boolean(),
          options: v.optional(v.array(v.string())), // For select type
          placeholder: v.optional(v.string()),
        }),
      ),
    ),

    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_org', ['orgId']),

  // Space bookings (Phase 32)
  spaceBookings: defineTable({
    spaceId: v.id('coworkingSpaces'),
    userId: v.string(),

    // Date and time
    date: v.string(), // ISO date string e.g. "2026-02-15"
    startMinutes: v.number(), // Minutes from midnight (e.g., 600 = 10:00 AM)
    endMinutes: v.number(), // Minutes from midnight (e.g., 900 = 3:00 PM)

    // Booking type (member now, guest in Phase 33)
    bookingType: v.union(v.literal('member'), v.literal('guest')),

    // Status: members auto-confirm, guests go through approval
    status: v.union(
      v.literal('confirmed'),
      v.literal('cancelled'),
      v.literal('pending'), // For guests (Phase 33)
      v.literal('rejected'), // For guests (Phase 33)
    ),

    // Networking tags (offer/ask format)
    workingOn: v.optional(v.string()), // "Can help with" — Max 140 chars, enforced in mutation
    interestedInMeeting: v.optional(v.string()), // "Looking for" — Max 140 chars

    // Consent for attendee visibility (required for booking)
    consentToProfileSharing: v.boolean(),

    // Guest approval fields (Phase 33)
    approvedBy: v.optional(v.id('orgMemberships')),
    approvedAt: v.optional(v.number()),
    rejectionReason: v.optional(v.string()),

    // No-show tracking
    noShow: v.optional(v.boolean()),
    noShowMarkedAt: v.optional(v.number()),
    noShowMarkedBy: v.optional(v.id('orgMemberships')),

    // Metadata
    createdAt: v.number(),
    updatedAt: v.number(),
    cancelledAt: v.optional(v.number()),
  })
    .index('by_space_date', ['spaceId', 'date'])
    .index('by_user', ['userId'])
    .index('by_space_user', ['spaceId', 'userId']),

  // Career actions (LLM-generated personalized career steps)
  careerActions: defineTable({
    profileId: v.id('profiles'),
    type: v.union(
      v.literal('replicate'),
      v.literal('collaborate'),
      v.literal('start_org'),
      v.literal('identify_gaps'),
      v.literal('volunteer'),
      v.literal('build_tools'),
      v.literal('teach_write'),
      v.literal('develop_skills'),
    ),
    title: v.string(),
    description: v.string(),
    rationale: v.string(), // User-facing reasoning referencing profile elements
    profileBasis: v.optional(v.array(v.string())), // Machine-readable profile signal identifiers (GEN-07)
    status: v.union(
      v.literal('active'),
      v.literal('saved'),
      v.literal('dismissed'),
      v.literal('in_progress'),
      v.literal('done'),
    ),
    generatedAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    modelVersion: v.string(),
    completionConversationStarted: v.optional(v.boolean()), // Phase 36 flag
  })
    .index('by_profile', ['profileId'])
    .index('by_profile_status', ['profileId', 'status']),

  // Match results (per CONTEXT.md: tier labels, not percentages)
  matches: defineTable({
    profileId: v.id('profiles'),
    opportunityId: v.id('opportunities'),

    // Scoring (tier labels not percentages per CONTEXT.md)
    tier: v.union(
      v.literal('great'),
      v.literal('good'),
      v.literal('exploring'),
    ),
    score: v.number(), // 0-100 internal score for sorting within tier

    // User-controlled status for swipe actions
    status: v.optional(
      v.union(v.literal('active'), v.literal('dismissed'), v.literal('saved')),
    ),

    // Explanation (MATCH-02: bullet points with strengths + actionable gap)
    explanation: v.object({
      strengths: v.array(v.string()), // 2-4 bullet points on why this fits
      gap: v.optional(v.string()), // One actionable thing to strengthen application
    }),

    // Probability (legacy — no longer generated, kept optional for existing documents)
    probability: v.optional(
      v.object({
        interviewChance: v.string(),
        ranking: v.string(),
        confidence: v.string(),
      }),
    ),

    // Recommendations (MATCH-04: 1 specific + 1-2 general per match)
    recommendations: v.array(
      v.object({
        type: v.union(
          v.literal('specific'),
          v.literal('skill'),
          v.literal('experience'),
        ),
        action: v.string(),
        priority: v.union(
          v.literal('high'),
          v.literal('medium'),
          v.literal('low'),
        ),
      }),
    ),

    // Denormalized opportunity snapshot (avoids N+1 reads in getMyMatches)
    opportunitySnapshot: v.optional(
      v.object({
        title: v.string(),
        organization: v.string(),
        location: v.string(),
        isRemote: v.boolean(),
        roleType: v.string(),
        experienceLevel: v.optional(v.string()),
        salaryRange: v.optional(v.string()),
        extractedSkills: v.optional(v.array(v.string())),
        sourceUrl: v.string(),
        deadline: v.optional(v.number()),
        postedAt: v.optional(v.number()),
        opportunityType: v.optional(v.string()),
      }),
    ),

    // Deadline reminder tracking (prevents duplicate emails)
    deadlineRemindersSent: v.optional(
      v.object({
        sevenDay: v.optional(v.boolean()),
        oneDay: v.optional(v.boolean()),
      }),
    ),

    // Application tracking (orthogonal to status — a match can be saved AND applied)
    appliedAt: v.optional(v.number()),

    // Metadata
    isNew: v.boolean(), // For "new high-fit" prioritization
    computedAt: v.number(),
    modelVersion: v.string(), // Track which model version generated this
  })
    .index('by_profile', ['profileId'])
    .index('by_profile_tier', ['profileId', 'tier'])
    .index('by_opportunity', ['opportunityId'])
    .index('by_profile_new', ['profileId', 'isNew']),

  // Opportunities
  opportunities: defineTable({
    // Identity
    sourceId: v.string(), // Unique per source: "80k-123", "aisafety-abc", "manual-uuid"
    source: v.union(
      v.literal('80k_hours'),
      v.literal('aisafety_com'),
      v.literal('aisafety_events'),
      v.literal('manual'),
    ),

    // Core fields
    title: v.string(),
    organization: v.string(),
    organizationLogoUrl: v.optional(v.string()),
    location: v.string(),
    isRemote: v.boolean(),
    roleType: v.string(), // "research", "engineering", "operations", "policy", "other"
    experienceLevel: v.optional(v.string()), // "entry", "mid", "senior", "lead"
    description: v.string(),
    requirements: v.optional(v.array(v.string())),
    salaryRange: v.optional(v.string()),
    deadline: v.optional(v.number()), // Unix timestamp
    postedAt: v.optional(v.number()), // Unix timestamp — when the opportunity was published at source
    opportunityType: v.optional(v.union(v.literal('job'), v.literal('event'))),
    eventType: v.optional(v.string()), // "course", "fellowship", "conference", "talk", "meetup"
    startDate: v.optional(v.number()), // Unix timestamp
    endDate: v.optional(v.number()), // Unix timestamp

    // Source tracking
    sourceUrl: v.string(),
    alternateSources: v.optional(
      v.array(
        v.object({
          sourceId: v.string(),
          source: v.string(),
          sourceUrl: v.string(),
        }),
      ),
    ),

    // Status and timestamps
    status: v.union(v.literal('active'), v.literal('archived')),
    lastVerified: v.number(), // For freshness indicator (OPPS-06)
    createdAt: v.number(),
    updatedAt: v.number(),

    // LLM-extracted fields
    extractedSkills: v.optional(v.array(v.string())),

    // LLM enrichment metadata
    enrichedAt: v.optional(v.number()),
    enrichedFields: v.optional(v.array(v.string())),
    enrichmentVersion: v.optional(v.number()),
  })
    .index('by_source_id', ['sourceId'])
    .index('by_organization', ['organization'])
    .index('by_status', ['status'])
    .index('by_role_type', ['roleType', 'status'])
    .index('by_location', ['isRemote', 'status'])
    .searchIndex('search_title', {
      searchField: 'title',
      filterFields: ['status', 'roleType', 'isRemote', 'opportunityType'],
    }),

  // Events (synced from lu.ma)
  events: defineTable({
    orgId: v.id('organizations'),
    lumaEventId: v.string(), // lu.ma event ID (e.g., "evt-abc123")

    // Core fields from lu.ma API
    title: v.string(),
    description: v.optional(v.string()),
    startAt: v.number(), // Unix timestamp
    endAt: v.optional(v.number()), // Unix timestamp
    timezone: v.string(), // IANA timezone
    coverUrl: v.optional(v.string()), // Event cover image
    url: v.string(), // lu.ma event URL for RSVP link-out

    // Location (can be virtual or physical)
    location: v.optional(v.string()), // Address or "Online"
    isVirtual: v.boolean(), // True if online event

    // Metadata
    syncedAt: v.number(),
  })
    .index('by_org', ['orgId'])
    .index('by_org_start', ['orgId', 'startAt'])
    .index('by_luma_id', ['lumaEventId']),

  // Platform admins (super-admins who can approve/reject org applications)
  platformAdmins: defineTable({
    userId: v.string(),
    addedAt: v.number(),
    addedBy: v.optional(v.string()), // userId of who added them, null for seed
  }).index('by_user', ['userId']),

  // Org applications (organizations applying to join the platform)
  orgApplications: defineTable({
    // Applicant info
    applicantUserId: v.string(),
    applicantName: v.string(),
    applicantEmail: v.string(),

    // Org info from application
    orgName: v.string(),
    orgNameNormalized: v.optional(v.string()), // Lowercase/trimmed for case-insensitive duplicate detection
    description: v.string(),
    city: v.string(),
    country: v.string(),
    website: v.optional(v.string()),
    reasonForJoining: v.optional(v.string()), // Made optional - field removed from UI

    // Status machine: pending -> approved | rejected | withdrawn
    status: v.union(
      v.literal('pending'),
      v.literal('approved'),
      v.literal('rejected'),
      v.literal('withdrawn'),
    ),
    rejectionReason: v.optional(v.string()),

    // Review tracking
    reviewedBy: v.optional(v.string()), // platform admin userId
    reviewedAt: v.optional(v.number()),

    // Metadata
    createdAt: v.number(),
  })
    .index('by_applicant', ['applicantUserId'])
    .index('by_status', ['status'])
    .index('by_orgName', ['orgName'])
    .index('by_orgNameNormalized', ['orgNameNormalized']),

  // In-app notifications (bell icon notification center)
  notifications: defineTable({
    userId: v.string(),
    type: v.union(
      v.literal('event_new'),
      v.literal('event_reminder'),
      v.literal('event_updated'),
      v.literal('attendance_prompt'),
      v.literal('org_application_approved'),
      v.literal('org_application_rejected'),
      v.literal('booking_confirmed'),
      v.literal('guest_visit_approved'),
      v.literal('guest_visit_rejected'),
      v.literal('guest_visit_pending'),
    ),
    eventId: v.optional(v.id('events')),
    orgId: v.optional(v.id('organizations')),
    spaceBookingId: v.optional(v.id('spaceBookings')),
    applicationId: v.optional(v.id('orgApplications')),
    title: v.string(),
    body: v.string(),
    actionUrl: v.optional(v.string()),
    read: v.boolean(),
    createdAt: v.number(),
    // For attendance prompts
    promptNumber: v.optional(v.number()), // 1 or 2
    respondedAt: v.optional(v.number()), // When user responded
  })
    .index('by_user', ['userId'])
    .index('by_user_read', ['userId', 'read']),

  // Event view tracking (for reminder audience - users who viewed an event)
  eventViews: defineTable({
    userId: v.string(),
    eventId: v.id('events'),
    viewedAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_event', ['eventId'])
    .index('by_user_event', ['userId', 'eventId']),

  // Scheduled reminders (for cancellation when events change)
  scheduledReminders: defineTable({
    eventId: v.id('events'),
    userId: v.string(),
    timing: v.union(
      v.literal('1_week'),
      v.literal('1_day'),
      v.literal('1_hour'),
    ),
    scheduledFunctionId: v.string(),
    scheduledFor: v.number(),
  })
    .index('by_event', ['eventId'])
    .index('by_user', ['userId'])
    .index('by_user_event', ['userId', 'eventId']),

  // Attendance records (post-event confirmation and feedback)
  attendance: defineTable({
    userId: v.string(),
    eventId: v.id('events'),
    orgId: v.id('organizations'), // Denormalized for privacy queries

    // Response
    status: v.union(
      v.literal('attended'),
      v.literal('partial'),
      v.literal('not_attended'),
      v.literal('unknown'),
    ),
    respondedAt: v.optional(v.number()),

    // Feedback (optional)
    feedbackRating: v.optional(v.number()), // 1-5 stars
    feedbackText: v.optional(v.string()),
    feedbackSubmittedAt: v.optional(v.number()),

    // Privacy
    showOnProfile: v.boolean(),
    showToOtherOrgs: v.boolean(),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_event', ['eventId'])
    .index('by_org', ['orgId'])
    .index('by_user_event', ['userId', 'eventId']),

  // Scheduled attendance prompts (for tracking and deduplication)
  scheduledAttendancePrompts: defineTable({
    eventId: v.id('events'),
    userId: v.string(),
    scheduledFunctionId: v.string(),
    scheduledFor: v.number(),
    promptNumber: v.number(), // 1 or 2
  })
    .index('by_event', ['eventId'])
    .index('by_user', ['userId'])
    .index('by_user_event', ['userId', 'eventId']),

  // Member engagement levels (per user-org pair)
  memberEngagement: defineTable({
    userId: v.string(),
    orgId: v.id('organizations'),

    // Computed engagement level
    level: v.union(
      v.literal('highly_engaged'),
      v.literal('moderate'),
      v.literal('at_risk'),
      v.literal('new'),
      v.literal('inactive'),
    ),

    // Explanations from LLM
    adminExplanation: v.string(), // Detailed with signals for admins
    userExplanation: v.string(), // Friendly messaging for users

    // Input signals (stored for audit/debugging)
    signals: v.object({
      eventsAttended90d: v.number(),
      lastAttendedAt: v.optional(v.number()),
      rsvpCount90d: v.number(),
      profileUpdatedAt: v.optional(v.number()),
      joinedAt: v.number(),
    }),

    // Override (optional - only set when admin overrides)
    override: v.optional(
      v.object({
        level: v.union(
          v.literal('highly_engaged'),
          v.literal('moderate'),
          v.literal('at_risk'),
          v.literal('new'),
          v.literal('inactive'),
        ),
        notes: v.string(),
        overriddenBy: v.id('orgMemberships'),
        overriddenAt: v.number(),
        expiresAt: v.optional(v.number()),
      }),
    ),

    // Metadata
    computedAt: v.number(),
    modelVersion: v.string(),
  })
    .index('by_user_org', ['userId', 'orgId'])
    .index('by_org', ['orgId'])
    .index('by_org_level', ['orgId', 'level']),

  // Engagement override history (audit trail)
  engagementOverrideHistory: defineTable({
    engagementId: v.id('memberEngagement'),
    userId: v.string(),
    orgId: v.id('organizations'),

    previousLevel: v.string(),
    newLevel: v.string(),
    notes: v.string(),

    action: v.union(v.literal('override'), v.literal('clear')),
    performedBy: v.id('orgMemberships'),
    performedAt: v.number(),
  })
    .index('by_engagement', ['engagementId'])
    .index('by_org', ['orgId'])
    .index('by_user', ['userId']),

  // Programs (org-specific activities like reading groups, fellowships)
  programs: defineTable({
    orgId: v.id('organizations'),

    // Identity
    name: v.string(),
    slug: v.string(), // URL-safe identifier within org
    description: v.optional(v.string()),

    // Program type
    type: v.union(
      v.literal('reading_group'),
      v.literal('fellowship'),
      v.literal('mentorship'),
      v.literal('cohort'),
      v.literal('workshop_series'),
      v.literal('custom'),
    ),

    // Dates
    startDate: v.optional(v.number()), // Unix timestamp
    endDate: v.optional(v.number()),
    status: v.union(
      v.literal('planning'),
      v.literal('active'),
      v.literal('completed'),
      v.literal('archived'),
    ),

    // Enrollment configuration
    enrollmentMethod: v.union(
      v.literal('admin_only'), // Only admins can add members
      v.literal('self_enroll'), // Members can join freely
      v.literal('approval_required'), // Members request, admin approves
    ),
    maxParticipants: v.optional(v.number()),

    // Completion criteria (optional)
    completionCriteria: v.optional(
      v.object({
        type: v.union(
          v.literal('attendance_count'),
          v.literal('attendance_percentage'),
          v.literal('manual'),
        ),
        requiredCount: v.optional(v.number()), // For attendance_count
        requiredPercentage: v.optional(v.number()), // For attendance_percentage
      }),
    ),

    // Linked events (for auto-attendance counting)
    linkedEventIds: v.optional(v.array(v.id('events'))),

    // Linked opportunity (for bulk enrollment from accepted applicants)
    linkedOpportunityId: v.optional(v.id('orgOpportunities')),

    // Metadata
    createdBy: v.id('orgMemberships'),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_org', ['orgId'])
    .index('by_org_status', ['orgId', 'status'])
    .index('by_org_slug', ['orgId', 'slug']),

  // Program participation tracking
  programParticipation: defineTable({
    programId: v.id('programs'),
    userId: v.string(),
    orgId: v.id('organizations'), // Denormalized for queries

    // Enrollment status
    status: v.union(
      v.literal('pending'), // Requested, awaiting approval
      v.literal('enrolled'), // Active participant
      v.literal('completed'), // Finished program (graduated)
      v.literal('withdrawn'), // Left program
      v.literal('removed'), // Removed by admin
    ),

    // Tracking
    enrolledAt: v.number(),
    completedAt: v.optional(v.number()),

    // Manual attendance tracking (for non-event activities)
    manualAttendanceCount: v.optional(v.number()),
    attendanceNotes: v.optional(v.string()),

    // Admin notes
    adminNotes: v.optional(v.string()),

    // Enrollment request (if approval_required)
    requestedAt: v.optional(v.number()),
    approvedBy: v.optional(v.id('orgMemberships')),
    approvedAt: v.optional(v.number()),
  })
    .index('by_program', ['programId'])
    .index('by_program_and_user', ['programId', 'userId'])
    .index('by_user', ['userId'])
    .index('by_org', ['orgId'])
    .index('by_program_status', ['programId', 'status'])
    .index('by_user_org', ['userId', 'orgId']),

  // Program modules (curriculum content)
  programModules: defineTable({
    programId: v.id('programs'),
    title: v.string(),
    description: v.optional(v.string()),
    weekNumber: v.number(),
    orderIndex: v.number(),
    materials: v.optional(
      v.array(
        v.object({
          label: v.string(),
          url: v.optional(v.string()),
          type: v.union(
            v.literal('link'),
            v.literal('pdf'),
            v.literal('video'),
            v.literal('reading'),
            v.literal('audio'),
          ),
          estimatedMinutes: v.optional(v.number()),
          isEssential: v.optional(v.boolean()),
          storageId: v.optional(v.id('_storage')),
        }),
      ),
    ),
    linkedSessionId: v.optional(v.id('programSessions')),
    status: v.union(
      v.literal('locked'),
      v.literal('available'),
      v.literal('completed'),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_program', ['programId'])
    .index('by_program_and_order', ['programId', 'orderIndex']),

  // Program sessions (course schedule)
  programSessions: defineTable({
    programId: v.id('programs'),
    dayNumber: v.number(),
    title: v.string(),
    date: v.number(),
    morningStartTime: v.string(),
    afternoonStartTime: v.string(),
    lumaUrl: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_program', ['programId'])
    .index('by_program_and_day', ['programId', 'dayNumber']),

  // Session RSVPs (slot preference per session)
  sessionRsvps: defineTable({
    sessionId: v.id('programSessions'),
    programId: v.id('programs'),
    userId: v.string(),
    preference: v.union(
      v.literal('morning'),
      v.literal('afternoon'),
      v.literal('either'),
    ),
    updatedAt: v.number(),
  })
    .index('by_session', ['sessionId'])
    .index('by_session_and_user', ['sessionId', 'userId'])
    .index('by_program_and_user', ['programId', 'userId']),

  // Session attendance (admin-marked)
  sessionAttendance: defineTable({
    sessionId: v.id('programSessions'),
    programId: v.id('programs'),
    userId: v.string(),
    slot: v.union(v.literal('morning'), v.literal('afternoon')),
    markedBy: v.string(),
    markedAt: v.number(),
  })
    .index('by_session', ['sessionId'])
    .index('by_session_and_user', ['sessionId', 'userId'])
    .index('by_program_and_user', ['programId', 'userId'])
    .index('by_program', ['programId']),

  // Material progress (participant completion tracking)
  materialProgress: defineTable({
    moduleId: v.id('programModules'),
    programId: v.id('programs'),
    userId: v.string(),
    materialIndex: v.number(),
    completedAt: v.number(),
  })
    .index('by_module_and_user', ['moduleId', 'userId'])
    .index('by_program_and_user', ['programId', 'userId']),

  // Course prompts (Phase 37) - unified interactive primitive for exercises, activities, polls, feedback
  coursePrompts: defineTable({
    programId: v.id('programs'),

    // Denormalized for indexing (mirrors attachedTo)
    moduleId: v.optional(v.id('programModules')),
    sessionId: v.optional(v.id('programSessions')),

    // Canonical attachment info
    attachedTo: v.union(
      v.object({
        type: v.literal('module'),
        moduleId: v.id('programModules'),
      }),
      v.object({
        type: v.literal('session_phase'),
        sessionId: v.id('programSessions'),
        phaseId: v.id('sessionPhases'),
      }),
    ),

    // Content
    title: v.string(),
    body: v.optional(v.string()), // Markdown
    orderIndex: v.number(),

    // Fields (the actual questions)
    fields: v.array(
      v.object({
        id: v.string(),
        type: v.union(
          v.literal('text'),
          v.literal('choice'),
          v.literal('multiple_choice'),
        ),
        label: v.string(),
        required: v.boolean(),
        placeholder: v.optional(v.string()),
        options: v.optional(
          v.array(v.object({ id: v.string(), label: v.string() })),
        ),
        maxLength: v.optional(v.number()),
      }),
    ),

    // Visibility configuration
    revealMode: v.union(
      v.literal('immediate'),
      v.literal('facilitator_only'),
      v.literal('write_then_reveal'),
    ),
    revealedAt: v.optional(v.number()), // Timestamp when reveal was triggered

    // AI feedback (Phase 38) - triggers proactive sidebar feedback on submission
    aiFeedback: v.optional(v.boolean()),

    // Metadata
    createdBy: v.string(), // Clerk userId
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_programId', ['programId'])
    .index('by_moduleId', ['moduleId'])
    .index('by_sessionId', ['sessionId'])
    .index('by_programId_and_orderIndex', ['programId', 'orderIndex']),

  // Course prompt responses (Phase 37) - participant answers to prompts
  coursePromptResponses: defineTable({
    promptId: v.id('coursePrompts'),
    programId: v.id('programs'), // Denormalized
    userId: v.string(), // Clerk userId

    // Response data keyed by field id
    fieldResponses: v.array(
      v.object({
        fieldId: v.string(),
        textValue: v.optional(v.string()),
        selectedOptionIds: v.optional(v.array(v.string())),
      }),
    ),

    // Status
    status: v.union(v.literal('draft'), v.literal('submitted')),

    // Spotlight (facilitator highlights)
    spotlighted: v.optional(v.boolean()),
    spotlightedBy: v.optional(v.string()),
    spotlightedAt: v.optional(v.number()),

    // Timestamps
    savedAt: v.number(),
    submittedAt: v.optional(v.number()),
  })
    .index('by_promptId', ['promptId'])
    .index('by_promptId_and_userId', ['promptId', 'userId'])
    .index('by_programId_and_userId', ['programId', 'userId']),

  // Course sidebar threads (Phase 38) - maps user+module to @convex-dev/agent thread
  courseSidebarThreads: defineTable({
    userId: v.string(),
    moduleId: v.id('programModules'),
    programId: v.id('programs'), // Denormalized for facilitator queries
    threadId: v.string(), // @convex-dev/agent thread ID
    createdAt: v.number(),
  })
    .index('by_userId_and_moduleId', ['userId', 'moduleId'])
    .index('by_programId', ['programId'])
    .index('by_programId_and_userId', ['programId', 'userId']),

  // Agent proposals (Phase 39) — facilitator agent propose-and-approve workflow
  agentProposals: defineTable({
    programId: v.id('programs'),
    type: v.union(
      v.literal('comment'),
      v.literal('message'),
      v.literal('pairs'),
      v.literal('summary'),
      v.literal('flag'),
      v.literal('prompt'),
    ),
    targetId: v.optional(v.string()), // e.g., coursePromptResponses ID for comments
    targetType: v.optional(v.string()), // e.g., "promptResponse", "session", "participant"
    content: v.string(), // The proposed text/action
    status: v.union(
      v.literal('proposed'),
      v.literal('approved'),
      v.literal('edited'),
      v.literal('dismissed'),
    ),
    editedContent: v.optional(v.string()), // Content after facilitator edit
    approvedBy: v.optional(v.string()), // Clerk userId of approver
    approvedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_programId', ['programId'])
    .index('by_programId_and_status', ['programId', 'status'])
    .index('by_targetId', ['targetId']),

  // Facilitator comments (Phase 39) — approved feedback on participant responses
  facilitatorComments: defineTable({
    promptResponseId: v.id('coursePromptResponses'),
    programId: v.id('programs'),
    authorId: v.string(), // Clerk userId — facilitator who wrote/approved
    content: v.string(),
    fromAgent: v.boolean(), // Was this proposed by the agent?
    createdAt: v.number(),
  })
    .index('by_promptResponseId', ['promptResponseId'])
    .index('by_programId', ['programId'])
    .index('by_programId_and_authorId', ['programId', 'authorId']),

  // Facilitator agent chat history (Phase 39) — per facilitator per program
  facilitatorAgentChats: defineTable({
    userId: v.string(),
    programId: v.id('programs'),
    messages: v.array(
      v.object({
        role: v.union(v.literal('user'), v.literal('assistant')),
        content: v.optional(v.string()),
        parts: v.optional(
          v.array(
            v.union(
              v.object({ type: v.literal('text'), content: v.string() }),
              v.object({
                type: v.literal('tool_call'),
                name: v.string(),
                input: v.any(),
                output: v.optional(v.string()),
              }),
            ),
          ),
        ),
      }),
    ),
    updatedAt: v.number(),
  }).index('by_userId_programId', ['userId', 'programId']),

  // Guest profiles (Phase 33) - lightweight accounts for visitors
  guestProfiles: defineTable({
    userId: v.string(),
    name: v.string(),
    email: v.string(),

    // Optional contact info
    phone: v.optional(v.string()),
    organization: v.optional(v.string()),
    title: v.optional(v.string()),

    // Visit tracking
    visitCount: v.number(),
    firstVisitDate: v.optional(v.string()), // ISO date
    lastVisitDate: v.optional(v.string()), // ISO date

    // Conversion tracking (GUEST-08)
    becameMember: v.boolean(),
    becameMemberAt: v.optional(v.number()),
    convertedToProfileId: v.optional(v.id('profiles')),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_email', ['email']),

  // Visit application responses (Phase 33) - custom form field answers
  visitApplicationResponses: defineTable({
    spaceBookingId: v.id('spaceBookings'),
    fieldId: v.string(),
    value: v.string(),
    createdAt: v.number(),
  }).index('by_booking', ['spaceBookingId']),

  // Org-created opportunities (distinct from scraped opportunities)
  orgOpportunities: defineTable({
    orgId: v.id('organizations'),
    title: v.string(),
    description: v.string(),
    type: v.union(
      v.literal('course'),
      v.literal('fellowship'),
      v.literal('job'),
      v.literal('other'),
    ),
    status: v.union(
      v.literal('active'),
      v.literal('closed'),
      v.literal('draft'),
    ),
    deadline: v.optional(v.number()),
    externalUrl: v.optional(v.string()),
    featured: v.boolean(),
    formFields: v.optional(v.any()), // Array<FormField> — see convex/lib/formFields.ts
    tags: v.optional(v.array(v.string())), // freeform labels for grouping/filtering (e.g. "TAIS Course")
    // Explicit expression-of-interest marker (replaces title/tag inference).
    // EOIs default the on-apply confirmation email to OFF.
    isEOI: v.optional(v.boolean()),
    // Email template set this opportunity inherits (issue #20). When set, the
    // outbox system handles decision emails and legacy auto-emails are skipped.
    emailTemplateSetId: v.optional(v.id('emailTemplateSets')),
    // On-apply confirmation email kill switch (outbox system only). undefined
    // defaults to ON, except EOIs which default OFF. Toggling never sends
    // retroactively — it only affects future submissions.
    sendApplicationReceivedEmail: v.optional(v.boolean()),
    redirectOpportunityId: v.optional(v.id('orgOpportunities')),
    sourceOpportunityId: v.optional(v.id('orgOpportunities')),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_org_and_status', ['orgId', 'status'])
    .index('by_org_and_featured', ['orgId', 'featured'])
    .index('by_org_and_featured_and_status', ['orgId', 'featured', 'status']),

  // Opportunity applications (submitted by org members or guests)
  opportunityApplications: defineTable({
    opportunityId: v.id('orgOpportunities'),
    orgId: v.id('organizations'),
    userId: v.optional(v.string()),
    guestEmail: v.optional(v.string()),
    profileId: v.optional(v.id('profiles')),
    status: v.union(
      v.literal('submitted'),
      v.literal('under_review'),
      v.literal('accepted'),
      v.literal('rejected'),
      v.literal('redirected'), // "Fit for another course"
      v.literal('waitlisted'),
      v.literal('participated'),
    ),
    responses: v.any(),
    submittedAt: v.number(),
    updatedAt: v.optional(v.number()),
    reviewedAt: v.optional(v.number()),
    reviewedBy: v.optional(v.string()),
    reviewNotes: v.optional(v.string()),
  })
    .index('by_opportunity_and_status', ['opportunityId', 'status'])
    .index('by_user_and_opportunity', ['userId', 'opportunityId'])
    .index('by_org', ['orgId'])
    .index('by_guest_email_and_opportunity', ['guestEmail', 'opportunityId']),

  // BAISH CRM imports (from Airtable)
  baishImports: defineTable({
    email: v.string(), // Primary email (lowercased)
    otherEmails: v.optional(v.array(v.string())), // Additional emails (lowercased)
    nombre: v.optional(v.string()), // Full name
    vinculo: v.optional(v.string()), // Relationship to BAISH
    rol: v.optional(v.string()), // Current role/title
    etapaProfesional: v.optional(v.string()), // Professional stage
    experienciaAiSafety: v.optional(v.string()), // AI Safety experience level
    intereses: v.optional(v.array(v.string())), // Interest areas
    participoEn: v.optional(v.array(v.string())), // Programs participated in
    disponibilidad: v.optional(v.string()), // Availability
    linkedin: v.optional(v.string()), // LinkedIn URL
    formResponses: v.optional(
      v.array(
        v.object({
          formName: v.optional(v.string()),
          submittedAt: v.optional(v.string()),
          careerGoals: v.optional(v.string()),
          whatLearned: v.optional(v.string()),
          nextSteps: v.optional(v.string()),
          feedback: v.optional(v.string()),
          otherResponses: v.optional(v.string()), // JSON string of remaining fields
        }),
      ),
    ),
    importedAt: v.number(),
  }).index('by_email', ['email']),

  // Anonymous feedback submissions
  feedback: defineTable({
    featureRequests: v.optional(v.string()),
    bugReports: v.optional(v.string()),
    page: v.string(),
    userId: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_created', ['createdAt']),

  // LLM usage tracking (token consumption per API call)
  llmUsage: defineTable({
    operation: v.string(), // "matching", "enrichment_chat", "enrichment_extraction", etc.
    model: v.string(), // "claude-sonnet-4-6", "claude-haiku-4-5"
    inputTokens: v.number(),
    outputTokens: v.number(),
    userId: v.optional(v.string()),
    profileId: v.optional(v.id('profiles')),
    durationMs: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_operation_and_createdAt', ['operation', 'createdAt'])
    .index('by_userId_and_createdAt', ['userId', 'createdAt'])
    .index('by_createdAt', ['createdAt']),

  // Debounce state tracking (cancel-and-reschedule for expensive operations)
  debouncedJobs: defineTable({
    namespace: v.string(),
    key: v.string(),
    scheduledFunctionId: v.id('_scheduled_functions'),
    scheduledFor: v.number(),
  }).index('by_namespace_and_key', ['namespace', 'key']),

  // Availability polls (when2meet replacement for scheduling)
  availabilityPolls: defineTable({
    opportunityId: v.id('orgOpportunities'),
    orgId: v.id('organizations'),
    createdBy: v.string(),
    title: v.string(),
    timezone: v.string(), // IANA, e.g. "America/Argentina/Buenos_Aires"
    // Generic week: which weekdays the poll covers. 0 = Monday … 6 = Sunday.
    days: v.array(v.number()),
    startMinutes: v.number(), // minutes from midnight (540 = 9 AM)
    endMinutes: v.number(), // minutes from midnight (1080 = 6 PM)
    slotDurationMinutes: v.number(), // 15, 30, or 60
    accessToken: v.string(), // UUID for shareable link
    status: v.union(
      v.literal('open'),
      v.literal('closed'),
      v.literal('finalized'),
    ),
    finalizedSlot: v.optional(
      v.object({
        day: v.number(), // weekday index, 0 = Monday … 6 = Sunday
        startMinutes: v.number(),
        endMinutes: v.number(),
      }),
    ),
    finalizedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_opportunity', ['opportunityId'])
    .index('by_accessToken', ['accessToken']),

  // Poll respondents (junction between polls and applicants)
  pollRespondents: defineTable({
    pollId: v.id('availabilityPolls'),
    applicationId: v.id('opportunityApplications'),
    respondentToken: v.string(),
    respondentName: v.string(),
  })
    .index('by_poll', ['pollId'])
    .index('by_respondentToken', ['respondentToken'])
    .index('by_poll_and_application', ['pollId', 'applicationId']),

  // Availability responses (individual respondent selections)
  availabilityResponses: defineTable({
    pollId: v.id('availabilityPolls'),
    // Legacy field — old responses used userId (string). New responses use respondentId.
    userId: v.optional(v.string()),
    respondentId: v.optional(v.id('pollRespondents')),
    respondentName: v.string(),
    // Only available/maybe slots stored. Absent key = unavailable.
    // Key format: "<weekdayIndex>|minutesFromMidnight" (0 = Monday … 6 = Sunday)
    slots: v.record(
      v.string(),
      v.union(v.literal('available'), v.literal('maybe')),
    ),
    updatedAt: v.number(),
  })
    .index('by_poll', ['pollId'])
    .index('by_poll_and_respondent', ['pollId', 'respondentId']),

  // ── Email redesign (issue #20): template sets, outbox, unified log ────────

  // Org-level library of email template sets (e.g. "TAIS", "Governance").
  // A set always holds one template per kind — created together, so a linked
  // opportunity can never hit a missing template.
  emailTemplateSets: defineTable({
    orgId: v.id('organizations'),
    name: v.string(),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_org', ['orgId']),

  // Templates. Library templates carry setId; per-opportunity overrides carry
  // opportunityId instead (exactly one of the two is set). Every kind always
  // has a row; `enabled: false` is the explicit "this decision sends no email"
  // choice (never a missing template). Poll/survey links are system-managed
  // blocks toggled per template — never text variables that can break.
  emailTemplates: defineTable({
    orgId: v.id('organizations'),
    setId: v.optional(v.id('emailTemplateSets')),
    opportunityId: v.optional(v.id('orgOpportunities')),
    kind: v.union(
      v.literal('application_received'),
      v.literal('accepted'),
      v.literal('rejected'),
      v.literal('redirected'),
      v.literal('waitlisted'),
    ),
    enabled: v.optional(v.boolean()), // undefined = true
    subject: v.string(),
    markdownBody: v.string(),
    includePollLink: v.optional(v.boolean()), // undefined = false
    includeSurveyLink: v.optional(v.boolean()), // undefined = false
    updatedAt: v.number(),
  })
    .index('by_set_and_kind', ['setId', 'kind'])
    .index('by_opportunity_and_kind', ['opportunityId', 'kind']),

  // Pending decision-email drafts. At most one draft per application; a status
  // change replaces it. Sending moves the record into emailLog and deletes it.
  emailOutbox: defineTable({
    orgId: v.id('organizations'),
    opportunityId: v.id('orgOpportunities'),
    applicationId: v.id('opportunityApplications'),
    kind: v.union(
      v.literal('accepted'),
      v.literal('rejected'),
      v.literal('redirected'),
      v.literal('waitlisted'),
    ),
    subject: v.string(),
    markdownBody: v.string(),
    includePollLink: v.optional(v.boolean()), // undefined = false
    includeSurveyLink: v.optional(v.boolean()), // undefined = false
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_opportunity', ['opportunityId'])
    .index('by_application', ['applicationId']),

  // Unified send log for every applicant email (outbox, auto, broadcast).
  // Idempotency: one 'sent' row per (application, kind) — checked before any
  // outbox send.
  emailLog: defineTable({
    orgId: v.id('organizations'),
    opportunityId: v.id('orgOpportunities'),
    applicationId: v.optional(v.id('opportunityApplications')),
    recipientEmail: v.string(),
    recipientName: v.string(),
    kind: v.string(), // accepted/rejected/... | application_received | broadcast
    source: v.union(
      v.literal('outbox'),
      v.literal('auto'),
      v.literal('broadcast'),
    ),
    subject: v.string(),
    sentAt: v.number(),
    sentBy: v.string(), // admin userId, or 'system' for automatic sends
    status: v.union(v.literal('sent'), v.literal('failed')),
    error: v.optional(v.string()),
  })
    .index('by_opportunity', ['opportunityId'])
    .index('by_application_and_kind', ['applicationId', 'kind']),

  // Admin agent chat history (per admin per org)
  adminAgentChats: defineTable({
    orgId: v.id('organizations'),
    userId: v.string(),
    messages: v.array(
      v.object({
        role: v.union(v.literal('user'), v.literal('assistant')),
        // User messages: plain text content
        content: v.optional(v.string()),
        // Assistant messages: ordered content parts
        parts: v.optional(
          v.array(
            v.union(
              v.object({ type: v.literal('text'), content: v.string() }),
              v.object({
                type: v.literal('tool_call'),
                name: v.string(),
                input: v.any(),
                output: v.optional(v.string()),
              }),
              v.object({
                type: v.literal('confirmation'),
                confirmId: v.string(),
                action: v.string(),
                description: v.string(),
                details: v.any(),
                status: v.union(
                  v.literal('pending'),
                  v.literal('approved'),
                  v.literal('rejected'),
                ),
              }),
            ),
          ),
        ),
      }),
    ),
    updatedAt: v.number(),
  }).index('by_userId_orgId', ['userId', 'orgId']),

  // Admin agent action audit log
  agentActionLog: defineTable({
    userId: v.string(),
    orgId: v.id('organizations'),
    toolName: v.string(),
    params: v.string(), // JSON
    result: v.string(), // JSON
    timestamp: v.number(),
    approvalStatus: v.union(
      v.literal('auto'),
      v.literal('approved'),
      v.literal('rejected'),
      v.literal('n/a'),
    ),
  })
    .index('by_org', ['orgId'])
    .index('by_org_timestamp', ['orgId', 'timestamp']),

  // Session phases (Phase 40) — ordered agenda items within a session
  sessionPhases: defineTable({
    sessionId: v.id('programSessions'),
    programId: v.id('programs'),
    title: v.string(),
    durationMs: v.number(),
    notes: v.optional(v.string()),
    promptIds: v.optional(v.array(v.id('coursePrompts'))),
    pairConfig: v.optional(
      v.object({
        strategy: v.union(
          v.literal('random'),
          v.literal('complementary'),
          v.literal('manual'),
        ),
        sourcePromptId: v.optional(v.id('coursePrompts')),
        sourceFieldId: v.optional(v.string()),
      }),
    ),
    orderIndex: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_sessionId', ['sessionId'])
    .index('by_sessionId_and_orderIndex', ['sessionId', 'orderIndex']),

  // Session live state (Phase 40) — single document per live session (hot state)
  sessionLiveState: defineTable({
    sessionId: v.id('programSessions'),
    programId: v.id('programs'),
    status: v.union(
      v.literal('running'),
      v.literal('paused'),
      v.literal('completed'),
    ),
    currentPhaseId: v.id('sessionPhases'),
    phaseStartedAt: v.number(),
    phaseDurationMs: v.number(),
    activePromptIds: v.array(v.id('coursePrompts')),
    startedAt: v.number(),
    startedBy: v.string(),
    completedAt: v.optional(v.number()),
  })
    .index('by_sessionId', ['sessionId'])
    .index('by_programId_and_status', ['programId', 'status']),

  // Session presence (Phase 40) — typing/activity indicators
  sessionPresence: defineTable({
    sessionId: v.id('programSessions'),
    userId: v.string(),
    phaseId: v.id('sessionPhases'),
    status: v.union(
      v.literal('typing'),
      v.literal('idle'),
      v.literal('submitted'),
    ),
    lastSeen: v.number(),
  })
    .index('by_sessionId', ['sessionId'])
    .index('by_sessionId_and_userId', ['sessionId', 'userId'])
    .index('by_sessionId_and_phaseId', ['sessionId', 'phaseId']),

  // Session pair assignments (Phase 40) — pair/trio assignments per phase
  sessionPairAssignments: defineTable({
    sessionId: v.id('programSessions'),
    phaseId: v.id('sessionPhases'),
    programId: v.id('programs'),
    strategy: v.union(
      v.literal('random'),
      v.literal('complementary'),
      v.literal('manual'),
    ),
    pairs: v.array(v.object({ members: v.array(v.string()) })),
    createdAt: v.number(),
    createdBy: v.string(),
  })
    .index('by_sessionId', ['sessionId'])
    .index('by_sessionId_and_phaseId', ['sessionId', 'phaseId']),

  // Session phase results (Phase 40) — actual durations recorded after each phase
  sessionPhaseResults: defineTable({
    sessionId: v.id('programSessions'),
    phaseId: v.id('sessionPhases'),
    actualDurationMs: v.number(),
    startedAt: v.number(),
    endedAt: v.number(),
  }).index('by_sessionId', ['sessionId']),

  // Feedback surveys (post-course/opportunity feedback with magic links)
  feedbackSurveys: defineTable({
    opportunityId: v.id('orgOpportunities'),
    orgId: v.id('organizations'),
    programId: v.optional(v.id('programs')),
    createdBy: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    formFields: v.any(), // Array<FormField> — see convex/lib/formFields.ts
    accessToken: v.string(), // UUID for generic shareable link
    status: v.union(v.literal('draft'), v.literal('open'), v.literal('closed')),
    applicantStatuses: v.optional(v.array(v.string())), // which application statuses were included
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_opportunity', ['opportunityId'])
    .index('by_accessToken', ['accessToken'])
    .index('by_org', ['orgId']),

  // Survey respondents (junction between surveys and applicants, with unique tokens)
  surveyRespondents: defineTable({
    surveyId: v.id('feedbackSurveys'),
    applicationId: v.id('opportunityApplications'),
    respondentToken: v.string(), // UUID for personalized link
    respondentName: v.string(),
    userId: v.optional(v.string()), // Clerk userId for cross-referencing
  })
    .index('by_survey', ['surveyId'])
    .index('by_respondentToken', ['respondentToken'])
    .index('by_survey_and_application', ['surveyId', 'applicationId'])
    .index('by_userId', ['userId']),

  // Survey responses (submitted answers)
  surveyResponses: defineTable({
    surveyId: v.id('feedbackSurveys'),
    respondentId: v.id('surveyRespondents'),
    respondentName: v.string(),
    responses: v.any(), // Record<string, unknown> keyed by formField.key
    userId: v.optional(v.string()), // Denormalized from surveyRespondents for queries
    submittedAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_survey', ['surveyId'])
    .index('by_survey_and_respondent', ['surveyId', 'respondentId'])
    .index('by_userId', ['userId']),

  // Push notification tokens for mobile (Tauri) clients
  pushTokens: defineTable({
    userId: v.string(),
    token: v.string(),
    platform: v.union(v.literal('ios'), v.literal('android')),
    createdAt: v.number(),
  })
    .index('by_userId', ['userId'])
    .index('by_token', ['token']),

  // ── CRM Tables (org-scoped, independent from platform tables) ──

  // CRM Contacts — contacts in the org's network
  crmContacts: defineTable({
    orgId: v.id('organizations'),
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    website: v.optional(v.string()),
    relationship: v.optional(v.string()),
    role: v.optional(v.string()),
    title: v.optional(v.string()),
    professionalField: v.optional(v.string()),
    careerStage: v.optional(v.string()),
    aiSafetyExperience: v.optional(v.string()),
    skills: v.optional(v.string()),
    interests: v.optional(v.string()),
    availability: v.optional(v.string()),
    location: v.optional(v.string()),
    inBuenosAires: v.optional(v.boolean()),
    contactSource: v.optional(v.string()),
    contactPerson: v.optional(v.string()),
    firstContact: v.optional(v.string()),
    associatedOrganizations: v.optional(v.string()),
    participatedIn: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_orgId', ['orgId'])
    .searchIndex('search_name', {
      searchField: 'name',
      filterFields: ['orgId'],
    }),

  // CRM Organizations — organizations in the ecosystem
  crmOrganizations: defineTable({
    orgId: v.id('organizations'),
    name: v.string(),
    description: v.optional(v.string()),
    keyPeople: v.optional(v.string()),
    type: v.optional(v.string()),
    aiStance: v.optional(v.string()),
    mainTopic: v.optional(v.string()),
    notes: v.optional(v.string()),
    autoSummary: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_orgId', ['orgId'])
    .searchIndex('search_name', {
      searchField: 'name',
      filterFields: ['orgId'],
    }),

  // CRM Opportunities — job/funding opportunities
  crmOpportunities: defineTable({
    orgId: v.id('organizations'),
    title: v.string(),
    organization: v.optional(v.string()),
    location: v.optional(v.string()),
    type: v.optional(v.string()),
    category: v.optional(v.string()),
    date: v.optional(v.string()),
    status: v.optional(v.string()),
    source: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_orgId', ['orgId'])
    .searchIndex('search_title', {
      searchField: 'title',
      filterFields: ['orgId'],
    }),

  // CRM Submissions — program feedback/survey responses
  crmSubmissions: defineTable({
    orgId: v.id('organizations'),
    participant: v.optional(v.string()),
    period: v.optional(v.string()),
    source: v.optional(v.string()),
    // Flexible bag for remaining form fields — program forms can have 79+
    // columns that vary by period.
    data: v.record(v.string(), v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_orgId', ['orgId']),

  // CRM Counts — O(1) per-org per-collection size aggregate. Each insert/
  // delete bumps the matching field; the dashboard reads one row per org
  // instead of `.take(STATS_CAP)`-scanning each table on every page view.
  crmCounts: defineTable({
    orgId: v.id('organizations'),
    contacts: v.number(),
    organizations: v.number(),
    opportunities: v.number(),
    submissions: v.number(),
  }).index('by_orgId', ['orgId']),
})
