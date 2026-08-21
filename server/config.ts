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
  // Extra Host header values to answer for, beyond loopback. Empty by default:
  // the explorer is loopback-only, and answering for any other name is what
  // makes DNS rebinding work. Only the documented `HOST=0.0.0.0`-behind-Caddy
  // deployment needs this, and that operator must name their own domain.
  EXPLORER_ALLOWED_HOSTS: z
    .string()
    .default('')
    .describe('Comma-separated extra Host header values to serve, beyond loopback names.'),
  // Cross-origin read access for the deliberate embedding seam. Empty by
  // default — the explorer ships no CORS headers, relying on the same-origin
  // policy to guard its responses (see README security model). A host that
  // mounts the explorer's frontend into its own page while running this server
  // as a separate process on another port makes cross-origin requests the
  // browser would otherwise refuse to read; naming that host's origin here
  // returns CORS headers for it, and nothing else. This never widens the
  // network surface — the loopback bind and Host-header guard are untouched; it
  // only lets a named origin *read* a response it is already allowed to receive.
  EXPLORER_ALLOWED_ORIGINS: z
    .string()
    .default('')
    .describe('Comma-separated exact Origins granted cross-origin (CORS) read access.'),
  // How the server chooses its listen port. `strict` (the default, and what
  // `mise run start` / a direct launch uses) binds PORT exactly and dies loudly
  // on a conflict — ADR-0018. `auto` walks upward from PORT to the first free
  // port, announcing each skip; it is the opt-in the `bfe` CLI sets so any
  // number of instances land on distinct ports without colliding. Auto never
  // fails silently — every reassignment is printed — and it is only ever
  // enabled deliberately, so the ADR-0018 default posture is unchanged.
  EXPLORER_PORT_STRATEGY: z
    .enum(['strict', 'auto'])
    .default('strict')
    .describe('Port selection: `strict` binds PORT exactly (fail loud); `auto` walks to a free one.'),
  // Log one line per directory listing with what it cost — the per-listing
  // server timing the optimization gate in
  // `docs/requirements/101-performance-budgets.md` requires. Off by default
  // (a local browsing tool that printed a line per keystroke-driven listing
  // would be unusable), and an explicit purpose-named flag rather than
  // anything inferred from the environment. The same numbers ride on every
  // listing's `Server-Timing` header regardless of this setting.
  EXPLORER_TIMING: z
    .stringbool()
    .default(false)
    .describe('Log one line per directory listing with its phase timings and syscall counts.'),
  // When set, the server writes the port it actually bound to this file the
  // instant it starts listening. The CLI passes a private path here so it can
  // learn an auto-assigned port (and confirm a strict one) without parsing
  // stdout. Empty (the default) writes nothing.
  EXPLORER_READY_FILE: z
    .string()
    .default('')
    .describe('Path the server writes its bound port to once listening (for the CLI handshake).'),
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
  EXPLORER_ALLOWED_ORIGINS: process.env.EXPLORER_ALLOWED_ORIGINS || undefined,
  EXPLORER_PORT_STRATEGY: process.env.EXPLORER_PORT_STRATEGY || undefined,
  EXPLORER_TIMING: process.env.EXPLORER_TIMING || undefined,
  EXPLORER_READY_FILE: process.env.EXPLORER_READY_FILE || undefined,
})

// Parsed once here rather than re-split per request.
export const additionalAllowedHosts = config.EXPLORER_ALLOWED_HOSTS.split(',')
  .map((allowedHost) => allowedHost.trim())
  .filter((allowedHost) => allowedHost !== '')

// The exact Origins granted cross-origin read access. Empty (the default) means
// no CORS at all — the historical, most-restrictive posture.
export const allowedOrigins = config.EXPLORER_ALLOWED_ORIGINS.split(',')
  .map((allowedOrigin) => allowedOrigin.trim())
  .filter((allowedOrigin) => allowedOrigin !== '')

export const isDev = config.NODE_ENV !== 'production'
