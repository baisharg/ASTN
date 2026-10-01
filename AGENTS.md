# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Safety Talent Network (ASTN) - A career command center for AI safety talent. Users maintain profiles and get matched to opportunities. Initial pilot targets BAISH (Buenos Aires AI Safety Hub) with 50-100 profiles. Live at app.baish.com.ar (safetytalent.org redirects there) with ~40 users.

## Development Commands

```bash
# Start dev (runs Convex + Vite concurrently)
bun run dev

# Run only the web frontend
bun run dev:web

# Run only Convex backend
bun run dev:convex

# Type check and lint
bun run lint

# Format code
bun run format

# Build for production
bun run build
```

## Architecture

### Frontend Stack

- **TanStack Start** with file-based routing in `src/routes/`
- **TanStack Router + Query** integrated with Convex for data fetching
- **React 19** with React Compiler enabled (via babel-plugin-react-compiler)
- **shadcn/ui** (new-york style) with Tailwind v4
- Path alias: `~/` maps to `src/`

### Backend Stack

- **Convex** for database, real-time sync, and serverless functions
- **Clerk** for authentication (GitHub, Google, Email+Password) via `@clerk/clerk-react` + `convex/react-clerk`
- **Claude API** + Gemini + Kimi for LLM features

### Key Patterns

**Convex Actions with Node.js**: Files using external APIs (like Claude) require `"use node"` at the top.

**Internal vs Public Functions**: Use `internal` from `_generated/api` for functions that should only be called by other Convex functions, not the client.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.

<!-- convex-ai-end -->
