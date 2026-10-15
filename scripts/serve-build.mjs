#!/usr/bin/env node
// Serves the server-rendered output of `vp build` (nitro "vercel" preset) on
// a local port, so scripts/smoke-pages.mjs can request pages the way a browser
// would. Only the SSR handler is served, not the static assets: the smoke test
// looks at the HTML, not at the client bundle.
//
// `npx srvx` is what nitro's build log suggests, but its request wrapper breaks
// this build (every page returns 500 with "Cannot destructure property 'req'
// of 'this.runtime.node'"), so this uses plain node:http instead.
//
// Usage: node scripts/serve-build.mjs [port]   (default 3000)

import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const port = Number(process.argv[2] ?? 3000)
const entry = resolve('.vercel/output/functions/__server.func/index.mjs')
const { default: handler } = await import(pathToFileURL(entry).href)

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue
      for (const v of Array.isArray(value) ? value : [value]) {
        headers.append(key, v)
      }
    }
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
    const request = new Request(url, {
      method: req.method,
      headers,
      body: hasBody ? Readable.toWeb(req) : undefined,
      duplex: hasBody ? 'half' : undefined,
    })
    const response = await handler.fetch(request)
    res.writeHead(
      response.status,
      Object.fromEntries(
        [...response.headers].filter(([k]) => k !== 'set-cookie'),
      ),
    )
    if (response.body) Readable.fromWeb(response.body).pipe(res)
    else res.end()
  } catch (error) {
    console.error(error)
    res.writeHead(500).end('Server error')
  }
}).listen(port, () => console.log(`Serving build on http://localhost:${port}`))
