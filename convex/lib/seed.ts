import { v } from 'convex/values'
import { internalMutation } from '../_generated/server'

/**
 * Seed the dev database with realistic AI safety mock data.
 * Run from the Convex dashboard:
 *   lib/seed:seedDevData({})
 *
 * Safe to run multiple times — checks if already seeded.
 */
export const seedDevData = internalMutation({
  args: {},
  returns: v.object({ success: v.boolean(), message: v.string() }),
  handler: async (ctx) => {
    // Check if already seeded
    const existingOrg = await ctx.db.query('organizations').first()
    if (existingOrg) {
      return {
        success: false,
        message:
          'Database already has data. Run lib/seed:clearDevData first to reseed.',
      }
    }

    const now = Date.now()

    // ──────────────────────────────────────────
    // 1. Skills Taxonomy
    // ──────────────────────────────────────────
    const skills = [
      { name: 'Alignment Research', category: 'Research Areas' },
      { name: 'Interpretability', category: 'Research Areas' },
      { name: 'Mechanistic Interpretability', category: 'Research Areas' },
      { name: 'AI Governance and Policy', category: 'Research Areas' },
      { name: 'AI Safety Evaluation', category: 'Research Areas' },
      { name: 'Scalable Oversight', category: 'Research Areas' },
      { name: 'RLHF', category: 'Research Areas' },
      { name: 'Red Teaming', category: 'Research Areas' },
      { name: 'Machine Learning Engineering', category: 'Technical Skills' },
      { name: 'Deep Learning', category: 'Technical Skills' },
      { name: 'Python', category: 'Technical Skills' },
      { name: 'PyTorch', category: 'Technical Skills' },
      { name: 'Statistical Analysis', category: 'Technical Skills' },
      { name: 'Formal Verification', category: 'Technical Skills' },
      { name: 'AI Risk Assessment', category: 'Domain Knowledge' },
      { name: 'Existential Risk', category: 'Domain Knowledge' },
      { name: 'AI Ethics', category: 'Domain Knowledge' },
      { name: 'Technology Policy', category: 'Domain Knowledge' },
      { name: 'Technical Writing', category: 'Soft Skills' },
      { name: 'Research Communication', category: 'Soft Skills' },
      { name: 'Project Management', category: 'Soft Skills' },
    ]
    const existingSkill = await ctx.db.query('skillsTaxonomy').first()
    if (!existingSkill) {
      for (const skill of skills) {
        await ctx.db.insert('skillsTaxonomy', {
          name: skill.name,
          category: skill.category,
        })
      }
    }

    // ──────────────────────────────────────────
    // 2. Organizations
    // ──────────────────────────────────────────
    const baishId = await ctx.db.insert('organizations', {
      name: 'Buenos Aires AI Safety Hub',
      slug: 'baish',
      city: 'Buenos Aires',
      country: 'Argentina',
      isGlobal: false,
      description:
        'The Buenos Aires hub for AI safety research, community events, and co-working.',
      memberCount: 45,
      hasCoworkingSpace: true,
      contactEmail: 'hello@baish.org',
      website: 'https://baish.org',
      socialLinks: [
        { platform: 'twitter', url: 'https://twitter.com/baish_aisafety' },
        { platform: 'discord', url: 'https://discord.gg/baish' },
      ],
    })

    const miriId = await ctx.db.insert('organizations', {
      name: 'Machine Intelligence Research Institute',
      slug: 'miri',
      city: 'Berkeley',
      country: 'United States',
      isGlobal: false,
      description:
        'MIRI does foundational mathematical research to ensure smarter-than-human AI systems are safe and beneficial.',
      memberCount: 30,
      hasCoworkingSpace: false,
      contactEmail: 'info@intelligence.org',
      website: 'https://intelligence.org',
      socialLinks: [],
    })

    const apartId = await ctx.db.insert('organizations', {
      name: 'Apart Research',
      slug: 'apart',
      city: 'London',
      country: 'United Kingdom',
      isGlobal: false,
      description:
        'Collaborative AI safety research through hackathons, sprints, and fellowships.',
      memberCount: 120,
      hasCoworkingSpace: false,
      contactEmail: 'team@apartresearch.com',
      website: 'https://apartresearch.com',
      socialLinks: [
        { platform: 'twitter', url: 'https://twitter.com/ApartResearch' },
      ],
    })

    const globalHubId = await ctx.db.insert('organizations', {
      name: 'AI Safety Camp',
      slug: 'aisc',
      country: 'Global',
      isGlobal: true,
      description:
        'Intensive research camps bringing together aspiring AI safety researchers worldwide.',
      memberCount: 200,
      hasCoworkingSpace: false,
      contactEmail: 'info@aisafety.camp',
      website: 'https://aisafety.camp',
      socialLinks: [],
    })

    // ──────────────────────────────────────────
    // 3. Profiles (fake Clerk user IDs)
    // ──────────────────────────────────────────
    const profileData = [
      {
        userId: 'user_seed_001',
        name: 'María García López',
        pronouns: 'she/her',
        location: 'Buenos Aires, Argentina',
        headline: 'ML researcher focused on interpretability and alignment',
        linkedinUrl: 'https://linkedin.com/in/maria-garcia-lopez',
        preferredLanguage: 'es',
        education: [
          {
            institution: 'Universidad de Buenos Aires',
            degree: 'PhD',
            field: 'Computer Science',
            startYear: 2019,
            endYear: 2024,
            current: false,
          },
          {
            institution: 'Instituto Balseiro',
            degree: 'BS',
            field: 'Physics',
            startYear: 2014,
            endYear: 2019,
            current: false,
          },
        ],
        workHistory: [
          {
            organization: 'BAISH',
            title: 'Research Lead',
            startDate: new Date('2024-03-01').getTime(),
            current: true,
            description:
              'Leading interpretability research projects and mentoring junior researchers.',
          },
          {
            organization: 'Google DeepMind',
            title: 'Research Intern',
            startDate: new Date('2022-06-01').getTime(),
            endDate: new Date('2022-09-01').getTime(),
            current: false,
            description:
              'Worked on mechanistic interpretability of transformer models.',
          },
        ],
        skills: [
          'Interpretability',
          'Mechanistic Interpretability',
          'Deep Learning',
          'PyTorch',
          'Python',
          'Research Communication',
        ],
        careerGoals:
          'Lead a research team working on scalable interpretability tools for frontier models.',
        aiSafetyInterests: [
          'Mechanistic Interpretability',
          'Scalable Oversight',
        ],
        seeking: 'Research positions in interpretability',
      },
      {
        userId: 'user_seed_002',
        name: 'James Chen',
        pronouns: 'he/him',
        location: 'Berkeley, CA',
        headline: 'AI governance researcher and policy analyst',
        linkedinUrl: 'https://linkedin.com/in/jameschen-gov',
        preferredLanguage: 'en',
        education: [
          {
            institution: 'UC Berkeley',
            degree: 'MA',
            field: 'Public Policy',
            startYear: 2020,
            endYear: 2022,
            current: false,
          },
          {
            institution: 'MIT',
            degree: 'BS',
            field: 'Computer Science',
            startYear: 2016,
            endYear: 2020,
            current: false,
          },
        ],
        workHistory: [
          {
            organization: 'Center for AI Safety',
            title: 'Policy Researcher',
            startDate: new Date('2023-01-01').getTime(),
            current: true,
            description:
              'Researching AI governance frameworks and international coordination mechanisms.',
          },
        ],
        skills: [
          'AI Governance and Policy',
          'AI Risk Assessment',
          'Technology Policy',
          'Technical Writing',
          'Project Management',
        ],
        careerGoals:
          'Shape international AI safety policy and build bridges between technical and policy communities.',
        aiSafetyInterests: ['AI Governance and Policy', 'Existential Risk'],
        seeking: 'Policy roles at AI labs or think tanks',
      },
      {
        userId: 'user_seed_003',
        name: 'Sofía Rodríguez',
        pronouns: 'she/they',
        location: 'Buenos Aires, Argentina',
        headline: 'Full-stack ML engineer transitioning to AI safety',
        preferredLanguage: 'es',
        education: [
          {
            institution: 'Universidad Tecnológica Nacional',
            degree: 'MS',
            field: 'Software Engineering',
            startYear: 2017,
            endYear: 2020,
            current: false,
          },
        ],
        workHistory: [
          {
            organization: 'MercadoLibre',
            title: 'Senior ML Engineer',
            startDate: new Date('2020-06-01').getTime(),
            endDate: new Date('2025-01-01').getTime(),
            current: false,
            description: 'Built recommendation systems serving 100M+ users.',
          },
          {
            organization: 'BAISH',
            title: 'Volunteer Researcher',
            startDate: new Date('2025-02-01').getTime(),
            current: true,
            description:
              'Learning alignment research fundamentals. Working through AGISF curriculum.',
          },
        ],
        skills: [
          'Machine Learning Engineering',
          'Deep Learning',
          'Python',
          'PyTorch',
          'RLHF',
        ],
        careerGoals:
          'Transition from industry ML to technical AI safety research.',
        aiSafetyInterests: ['RLHF', 'Alignment Research', 'Red Teaming'],
        seeking: 'Fellowships or entry-level safety research positions',
      },
      {
        userId: 'user_seed_004',
        name: 'Dr. Anika Patel',
        pronouns: 'she/her',
        location: 'London, UK',
        headline: 'Senior alignment researcher at Apart Research',
        linkedinUrl: 'https://linkedin.com/in/anika-patel-alignment',
        preferredLanguage: 'en',
        education: [
          {
            institution: 'University of Oxford',
            degree: 'PhD',
            field: 'Machine Learning',
            startYear: 2015,
            endYear: 2019,
            current: false,
          },
          {
            institution: 'IIT Delhi',
            degree: 'BTech',
            field: 'Computer Science',
            startYear: 2011,
            endYear: 2015,
            current: false,
          },
        ],
        workHistory: [
          {
            organization: 'Apart Research',
            title: 'Senior Research Scientist',
            startDate: new Date('2021-06-01').getTime(),
            current: true,
            description:
              'Leading multiple alignment research streams. Published 8 papers on scalable oversight.',
          },
          {
            organization: 'DeepMind',
            title: 'Research Scientist',
            startDate: new Date('2019-09-01').getTime(),
            endDate: new Date('2021-05-01').getTime(),
            current: false,
            description: 'Safety team - worked on reward modeling and RLHF.',
          },
        ],
        skills: [
          'Alignment Research',
          'Scalable Oversight',
          'RLHF',
          'Deep Learning',
          'PyTorch',
          'Statistical Analysis',
          'Research Communication',
        ],
        careerGoals:
          'Develop practical scalable oversight techniques that work for frontier models.',
        aiSafetyInterests: [
          'Scalable Oversight',
          'Alignment Research',
          'AI Safety Evaluation',
        ],
        seeking: 'Research lead positions or founding my own safety org',
      },
      {
        userId: 'user_seed_005',
        name: 'Lucas Fernández',
        pronouns: 'he/him',
        location: 'Buenos Aires, Argentina',
        headline: 'Red teaming specialist and security researcher',
        preferredLanguage: 'es',
        education: [
          {
            institution: 'ITBA',
            degree: 'BS',
            field: 'Computer Engineering',
            startYear: 2018,
            endYear: 2023,
            current: false,
          },
        ],
        workHistory: [
          {
            organization: 'BAISH',
            title: 'Red Team Lead',
            startDate: new Date('2024-06-01').getTime(),
            current: true,
            description:
              'Developing adversarial evaluation frameworks for LLMs.',
          },
        ],
        skills: [
          'Red Teaming',
          'AI Safety Evaluation',
          'Machine Learning Engineering',
          'Python',
          'AI Risk Assessment',
        ],
        careerGoals:
          'Build industry-standard red teaming tools for AI systems.',
        aiSafetyInterests: ['Red Teaming', 'AI Safety Evaluation'],
        seeking: 'Red teaming roles at frontier AI labs',
      },
      {
        userId: 'user_seed_006',
        name: 'Yuki Tanaka',
        pronouns: 'they/them',
        location: 'Tokyo, Japan',
        headline:
          'Formal methods researcher applying verification to neural networks',
        preferredLanguage: 'en',
        education: [
          {
            institution: 'University of Tokyo',
            degree: 'PhD',
            field: 'Formal Methods',
            startYear: 2018,
            endYear: 2023,
            current: false,
          },
        ],
        workHistory: [
          {
            organization: 'RIKEN AIP',
            title: 'Postdoctoral Researcher',
            startDate: new Date('2023-04-01').getTime(),
            current: true,
            description:
              'Applying formal verification to ensure safety properties of neural networks.',
          },
        ],
        skills: [
          'Formal Verification',
          'AI Safety Evaluation',
          'Deep Learning',
          'Python',
          'Statistical Analysis',
        ],
        careerGoals:
          'Pioneer practical formal safety guarantees for deployed AI systems.',
        aiSafetyInterests: ['AI Safety Evaluation', 'Alignment Research'],
        seeking: 'Research positions at safety-focused organizations',
      },
      {
        userId: 'user_seed_007',
        name: 'Emma Johansson',
        pronouns: 'she/her',
        location: 'Stockholm, Sweden',
        headline: 'AI ethics researcher and policy consultant',
        preferredLanguage: 'en',
        education: [
          {
            institution: 'KTH Royal Institute',
            degree: 'MS',
            field: 'AI & Society',
            startYear: 2019,
            endYear: 2021,
            current: false,
          },
        ],
        workHistory: [
          {
            organization: 'Future of Humanity Institute',
            title: 'Research Analyst',
            startDate: new Date('2021-09-01').getTime(),
            endDate: new Date('2024-12-01').getTime(),
            current: false,
            description: 'Analyzed risks from advanced AI systems.',
          },
          {
            organization: 'Independent',
            title: 'Consultant',
            startDate: new Date('2025-01-01').getTime(),
            current: true,
            description: 'Consulting on AI governance for EU institutions.',
          },
        ],
        skills: [
          'AI Ethics',
          'AI Governance and Policy',
          'Technology Policy',
          'Existential Risk',
          'Technical Writing',
          'Project Management',
        ],
        careerGoals:
          'Help shape EU AI regulation to effectively address safety concerns.',
        aiSafetyInterests: [
          'AI Governance and Policy',
          'AI Ethics',
          'Existential Risk',
        ],
        seeking: 'Policy roles at international organizations',
      },
      {
        userId: 'user_seed_008',
        name: 'Diego Morales',
        pronouns: 'he/him',
        location: 'Buenos Aires, Argentina',
        headline: 'Student exploring AI safety through the AGISF curriculum',
        preferredLanguage: 'es',
        education: [
          {
            institution: 'Universidad de Buenos Aires',
            degree: 'BS',
            field: 'Mathematics',
            startYear: 2022,
            current: true,
          },
        ],
        workHistory: [],
        skills: ['Python', 'Deep Learning', 'Statistical Analysis'],
        careerGoals:
          'Understand alignment well enough to contribute to technical research.',
        aiSafetyInterests: ['Alignment Research', 'Interpretability'],
        seeking: 'Internships or mentorship opportunities',
      },
      {
        userId: 'user_seed_009',
        name: 'Priya Sharma',
        pronouns: 'she/her',
        location: 'Bangalore, India',
        headline:
          'NLP researcher applying language models to safety evaluations',
        preferredLanguage: 'en',
        education: [
          {
            institution: 'Indian Institute of Science',
            degree: 'MS',
            field: 'Computer Science',
            startYear: 2020,
            endYear: 2022,
            current: false,
          },
        ],
        workHistory: [
          {
            organization: 'Anthropic',
            title: 'Research Engineer',
            startDate: new Date('2022-08-01').getTime(),
            current: true,
            description:
              'Building evaluation pipelines for language model safety.',
          },
        ],
        skills: [
          'AI Safety Evaluation',
          'Machine Learning Engineering',
          'Python',
          'PyTorch',
          'Red Teaming',
          'Deep Learning',
        ],
        careerGoals:
          'Develop comprehensive safety evaluation suites for frontier models.',
        aiSafetyInterests: ['AI Safety Evaluation', 'Red Teaming', 'RLHF'],
        seeking: 'Not actively seeking — open to interesting collaborations',
      },
      {
        userId: 'user_seed_010',
        name: 'Carlos Mendoza',
        pronouns: 'he/him',
        location: 'Buenos Aires, Argentina',
        headline: 'BAISH community organizer and AI safety educator',
        preferredLanguage: 'es',
        education: [
          {
            institution: 'Universidad de San Andrés',
            degree: 'BA',
            field: 'Philosophy',
            startYear: 2015,
            endYear: 2019,
            current: false,
          },
          {
            institution: 'Universidad de Buenos Aires',
            degree: 'MS',
            field: 'Cognitive Science',
            startYear: 2020,
            endYear: 2023,
            current: false,
          },
        ],
        workHistory: [
          {
            organization: 'BAISH',
            title: 'Community Director',
            startDate: new Date('2023-06-01').getTime(),
            current: true,
            description:
              'Running the BAISH community, organizing events, and developing the AGISF reading group.',
          },
        ],
        skills: [
          'AI Ethics',
          'Existential Risk',
          'Research Communication',
          'Project Management',
        ],
        careerGoals: 'Scale AI safety education across Latin America.',
        aiSafetyInterests: [
          'AI Ethics',
          'Existential Risk',
          'AI Governance and Policy',
        ],
        seeking: 'Community building and education roles',
      },
    ]

    const profileIds: Record<string, any> = {}
    for (const p of profileData) {
      const profileId = await ctx.db.insert('profiles', {
        userId: p.userId,
        name: p.name,
        pronouns: p.pronouns,
        location: p.location,
        headline: p.headline,
        linkedinUrl: p.linkedinUrl,
        preferredLanguage: p.preferredLanguage,
        education: p.education,
        workHistory: p.workHistory,
        skills: p.skills,
        careerGoals: p.careerGoals,
        aiSafetyInterests: p.aiSafetyInterests,
        seeking: p.seeking,
        createdAt: now - 86400000 * 30, // 30 days ago
        updatedAt: now - 86400000 * Math.floor(Math.random() * 7),
        completedSections: ['basic', 'education', 'work', 'skills', 'career'],
        consentedAt: now - 86400000 * 30,
        consentVersion: '1.0',
        privacySettings: {
          defaultVisibility: 'connections' as const,
          sectionVisibility: {},
          hiddenFromOrgs: [],
          locationDiscoverable: true,
          attendancePrivacyDefaults: {
            showOnProfile: true,
            showToOtherOrgs: false,
          },
        },
        matchPreferences: {
          remotePreference: 'no_preference' as const,
          roleTypes: [],
          experienceLevels: [],
          willingToRelocate: false,
          availability: 'immediately' as const,
          commitmentTypes: [],
        },
        notificationPreferences: {
          matchAlerts: { enabled: true },
          weeklyDigest: { enabled: true },
          deadlineReminders: { enabled: true },
          timezone: 'America/Argentina/Buenos_Aires',
        },
      })
      profileIds[p.userId] = profileId
    }

    // ──────────────────────────────────────────
    // 4. Org Memberships
    // ──────────────────────────────────────────
    const memberships: Array<{
      userId: string
      orgId: any
      role: 'admin' | 'member'
    }> = [
      // BAISH members
      { userId: 'user_seed_001', orgId: baishId, role: 'admin' },
      { userId: 'user_seed_003', orgId: baishId, role: 'member' },
      { userId: 'user_seed_005', orgId: baishId, role: 'member' },
      { userId: 'user_seed_008', orgId: baishId, role: 'member' },
      { userId: 'user_seed_010', orgId: baishId, role: 'admin' },
      // MIRI
      { userId: 'user_seed_002', orgId: miriId, role: 'member' },
      // Apart
      { userId: 'user_seed_004', orgId: apartId, role: 'admin' },
      // AI Safety Camp
      { userId: 'user_seed_003', orgId: globalHubId, role: 'member' },
      { userId: 'user_seed_006', orgId: globalHubId, role: 'member' },
      { userId: 'user_seed_009', orgId: globalHubId, role: 'member' },
    ]

    const membershipIds: Record<string, any> = {}
    for (const m of memberships) {
      const id = await ctx.db.insert('orgMemberships', {
        userId: m.userId,
        orgId: m.orgId,
        role: m.role,
        directoryVisibility: 'visible',
        joinedAt: now - 86400000 * 60,
      })
      membershipIds[`${m.userId}_${m.orgId}`] = id
    }

    // ──────────────────────────────────────────
    // 5. Coworking Space (BAISH)
    // ──────────────────────────────────────────
    const spaceId = await ctx.db.insert('coworkingSpaces', {
      orgId: baishId,
      name: 'BAISH Lab',
      capacity: 20,
      timezone: 'America/Argentina/Buenos_Aires',
      operatingHours: [
        { dayOfWeek: 0, openMinutes: 0, closeMinutes: 0, isClosed: true },
        { dayOfWeek: 1, openMinutes: 540, closeMinutes: 1140, isClosed: false }, // Mon 9-19
        { dayOfWeek: 2, openMinutes: 540, closeMinutes: 1140, isClosed: false },
        { dayOfWeek: 3, openMinutes: 540, closeMinutes: 1140, isClosed: false },
        { dayOfWeek: 4, openMinutes: 540, closeMinutes: 1140, isClosed: false },
        { dayOfWeek: 5, openMinutes: 540, closeMinutes: 1020, isClosed: false }, // Fri 9-17
        { dayOfWeek: 6, openMinutes: 0, closeMinutes: 0, isClosed: true },
      ],
      description:
        'Shared workspace for AI safety researchers in Buenos Aires. Quiet focus area + meeting room.',
      address: 'Av. Corrientes 1234, CABA, Buenos Aires',
      amenities: ['WiFi', 'Coffee', 'Meeting Room', 'Whiteboard', 'Library'],
      houseRules:
        'Please keep noise levels low in the focus area. Meeting room bookings via the platform.',
      guestAccessEnabled: true,
      customVisitFields: [
        {
          fieldId: 'research_area',
          label: 'What are you working on?',
          type: 'text',
          required: true,
        },
      ],
      createdAt: now - 86400000 * 90,
      updatedAt: now - 86400000 * 5,
    })

    // A few bookings for today/tomorrow
    const today = new Date().toISOString().split('T')[0]
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]

    await ctx.db.insert('spaceBookings', {
      spaceId,
      userId: 'user_seed_001',
      date: today,
      startMinutes: 540,
      endMinutes: 1020,
      bookingType: 'member',
      status: 'confirmed',
      workingOn: 'Interpretability research on transformer attention heads',
      interestedInMeeting: 'Anyone working on mechanistic interpretability',
      consentToProfileSharing: true,
      createdAt: now - 86400000,
      updatedAt: now - 86400000,
    })

    await ctx.db.insert('spaceBookings', {
      spaceId,
      userId: 'user_seed_005',
      date: today,
      startMinutes: 600,
      endMinutes: 1140,
      bookingType: 'member',
      status: 'confirmed',
      workingOn: 'Red teaming evaluation framework v2',
      interestedInMeeting: 'ML engineers interested in adversarial testing',
      consentToProfileSharing: true,
      createdAt: now - 86400000,
      updatedAt: now - 86400000,
    })

    await ctx.db.insert('spaceBookings', {
      spaceId,
      userId: 'user_seed_008',
      date: tomorrow,
      startMinutes: 600,
      endMinutes: 900,
      bookingType: 'member',
      status: 'confirmed',
      workingOn: 'AGISF Week 4 readings',
      consentToProfileSharing: true,
      createdAt: now,
      updatedAt: now,
    })

    // ──────────────────────────────────────────
    // 6. Opportunities
    // ──────────────────────────────────────────
    const opps = [
      {
        sourceId: 'seed-opp-001',
        source: '80k_hours' as const,
        title: 'Research Scientist - Alignment',
        organization: 'Anthropic',
        organizationLogoUrl: 'https://logo.clearbit.com/anthropic.com',
        location: 'San Francisco, CA',
        isRemote: false,
        roleType: 'Research',
        experienceLevel: 'Mid-level',
        description:
          'Join the alignment science team to develop and evaluate methods for making AI systems more reliable, interpretable, and steerable.',
        requirements: [
          'PhD in ML/AI or related field',
          '3+ years research experience',
          'Published papers in top venues',
        ],
        deadline: now + 86400000 * 30,
        postedAt: now - 86400000 * 10,
        opportunityType: 'job' as const,
        status: 'active' as const,
        sourceUrl: 'https://boards.greenhouse.io/anthropic',
        extractedSkills: [
          'Alignment Research',
          'Deep Learning',
          'RLHF',
          'Interpretability',
        ],
        lastVerified: now - 86400000 * 2,
        createdAt: now - 86400000 * 10,
        updatedAt: now - 86400000 * 10,
      },
      {
        sourceId: 'seed-opp-002',
        source: '80k_hours' as const,
        title: 'AI Policy Fellow',
        organization: 'RAND Corporation',
        location: 'Washington, DC',
        isRemote: true,
        roleType: 'Policy',
        experienceLevel: 'Entry-level',
        description:
          'One-year fellowship to research AI governance and help develop policy recommendations for US government.',
        requirements: [
          'Masters in relevant field',
          'Strong writing skills',
          'Interest in AI governance',
        ],
        deadline: now + 86400000 * 45,
        postedAt: now - 86400000 * 5,
        opportunityType: 'job' as const,
        status: 'active' as const,
        sourceUrl: 'https://rand.org/careers',
        extractedSkills: [
          'AI Governance and Policy',
          'Technology Policy',
          'Technical Writing',
        ],
        lastVerified: now - 86400000 * 1,
        createdAt: now - 86400000 * 5,
        updatedAt: now - 86400000 * 5,
      },
      {
        sourceId: 'seed-opp-003',
        source: 'aisafety_com' as const,
        title: 'Red Teaming Engineer',
        organization: 'OpenAI',
        location: 'San Francisco, CA',
        isRemote: false,
        roleType: 'Engineering',
        experienceLevel: 'Mid-level',
        description:
          'Develop and execute adversarial evaluations of AI systems to identify safety risks before deployment.',
        requirements: [
          'Experience with LLM evaluation',
          'Security or adversarial ML background',
          'Python proficiency',
        ],
        deadline: now + 86400000 * 20,
        postedAt: now - 86400000 * 14,
        opportunityType: 'job' as const,
        status: 'active' as const,
        sourceUrl: 'https://openai.com/careers',
        extractedSkills: [
          'Red Teaming',
          'AI Safety Evaluation',
          'Python',
          'Machine Learning Engineering',
        ],
        lastVerified: now - 86400000 * 3,
        createdAt: now - 86400000 * 14,
        updatedAt: now - 86400000 * 14,
      },
      {
        sourceId: 'seed-opp-004',
        source: 'aisafety_events' as const,
        title: 'AI Safety Camp - Research Sprint',
        organization: 'AI Safety Camp',
        location: 'Remote',
        isRemote: true,
        roleType: 'Research',
        experienceLevel: 'Entry-level',
        description:
          'Intensive 2-week research sprint working on alignment problems with experienced mentors.',
        requirements: [
          'Completed AGISF or equivalent',
          'Available for full-time participation',
        ],
        deadline: now + 86400000 * 60,
        postedAt: now - 86400000 * 3,
        opportunityType: 'event' as const,
        eventType: 'Research Program',
        startDate: new Date('2026-05-01').getTime(),
        endDate: new Date('2026-05-15').getTime(),
        status: 'active' as const,
        sourceUrl: 'https://aisafety.camp',
        extractedSkills: ['Alignment Research', 'Deep Learning'],
        lastVerified: now - 86400000 * 1,
        createdAt: now - 86400000 * 3,
        updatedAt: now - 86400000 * 3,
      },
      {
        sourceId: 'seed-opp-005',
        source: '80k_hours' as const,
        title: 'Interpretability Research Engineer',
        organization: 'Google DeepMind',
        organizationLogoUrl: 'https://logo.clearbit.com/deepmind.com',
        location: 'London, UK',
        isRemote: false,
        roleType: 'Engineering',
        experienceLevel: 'Senior',
        description:
          'Build tooling and infrastructure for interpretability research on large language models.',
        requirements: [
          '5+ years engineering experience',
          'ML systems expertise',
          'Experience with interpretability tools',
        ],
        postedAt: now - 86400000 * 20,
        opportunityType: 'job' as const,
        status: 'active' as const,
        sourceUrl: 'https://deepmind.google/careers',
        extractedSkills: [
          'Interpretability',
          'Machine Learning Engineering',
          'PyTorch',
          'Python',
        ],
        lastVerified: now - 86400000 * 5,
        createdAt: now - 86400000 * 20,
        updatedAt: now - 86400000 * 20,
      },
      {
        sourceId: 'seed-opp-006',
        source: 'manual' as const,
        title: 'Technical Writer - AI Safety',
        organization: 'Center for AI Safety',
        location: 'Remote',
        isRemote: true,
        roleType: 'Operations',
        experienceLevel: 'Entry-level',
        description:
          'Write clear technical content explaining AI safety concepts to various audiences.',
        requirements: ['Strong writing portfolio', 'Basic understanding of ML'],
        deadline: now + 86400000 * 15,
        postedAt: now - 86400000 * 7,
        opportunityType: 'job' as const,
        status: 'active' as const,
        sourceUrl: 'https://safe.ai/careers',
        extractedSkills: [
          'Technical Writing',
          'Research Communication',
          'AI Ethics',
        ],
        lastVerified: now - 86400000 * 2,
        createdAt: now - 86400000 * 7,
        updatedAt: now - 86400000 * 7,
      },
    ]

    const oppIds: Array<any> = []
    for (const opp of opps) {
      const id = await ctx.db.insert('opportunities', opp)
      oppIds.push(id)
    }

    // ──────────────────────────────────────────
    // 7. Matches (profile ↔ opportunity)
    // ──────────────────────────────────────────
    const matchData = [
      // María (interpretability researcher) matched to opportunities
      {
        profileId: profileIds['user_seed_001'],
        opportunityId: oppIds[0], // Anthropic alignment
        tier: 'great' as const,
        score: 92,
        status: 'active' as const,
        explanation: {
          strengths: [
            'PhD in CS with interpretability focus',
            'Published research',
            'PyTorch expertise',
          ],
          gap: 'Based in Argentina — may need visa',
        },
        recommendations: [
          {
            type: 'specific' as const,
            action: 'Highlight your DeepMind internship experience',
            priority: 'high' as const,
          },
        ],
        opportunitySnapshot: {
          title: opps[0].title,
          organization: opps[0].organization,
          location: opps[0].location,
          isRemote: opps[0].isRemote,
          roleType: opps[0].roleType,
          experienceLevel: opps[0].experienceLevel,
          extractedSkills: opps[0].extractedSkills,
          sourceUrl: opps[0].sourceUrl,
          deadline: opps[0].deadline,
          postedAt: opps[0].postedAt,
          opportunityType: opps[0].opportunityType,
        },
        isNew: true,
        computedAt: now - 86400000,
        modelVersion: 'v2',
      },
      {
        profileId: profileIds['user_seed_001'],
        opportunityId: oppIds[4], // DeepMind interp eng
        tier: 'good' as const,
        score: 78,
        status: 'active' as const,
        explanation: {
          strengths: [
            'Strong interpretability background',
            'Former DeepMind intern',
          ],
          gap: 'Role requires 5+ years engineering experience',
        },
        recommendations: [
          {
            type: 'experience' as const,
            action: 'Consider getting more industry engineering experience',
            priority: 'medium' as const,
          },
        ],
        opportunitySnapshot: {
          title: opps[4].title,
          organization: opps[4].organization,
          location: opps[4].location,
          isRemote: opps[4].isRemote,
          roleType: opps[4].roleType,
          experienceLevel: opps[4].experienceLevel,
          extractedSkills: opps[4].extractedSkills,
          sourceUrl: opps[4].sourceUrl,
          postedAt: opps[4].postedAt,
          opportunityType: opps[4].opportunityType,
        },
        isNew: true,
        computedAt: now - 86400000,
        modelVersion: 'v2',
      },
      // James (governance) matched to policy fellow
      {
        profileId: profileIds['user_seed_002'],
        opportunityId: oppIds[1], // RAND policy
        tier: 'great' as const,
        score: 95,
        status: 'active' as const,
        explanation: {
          strengths: [
            'Policy MA from Berkeley',
            'Active governance researcher',
            'Strong writing skills',
          ],
        },
        recommendations: [
          {
            type: 'specific' as const,
            action: 'Reference your international coordination research',
            priority: 'high' as const,
          },
        ],
        opportunitySnapshot: {
          title: opps[1].title,
          organization: opps[1].organization,
          location: opps[1].location,
          isRemote: opps[1].isRemote,
          roleType: opps[1].roleType,
          experienceLevel: opps[1].experienceLevel,
          extractedSkills: opps[1].extractedSkills,
          sourceUrl: opps[1].sourceUrl,
          deadline: opps[1].deadline,
          postedAt: opps[1].postedAt,
          opportunityType: opps[1].opportunityType,
        },
        isNew: false,
        computedAt: now - 86400000 * 3,
        modelVersion: 'v2',
      },
      // Sofía (transitioning ML eng) matched to red teaming & camp
      {
        profileId: profileIds['user_seed_003'],
        opportunityId: oppIds[2], // OpenAI red teaming
        tier: 'exploring' as const,
        score: 55,
        status: 'active' as const,
        explanation: {
          strengths: ['Strong ML engineering background', 'RLHF interest'],
          gap: 'Needs more adversarial ML specific experience',
        },
        recommendations: [
          {
            type: 'skill' as const,
            action: 'Take red teaming courses or participate in CTFs',
            priority: 'high' as const,
          },
          {
            type: 'experience' as const,
            action: 'Contribute to open-source red teaming tools',
            priority: 'medium' as const,
          },
        ],
        opportunitySnapshot: {
          title: opps[2].title,
          organization: opps[2].organization,
          location: opps[2].location,
          isRemote: opps[2].isRemote,
          roleType: opps[2].roleType,
          experienceLevel: opps[2].experienceLevel,
          extractedSkills: opps[2].extractedSkills,
          sourceUrl: opps[2].sourceUrl,
          deadline: opps[2].deadline,
          postedAt: opps[2].postedAt,
          opportunityType: opps[2].opportunityType,
        },
        isNew: true,
        computedAt: now - 86400000,
        modelVersion: 'v2',
      },
      {
        profileId: profileIds['user_seed_003'],
        opportunityId: oppIds[3], // AI Safety Camp
        tier: 'great' as const,
        score: 88,
        status: 'saved' as const,
        explanation: {
          strengths: [
            'Currently doing AGISF',
            'Strong ML fundamentals',
            'Eager to transition',
          ],
        },
        recommendations: [
          {
            type: 'specific' as const,
            action: 'Mention your MercadoLibre scale experience as an asset',
            priority: 'high' as const,
          },
        ],
        opportunitySnapshot: {
          title: opps[3].title,
          organization: opps[3].organization,
          location: opps[3].location,
          isRemote: opps[3].isRemote,
          roleType: opps[3].roleType,
          experienceLevel: opps[3].experienceLevel,
          extractedSkills: opps[3].extractedSkills,
          sourceUrl: opps[3].sourceUrl,
          deadline: opps[3].deadline,
          postedAt: opps[3].postedAt,
          opportunityType: opps[3].opportunityType,
        },
        isNew: false,
        computedAt: now - 86400000 * 5,
        modelVersion: 'v2',
      },
      // Lucas (red teaming) matched to OpenAI
      {
        profileId: profileIds['user_seed_005'],
        opportunityId: oppIds[2], // OpenAI red teaming
        tier: 'great' as const,
        score: 90,
        status: 'active' as const,
        explanation: {
          strengths: [
            'Current red team lead',
            'Hands-on adversarial evaluation experience',
            'Python proficiency',
          ],
        },
        recommendations: [
          {
            type: 'specific' as const,
            action: 'Share your evaluation framework as a portfolio piece',
            priority: 'high' as const,
          },
        ],
        opportunitySnapshot: {
          title: opps[2].title,
          organization: opps[2].organization,
          location: opps[2].location,
          isRemote: opps[2].isRemote,
          roleType: opps[2].roleType,
          experienceLevel: opps[2].experienceLevel,
          extractedSkills: opps[2].extractedSkills,
          sourceUrl: opps[2].sourceUrl,
          deadline: opps[2].deadline,
          postedAt: opps[2].postedAt,
          opportunityType: opps[2].opportunityType,
        },
        isNew: true,
        computedAt: now - 86400000,
        modelVersion: 'v2',
      },
    ]

    for (const m of matchData) {
      await ctx.db.insert('matches', m)
    }

    // ──────────────────────────────────────────
    // 8. Events (Lu.ma-style synced events for BAISH)
    // ──────────────────────────────────────────
    const eventData = [
      {
        orgId: baishId,
        lumaEventId: 'seed-evt-001',
        title: 'AGISF Reading Group - Week 8: Governance',
        description:
          'This week we discuss AI governance frameworks and international coordination approaches. Required reading: Dafoe (2020) "AI Governance: A Research Agenda".',
        startAt: now + 86400000 * 3 + 3600000 * 18, // 3 days from now, 6pm
        endAt: now + 86400000 * 3 + 3600000 * 20,
        timezone: 'America/Argentina/Buenos_Aires',
        url: 'https://lu.ma/baish-agisf-w8',
        location: 'BAISH Lab, Av. Corrientes 1234',
        isVirtual: false,
        syncedAt: now,
      },
      {
        orgId: baishId,
        lumaEventId: 'seed-evt-002',
        title: 'Monthly Research Presentations',
        description:
          'Three 15-minute presentations from BAISH researchers, followed by Q&A and networking. This month: interpretability tools, red teaming techniques, and RLHF experiments.',
        startAt: now + 86400000 * 10 + 3600000 * 17,
        endAt: now + 86400000 * 10 + 3600000 * 20,
        timezone: 'America/Argentina/Buenos_Aires',
        url: 'https://lu.ma/baish-monthly-march',
        location: 'BAISH Lab, Av. Corrientes 1234',
        isVirtual: false,
        syncedAt: now,
      },
      {
        orgId: baishId,
        lumaEventId: 'seed-evt-003',
        title: 'Alignment Tea Time (Virtual)',
        description:
          'Casual weekly hangout to discuss recent AI safety papers and news. Bring your own tea!',
        startAt: now + 86400000 * 1 + 3600000 * 15,
        endAt: now + 86400000 * 1 + 3600000 * 16,
        timezone: 'America/Argentina/Buenos_Aires',
        url: 'https://lu.ma/baish-teatime',
        isVirtual: true,
        syncedAt: now,
      },
      {
        orgId: apartId,
        lumaEventId: 'seed-evt-004',
        title: 'Alignment Hackathon: Interpretability Challenge',
        description:
          'A weekend hackathon focused on building interpretability tools. Teams compete to develop the most useful tool for understanding transformer internals.',
        startAt: now + 86400000 * 14 + 3600000 * 9,
        endAt: now + 86400000 * 16 + 3600000 * 18,
        timezone: 'Europe/London',
        url: 'https://lu.ma/apart-interp-hack',
        isVirtual: true,
        syncedAt: now,
      },
    ]

    const eventIds: Array<any> = []
    for (const evt of eventData) {
      const id = await ctx.db.insert('events', evt)
      eventIds.push(id)
    }

    // ──────────────────────────────────────────
    // 9. Attendance records for past events
    // ──────────────────────────────────────────
    // Simulate a past event with attendance
    const pastEventId = await ctx.db.insert('events', {
      orgId: baishId,
      lumaEventId: 'seed-evt-past-001',
      title: 'AGISF Reading Group - Week 7: Interpretability',
      description:
        'Discussion of transformer circuits and feature visualization.',
      startAt: now - 86400000 * 4 + 3600000 * 18,
      endAt: now - 86400000 * 4 + 3600000 * 20,
      timezone: 'America/Argentina/Buenos_Aires',
      url: 'https://lu.ma/baish-agisf-w7',
      location: 'BAISH Lab',
      isVirtual: false,
      syncedAt: now - 86400000 * 4,
    })

    const attendees = [
      'user_seed_001',
      'user_seed_003',
      'user_seed_005',
      'user_seed_008',
      'user_seed_010',
    ]
    for (const userId of attendees) {
      await ctx.db.insert('attendance', {
        userId,
        eventId: pastEventId,
        orgId: baishId,
        status: 'attended',
        respondedAt: now - 86400000 * 3,
        showOnProfile: true,
        showToOtherOrgs: false,
        createdAt: now - 86400000 * 4,
        updatedAt: now - 86400000 * 3,
      })
    }

    // ──────────────────────────────────────────
    // 10. Programs
    // ──────────────────────────────────────────
    const agisfProgramId = await ctx.db.insert('programs', {
      orgId: baishId,
      name: 'AGISF Fundamentals',
      slug: 'agisf-fundamentals',
      description:
        'An 8-week curriculum covering the fundamentals of AI safety, based on the AGI Safety Fundamentals course.',
      type: 'reading_group',
      startDate: new Date('2026-01-15').getTime(),
      endDate: new Date('2026-03-15').getTime(),
      status: 'active',
      enrollmentMethod: 'approval_required',
      maxParticipants: 15,
      completionCriteria: {
        type: 'attendance_percentage' as const,
        requiredPercentage: 75,
      },
      createdBy: membershipIds[`user_seed_010_${baishId}`],
      createdAt: now - 86400000 * 50,
      updatedAt: now - 86400000 * 5,
    })

    // Program participants
    const programParticipants = [
      { userId: 'user_seed_003', status: 'enrolled' as const },
      { userId: 'user_seed_008', status: 'enrolled' as const },
      { userId: 'user_seed_005', status: 'enrolled' as const },
    ]
    for (const pp of programParticipants) {
      await ctx.db.insert('programParticipation', {
        programId: agisfProgramId,
        userId: pp.userId,
        orgId: baishId,
        status: pp.status,
        enrolledAt: now - 86400000 * 45,
      })
    }

    // ──────────────────────────────────────────
    // 11. Career Actions (for María)
    // ──────────────────────────────────────────
    const careerActions = [
      {
        profileId: profileIds['user_seed_001'],
        type: 'develop_skills' as const,
        title: 'Deepen understanding of superposition in transformers',
        description:
          'Read and implement key results from "Toy Models of Superposition" paper. Try reproducing results with small transformers.',
        rationale:
          'Your interpretability focus + DeepMind experience positions you well, but hands-on superposition work would strengthen Anthropic application.',
        profileBasis: ['skills:Interpretability', 'work:Google DeepMind'],
        status: 'in_progress' as const,
        generatedAt: now - 86400000 * 7,
        startedAt: now - 86400000 * 3,
        modelVersion: 'v2',
      },
      {
        profileId: profileIds['user_seed_001'],
        type: 'collaborate' as const,
        title: 'Co-author paper with BAISH red teaming group',
        description:
          'Combine your interpretability tools with Lucas\'s red teaming framework to publish on "interpretability-guided red teaming".',
        rationale:
          'Cross-pollinating your interpretability expertise with the red teaming group creates unique research output.',
        profileBasis: [
          'skills:Interpretability',
          'org:BAISH',
          'colleague:user_seed_005',
        ],
        status: 'active' as const,
        generatedAt: now - 86400000 * 5,
        modelVersion: 'v2',
      },
    ]

    for (const ca of careerActions) {
      await ctx.db.insert('careerActions', ca)
    }

    // ──────────────────────────────────────────
    // 12. Org Opportunities (BAISH-created)
    // ──────────────────────────────────────────
    const baishFellowshipId = await ctx.db.insert('orgOpportunities', {
      orgId: baishId,
      title: 'BAISH Summer Research Fellowship 2026',
      description:
        'A 3-month fellowship for early-career researchers to work on AI safety projects at BAISH. Includes mentorship, workspace, and a stipend.',
      type: 'fellowship',
      status: 'active',
      deadline: now + 86400000 * 40,
      featured: true,
      formFields: [
        {
          id: 'motivation',
          type: 'textarea',
          label: 'Why are you interested in AI safety research?',
          required: true,
        },
        {
          id: 'project',
          type: 'textarea',
          label: 'Describe a research project you would like to pursue',
          required: true,
        },
        {
          id: 'availability',
          type: 'select',
          label: 'When can you start?',
          options: ['June 2026', 'July 2026', 'August 2026'],
          required: true,
        },
      ],
      createdAt: now - 86400000 * 14,
      updatedAt: now - 86400000 * 14,
    })

    // A couple of applications
    await ctx.db.insert('opportunityApplications', {
      opportunityId: baishFellowshipId,
      orgId: baishId,
      userId: 'user_seed_006',
      profileId: profileIds['user_seed_006'],
      status: 'submitted',
      responses: {
        motivation:
          'I want to apply formal verification methods to neural network safety guarantees, and BAISH offers the perfect collaborative environment.',
        project:
          'Developing a lightweight formal verification framework for transformer safety properties.',
        availability: 'July 2026',
      },
      submittedAt: now - 86400000 * 2,
    })

    await ctx.db.insert('opportunityApplications', {
      opportunityId: baishFellowshipId,
      orgId: baishId,
      userId: 'user_seed_009',
      profileId: profileIds['user_seed_009'],
      status: 'under_review',
      responses: {
        motivation:
          'My work at Anthropic on safety evaluations has shown me gaps in how we test models. I want to develop more comprehensive evaluation suites in a research-focused setting.',
        project:
          'Building an open-source toolkit for multilingual AI safety evaluation.',
        availability: 'June 2026',
      },
      submittedAt: now - 86400000 * 5,
      reviewedAt: now - 86400000 * 1,
      reviewNotes:
        'Strong candidate — Anthropic background is excellent. Schedule interview.',
    })

    // ──────────────────────────────────────────
    // 13. Member Engagement (BAISH members)
    // ──────────────────────────────────────────
    const engagementData = [
      {
        userId: 'user_seed_001',
        orgId: baishId,
        level: 'highly_engaged' as const,
        adminExplanation:
          'Research lead, attends most events, active in coworking space 4+ days/week.',
        userExplanation:
          "You're a core part of the BAISH community! Keep up the great work.",
        signals: {
          eventsAttended90d: 8,
          lastAttendedAt: now - 86400000 * 4,
          rsvpCount90d: 10,
          profileUpdatedAt: now - 86400000 * 2,
          joinedAt: now - 86400000 * 180,
        },
        computedAt: now - 86400000,
        modelVersion: 'v1',
      },
      {
        userId: 'user_seed_003',
        orgId: baishId,
        level: 'moderate' as const,
        adminExplanation:
          'Active in AGISF reading group, attends weekly. Still ramping up broader involvement.',
        userExplanation:
          "You're making great progress with AGISF! Consider joining more community events to deepen your connections.",
        signals: {
          eventsAttended90d: 5,
          lastAttendedAt: now - 86400000 * 4,
          rsvpCount90d: 6,
          profileUpdatedAt: now - 86400000 * 10,
          joinedAt: now - 86400000 * 30,
        },
        computedAt: now - 86400000,
        modelVersion: 'v1',
      },
      {
        userId: 'user_seed_008',
        orgId: baishId,
        level: 'new' as const,
        adminExplanation:
          'Just joined a month ago, enrolled in AGISF. Early signals are positive.',
        userExplanation:
          "Welcome to BAISH! You're off to a good start with the reading group.",
        signals: {
          eventsAttended90d: 2,
          lastAttendedAt: now - 86400000 * 4,
          rsvpCount90d: 3,
          profileUpdatedAt: now - 86400000 * 5,
          joinedAt: now - 86400000 * 30,
        },
        computedAt: now - 86400000,
        modelVersion: 'v1',
      },
    ]

    for (const eng of engagementData) {
      await ctx.db.insert('memberEngagement', eng)
    }

    // ──────────────────────────────────────────
    // 14. Notifications (for María)
    // ──────────────────────────────────────────
    await ctx.db.insert('notifications', {
      userId: 'user_seed_001',
      type: 'event_new',
      eventId: eventIds[0],
      orgId: baishId,
      title: 'New Event: AGISF Reading Group - Week 8',
      body: 'A new event has been posted by Buenos Aires AI Safety Hub.',
      actionUrl: '/events',
      read: false,
      createdAt: now - 3600000,
    })

    await ctx.db.insert('notifications', {
      userId: 'user_seed_001',
      type: 'event_reminder',
      eventId: eventIds[2],
      orgId: baishId,
      title: 'Reminder: Alignment Tea Time tomorrow',
      body: 'Your event starts tomorrow at 3pm.',
      actionUrl: '/events',
      read: true,
      createdAt: now - 86400000,
    })

    // ──────────────────────────────────────────
    // 15. Feedback entries
    // ──────────────────────────────────────────
    await ctx.db.insert('feedback', {
      featureRequests:
        'Would love to see a way to export my profile as a PDF for applications.',
      page: '/profile',
      userId: 'user_seed_003',
      createdAt: now - 86400000 * 10,
    })

    await ctx.db.insert('feedback', {
      bugReports:
        "The coworking space calendar doesn't show weekends correctly.",
      page: '/spaces',
      userId: 'user_seed_005',
      createdAt: now - 86400000 * 3,
    })

    console.log('[seed] Successfully seeded dev database with mock data')
    return {
      success: true,
      message: `Seeded: 4 orgs, 10 profiles, ${memberships.length} memberships, ${opps.length} opportunities, ${matchData.length} matches, ${eventData.length + 1} events, 1 space, 1 program, 2 career actions, 3 engagement records`,
    }
  },
})

/**
 * Clear all seeded data. Run before re-seeding:
 *   lib/seed:clearDevData({})
 *
 * WARNING: This deletes ALL data from core tables. Only use in dev!
 */
export const clearDevData = internalMutation({
  args: {},
  returns: v.object({ success: v.boolean(), message: v.string() }),
  handler: async (ctx) => {
    // Helper to clear a table
    async function clearTable(table: string) {
      const docs = await ctx.db.query(table as any).collect()
      for (const doc of docs) {
        // eslint-disable-next-line @convex-dev/explicit-table-ids
        await ctx.db.delete(doc._id)
      }
      return docs.length
    }

    let totalDeleted = 0
    const tables = [
      'notifications',
      'memberEngagement',
      'engagementOverrideHistory',
      'programParticipation',
      'programs',
      'attendance',
      'scheduledReminders',
      'scheduledAttendancePrompts',
      'eventViews',
      'events',
      'careerActions',
      'matches',
      'opportunities',
      'opportunityApplications',
      'orgOpportunities',
      'availabilityResponses',
      'pollRespondents',
      'availabilityPolls',
      'visitApplicationResponses',
      'spaceBookings',
      'guestProfiles',
      'coworkingSpaces',
      'enrichmentMessages',
      'enrichmentExtractions',
      'agentToolCalls',
      'uploadedDocuments',
      'orgInviteLinks',
      'orgMemberships',
      'orgApplications',
      'profiles',
      'organizations',
      'skillsTaxonomy',
      'feedback',
      'platformAdmins',
    ]

    for (const table of tables) {
      totalDeleted += await clearTable(table)
    }

    console.log(`[seed] Cleared ${totalDeleted} documents from dev database`)
    return {
      success: true,
      message: `Deleted ${totalDeleted} documents across ${tables.length} tables`,
    }
  },
})
