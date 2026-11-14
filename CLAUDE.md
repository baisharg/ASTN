# CLAUDE.md

ASTN (AI Safety Talent Network) is live at safetytalent.org. Orgs like BAISH use it to run their courses: opportunities with application forms, decision emails, availability polls and feedback surveys. Individuals keep a profile and get matched to opportunities. Real applicants use it every day, so treat `main` as production.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before shipping anything: it covers how a change reaches production and which areas need extra care.

## Commands

```bash
pnpm install                 # the only package manager; never bun install / npm install
bun run dev                  # your own Convex dev deployment + the site
vp check --no-fmt            # fast frontend lint + types
pnpm run lint && pnpm run lint:convex
pnpm exec tsc -p convex/tsconfig.json --noEmit
bun test src convex
vp build
npx convex codegen           # after adding a file under convex/
```

Bun only runs scripts and tests. `vp` (Vite+) wraps Vite, Oxlint and Oxfmt: use `vp dev`, `vp build`, `vp lint`, `vp fmt`, never the underlying tools. The commit hook runs `vp staged`; don't skip it.

If a tool fails for reasons unrelated to the code (e.g. "Failed to convert napi value into rust type `bool`", `MISSING_EXPORT` from `@tanstack/router-core`), the installed packages are mixed: `rm -rf node_modules && pnpm install`.

## Deploy

- Pushing to `main` deploys: Vercel updates Convex first, then the frontend. CI (`.github/workflows/ci.yml`) runs in parallel and does not block the release, so wait for it.
- Preview deployments have no backend of their own.
- Never run anything against production (`--prod`, a prod deploy key, writes through the MCP) unless the user explicitly asks for it.

## Stack

- **Frontend:** TanStack Start with file-based routes in `src/routes/`, React 19 with the React Compiler, shadcn/ui on Tailwind v4. `~/` maps to `src/`.
- **Backend:** Convex. Clerk for auth. Resend for email (`convex/emails/`). LLM models are configured in `convex/lib/models.ts`.
- **MCP server:** `convex/mcp/`, admin-only, authenticated with a Clerk OAuth token.

## Domain

- **Opportunities** (`orgOpportunities`) are `draft`, `active` or `closed`. A draft's application link only works for admins and people with course access. Access checks live in `convex/lib/courseAccess.ts`.
- **Courses** are identified by a course tag (`COURSE_TAGS` in `convex/lib/courses.ts`). An **EOI** (expression of interest, `isEOI`) collects interest for a course's next edition; `redirectOpportunityId` points it at the edition that opened.
- **Canonicals** (Admin → Canonicals) are the org's defaults: the course form, the EOI form, the two feedback surveys (`canonicalForms`), the canonical emails (`emailTemplateSets.isCanonical`) and the footer of every email (`organizations.emailFooter`). New opportunities copy them and own the copy: an opportunity's six emails are its `emailTemplates` rows (`convex/emails/templateLibrary.ts`), edited in its Emails tab; editing a canonical changes no existing opportunity. Text may use `{{course}}` and `{{area}}`, filled from the course tag.
- **Forms** (`convex/lib/formFields.ts`): an opportunity's questions can be edited until its first application, then they are locked. Question keys are sanitized there; keep them valid field names.
- **Emails:** a status change only adds a draft to the opportunity's Outbox; someone sends it by hand. Only the application confirmation and poll emails send on their own. Template variables: `{{applicant_name}}`, `{{course}}`, `{{area}}`, and `{{apply_link}}` in broadcasts (a personal, pre-filled link to the course's open application; `convex/applicationInvites.ts`).
- Shared links (apply, poll, survey) must keep working: an opportunity resolves by slug or by id.

## Rules that have broken production before

- Every field added to `orgOpportunities` must also go in `opportunityReturnValidator` (`convex/orgOpportunities.ts`), or admin pages stop loading.
- Changing the shape of existing data takes two releases: widen the schema and migrate (idempotently, after a `convex export` backup), then narrow it.
- React Compiler: initialize component state from props or query results at mount (or in render, guarded by a `loaded` flag). Never set a Radix `Select` value from a `useEffect` after mount; it stays empty.

## Conventions

- Admin UI text is in English. Text applicants read (emails, apply-page messages) is in Spanish (Argentina).
- Comments describe what the code does now. No history, no notes about removed features or past versions.
- Tests are `*.test.ts` files under `src/` (mostly `src/lib/`) and run with `bun test`. They declare `describe`/`test`/`expect` themselves instead of importing `bun:test`, which the type check can't resolve.
- Small conventional commits: `fix(polls): ...`, `feat(forms): ...`, `chore: ...`.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data. `convex/CLAUDE.md` adds this repo's Convex rules.

<!-- convex-ai-end -->
