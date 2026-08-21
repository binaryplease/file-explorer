/**
 * The stress fixture that [101-performance-budgets] gates optimization on:
 * "build a stress fixture (a script that generates e.g. 50k files / deep
 * nesting), log server timing per listing, and reproduce the miss. No fixture,
 * no optimization."
 *
 * It exists so a listing measurement is *reproducible*. The number in
 * [013-large-directory-listing-performance] came from this machine's real
 * `/tmp` — a tree that differs per machine, per day, and that nobody else can
 * re-measure against. Every performance claim about the listing path in this
 * repo is meant to pass through here instead.
 *
 * The shapes generated are the ones the listing path actually costs differently:
 *
 *   - `few-thousand` — the scale the budget is *written* for ("< ~50ms for a
 *                      few-thousand-entry directory"), in the same mix as
 *                      `wide-mixed`. Kept as its own case so the budget as
 *                      stated stays measurable, not only the 10×-larger
 *                      directory [013] asks the same number of.
 *   - `wide-mixed`   — the shape the miss was measured on: tens of thousands of
 *                      entries, overwhelmingly *directories*, each holding a
 *                      couple of children. Every child directory is one more
 *                      `readdir` for the `childCount` column, so this is the
 *                      expensive case, plus the two symlinks (one contained,
 *                      one escaping the root) that keep the confinement path
 *                      exercised at scale.
 *   - `wide-files`   — the same entry count as plain files: one `stat` each for
 *                      size and the execute bit, and no child `readdir` at all.
 *                      Isolates per-entry stat cost from child-directory cost.
 *   - `deep`         — a single chain of nested directories. Listing any one
 *                      level is cheap; what this exercises is the `.gitignore`
 *                      chain, which is loaded per ancestor level on every
 *                      listing.
 *
 * Generation is idempotent (a marker file records the shape that was built), so
 * re-running is free and a shape change regenerates only what changed.
 *
 * Usage:
 *   bun scripts/stress-fixture.ts [--root DIR] [--entries N] [--depth N]
 *                                 [--children N] [--force] [--remove]
 */
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** Default fixture size: past the ~37 000 entries the miss was measured on. */
export const DEFAULT_ENTRY_COUNT = 40_000
/**
 * The scale the `GET /api/fs/list` budget is written for — "a few-thousand-entry
 * directory". Fixed rather than configurable: it is the budget's own wording,
 * not a dial.
 */
export const FEW_THOUSAND_ENTRY_COUNT = 4_000
/** Entries inside each generated child directory, so `childCount` is non-trivial. */
export const DEFAULT_CHILDREN_PER_DIRECTORY = 2
/** Nesting levels in the `deep` case. */
export const DEFAULT_DEPTH = 256
/**
 * Share of `wide-mixed` entries that are directories. The measured miss saw
 * 34 442 directories in 37 071 entries — 93% — and directories are the
 * expensive kind, so the fixture reproduces that ratio rather than an even
 * split that would understate the cost.
 */
export const DIRECTORY_SHARE = 0.93

/** The directory/file/symlink split of one mixed-entry case. */
export type MixedCaseShape = {
  entryCount: number
  directoryCount: number
  fileCount: number
  symlinkCount: number
}

export type StressFixturePlan = {
  rootAbsolutePath: string
  entryCount: number
  childrenPerDirectory: number
  depth: number
  wideMixed: MixedCaseShape
  fewThousand: MixedCaseShape
  /** Where the escaping symlink points: outside the fixture root, always. */
  escapingLinkTarget: string
}

/**
 * Splits an entry count into the mix the miss was measured on: two symlinks —
 * one contained, one escaping — and the rest weighted heavily towards
 * directories, which are the expensive kind.
 */
export function mixedCaseShape(entryCount: number): MixedCaseShape {
  const remainingAfterLinks = entryCount - 2
  const directoryCount = Math.round(remainingAfterLinks * DIRECTORY_SHARE)
  return {
    entryCount,
    directoryCount,
    fileCount: remainingAfterLinks - directoryCount,
    symlinkCount: 2,
  }
}

export type StressFixtureArguments = {
  rootAbsolutePath?: string
  entryCount?: number
  childrenPerDirectory?: number
  depth?: number
  force?: boolean
  remove?: boolean
}

/** The default fixture root, outside the repo so nothing can be committed by accident. */
export function defaultFixtureRoot(temporaryDirectory: string = tmpdir()): string {
  return join(temporaryDirectory, 'binp-file-explorer-stress')
}

/**
 * Pure shape derivation: what will exist on disk for a given set of options.
 * Separated from the IO below so it can be asserted without touching a disk
 * (`composable-design`).
 *
 * The two symlinks are counted as part of `wideMixedFileCount`'s complement:
 * `wide-mixed` holds exactly `entryCount` entries, of which two are links.
 */
export function stressFixturePlan(fixtureArguments: StressFixtureArguments = {}): StressFixturePlan {
  const entryCount = fixtureArguments.entryCount ?? DEFAULT_ENTRY_COUNT
  if (!Number.isInteger(entryCount) || entryCount < 3) {
    throw new Error(`--entries must be an integer of at least 3, got ${entryCount}`)
  }
  const childrenPerDirectory =
    fixtureArguments.childrenPerDirectory ?? DEFAULT_CHILDREN_PER_DIRECTORY
  if (!Number.isInteger(childrenPerDirectory) || childrenPerDirectory < 0) {
    throw new Error(`--children must be a non-negative integer, got ${childrenPerDirectory}`)
  }
  const depth = fixtureArguments.depth ?? DEFAULT_DEPTH
  if (!Number.isInteger(depth) || depth < 1) {
    throw new Error(`--depth must be an integer of at least 1, got ${depth}`)
  }
  const rootAbsolutePath = resolve(fixtureArguments.rootAbsolutePath ?? defaultFixtureRoot())

  return {
    rootAbsolutePath,
    entryCount,
    childrenPerDirectory,
    depth,
    wideMixed: mixedCaseShape(entryCount),
    fewThousand: mixedCaseShape(Math.min(FEW_THOUSAND_ENTRY_COUNT, entryCount)),
    // The system temp directory is guaranteed to exist and is never inside the
    // fixture root, so this link escapes a confined root on any machine.
    escapingLinkTarget: tmpdir(),
  }
}

/** Command-line parsing, kept pure so the usage errors are testable. */
export function parseStressFixtureArguments(commandLineArguments: string[]): StressFixtureArguments {
  const parsed: StressFixtureArguments = {}
  for (let index = 0; index < commandLineArguments.length; index++) {
    const flag = commandLineArguments[index]!
    const readValue = (): string => {
      const value = commandLineArguments[index + 1]
      if (value === undefined) throw new Error(`${flag} needs a value`)
      index++
      return value
    }
    const readCount = (): number => {
      const value = readValue()
      const count = Number(value)
      if (!Number.isInteger(count)) throw new Error(`${flag} needs an integer, got ${value}`)
      return count
    }
    switch (flag) {
      case '--root':
        parsed.rootAbsolutePath = readValue()
        break
      case '--entries':
        parsed.entryCount = readCount()
        break
      case '--children':
        parsed.childrenPerDirectory = readCount()
        break
      case '--depth':
        parsed.depth = readCount()
        break
      case '--force':
        parsed.force = true
        break
      case '--remove':
        parsed.remove = true
        break
      default:
        throw new Error(`unknown flag: ${flag}`)
    }
  }
  return parsed
}

/** Names of the fixture's cases, so callers address them by constant, not string. */
export const FEW_THOUSAND_CASE = 'few-thousand'
export const WIDE_MIXED_CASE = 'wide-mixed'
export const WIDE_FILES_CASE = 'wide-files'
export const DEEP_CASE = 'deep'
export const ESCAPING_LINK_NAME = 'escaping-link'
export const CONTAINED_LINK_NAME = 'contained-link'
const MARKER_FILE_NAME = 'fixture.json'

/**
 * The marker recording what was generated. Its presence with matching numbers
 * is what makes a re-run a no-op — the tree is 120 000+ inodes and rebuilding
 * it on every benchmark run would dominate the measurement it exists to serve.
 */
type FixtureMarker = {
  entryCount: number
  fewThousandEntryCount: number
  childrenPerDirectory: number
  depth: number
}

function readMarker(rootAbsolutePath: string): FixtureMarker | null {
  try {
    return JSON.parse(readFileSync(join(rootAbsolutePath, MARKER_FILE_NAME), 'utf8'))
  } catch {
    return null
  }
}

function markerMatches(marker: FixtureMarker | null, plan: StressFixturePlan): boolean {
  if (marker === null) return false
  return (
    marker.entryCount === plan.entryCount &&
    marker.fewThousandEntryCount === plan.fewThousand.entryCount &&
    marker.childrenPerDirectory === plan.childrenPerDirectory &&
    marker.depth === plan.depth
  )
}

/**
 * Zero-padded so directory order on disk and lexical order agree — a listing
 * that sorts by name should not also be measuring a pathological sort input.
 */
function paddedName(prefix: string, index: number, width: number): string {
  return `${prefix}-${String(index).padStart(width, '0')}`
}

function touchFile(absolutePath: string, contents: string): void {
  if (contents === '') {
    closeSync(openSync(absolutePath, 'w'))
    return
  }
  writeFileSync(absolutePath, contents)
}

/**
 * Builds the tree. Synchronous throughout: this is a one-shot generator whose
 * only job is to finish, and 120 000 awaited filesystem calls are slower than
 * 120 000 synchronous ones with nothing else on the loop to serve.
 */
export function generateStressFixture(plan: StressFixturePlan): void {
  const indexWidth = String(plan.entryCount).length

  mkdirSync(plan.rootAbsolutePath, { recursive: true })

  // Both mixed cases are the same shape at two scales, so they are built by the
  // same code — a difference between them would make the small one useless as a
  // reading of the large one.
  const buildMixedCase = (caseName: string, shape: MixedCaseShape): void => {
    const casePath = join(plan.rootAbsolutePath, caseName)
    mkdirSync(casePath, { recursive: true })
    for (let index = 0; index < shape.directoryCount; index++) {
      const directoryPath = join(casePath, paddedName('dir', index, indexWidth))
      mkdirSync(directoryPath, { recursive: true })
      for (let childIndex = 0; childIndex < plan.childrenPerDirectory; childIndex++) {
        touchFile(join(directoryPath, paddedName('child', childIndex, 2)), '')
      }
    }
    for (let index = 0; index < shape.fileCount; index++) {
      touchFile(join(casePath, `${paddedName('file', index, indexWidth)}.txt`), `entry ${index}\n`)
    }
    // One symlink that stays inside the root and one that leaves it. Confined,
    // the escaping one must still appear as a row with every fact about its
    // target withheld, and its target must never be stat-ed — the behaviour
    // this fixture must keep honest while the listing gets faster.
    symlinkSync(join(plan.rootAbsolutePath, DEEP_CASE), join(casePath, CONTAINED_LINK_NAME))
    symlinkSync(plan.escapingLinkTarget, join(casePath, ESCAPING_LINK_NAME))
  }
  buildMixedCase(WIDE_MIXED_CASE, plan.wideMixed)
  buildMixedCase(FEW_THOUSAND_CASE, plan.fewThousand)

  const wideFilesPath = join(plan.rootAbsolutePath, WIDE_FILES_CASE)
  mkdirSync(wideFilesPath, { recursive: true })
  for (let index = 0; index < plan.entryCount; index++) {
    touchFile(
      join(wideFilesPath, `${paddedName('file', index, indexWidth)}.txt`),
      `entry ${index}\n`,
    )
  }

  // Deep nesting, with a `.gitignore` every level: the listing path loads the
  // ignore chain from the root down on every request, so depth is what puts a
  // price on that.
  let deepPath = join(plan.rootAbsolutePath, DEEP_CASE)
  mkdirSync(deepPath, { recursive: true })
  for (let level = 0; level < plan.depth; level++) {
    deepPath = join(deepPath, paddedName('level', level, 4))
    mkdirSync(deepPath, { recursive: true })
    touchFile(join(deepPath, '.gitignore'), `ignored-${level}\n`)
    touchFile(join(deepPath, 'leaf.txt'), `level ${level}\n`)
  }

  writeFileSync(
    join(plan.rootAbsolutePath, MARKER_FILE_NAME),
    `${JSON.stringify(
      {
        entryCount: plan.entryCount,
        fewThousandEntryCount: plan.fewThousand.entryCount,
        childrenPerDirectory: plan.childrenPerDirectory,
        depth: plan.depth,
      } satisfies FixtureMarker,
      null,
      2,
    )}\n`,
  )
}

function reportPlan(plan: StressFixturePlan, wasRebuilt: boolean): void {
  const describeMixed = (shape: MixedCaseShape) =>
    `${shape.entryCount} entries (${shape.directoryCount} directories, ` +
    `${shape.fileCount} files, ${shape.symlinkCount} symlinks)`
  console.log(`stress fixture ${wasRebuilt ? 'generated' : 'already present'} at`)
  console.log(`  ${plan.rootAbsolutePath}`)
  console.log(`  ${WIDE_MIXED_CASE}/    ${describeMixed(plan.wideMixed)}`)
  console.log(`  ${FEW_THOUSAND_CASE}/  ${describeMixed(plan.fewThousand)}`)
  console.log(`  ${WIDE_FILES_CASE}/    ${plan.entryCount} files`)
  console.log(`  ${DEEP_CASE}/          ${plan.depth} nested levels`)
}

if (import.meta.main) {
  const fixtureArguments = parseStressFixtureArguments(process.argv.slice(2))
  const plan = stressFixturePlan(fixtureArguments)

  if (fixtureArguments.remove) {
    rmSync(plan.rootAbsolutePath, { recursive: true, force: true })
    console.log(`removed ${plan.rootAbsolutePath}`)
  } else {
    const alreadyBuilt = markerMatches(readMarker(plan.rootAbsolutePath), plan)
    const mustRebuild = fixtureArguments.force === true || !alreadyBuilt
    if (mustRebuild) {
      rmSync(plan.rootAbsolutePath, { recursive: true, force: true })
      const startedAt = performance.now()
      generateStressFixture(plan)
      console.log(`built in ${Math.round(performance.now() - startedAt)}ms`)
    }
    reportPlan(plan, mustRebuild)
  }
}
