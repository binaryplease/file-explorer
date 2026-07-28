/**
 * The directory a dev session serves.
 *
 * The server's own default is the home directory of the user running it —
 * right for an installed `bfe`, wrong for development, where you are almost
 * always looking at the code you are changing. `.mise.toml` pins
 * `EXPLORER_ROOT` to this repo for the mise tasks, but `bun dev` never loads
 * that file, so the same decision has to live in the dev entry point too. This
 * module is where it lives, so both entry points land on the same tree
 * (ADR-0032).
 *
 * It only ever fills a gap: an `EXPLORER_ROOT` already in the environment —
 * mise's, or one a developer exported to browse elsewhere — is left alone.
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Absolute path of the repository checkout. Derived from this file's own
 * location (it lives in `./scripts`) rather than the cwd, so it holds however
 * the dev task was invoked (ADR-0011). `resolve` drops the trailing separator
 * `fileURLToPath` leaves on a directory URL.
 */
export const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

/**
 * Environment override that points the dev server at this repo, or nothing at
 * all when the root is already configured.
 */
export function devRootEnvironment(
  environment: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const configuredRoot = environment.EXPLORER_ROOT?.trim()
  if (configuredRoot) return {}
  return { EXPLORER_ROOT: repositoryRoot }
}
