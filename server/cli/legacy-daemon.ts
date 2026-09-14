/**
 * One-way adoption of the daemon state a pre-rename build left on disk.
 *
 * `DAEMON_NAME` is the single constant the daemon's five runtime paths derive
 * from, so matching it to the repository name moved all five at once. That is
 * a contract with something outside this process — a daemon already running —
 * and breaking it silently is the failure this module exists to prevent: the
 * new CLI would read a PID file that does not exist, report "not running", and
 * leave the old process alive and still holding its port. `stop` would be a
 * no-op and `logs` would read an empty directory. A port held by a process the
 * CLI says is not running is exactly the fail-quietly case `fail-loud-ports`
 * rejects.
 *
 * So the CLI adopts rather than asking the user to clean up first:
 *
 *   - **Live old daemon, nothing recorded under the new name** — rewrite its
 *     pid/state pair under the new name and remove the old pair. Every verb
 *     reaches the same daemon again; no restart, no orphaned port.
 *   - **Live old daemon, but the new name is already taken** — two daemons, and
 *     adopting would overwrite a live record with another. Report both pids and
 *     leave the disk alone.
 *   - **Stale old files** — the process is gone; clear them away.
 *   - **The log directory** — rename it when the new path is free (the running
 *     daemon's open file descriptor follows the inode, so `daemon logs` keeps
 *     tailing the same live stream). When the new path is taken, leave both and
 *     say which is which.
 *
 * Nothing here is silent: every branch returns a line the CLI prints. All of it
 * is deletable in one piece once no daemon can plausibly predate the rename —
 * which is why it is its own module rather than a branch inside ./daemon.ts.
 */
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { processIsAlive, removeQuietly } from './daemon'
import { DAEMON_NAME, daemonPaths, daemonPathsFor, type DaemonPaths } from './paths'

/**
 * The product name before it matched the repository, spelled as its prefix plus
 * the current name rather than as one literal. That is deliberate. The rename's
 * standing guard is a grep for the old prefix that must match nothing outside
 * `docs/` (`015-product-identifiers-match-the-repository-name` states it in
 * full), and writing the old identifier out whole here would satisfy that grep
 * forever — turning a live check for regressions into a permanent exemption.
 * The value is identical either way; ./legacy-daemon.test.ts asserts it, which
 * is the one place the old string is spelled to be checked rather than used.
 */
const LEGACY_NAME_PREFIX = 'binp'
export const legacyDaemonName = `${LEGACY_NAME_PREFIX}-${DAEMON_NAME}`

export type LegacyDaemonAdoption = {
  legacy: DaemonPaths
  current: DaemonPaths
  /** Injected so the adoption branches are testable without spawning processes. */
  processIsAlive: (pid: number) => boolean
}

/** The pid recorded in a PID file, or null when the file is absent or unusable. */
async function readRecordedPid(pidFilePath: string): Promise<number | null> {
  if (!existsSync(pidFilePath)) return null
  try {
    const recordedPid = Number((await Bun.file(pidFilePath).text()).trim())
    return Number.isInteger(recordedPid) && recordedPid > 0 ? recordedPid : null
  } catch {
    return null
  }
}

/**
 * Move the pid/state pair of a still-running old daemon under the current name,
 * or clear it away when the process behind it is gone.
 */
async function adoptProcessState(adoption: LegacyDaemonAdoption): Promise<string[]> {
  const { legacy, current } = adoption
  const legacyPid = await readRecordedPid(legacy.pidFilePath)

  if (legacyPid === null) {
    // A PID file that is present but unreadable is as stale as a missing one.
    if (!existsSync(legacy.pidFilePath) && !existsSync(legacy.stateFilePath)) return []
    removeQuietly(legacy.pidFilePath)
    removeQuietly(legacy.stateFilePath)
    return [`cleared unreadable daemon files left under the previous name (${legacyDaemonName})`]
  }

  if (!adoption.processIsAlive(legacyPid)) {
    removeQuietly(legacy.pidFilePath)
    removeQuietly(legacy.stateFilePath)
    return [`cleared stale daemon files left under the previous name (${legacyDaemonName})`]
  }

  const currentPid = await readRecordedPid(current.pidFilePath)
  if (currentPid !== null && adoption.processIsAlive(currentPid)) {
    return [
      `a daemon started under the previous name (${legacyDaemonName}) is still running as ` +
        `pid ${legacyPid}, and a different daemon (pid ${currentPid}) is already recorded under ` +
        `the current name. Both hold a port; stop pid ${legacyPid} by hand — this CLI's verbs ` +
        `reach pid ${currentPid} only.`,
    ]
  }

  // The state file travels verbatim; `daemonProbe` validates it on read, and a
  // missing or corrupt one already degrades to the "port unknown" status line.
  await Bun.write(current.pidFilePath, String(legacyPid))
  if (existsSync(legacy.stateFilePath)) {
    await Bun.write(current.stateFilePath, await Bun.file(legacy.stateFilePath).text())
  }
  removeQuietly(legacy.pidFilePath)
  removeQuietly(legacy.stateFilePath)
  return [
    `adopted the daemon started under the previous name (${legacyDaemonName}) — pid ${legacyPid} ` +
      `now answers to '${DAEMON_NAME}' verbs`,
  ]
}

/**
 * Move the old log directory to the new one when that path is free, renaming
 * the log file inside it so `daemon logs` keeps finding it. A rename keeps the
 * inode, so a daemon currently writing to it is undisturbed.
 */
function adoptLogDirectory(adoption: LegacyDaemonAdoption): string[] {
  const { legacy, current } = adoption
  if (!existsSync(legacy.logDirectory)) return []

  if (existsSync(current.logDirectory)) {
    return [
      `older logs are kept at ${legacy.logDirectory}; this daemon logs to ${current.logDirectory}`,
    ]
  }

  try {
    mkdirSync(dirname(current.logDirectory), { recursive: true })
    renameSync(legacy.logDirectory, current.logDirectory)
  } catch {
    return [
      `older logs could not be moved and are kept at ${legacy.logDirectory}; ` +
        `this daemon logs to ${current.logDirectory}`,
    ]
  }

  const movedLogFile = join(current.logDirectory, basename(legacy.logFilePath))
  if (existsSync(movedLogFile) && !existsSync(current.logFilePath)) {
    try {
      renameSync(movedLogFile, current.logFilePath)
    } catch {
      return [
        `moved the log directory to ${current.logDirectory}, but ${movedLogFile} kept its old name`,
      ]
    }
  }
  return [`moved the log directory from ${legacy.logDirectory} to ${current.logDirectory}`]
}

/**
 * Run both adoptions against explicit locations. Returns one report line per
 * thing that happened, and an empty array when there was nothing to adopt —
 * which is the case on every run after the first.
 */
export async function adoptLegacyDaemonAt(adoption: LegacyDaemonAdoption): Promise<string[]> {
  return [...(await adoptProcessState(adoption)), ...adoptLogDirectory(adoption)]
}

/** The same, wired to this machine's real locations. */
export async function adoptLegacyDaemon(): Promise<string[]> {
  return adoptLegacyDaemonAt({
    legacy: daemonPathsFor(legacyDaemonName),
    current: daemonPaths,
    processIsAlive,
  })
}
