#!/usr/bin/env node
// Requests ASTN's public pages and fails if any of them is broken: not HTTP
// 200, or an HTML body carrying the error boundary's "Something went wrong".
// Used by CI (against the built server, one application link) and by the
// production check (against https://safetytalent.org, every application link).
//
// Usage: node scripts/smoke-pages.mjs <baseUrl> [--all-links] [--json-out <file>]
//
// Application links are resolved at run time from the public Convex queries,
// so new editions are covered and closed ones drop out without edits here.
// Env: CONVEX_URL overrides the deployment they are read from (default: the
// production one, whose URL is public, it ships in the client bundle).

import { writeFileSync } from 'node:fs'

const CONVEX_URL =
  process.env.CONVEX_URL ?? 'https://brainy-civet-624.convex.cloud'
const STATIC_PATHS = ['/', '/orgs', '/org/baish', '/opportunities']
const ERROR_MARKER = 'Something went wrong'
const ATTEMPTS = 2
const TIMEOUT_MS = 30_000

const args = process.argv.slice(2)
const baseUrl = args.find((a) => !a.startsWith('--') && a !== jsonOut())
const allLinks = args.includes('--all-links')

function jsonOut() {
  const i = args.indexOf('--json-out')
  return i === -1 ? undefined : args[i + 1]
}

if (!baseUrl) {
  console.error(
    'Usage: node scripts/smoke-pages.mjs <baseUrl> [--all-links] [--json-out <file>]',
  )
  process.exit(2)
}

async function convexQuery(path, queryArgs) {
  const res = await fetch(`${CONVEX_URL}/api/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, args: queryArgs, format: 'json' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const body = await res.json()
  if (body.status !== 'success') {
    throw new Error(`Convex ${path} failed: ${body.errorMessage ?? res.status}`)
  }
  return body.value
}

// Paths of the application links of every active opportunity of every org.
async function applicationPaths() {
  const orgs = await convexQuery('organizations:listOrganizations', {})
  const paths = []
  for (const org of orgs) {
    const opportunities = await convexQuery('orgOpportunities:listByOrg', {
      orgId: org._id,
    })
    for (const opp of opportunities) {
      paths.push(`/org/${org.slug}/apply/${opp.slug ?? opp._id}`)
    }
  }
  return paths
}

async function checkOnce(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const html = await res.text()
    if (res.status !== 200)
      return { status: res.status, reason: `HTTP ${res.status}` }
    if (html.includes(ERROR_MARKER)) {
      return { status: res.status, reason: `HTML contains "${ERROR_MARKER}"` }
    }
    return { status: res.status }
  } catch (error) {
    return { status: 0, reason: `request failed: ${error.message}` }
  }
}

async function check(url) {
  let result
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    result = await checkOnce(url)
    if (!result.reason) break
    if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, 2000))
  }
  return { url, ...result }
}

const paths = [...STATIC_PATHS]
const links = await applicationPaths()
if (links.length === 0) {
  console.warn(
    'WARNING: no active opportunity found, no application link checked',
  )
}
paths.push(...(allLinks ? links : links.slice(0, 1)))

const results = []
for (const path of paths) {
  const result = await check(new URL(path, baseUrl).href)
  results.push(result)
  console.log(
    `${result.reason ? 'FAIL' : 'ok  '} ${result.status} ${result.url}${result.reason ? `  (${result.reason})` : ''}`,
  )
}

const failures = results.filter((r) => r.reason)
console.log(
  `\n${results.length} pages checked (${allLinks ? links.length : Math.min(links.length, 1)} application links), ${failures.length} failed`,
)
if (jsonOut()) {
  writeFileSync(
    jsonOut(),
    JSON.stringify({ checked: results.length, failures }, null, 2),
  )
}
process.exit(failures.length ? 1 : 0)
