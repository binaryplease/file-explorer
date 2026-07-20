import { homedir } from 'node:os'
import { z } from 'zod'

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
  // Extra Host header values to answer for, beyond loopback. Empty by default:
  // the explorer is loopback-only, and answering for any other name is what
  // makes DNS rebinding work. Only the documented `HOST=0.0.0.0`-behind-Caddy
  // deployment needs this, and that operator must name their own domain.
  EXPLORER_ALLOWED_HOSTS: z
    .string()
    .default('')
    .describe('Comma-separated extra Host header values to serve, beyond loopback names.'),
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
  EXPLORER_ALLOWED_HOSTS: process.env.EXPLORER_ALLOWED_HOSTS || undefined,
})

// Parsed once here rather than re-split per request.
export const additionalAllowedHosts = config.EXPLORER_ALLOWED_HOSTS.split(',')
  .map((allowedHost) => allowedHost.trim())
  .filter((allowedHost) => allowedHost !== '')

export const isDev = config.NODE_ENV !== 'production'
