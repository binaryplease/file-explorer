import { join, resolve } from 'node:path'
import { Elysia } from 'elysia'
import { openapi } from '@elysiajs/openapi'
import { z } from 'zod/v4'
import { additionalAllowedHosts, config, isDev } from './config'
import { createTrustedHostGuard } from './services/trusted-host'
import { createBindExposurePolicy } from './services/bind-exposure'
import { DiscoveryDocSchema, HealthResponseSchema } from './routes/discovery.schema'
import { createFilesystemRoutes } from './routes/filesystem'
import { createPreviewRoutes } from './routes/preview'
import { filesystemService, previewService } from './services/instances'

const SERVICE_NAME = 'binp-file-explorer'
const SERVICE_VERSION = '0.1.0'

// Per ADR-0020, discovery URLs must be absolute. Honour the forwarded-* headers
// Caddy/Vite set so the URLs match the public origin; otherwise fall back to the
// request's own Host.
function publicOrigin(request: Request): string {
  const url = new URL(request.url)
  const forwardedProto = request.headers.get('x-forwarded-proto')
  const forwardedHost = request.headers.get('x-forwarded-host')
  const proto = forwardedProto?.split(',')[0]?.trim() || url.protocol.replace(':', '')
  const host = forwardedHost?.split(',')[0]?.trim() || request.headers.get('host') || url.host
  return `${proto}://${host}`
}

const trustedHostGuard = createTrustedHostGuard({ additionalAllowedHosts })

const app = new Elysia()
  // Answer only for the names this server is actually reachable under. Runs
  // before routing, so it covers every endpoint including the static client —
  // a rebound origin must not get a single byte. See services/trusted-host.ts
  // for why this, and not path confinement, is the control that matters here.
  .onRequest(({ request, set }) => {
    if (trustedHostGuard.isTrusted(request.headers.get('host'))) return
    set.status = 421
    return {
      error:
        'refusing to answer for this Host. binp-file-explorer serves loopback origins only; ' +
        'set EXPLORER_ALLOWED_HOSTS to serve another name deliberately.',
    }
  })
  // ADR-0020: human docs at /api/docs, machine spec at /api/openapi.json.
  .use(
    openapi({
      path: '/api/docs',
      specPath: '/api/openapi.json',
      // The plugin embeds `specPath` minus its leading `/`, which would resolve
      // to `/api/api/openapi.json` from `/api/docs`. Pin the absolute path.
      scalar: { url: '/api/openapi.json' },
      // Zod v4 ships its own JSON-Schema converter; wire it in explicitly.
      mapJsonSchema: { zod: z.toJSONSchema },
      documentation: {
        info: {
          title: 'File Explorer API',
          version: SERVICE_VERSION,
          description:
            'A high-speed Bun file explorer. Browse a served filesystem.\n\n' +
            'Discovery entrypoint: `GET /api` (ADR-0020).',
        },
        tags: [
          { name: 'system', description: 'Discovery, liveness, and metadata endpoints.' },
          { name: 'filesystem', description: 'Browsing the served filesystem.' },
        ],
      },
    }),
  )
  // ADR-0020 §3: GET /api returns the discovery document. Always JSON, never a
  // redirect to /api/docs. URLs must be absolute.
  .get(
    '/api',
    ({ request }) => {
      const origin = publicOrigin(request)
      return {
        name: SERVICE_NAME,
        version: SERVICE_VERSION,
        docs: `${origin}/api/docs`,
        openapi: `${origin}/api/openapi.json`,
        health: `${origin}/api/health`,
      }
    },
    {
      response: { 200: DiscoveryDocSchema },
      detail: {
        tags: ['system'],
        summary: 'API discovery',
        description:
          'Canonical discovery entrypoint per ADR-0020. Returns a JSON document naming the docs, OpenAPI spec, and liveness probe. No auth required.',
      },
    },
  )
  .get('/api/health', () => ({ ok: true }) as const, {
    response: { 200: HealthResponseSchema },
    detail: {
      tags: ['system'],
      summary: 'Liveness probe',
      description: 'Returns `{ ok: true }` when the server is up. No auth required.',
    },
  })
  .use(createFilesystemRoutes({ filesystemService }))
  .use(createPreviewRoutes({ previewService }))

// In production the built client is served from dist/client (this file runs as
// dist/server/index.js, so the client sits one directory over). In dev, Vite
// serves it on :5173 and proxies /api here.
if (!isDev) {
  const clientDirectory = resolve(import.meta.dir, '../client')
  app.get('/*', async ({ request }) => {
    const requestedPathname = decodeURIComponent(new URL(request.url).pathname)
    const candidatePath = resolve(clientDirectory, `.${requestedPathname}`)
    const isInsideClientDirectory =
      candidatePath === clientDirectory || candidatePath.startsWith(`${clientDirectory}/`)
    if (isInsideClientDirectory) {
      const assetFile = Bun.file(candidatePath)
      if (await assetFile.exists()) return assetFile
    }
    // SPA fallback: any non-asset path renders the explorer shell.
    return Bun.file(join(clientDirectory, 'index.html'))
  })
}

// ADR-0018: binding a non-loopback address publishes an unauthenticated
// filesystem API, so it is a fatal startup error unless the operator named the
// served hosts. Decided once, here, before we ever bind — never per request.
createBindExposurePolicy().enforce({
  bindHost: config.HOST,
  additionalAllowedHosts,
  isConfined: config.EXPLORER_CONFINE,
})

// ADR-0018: a port conflict is a fatal startup error. Elysia's listen surfaces
// EADDRINUSE by default — do not swallow it.
app.listen({
  port: config.PORT,
  hostname: config.HOST,
  development: isDev,
})

const localBase = `http://${config.HOST}:${config.PORT}`
console.log(`binp-file-explorer running at ${localBase}`)
console.log(
  `Serving ${config.EXPLORER_ROOT} ` +
    (config.EXPLORER_CONFINE
      ? '(confined: paths escaping the root are refused)'
      : '(unconfined: the root is the starting anchor, not a boundary)'),
)
console.log('Discovery')
console.log(`  docs:      ${localBase}/api/docs`)
console.log(`  openapi:   ${localBase}/api/openapi.json`)
console.log(`  discovery: ${localBase}/api`)
