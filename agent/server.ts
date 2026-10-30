import { ConvexClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { createAdminAgent, createFacilitatorAgent } from './agent'
import {
  ADMIN_AGENT_WS_PORT,
  FACILITATOR_AGENT_WS_PORT,
} from '../shared/admin-agent/constants'
import type {
  AdminAgentEvent,
  AdminClientMessage,
} from '../shared/admin-agent/types'
import type { Id } from '../convex/_generated/dataModel'

const CONFIRMATION_TIMEOUT_MS = 2 * 60 * 1000 // 2 minutes

const token = process.env.AGENT_TOKEN!
// Facilitator mode — set by CLI when --program flag is provided
const facilitatorProgramId = process.env.FACILITATOR_PROGRAM_ID
const port = facilitatorProgramId
  ? FACILITATOR_AGENT_WS_PORT
  : ADMIN_AGENT_WS_PORT

// Fallback Convex URL from env — browser can override per-connection
const fallbackConvexUrl = process.env.VITE_CONVEX_URL ?? process.env.CONVEX_URL
if (!fallbackConvexUrl) {
  console.warn(
    'No VITE_CONVEX_URL or CONVEX_URL in environment — will require browser to provide convexUrl',
  )
}

// Track per-connection state
type PendingConfirmation = {
  resolve: (approved: boolean) => void
  timeout: ReturnType<typeof setTimeout>
}

type ConnectionState = {
  convex: ConvexClient
  agent: { chat: ReturnType<typeof createAdminAgent>['chat'] }
  orgName: string
  clerkToken: string
  tokenHolder: { current: string }
  pendingConfirmations: Map<string, PendingConfirmation>
  /** Send an event to the browser outside the normal stream flow */
  emit: (event: AdminAgentEvent) => void
}

const connections = new Map<object, ConnectionState>()

Bun.serve({
  port,
  async fetch(req, server) {
    const url = new URL(req.url)
    const clientToken = url.searchParams.get('token')

    if (clientToken !== token) {
      console.log(
        `Auth failed: got "${clientToken?.slice(0, 8)}..." expected "${token.slice(0, 8)}..."`,
      )
      return new Response('Unauthorized', { status: 401 })
    }

    const origin = req.headers.get('origin')
    if (origin && !isAllowedOrigin(origin)) {
      return new Response('Forbidden', { status: 403 })
    }

    const orgSlug = url.searchParams.get('orgSlug')
    const clerkToken = url.searchParams.get('clerkToken')
    // Browser provides its Convex URL to ensure agent connects to same deployment
    const clientConvexUrl = url.searchParams.get('convexUrl')

    if (!orgSlug || !clerkToken) {
      return new Response('Missing orgSlug or clerkToken', { status: 400 })
    }

    const convexUrl = clientConvexUrl || fallbackConvexUrl
    if (!convexUrl) {
      return new Response(
        'No Convex URL — provide convexUrl param or set VITE_CONVEX_URL env',
        { status: 400 },
      )
    }

    server.upgrade(req, {
      data: { orgSlug, clerkToken, convexUrl } as any,
    })
  },
  websocket: {
    async open(ws) {
      const { orgSlug, clerkToken, convexUrl } = ws.data as unknown as {
        orgSlug: string
        clerkToken: string
        convexUrl: string
      }

      try {
        // Create a dedicated ConvexClient for this connection
        const convex = new ConvexClient(convexUrl)

        // Mutable token holder — the setAuth callback reads from this
        const tokenHolder = { current: clerkToken }

        // Set auth once — callback always returns latest token
        convex.setAuth(async () => tokenHolder.current)

        // Wait for auth to propagate to the Convex backend
        console.log(
          `[auth] Verifying Clerk token for org="${orgSlug}" against ${convexUrl}`,
        )
        let authed = false
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 250))
          try {
            const profile = await convex.query(
              api.profiles.getOrCreateProfile,
              {},
            )
            if (profile !== null) {
              authed = true
              console.log(`[auth] Verified on attempt ${i + 1}`)
              break
            }
            // profile === null could mean auth works but no profile, or auth isn't ready
            if (i > 5) {
              console.log(
                `[auth] Attempt ${i + 1}: getOrCreateProfile returned null`,
              )
            }
          } catch (e: any) {
            console.log(
              `[auth] Attempt ${i + 1}: ${e?.message ?? 'unknown error'}`,
            )
          }
        }

        if (!authed) {
          ws.send(
            JSON.stringify({
              type: 'error',
              message:
                'Authentication failed — could not verify Clerk token with Convex',
            }),
          )
          ws.close()
          convex.close()
          return
        }

        // Get the authenticated user's ID for audit logging
        const profile = await convex.query(api.profiles.getOrCreateProfile, {})
        const userId = profile?.userId ?? 'agent'

        // Resolve org by slug
        const org = await convex.query(api.orgs.directory.getOrgBySlug, {
          slug: orgSlug,
        })

        if (!org) {
          ws.send(
            JSON.stringify({
              type: 'error',
              message: `Organization not found: ${orgSlug}`,
            }),
          )
          ws.close()
          return
        }

        const pendingConfirmations = new Map<string, PendingConfirmation>()

        // Emit helper — sends an event directly to the browser WS
        const emit = (event: AdminAgentEvent) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(event))
          }
        }

        let agent: ConnectionState['agent']

        if (facilitatorProgramId) {
          // Facilitator mode — verify program exists and belongs to org
          const program = await convex.query(api.programs.getProgram, {
            programId: facilitatorProgramId as Id<'programs'>,
          })
          if (!program || program.orgId !== org._id) {
            ws.send(
              JSON.stringify({
                type: 'error',
                message: 'Program not found or does not belong to org',
              }),
            )
            ws.close()
            return
          }

          agent = createFacilitatorAgent(
            convex,
            org._id,
            facilitatorProgramId as Id<'programs'>,
            program.name,
            userId,
            emit,
          )

          console.log(
            `Connected (facilitator): org="${org.name}" program="${program.name}" convex=${convexUrl}`,
          )
        } else {
          // Admin mode — standard admin agent
          const requestConfirmation = (confirmId: string): Promise<boolean> => {
            return new Promise<boolean>((resolve) => {
              const timeout = setTimeout(() => {
                pendingConfirmations.delete(confirmId)
                resolve(false) // Timeout = reject
              }, CONFIRMATION_TIMEOUT_MS)

              pendingConfirmations.set(confirmId, { resolve, timeout })
            })
          }

          agent = createAdminAgent(
            convex,
            org._id,
            org.name,
            userId,
            emit,
            requestConfirmation,
          )

          console.log(
            `Connected (admin): org="${org.name}" (${org._id}) convex=${convexUrl}`,
          )
        }

        const state: ConnectionState = {
          convex,
          agent,
          orgName: org.name,
          clerkToken: tokenHolder.current,
          tokenHolder,
          pendingConfirmations,
          emit,
        }

        connections.set(ws, state)
      } catch (e: any) {
        console.error('Connection setup failed:', e)
        ws.send(
          JSON.stringify({
            type: 'error',
            message: `Setup failed: ${e.message}`,
          }),
        )
        ws.close()
      }
    },

    async message(ws, raw) {
      const state = connections.get(ws)
      if (!state) return

      const msg: AdminClientMessage = JSON.parse(raw as string)

      switch (msg.type) {
        case 'chat': {
          try {
            for await (const event of state.agent.chat(
              msg.text,
              msg.model,
              msg.thinking,
            )) {
              ws.send(JSON.stringify(event))
            }
          } catch (e: any) {
            ws.send(
              JSON.stringify({
                type: 'error',
                message: e?.message ?? 'Unknown error',
              }),
            )
          }
          ws.send(JSON.stringify({ type: 'done' }))
          break
        }

        case 'refresh_token': {
          // Update the mutable token ref — the setAuth callback reads from this
          // Don't call setAuth() again as it triggers a re-auth cycle
          state.clerkToken = msg.clerkToken
          state.tokenHolder.current = msg.clerkToken
          console.log('Clerk token refreshed')
          break
        }

        case 'confirm_response': {
          const pending = state.pendingConfirmations.get(msg.confirmId)
          if (pending) {
            clearTimeout(pending.timeout)
            state.pendingConfirmations.delete(msg.confirmId)
            pending.resolve(msg.approved)
            console.log(
              `[confirm] ${msg.confirmId} → ${msg.approved ? 'approved' : 'rejected'}`,
            )
          } else {
            console.log(
              `[confirm] ${msg.confirmId} — no pending confirmation found`,
            )
          }
          break
        }
      }
    },

    close(ws) {
      const state = connections.get(ws)
      if (state) {
        // Reject all pending confirmations on disconnect
        for (const [id, pending] of state.pendingConfirmations) {
          clearTimeout(pending.timeout)
          pending.resolve(false)
          console.log(`[confirm] ${id} — rejected (disconnect)`)
        }
        state.pendingConfirmations.clear()

        state.convex.close()
        connections.delete(ws)
        console.log(`Disconnected: org="${state.orgName}"`)
      }
    },
  },
})

function isAllowedOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost(:\d+)?|app\.baish\.com\.ar|safetytalent\.org)$/.test(
    origin,
  )
}

const mode = facilitatorProgramId ? 'Facilitator' : 'Admin'
console.log(`${mode} agent WebSocket server listening on :${port}`)
