#!/usr/bin/env bun
import { randomBytes } from 'crypto'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// Load .env.local from project root
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '../.env.local')
const envFile = Bun.file(envPath)
if (await envFile.exists()) {
  for (const line of (await envFile.text()).split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim()
    }
  }
}

// Parse --org flag (required)
const orgFlag = process.argv.find((arg) => arg.startsWith('--org='))
const orgSlug = orgFlag?.split('=')[1]

if (!orgSlug) {
  console.error('Error: --org=<slug> flag is required')
  console.error(
    'Usage: bun run cli.ts --org=my-org-slug [--program=<programId>]',
  )
  process.exit(1)
}

// Parse --program flag (optional — enables facilitator mode)
const programFlag = process.argv.find((arg) => arg.startsWith('--program='))
const programId = programFlag?.split('=')[1]

const token = randomBytes(32).toString('base64url')
process.env.AGENT_TOKEN = token
process.env.ORG_SLUG = orgSlug

if (programId) {
  process.env.FACILITATOR_PROGRAM_ID = programId
  console.log('ASTN facilitator agent starting...')
  console.log(`Organization: ${orgSlug}`)
  console.log(`Program: ${programId}`)
  console.log(`WebSocket: ws://localhost:3003`)
} else {
  console.log('ASTN admin agent starting...')
  console.log(`Organization: ${orgSlug}`)
  console.log(`WebSocket: ws://localhost:3002`)
}
console.log()

// Open browser with token in hash (never sent to server)
const appUrl = process.env.APP_URL ?? 'https://app.baish.com.ar'
const targetUrl = programId
  ? `${appUrl}/org/${orgSlug}/admin/programs/${programId}#agent=${token}`
  : `${appUrl}/org/${orgSlug}/admin#agent=${token}`

console.log(`Opening ${targetUrl}`)
const open = await import('open')
await open.default(targetUrl)

console.log('Agent ready. Waiting for connections...')
console.log('Press Ctrl+C to stop.')

// Start the WebSocket server
await import('./server')
