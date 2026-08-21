/**
 * Per-listing server timing — the second half of the optimization gate in
 * `docs/requirements/101-performance-budgets.md` ("build a stress fixture …,
 * log server timing per listing, and reproduce the miss").
 *
 * The point is that a listing that misses its budget says *why* without anyone
 * re-instrumenting the code first. A total alone cannot distinguish the three
 * things that can cost a large listing — the syscalls the service issues, the
 * JSON the route serializes, and the bytes the client then has to receive — so
 * the phases and the syscall counts are carried separately and reported
 * together.
 *
 * This is deliberately *not* a Zod wire schema. It never crosses a parsed
 * boundary: it is rendered into a `Server-Timing` response header, which
 * browsers read natively in devtools and which no code in this repo parses.
 */

/** What one `listDirectory` call cost, in phases and in syscalls. */
export type ListingTiming = {
  /** Wall clock for the whole service call. */
  totalMilliseconds: number
  /** Reading the directory's own entries. */
  readdirMilliseconds: number
  /** Loading the `.gitignore` chain from the served root down. */
  ignoreMilliseconds: number
  /** Describing every entry: the per-entry stats, child counts and realpaths. */
  describeMilliseconds: number
  /** Entries in the listing. */
  entryCount: number
  /** Of which directories. */
  directoryCount: number
  /** `stat`/`lstat` calls issued while describing entries. */
  statCount: number
  /** Child-directory `readdir` calls issued for the `childCount` column. */
  childReaddirCount: number
  /** `realpath` calls issued by confinement. Always 0 unconfined. */
  realpathCount: number
}

/**
 * The mutable counters a listing fills in as it runs. Kept apart from
 * `ListingTiming` so the finished measurement is a plain readable value and the
 * accumulator is the thing that gets passed down into the per-entry work.
 */
export type ListingCounters = {
  statCount: number
  childReaddirCount: number
  realpathCount: number
}

export function createListingCounters(): ListingCounters {
  return { statCount: 0, childReaddirCount: 0, realpathCount: 0 }
}

/**
 * Renders one measurement as a `Server-Timing` header value. Durations are the
 * phases; the counts ride along as `desc` on zero-duration metrics, which is
 * what the header allows and what devtools displays beside the name.
 */
export function toServerTimingHeader(timing: ListingTiming): string {
  const round = (milliseconds: number) => milliseconds.toFixed(1)
  return [
    `list;dur=${round(timing.totalMilliseconds)}`,
    `readdir;dur=${round(timing.readdirMilliseconds)}`,
    `ignore;dur=${round(timing.ignoreMilliseconds)}`,
    `describe;dur=${round(timing.describeMilliseconds)}`,
    `entries;desc="${timing.entryCount}"`,
    `dirs;desc="${timing.directoryCount}"`,
    `stats;desc="${timing.statCount}"`,
    `childreaddirs;desc="${timing.childReaddirCount}"`,
    `realpaths;desc="${timing.realpathCount}"`,
  ].join(', ')
}

/**
 * One-line log form, for the `EXPLORER_TIMING` opt-in. Names the listed path so
 * a log of many listings is readable without correlating request ids.
 */
export function formatListingTimingLine(relativePath: string, timing: ListingTiming): string {
  const displayPath = relativePath === '' ? '.' : relativePath
  return (
    `list ${displayPath} ${timing.totalMilliseconds.toFixed(1)}ms ` +
    `(readdir ${timing.readdirMilliseconds.toFixed(1)}ms, ` +
    `ignore ${timing.ignoreMilliseconds.toFixed(1)}ms, ` +
    `describe ${timing.describeMilliseconds.toFixed(1)}ms) ` +
    `${timing.entryCount} entries, ${timing.directoryCount} dirs, ` +
    `${timing.statCount} stats, ${timing.childReaddirCount} child readdirs, ` +
    `${timing.realpathCount} realpaths`
  )
}
