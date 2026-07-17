import { homedir } from 'node:os'
import { z } from 'zod/v4'

// Boundary validation of the process environment (ADR-0013). Parsed once at
// startup; a malformed env fails loud here rather than deep in a request path.
const EnvironmentSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  // Loopback by default even in prod — Caddy on the same host is the only thing
  // that should reach this process. Set HOST=0.0.0.0 to expose it directly.
  HOST: z.string().default('127.0.0.1'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Directory served by the explorer. Defaults to the home directory of the
  // user running the server; set it (or pass a positional CLI argument) to open
  // the explorer at a specific location instead.
  EXPLORER_ROOT: z.string().min(1).default(homedir()),
  // The zink instance this explorer publishes to (publish-to-zink feature).
  ZINK_BASE_URL: z.url().default('http://localhost:3000'),
  // Operator's `ZINK_DEPLOY_KEY`, sent as `x-deploy-key` when the target zink
  // gates uploads. Null in open mode.
  ZINK_DEPLOY_KEY: z.string().min(1).nullable().default(null),
})

export type Config = z.infer<typeof EnvironmentSchema>

export const config: Config = EnvironmentSchema.parse({
  PORT: process.env.PORT,
  HOST: process.env.HOST,
  NODE_ENV: process.env.NODE_ENV,
  // First positional argument wins (`bun server/index.ts ~/projects`), then the
  // environment, then the schema default (home directory).
  EXPLORER_ROOT: process.argv[2] || process.env.EXPLORER_ROOT || undefined,
  ZINK_BASE_URL: process.env.ZINK_BASE_URL,
  ZINK_DEPLOY_KEY: process.env.ZINK_DEPLOY_KEY || null,
})

export const isDev = config.NODE_ENV !== 'production'
