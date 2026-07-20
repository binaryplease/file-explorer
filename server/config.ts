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
  // Whether the served root is a security boundary or just the tree's starting
  // anchor. Off by default: the explorer is a local-only loopback tool running
  // with the user's own filesystem privileges, so confining it to one subtree
  // buys nothing and costs a `realpath()` per resolved symlink plus the ability
  // to browse anywhere (decision 2026-07-20). Set EXPLORER_CONFINE=true for any
  // surface where the root must actually hold.
  EXPLORER_CONFINE: z
    .stringbool()
    .default(false)
    .describe('Refuse paths that escape EXPLORER_ROOT, lexically or through a symlink.'),
})

export type Config = z.infer<typeof EnvironmentSchema>

export const config: Config = EnvironmentSchema.parse({
  PORT: process.env.PORT,
  HOST: process.env.HOST,
  NODE_ENV: process.env.NODE_ENV,
  // First positional argument wins (`bun server/index.ts ~/projects`), then the
  // environment, then the schema default (home directory).
  EXPLORER_ROOT: process.argv[2] || process.env.EXPLORER_ROOT || undefined,
  EXPLORER_CONFINE: process.env.EXPLORER_CONFINE || undefined,
})

export const isDev = config.NODE_ENV !== 'production'
