import { z } from 'zod/v4'

// ADR-0020: GET /api returns this discovery document with absolute URLs.
export const DiscoveryDocSchema = z.object({
  name: z.string().describe('Service name (matches `package.json#name`).'),
  version: z.string().describe('Service version.'),
  docs: z.url().describe('Absolute URL to the human-readable API documentation page.'),
  openapi: z.url().describe('Absolute URL to the OpenAPI 3.x document as JSON.'),
  health: z.url().describe('Absolute URL to the liveness probe.'),
})
export type DiscoveryDoc = z.infer<typeof DiscoveryDocSchema>

export const HealthResponseSchema = z.object({
  ok: z.literal(true).describe('Always `true` when the server is reachable.'),
})
export type HealthResponse = z.infer<typeof HealthResponseSchema>
