#!/usr/bin/env bash
# Vercel build command (see vercel.json).
# Production: deploy the Convex backend first, then build the frontend against
# it, so a failed backend deploy stops the release. Previews: frontend only.
set -euo pipefail

if [ "${VERCEL_ENV:-}" = "production" ]; then
  pnpm exec convex deploy \
    --cmd 'pnpm run build' \
    --cmd-url-env-var-name VITE_CONVEX_URL
else
  pnpm run build
fi
