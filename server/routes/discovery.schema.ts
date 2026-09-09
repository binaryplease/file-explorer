import { z } from 'zod/v4'

// `discovery-routes`: GET /api returns this document, with absolute URLs.
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

// The operational snapshot the CLI's `daemon-lifecycle` status view renders.
// Every field carries a default (`zod-defaults`) and is emitted even when
// nullish (`emit-nullish`), so a consumer always sees the full shape.
export const StatusResponseSchema = z.object({
  name: z.string().default('binp-file-explorer').describe('Service name.'),
  version: z.string().default('0.0.0').describe('Service version.'),
  pid: z.number().int().default(0).describe('Process id of the running server.'),
  uptimeSeconds: z
    .number()
    .default(0)
    .describe('Seconds since this server process began listening.'),
  startedAt: z
    .string()
    .default('')
    .describe('ISO-8601 timestamp of when this server process started, or "" if unknown.'),
  host: z.string().default('').describe('Bind address the server is listening on.'),
  port: z.number().int().default(0).describe('Port the server is listening on.'),
  root: z.string().default('').describe('Absolute path of the served root (the tree anchor).'),
  confined: z
    .boolean()
    .default(false)
    .describe('Whether the served root is a boundary (true) or only a starting anchor (false).'),
})
export type StatusResponse = z.infer<typeof StatusResponseSchema>
