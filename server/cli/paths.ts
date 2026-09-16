/**
 * Filesystem locations and on-disk state for the CLI's background daemon.
 *
 * Two conventions shape this module:
 *   - `location-agnostic-cli` — the path to the service script is resolved
 *     against the CLI's own real location (following symlinks), never the
 *     shell's cwd, so a symlinked `bfe` on PATH still finds its sibling
 *     `index.{ts,js}`.
 *   - `daemon-lifecycle` — the PID/log path conventions, and the "daemon logic
 *     lives in its own module" split (probe/start/stop live in ./daemon.ts).
 *
 * A companion state file sits beside the PID file: the PID file holds only the
 * pid, while the state file records the port/host/root/startedAt the daemon was
 * launched with, so `status`, `stop`, and `logs` can reach the right server
 * without re-guessing its port.
 */
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod/v4'

/**
 * The product name the daemon's runtime paths are built from — the repository
 * name exactly (`package-name-matches-repo`). Renaming this moves all five
 * paths below at once, which is why ./legacy-daemon.ts exists.
 */
export const DAEMON_NAME = 'file-explorer'

/**
 * Directory of the running CLI file, resolved through any symlink
 * (`location-agnostic-cli`).
 * Falls back to this module's own URL when `Bun.argv[1]` cannot be realpath'd
 * (e.g. an odd embedding), so path resolution never throws at startup.
 */
const cliFilePath = (() => {
  try {
    return realpathSync(Bun.argv[1])
  } catch {
    return fileURLToPath(import.meta.url)
  }
})()

// The server entry sits next to the CLI entry in every layout: `server/cli.ts`
// beside `server/index.ts` in the source tree, `cli.js` beside `index.js` in
// the built `dist/server`. Matching the CLI file's own extension picks the
// right one without probing the disk.
export const serviceScriptPath = join(dirname(cliFilePath), `index${extname(cliFilePath)}`)

/** The XDG roots the daemon's on-disk state hangs off, read once at load. */
export const xdgRoots: XdgRoots = {
  runtimeDirectory: process.env.XDG_RUNTIME_DIR || '/tmp',
  dataHome: process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'),
}

export type XdgRoots = {
  runtimeDirectory: string
  dataHome: string
}

/** The four persistent locations a daemon of a given product name owns. */
export type DaemonPaths = {
  pidFilePath: string
  stateFilePath: string
  logDirectory: string
  logFilePath: string
}

/**
 * Derive that set from a product name. Taking the name as an argument — rather
 * than closing over `DAEMON_NAME` — is what lets ./legacy-daemon.ts address the
 * paths a pre-rename build left behind without restating the layout.
 */
export function daemonPathsFor(daemonName: string, roots: XdgRoots = xdgRoots): DaemonPaths {
  const logDirectory = join(roots.dataHome, daemonName)
  return {
    pidFilePath: join(roots.runtimeDirectory, `${daemonName}.pid`),
    stateFilePath: join(roots.runtimeDirectory, `${daemonName}.state.json`),
    logDirectory,
    logFilePath: join(logDirectory, `${daemonName}.log`),
  }
}

export const daemonPaths = daemonPathsFor(DAEMON_NAME)
export const { pidFilePath, stateFilePath, logDirectory, logFilePath } = daemonPaths

/**
 * A private, per-launch path the server writes its bound port to (the CLI
 * handshake). Keyed by the launching CLI's pid so concurrent `bfe` invocations
 * never read each other's file.
 */
export function readyFilePathFor(uniqueSuffix: string | number): string {
  return join(xdgRoots.runtimeDirectory, `${DAEMON_NAME}.ready.${uniqueSuffix}`)
}

// Identity fields, deliberately exempt from `zod-defaults`: a corrupt or
// partial state file must fail loudly rather than resolve to a bogus zero-port
// daemon.
export const DaemonStateSchema = z.object({
  pid: z.number().int().positive(),
  host: z.string().min(1),
  port: z.number().int().positive(),
  root: z.string().min(1),
  startedAt: z.string().min(1),
})
export type DaemonState = z.infer<typeof DaemonStateSchema>

/** The daemon's base URL, from its recorded host/port. */
export function baseUrlForState(state: Pick<DaemonState, 'host' | 'port'>): string {
  return `http://${state.host}:${state.port}`
}
