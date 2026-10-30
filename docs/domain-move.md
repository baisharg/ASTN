# Domain move: safetytalent.org → app.baish.com.ar

Runbook for moving the production app from `safetytalent.org` to
`app.baish.com.ar`, with `safetytalent.org` and `www.safetytalent.org` kept as
permanent (308) redirects to the new host.

|                                  | Before                             | After                                                |
| -------------------------------- | ---------------------------------- | ---------------------------------------------------- |
| App (Vercel project `astn`)      | `https://safetytalent.org`         | `https://app.baish.com.ar`                           |
| Clerk Frontend API               | `clerk.safetytalent.org`           | `clerk.app.baish.com.ar` (see §2.1)                  |
| Clerk Account Portal             | `accounts.safetytalent.org`        | `accounts.app.baish.com.ar`                          |
| Convex (prod `brainy-civet-624`) | `*.convex.cloud` / `*.convex.site` | unchanged                                            |
| Email sender (Resend)            | `notifications@safetytalent.org`   | unchanged until `baish.com.ar` is verified in Resend |

What does **not** change: Convex deployment and URLs, the MCP endpoint
(`https://brainy-civet-624.convex.site/mcp`), `/.well-known/oauth-protected-resource*`
(served by Convex), the Luma webhook (`<convex-site>/luma-webhook`), the
unsubscribe endpoint (`<convex-site>/unsubscribe`), user data. Users are keyed by
the Clerk user id (`identity.subject`, `user_…`), which a Clerk domain change
does not alter, so **no data migration is needed**. Only active sessions and
MCP access tokens are invalidated.

## 0. What the code change does (branch `lucadeleo/app-domain`)

- `convex/lib/siteUrl.ts`: `appUrl()` reads `SITE_URL` (trailing slash
  trimmed), default `https://app.baish.com.ar`. Used for every absolute link and
  the logo in emails (`convex/emails/templates.tsx`), the unsubscribe
  confirmation page, outbox poll/survey links and poll reminder links.
  `emailFrom()` reads `EMAIL_FROM`, default `ASTN <notifications@safetytalent.org>`;
  used by `send.ts`, `outbox.ts`, `adminBroadcast.ts`.
- `src/lib/site-url.ts`: `SITE_URL` from `VITE_SITE_URL`, default
  `https://app.baish.com.ar`, used for `og:url`/`og:image`/`twitter:image` and the
  per-page `og:url` on apply and event pages. Links built in the browser keep
  using `window.location.origin`.
- `vercel.json`: CSP allows both the old and new Clerk hosts; host-based 308
  redirects from `safetytalent.org` and `www.safetytalent.org` to
  `https://app.baish.com.ar/:path*` (query string is passed through).
- `public/robots.txt`, `public/sitemap.xml`, `public/.well-known/security.txt`:
  new host.
- `agent/`: local agent bridge accepts the `https://app.baish.com.ar` origin;
  `APP_URL` default is the new host.

**Do not merge this branch before step 2.5.** Its `vercel.json` redirects send
all `safetytalent.org` traffic to `app.baish.com.ar`, and its URL defaults point
at the new host. Merging it is the cutover deploy.

### Environment variables

| Where             | Name                         | Value at cutover                 | Default if unset                        |
| ----------------- | ---------------------------- | -------------------------------- | --------------------------------------- |
| Convex prod       | `SITE_URL`                   | `https://app.baish.com.ar`       | `https://app.baish.com.ar`              |
| Convex prod       | `CLERK_JWT_ISSUER_DOMAIN`    | `https://clerk.app.baish.com.ar` | none (required)                         |
| Convex prod       | `EMAIL_FROM`                 | leave unset                      | `ASTN <notifications@safetytalent.org>` |
| Vercel Production | `VITE_SITE_URL`              | `https://app.baish.com.ar`       | `https://app.baish.com.ar`              |
| Vercel Production | `VITE_CLERK_PUBLISHABLE_KEY` | new `pk_live_…` from Clerk       | none (required)                         |

`CLERK_SECRET_KEY` does not change.

## 1. Preparation (no user impact; can be done days ahead)

### 1.1 Check current env (Luca, CLI)

```bash
bunx convex env get SITE_URL --prod
bunx convex env get CLERK_JWT_ISSUER_DOMAIN --prod   # expect https://clerk.safetytalent.org
vercel env ls production                             # note VITE_CLERK_PUBLISHABLE_KEY, VITE_SITE_URL
```

If `SITE_URL` is unset, set it explicitly to the current host now, so that
nothing changes until you switch it at cutover:

```bash
bunx convex env set SITE_URL https://safetytalent.org --prod
```

### 1.2 Decide Clerk "Primary" vs "Secondary" application (Luca)

When the new domain is a subdomain, Clerk asks how to scope it
([Change domain](https://clerk.com/docs/guides/development/deployment/changing-domains),
"Subdomain considerations"):

- **Secondary application (recommended)**: app and Clerk both live on
  `app.baish.com.ar`. Clerk hosts are `clerk.app.baish.com.ar` and
  `accounts.app.baish.com.ar`; session cookies are scoped to the subdomain and do
  not touch `baish.com.ar` (the BAISH website).
- Primary application: Clerk stays on the root domain (`clerk.baish.com.ar`,
  `accounts.baish.com.ar`) and cookies cover all of `*.baish.com.ar`.

This runbook assumes **Secondary**. If you choose Primary, before merging
replace `https://clerk.app.baish.com.ar` and `https://accounts.app.baish.com.ar`
in the `vercel.json` CSP with `https://clerk.baish.com.ar` and
`https://accounts.baish.com.ar`, and use `https://clerk.baish.com.ar` for
`CLERK_JWT_ISSUER_DOMAIN`.

### 1.3 Cloudflare DNS for the app (Luca, Cloudflare dashboard, zone `baish.com.ar`)

| Type  | Name  | Target                                                                          | Proxy                     |
| ----- | ----- | ------------------------------------------------------------------------------- | ------------------------- |
| CNAME | `app` | `cname.vercel-dns.com` (or the project-specific value Vercel shows in step 1.4) | **DNS only** (grey cloud) |

Proxying through Cloudflare breaks Vercel certificate issuance and Clerk's DNS
checks; keep every record in this runbook on "DNS only".

If the zone has CAA records, make sure they allow `letsencrypt.org` (Vercel)
and the CAs Clerk uses (check Clerk's DNS docs; at the time of writing `letsencrypt.org` and `pki.goog`). With no CAA records,
nothing to do.

### 1.4 Attach the domain in Vercel (Luca, CLI)

```bash
vercel domains add app.baish.com.ar astn
vercel domains inspect app.baish.com.ar   # wait for "Valid Configuration"
```

`app.baish.com.ar` now serves the current production deployment. Sign-in does
not work there yet (the Clerk instance still belongs to `safetytalent.org`), so
don't share the URL.

### 1.5 Optional: pre-create Clerk's DNS records (shortens the outage)

The Clerk records for the new domain use the same targets as the existing
`safetytalent.org` ones. In Cloudflare (`baish.com.ar`, all **DNS only**), add
the Secondary-application names, copying each target from the matching record
on `safetytalent.org`:

| Name (in zone `baish.com.ar`) | Copy target from                                                 |
| ----------------------------- | ---------------------------------------------------------------- |
| `clerk.app`                   | `clerk.safetytalent.org` (usually `frontend-api.clerk.services`) |
| `accounts.app`                | `accounts.safetytalent.org` (usually `accounts.clerk.services`)  |
| `clkmail.app`                 | `clkmail.safetytalent.org`                                       |
| `clk._domainkey.app`          | `clk._domainkey.safetytalent.org`                                |
| `clk2._domainkey.app`         | `clk2._domainkey.safetytalent.org`                               |

After step 2.1, compare with the list the Clerk dashboard shows and fix any
mismatch; Clerk's list is authoritative.

### 1.6 Other prep

- Social login (Luca): production Clerk uses your own OAuth credentials. Open
  Google Cloud Console (OAuth client) and the GitHub OAuth App now so step 2.3 is
  quick. For Google, add `baish.com.ar` to the consent screen's authorized
  domains and add `https://clerk.app.baish.com.ar/v1/oauth_callback` to the
  OAuth client's authorized redirect URIs ahead of time (Google accepts several;
  keep the old one until cutover is done). GitHub OAuth Apps take a single
  callback URL, so that one has to wait for step 2.3.
- Get the PR for this branch reviewed and approved, ready to merge.
- Tell users: one planned sign-out; the old address keeps working via redirect.

## 2. Cutover (sign-in outage runs from 2.1 until 2.5 is live)

Clerk generates a **new Publishable Key** when the domain changes, and "Failing
to update your Publishable Key will result in Clerk failing to load"
([Clerk: Change domain](https://clerk.com/docs/guides/development/deployment/changing-domains)).
The key encodes the Frontend API host, so the live `safetytalent.org` build
cannot sign anyone in from the moment the domain changes until a build with the
new key is deployed. Do 2.1–2.5 back to back.

### 2.1 Change the Clerk production domain (Luca, Clerk dashboard)

Production instance → **Domains** → **Configure** next to the primary domain →
**Danger zone** → **Change domain** → `app.baish.com.ar` → **Secondary
application**.

Use the dashboard. Clerk also documents a Backend API call
(`POST /v1/instance/change_domain` with `home_url`), but that example doesn't
show how to pick Secondary, so it could leave Clerk on the root domain
(`clerk.baish.com.ar`), which doesn't match the CSP and issuer values here.

Then:

- **API keys** page: copy the new `pk_live_…`. Check: the part after `pk_live_`
  base64-decodes to `clerk.app.baish.com.ar$`.
- **Domains** page: add any DNS records not already created in 1.5, click
  verify, and wait for DNS and SSL to show as issued.
- **Paths** / redirect settings: if any are absolute `safetytalent.org` URLs,
  change them to `app.baish.com.ar`.
- OAuth applications (MCP, dynamic client registration / CIMD settings) are
  instance settings and stay as they are.

All existing sessions end: Clerk states that changing the domain "will
invalidate all current user sessions (i.e. users will be logged out)"
([Clerk: Change domain or subdomain](https://clerk.com/docs/deployments/change-production-domain)).

### 2.2 Convex env (Luca, CLI)

```bash
bunx convex env set CLERK_JWT_ISSUER_DOMAIN https://clerk.app.baish.com.ar --prod
bunx convex env set SITE_URL https://app.baish.com.ar --prod
# EMAIL_FROM: leave unset (defaults to ASTN <notifications@safetytalent.org>)
```

`convex/auth.config.ts` is read when functions are deployed, so the new issuer
applies to app sign-in only after the next `convex deploy` (step 2.5 runs it).
Convex docs: after changing `auth.config.ts` inputs, run `npx convex deploy` for
production ([Convex & Clerk](https://docs.convex.dev/auth/clerk)). The MCP
endpoint reads `CLERK_JWT_ISSUER_DOMAIN` per request, so it switches
immediately. `SITE_URL` is read per call and applies to the next email sent.

### 2.3 Social connections (Luca, Google Cloud Console / GitHub)

In Clerk → **SSO connections** → Google / GitHub, copy the redirect URI shown
(expected `https://clerk.app.baish.com.ar/v1/oauth_callback`) and add it to:

- Google OAuth client → Authorized redirect URIs.
- GitHub OAuth App → Authorization callback URL (GitHub allows one; replace
  the old one). Update the Homepage URL to `https://app.baish.com.ar`.

### 2.4 Vercel env (Luca, CLI)

```bash
vercel env rm VITE_CLERK_PUBLISHABLE_KEY production -y
vercel env add VITE_CLERK_PUBLISHABLE_KEY production    # paste the new pk_live_…
vercel env rm VITE_SITE_URL production -y 2>/dev/null || true
printf 'https://app.baish.com.ar' | vercel env add VITE_SITE_URL production
```

`VITE_*` values are inlined at build time, so they only take effect with the
next build (2.5). Leave Preview/Development env alone (they use the Clerk
development instance).

### 2.5 Deploy (Luca / GitHub)

Merge the `lucadeleo/app-domain` PR into `main`. The production build
(`scripts/vercel-build.sh`) runs `convex deploy` first (pushes `auth.config.ts`
with the new issuer), then builds the frontend with the new `VITE_*` values.

If the branch was merged earlier by mistake, trigger a fresh production build
instead: `vercel --prod` from a clean checkout of `main`, or Redeploy in the
dashboard with the build cache disabled.

### 2.6 Domain-level redirects (Luca, Vercel dashboard)

Project `astn` → Settings → **Domains**:

- `app.baish.com.ar`: no redirect (production domain).
- `safetytalent.org` → **Edit** → Redirect to `app.baish.com.ar`, **308 Permanent Redirect**.
- `www.safetytalent.org` → **Edit** → Redirect to `app.baish.com.ar`, **308**
  (point it directly at the new host, not via `safetytalent.org`, to avoid a
  double hop).

API alternative (token with access to the team):

```bash
for d in safetytalent.org www.safetytalent.org; do
  curl -sX PATCH "https://api.vercel.com/v9/projects/astn/domains/$d?teamId=$VERCEL_TEAM_ID" \
    -H "Authorization: Bearer $VERCEL_TOKEN" -H 'Content-Type: application/json' \
    -d '{"redirect":"app.baish.com.ar","redirectStatusCode":308}'
done
```

**Why two redirect mechanisms.** The domain-level redirect is the primary one:
it's handled by Vercel's edge before any deployment runs, doesn't depend on
which deployment is live, and survives rollbacks. The `vercel.json` rules
(`has: [{ "type": "host", "value": "safetytalent.org" }]`, and `www`) only fire
if a request for the old host reaches the deployment, i.e. if the dashboard
redirect is missing or removed. With the dashboard redirect in place they never
match, so they don't interfere. Both preserve path and query string.
Nothing Clerk-related is affected: `clerk.*`/`accounts.*` are separate DNS
records pointing at Clerk, not at Vercel. `/.well-known/security.txt` on the old
host redirects to the new one, which is fine; the OAuth metadata under
`/.well-known/` is served by Convex, not Vercel.

Keep `safetytalent.org` (apex and `www`) attached to project `astn` and its DNS
records in place. Also keep the Resend records (SPF, DKIM, return-path MX) on
`safetytalent.org`: emails are still sent from `notifications@safetytalent.org`.

## 3. Verification checklist

```bash
# Redirects keep path and query
curl -sI 'https://safetytalent.org/org/baish/apply/test?utm_source=x' | grep -iE '^(HTTP|location)'
#   → 308, location: https://app.baish.com.ar/org/baish/apply/test?utm_source=x
curl -sI 'https://www.safetytalent.org/login' | grep -iE '^(HTTP|location)'
#   → 308, location: https://app.baish.com.ar/login

# New host serves the app with the new CSP
curl -sI https://app.baish.com.ar | grep -iE '^HTTP|content-security-policy' | grep -o 'HTTP.*\|clerk.app.baish.com.ar' | sort -u

# og tags point at the new host
curl -s https://app.baish.com.ar | grep -o 'og:url" content="[^"]*'

# Clerk issuer
curl -s https://clerk.app.baish.com.ar/.well-known/openid-configuration | jq -r .issuer
#   → https://clerk.app.baish.com.ar

# MCP protected-resource metadata names the new authorization server
curl -s https://brainy-civet-624.convex.site/.well-known/oauth-protected-resource/mcp | jq
#   → resource https://brainy-civet-624.convex.site/mcp (unchanged),
#     authorization_servers ["https://clerk.app.baish.com.ar"]
```

In a browser (private window):

- [ ] Sign in with Google, GitHub and email+password; profile and org admin
      pages load data (proves Convex accepts the new tokens).
- [ ] No CSP errors in the console on sign-in / sign-up / user profile modal.
- [ ] Admin → opportunity → Email → **Send test**: logo loads from
      `app.baish.com.ar`, footer shows `app.baish.com.ar`, sender is still
      `notifications@safetytalent.org`, poll/survey links use the new host.
- [ ] An email unsubscribe link (still on `*.convex.site`) works and its page
      links to `https://app.baish.com.ar/profile?section=privacy`.
- [ ] Copy an invite link / apply link in admin: it uses `app.baish.com.ar`
      (built from `window.location.origin`).
- [ ] MCP: in Claude, the ASTN connector gets a 401 and re-runs OAuth against
      Clerk on the new domain; `list_my_orgs` works afterwards. If the client
      cached the old authorization server, disconnect and reconnect it.
- [ ] Luma webhook: next delivery succeeds (Luma dashboard or
      `bunx convex logs --prod`); nothing changed there.
- [ ] `https://app.baish.com.ar/robots.txt` and `/sitemap.xml` show the new host.
- [ ] Local admin agent (`agent/`): after pulling `main`, the browser at
      `app.baish.com.ar` can connect (origin allowlist updated).

## 4. Rollback

- **Before 2.1**: nothing to undo; optionally `vercel domains rm app.baish.com.ar`.
- **After 2.1**: a Vercel Instant Rollback alone is not enough, because the
  Clerk instance has moved and the old publishable key no longer loads. To go
  back:
  1. Clerk → Domains → Change domain → `safetytalent.org` (this issues another
     publishable key; re-add the redirect URIs from 2.3 for the old host).
  2. `bunx convex env set CLERK_JWT_ISSUER_DOMAIN https://clerk.safetytalent.org --prod`
     and `bunx convex env set SITE_URL https://safetytalent.org --prod`.
  3. Vercel: set `VITE_CLERK_PUBLISHABLE_KEY` to the key from step 1, set
     `VITE_SITE_URL=https://safetytalent.org`, remove the domain redirects on
     `safetytalent.org` / `www.safetytalent.org`.
  4. Revert the merge commit on `main` (removes the `vercel.json` redirects) and
     let the production build run (it re-runs `convex deploy`).

## 5. Later cleanup

- After Resend verifies `baish.com.ar` (add its SPF/DKIM records in Cloudflare):
  `bunx convex env set EMAIL_FROM 'ASTN <notifications@baish.com.ar>' --prod`.
  Keep the `safetytalent.org` Resend records until no mail is sent from it.
- After a few weeks with no traffic on the old Clerk hosts:
  - remove `https://clerk.safetytalent.org` and `https://accounts.safetytalent.org`
    from the CSP in `vercel.json` (script-src, connect-src, frame-src);
  - delete the old Clerk DNS records on `safetytalent.org` (`clerk`, `accounts`,
    `clkmail`, `clk._domainkey`, `clk2._domainkey`);
  - drop `safetytalent\.org` from the origin allowlist in `agent/server.ts`.
- Optional: add `app.baish.com.ar` to PostHog's authorized URLs (toolbar,
  heatmaps) and to any Sentry "Allowed Domains" filter if one is set.
- Keep `safetytalent.org` registered and attached to Vercel for as long as old
  links (emails, posts) might be followed.

## Sources

- Clerk, Change domain: https://clerk.com/docs/guides/development/deployment/changing-domains
- Clerk, Change domain or subdomain (sessions invalidated): https://clerk.com/docs/deployments/change-production-domain
- Clerk, Deploy to production (DNS-only on Cloudflare): https://clerk.com/docs/guides/development/deployment/production
- Convex & Clerk (redeploy after changing auth config): https://docs.convex.dev/auth/clerk
- Vercel, Redirecting domains: https://vercel.com/docs/domains/working-with-domains/deploying-and-redirecting
- Vercel, `vercel.json` redirects (`has`, `permanent` → 308): https://vercel.com/docs/project-configuration/vercel-json#redirects
