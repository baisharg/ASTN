# AI Safety Talent Network (ASTN)

A career command center for AI safety talent. Users maintain living profiles, receive AI-powered opportunity matching with fit explanations, and get personalized career recommendations.

Live at [app.baish.com.ar](https://app.baish.com.ar) (formerly safetytalent.org, which redirects there).

## What it does

ASTN connects three groups: **individuals** pursuing AI safety careers, **local organizations** (like BAISH) managing their communities, and **opportunity posters** looking for matched candidates.

- **Smart matching** — A two-tier LLM matching engine scores opportunities against user profiles, organized into Great / Good / Exploring tiers with explanations of why each opportunity fits
- **AI career advisor** — A persistent sidebar agent that helps with profile building, opportunity discovery, and career guidance
- **Conversational profile building** — Users can build their profile through natural conversation or by uploading a CV, instead of filling out forms
- **Opportunity aggregation** — Automatically scrapes aisafety.com job boards daily, plus supports manually posted org opportunities
- **Organization dashboards** — Member directory, engagement scoring, event tracking (Lu.ma sync), program management, and coworking space booking
- **Personalized career actions** — LLM-generated next steps tailored to each user's profile and goals

## Tech stack

| Layer      | Technology                                                                             |
| ---------- | -------------------------------------------------------------------------------------- |
| Frontend   | React 19, TanStack Start/Router/Query, Tailwind v4, shadcn/ui                          |
| Backend    | Convex (database, real-time sync, serverless functions)                                |
| Auth       | Clerk (GitHub, Google, Email+Password)                                                 |
| AI         | Claude (career advisor, extraction), Gemini Flash (matching), Kimi K2.5 (conversation) |
| Email      | Resend with React Email templates                                                      |
| Analytics  | PostHog                                                                                |
| Deployment | Vercel                                                                                 |
| Runtime    | Bun                                                                                    |

## Getting started

### Prerequisites

- [Bun](https://bun.sh) installed
- A [Convex](https://convex.dev) account
- A [Clerk](https://clerk.com) application configured with GitHub, Google, and Email+Password providers

### Setup

1. Clone the repo and install dependencies:

```bash
git clone <repo-url>
cd ASTN
vp install
```

2. Create a `.env.local` file with your client-side keys:

```env
VITE_CONVEX_URL=<your convex deployment url>
VITE_CLERK_PUBLISHABLE_KEY=<your clerk publishable key>
```

3. Set server-side environment variables in the [Convex dashboard](https://dashboard.convex.dev):

| Variable                   | Required | Description                                                 |
| -------------------------- | -------- | ----------------------------------------------------------- |
| `ANTHROPIC_API_KEY`        | Yes      | Claude API key for matching, career advisor, and extraction |
| `RESEND_API_KEY`           | Yes      | Resend key for transactional email                          |
| `EIGHTY_K_ALGOLIA_APP_ID`  | No       | 80K Hours job scraping                                      |
| `EIGHTY_K_ALGOLIA_API_KEY` | No       | 80K Hours job scraping                                      |
| `AIRTABLE_TOKEN`           | No       | aisafety.com job board + CRM import                         |
| `AIRTABLE_BASE_ID`         | No       | Airtable base for imports                                   |
| `AIRTABLE_TABLE_NAME`      | No       | Airtable table for imports                                  |

4. Start development:

```bash
bun run dev
```

This runs both the Vite frontend and Convex backend concurrently.

### Other commands

```bash
bun run dev:web       # Frontend only
bun run dev:convex    # Convex backend only
bun run build         # Production build
bun run lint          # Type check + lint
bun run format        # Prettier format
```

## Project structure

```
src/
  routes/           # TanStack file-based routing (all pages)
  components/       # React components organized by feature
    agent-sidebar/  # AI career advisor
    matches/        # Match cards and detail views
    profile/        # Profile editor and upload wizard
    org/            # Organization pages and admin
    ui/             # shadcn/ui primitives
  hooks/            # Shared React hooks
  lib/              # Client utilities

convex/
  schema.ts         # Database schema (all tables + indexes)
  matching/         # Two-tier AI matching engine
  agent/            # Career advisor agent (tools, prompts, threads)
  aggregation/      # Opportunity scrapers (80K Hours, aisafety.com)
  enrichment/       # Profile extraction from CV and conversation
  engagement/       # LLM engagement scoring
  emails/           # React Email templates + send logic
  careerActions/    # Personalized career step generation
  crons.ts          # Scheduled jobs (sync, emails, engagement)
```

## Key routes

| Path               | Description                                    |
| ------------------ | ---------------------------------------------- |
| `/`                | Dashboard with matches, career actions, events |
| `/profile/edit`    | Profile editor                                 |
| `/matches`         | Opportunity matches by fit tier                |
| `/opportunities`   | Browse all opportunities                       |
| `/orgs`            | Organization directory with map                |
| `/org/:slug/admin` | Org admin dashboard                            |
| `/admin`           | Platform admin                                 |

## License

[AGPL-3.0](LICENSE)
