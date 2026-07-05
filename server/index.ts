import { Elysia } from 'elysia'
import { openapi } from '@elysiajs/openapi'
import { z } from 'zod/v4'
import { config, isDev } from './config'
import { DiscoveryDocSchema, HealthResponseSchema } from './routes/discovery.schema'

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

const app = new Elysia()
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
            'A high-speed Bun file explorer. Browse a served filesystem and publish any HTML file or folder to zink (= ZIP + LINK) for an instant share link.\n\n' +
            'Discovery entrypoint: `GET /api` (ADR-0020).',
        },
        tags: [{ name: 'system', description: 'Discovery, liveness, and metadata endpoints.' }],
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

// In production the built client is served from dist/client (added by the
// developer alongside the explorer UI). In dev, Vite serves it on :5173 and
// proxies /api here.

// ADR-0018: a port conflict is a fatal startup error. Elysia's listen surfaces
// EADDRINUSE by default — do not swallow it.
app.listen({
  port: config.PORT,
  hostname: config.HOST,
  development: isDev,
})

const localBase = `http://${config.HOST}:${config.PORT}`
console.log(`binp-file-explorer running at ${localBase}`)
console.log('Discovery')
console.log(`  docs:      ${localBase}/api/docs`)
console.log(`  openapi:   ${localBase}/api/openapi.json`)
console.log(`  discovery: ${localBase}/api`)
