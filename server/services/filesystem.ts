import { realpathSync, statSync } from 'node:fs'
import type { Dirent, Stats } from 'node:fs'
import { lstat, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { DirectoryEntry, DirectoryListing } from '../../shared/filesystem.schema'
import type { SearchNode, SearchSubtreeResult } from '../../shared/search.schema'
import { fuzzyScore } from '../../shared/fuzzy'
import { isPathIgnored, loadIgnoreFile, type IgnoreFile } from './ignore'
import { openPathWithDefaultApplication } from './open'

// `outside-root` is the lexical escape (`../../etc/passwd`) — a malformed
// request. `symlink-escapes-root` is a path that is lexically contained but
// whose real path leaves the root: it names a real entry the user can see in
// the tree, so it is refused separately and explicitly rather than being
// folded into "bad path" (the user has to understand *why* it is not allowed).
export type ListDirectoryFailureReason =
  | 'outside-root'
  | 'symlink-escapes-root'
  | 'not-found'
  | 'not-a-directory'
  | 'not-readable'

export type ListDirectoryResult =
  | { ok: true; listing: DirectoryListing }
  | { ok: false; reason: ListDirectoryFailureReason }

export type ReadFileFailureReason =
  | 'outside-root'
  | 'symlink-escapes-root'
  | 'not-found'
  | 'not-a-file'
  | 'not-readable'

export type ResolveFileResult =
  | { ok: true; absolutePath: string }
  | { ok: false; reason: ReadFileFailureReason }

// Opening reuses the file resolution failures and adds one for a launcher that
// couldn't be spawned (e.g. no `xdg-open` on PATH).
export type OpenFileFailureReason = ReadFileFailureReason | 'open-failed'

export type OpenFileServiceResult =
  | { ok: true; relativePath: string }
  | { ok: false; reason: OpenFileFailureReason }

export type SearchSubtreeOptions = {
  pattern: string
  showHidden: boolean
  showGitignored: boolean
  limit: number
  abortSignal: AbortSignal
}

export type SearchSubtreeServiceResult =
  | { ok: true; result: SearchSubtreeResult }
  | { ok: false; reason: ListDirectoryFailureReason }

// Search walk budgets, per broot's tree builder (tree_build/builder.rs): keep
// walking until 10× the targeted line count is gathered, or until the target
// is reached and ~900ms elapsed, then trim to the best-scoring lines. See
// `.nightshift/research/2026-07-17-broot-engine.md`.
const SEARCH_TIME_BUDGET_MILLISECONDS = 900
const SEARCH_OVERSCAN_FACTOR = 10
// broot walks until interrupted by a keystroke; a server request needs a hard
// stop even when matches are scarce and the good-enough rule never fires.
const SEARCH_HARD_TIME_LIMIT_MILLISECONDS = 3000
// Depth doping, per broot's make_bline: shallow lines outrank deep ones, and
// direct matches get a small extra bump over ancestor-only directories.
const SEARCH_DEPTH_DOPING_BASE = 10_000
const SEARCH_DIRECT_MATCH_BONUS = 10

// True when `absolutePath` is `containerAbsolutePath` itself or sits beneath
// it. Compares path segments, so a sibling (`../elsewhere`) is rejected while a
// legitimately-named child (`..config`) is not.
function isPathWithin(containerAbsolutePath: string, absolutePath: string): boolean {
  const pathFromContainer = relative(containerAbsolutePath, absolutePath)
  if (pathFromContainer === '') return true
  if (isAbsolute(pathFromContainer)) return false
  return pathFromContainer !== '..' && !pathFromContainer.startsWith('../')
}

// Factory per ADR-0007. Confines every listing to `rootAbsolutePath`; a request
// that escapes the root — lexically, or through a symlink pointing outside it —
// is rejected, never resolved.
export function createFilesystemService(options: { rootAbsolutePath: string }) {
  const rootAbsolutePath = resolve(options.rootAbsolutePath)

  const rootInfo = statSync(rootAbsolutePath, { throwIfNoEntry: false })
  if (rootInfo === undefined || !rootInfo.isDirectory()) {
    throw new Error(`explorer root is not a directory: ${rootAbsolutePath}`)
  }

  // The root may itself be reached through a symlink (`/tmp`, a home directory
  // on a mounted volume). Real paths are only comparable against another real
  // path, so resolve the root once here rather than on every request.
  const rootRealPath = realpathSync(rootAbsolutePath)

  function resolveWithinRoot(requestedRelativePath: string): string | null {
    const absolutePath = resolve(rootAbsolutePath, requestedRelativePath)
    if (!isPathWithin(rootAbsolutePath, absolutePath)) return null
    return absolutePath
  }

  // The lexical check above cannot see through symlinks: a link *inside* the
  // root pointing *outside* it resolves to a path that still looks contained.
  // Re-check containment against the root's real path for paths that exist.
  //
  // Callers run this only after their own stat/readdir has succeeded, so a
  // non-existent path is reported as not-found by that check and never reaches
  // here — which also keeps the extra syscall off the miss path.
  async function isRealPathWithinRoot(absolutePath: string): Promise<boolean> {
    try {
      return isPathWithin(rootRealPath, await realpath(absolutePath))
    } catch {
      // Vanished between the caller's existence check and this call. Deny:
      // confinement must not depend on winning a race.
      return false
    }
  }

  // Collects the `.gitignore` files that govern `directoryAbsolutePath`, from
  // the served root down to (and including) the directory itself, and whether
  // the directory already sits inside an ignored subtree. We honour
  // `.gitignore` files wherever they appear rather than requiring a git repo —
  // right for a local browsing tool.
  async function buildIgnoreContext(
    directoryAbsolutePath: string,
  ): Promise<{ ignoreChain: IgnoreFile[]; isWithinIgnoredDirectory: boolean }> {
    const ignoreChain: IgnoreFile[] = []
    let isWithinIgnoredDirectory = false
    const rootIgnoreFile = await loadIgnoreFile(rootAbsolutePath)
    if (rootIgnoreFile !== null) ignoreChain.push(rootIgnoreFile)

    const pathFromRoot = relative(rootAbsolutePath, directoryAbsolutePath)
    if (pathFromRoot === '') return { ignoreChain, isWithinIgnoredDirectory }
    let currentAbsolutePath = rootAbsolutePath
    for (const pathSegment of pathFromRoot.split('/')) {
      currentAbsolutePath = join(currentAbsolutePath, pathSegment)
      if (!isWithinIgnoredDirectory) {
        isWithinIgnoredDirectory =
          pathSegment === '.git' || isPathIgnored(ignoreChain, currentAbsolutePath, true)
      }
      const ignoreFile = await loadIgnoreFile(currentAbsolutePath)
      if (ignoreFile !== null) ignoreChain.push(ignoreFile)
    }
    return { ignoreChain, isWithinIgnoredDirectory }
  }

  async function describeEntry(
    parentAbsolutePath: string,
    entryName: string,
  ): Promise<DirectoryEntry> {
    const absolutePath = join(parentAbsolutePath, entryName)
    const isHidden = entryName.startsWith('.')

    let isSymlink = false
    try {
      isSymlink = (await lstat(absolutePath)).isSymbolicLink()
    } catch {
      // Entry vanished between readdir and lstat; fall through to `other`.
    }

    // An escaping symlink is described loudly but blankly: the row stays in the
    // listing (ADR-0025 — never hide a thing to say it is unavailable) while
    // every fact about its target is withheld, including whether it is a file
    // or a directory. Stat-ing it would follow the link and leak exactly the
    // metadata the confinement exists to withhold, so this returns first.
    //
    // Costs one `realpath` per symlink, and none at all for ordinary entries:
    // the `isSymlink` above is read from the `lstat` this function already did.
    if (isSymlink && !(await isRealPathWithinRoot(absolutePath))) {
      return {
        name: entryName,
        kind: 'other',
        sizeBytes: null,
        childCount: null,
        isExecutable: false,
        isHidden,
        isSymlink: true,
        isGitignored: false,
        escapesRoot: true,
      }
    }

    try {
      const entryInfo = await stat(absolutePath)
      if (entryInfo.isDirectory()) {
        let childCount: number | null = null
        try {
          childCount = (await readdir(absolutePath)).length
        } catch {
          // Unreadable directory (permissions): childCount stays null.
        }
        return {
          name: entryName,
          kind: 'directory',
          sizeBytes: null,
          childCount,
          isExecutable: false,
          isHidden,
          isSymlink,
          isGitignored: false,
          escapesRoot: false,
        }
      }
      if (entryInfo.isFile()) {
        return {
          name: entryName,
          kind: 'file',
          sizeBytes: entryInfo.size,
          childCount: null,
          isExecutable: (entryInfo.mode & 0o111) !== 0,
          isHidden,
          isSymlink,
          isGitignored: false,
          escapesRoot: false,
        }
      }
    } catch {
      // Broken symlink or stat failure: report as `other` below.
    }
    return {
      name: entryName,
      kind: 'other',
      sizeBytes: null,
      childCount: null,
      isExecutable: false,
      isHidden,
      isSymlink,
      isGitignored: false,
      escapesRoot: false,
    }
  }

  async function listDirectory(requestedRelativePath: string): Promise<ListDirectoryResult> {
    const absolutePath = resolveWithinRoot(requestedRelativePath)
    if (absolutePath === null) return { ok: false, reason: 'outside-root' }

    let entryNames: string[]
    try {
      entryNames = await readdir(absolutePath)
    } catch (readError) {
      const errorCode = (readError as NodeJS.ErrnoException).code
      if (errorCode === 'ENOENT') return { ok: false, reason: 'not-found' }
      if (errorCode === 'ENOTDIR') return { ok: false, reason: 'not-a-directory' }
      return { ok: false, reason: 'not-readable' }
    }
    if (!(await isRealPathWithinRoot(absolutePath)))
      return { ok: false, reason: 'symlink-escapes-root' }

    const { ignoreChain, isWithinIgnoredDirectory } = await buildIgnoreContext(absolutePath)
    const entries = await Promise.all(
      entryNames.map(async (entryName) => {
        const described = await describeEntry(absolutePath, entryName)
        const isDirectory = described.kind === 'directory'
        described.isGitignored =
          isWithinIgnoredDirectory ||
          (entryName === '.git' && isDirectory) ||
          isPathIgnored(ignoreChain, join(absolutePath, entryName), isDirectory)
        return described
      }),
    )
    return {
      ok: true,
      listing: {
        rootPath: rootAbsolutePath,
        relativePath: relative(rootAbsolutePath, absolutePath),
        entries,
      },
    }
  }

  // Resolves a relative path to an absolute file path for serving its bytes.
  // Same confinement as listings: paths that escape the root are rejected.
  async function resolveFile(requestedRelativePath: string): Promise<ResolveFileResult> {
    const absolutePath = resolveWithinRoot(requestedRelativePath)
    if (absolutePath === null) return { ok: false, reason: 'outside-root' }
    let entryInfo: Stats
    try {
      entryInfo = await stat(absolutePath)
    } catch (statError) {
      const errorCode = (statError as NodeJS.ErrnoException).code
      if (errorCode === 'ENOENT' || errorCode === 'ENOTDIR') return { ok: false, reason: 'not-found' }
      return { ok: false, reason: 'not-readable' }
    }
    // Confinement outranks the kind verdict, and must be answered before it:
    // replying `not-a-file` for an escaping symlink discloses that its target is
    // a directory — precisely the fact the listing withholds. Both kinds of
    // escaping link now give the same answer.
    if (!(await isRealPathWithinRoot(absolutePath)))
      return { ok: false, reason: 'symlink-escapes-root' }
    if (!entryInfo.isFile()) return { ok: false, reason: 'not-a-file' }
    return { ok: true, absolutePath }
  }

  // Opens a file with the OS default application on the host machine — the
  // explorer's "open" gesture. Confinement matches resolveFile: only files
  // inside the served root can be opened.
  async function openFile(requestedRelativePath: string): Promise<OpenFileServiceResult> {
    const resolved = await resolveFile(requestedRelativePath)
    if (!resolved.ok) return { ok: false, reason: resolved.reason }
    try {
      openPathWithDefaultApplication(resolved.absolutePath)
    } catch {
      return { ok: false, reason: 'open-failed' }
    }
    return { ok: true, relativePath: relative(rootAbsolutePath, resolved.absolutePath) }
  }

  // --- Recursive fuzzy search (re-engineered from broot's tree builder,
  // `tree_build/builder.rs`, used as the reference spec) ---

  // The builder's working line, broot's BLine. Lines live in an arena (a flat
  // array) and reference each other by index.
  type BuildLine = {
    parentIndex: number | null
    name: string
    subpath: string // from the search root; '' for the search root itself
    absolutePath: string
    depth: number
    kind: 'directory' | 'file' | 'other'
    isSymlink: boolean
    isHidden: boolean
    isGitignored: boolean
    ignoreChain: IgnoreFile[] // for directories: the chain governing their children
    childIndexes: number[] | null // null until the directory's children are loaded
    nextChildIndex: number // children emitted so far; children.length − this = unlisted
    hasMatch: boolean // shown: a direct match, or a directory containing one
    directMatch: boolean
    score: number
    keptChildCount: number
  }

  // Minimal binary min-heap for the trim step: pops the lowest-scoring
  // removable line first (broot's BinaryHeap<SortableBId> with reversed Ord).
  function createRemovalHeap() {
    const heapedLineIndexes: number[] = []
    const heapedScores: number[] = []
    function swap(firstSlot: number, secondSlot: number): void {
      ;[heapedLineIndexes[firstSlot], heapedLineIndexes[secondSlot]] = [
        heapedLineIndexes[secondSlot]!,
        heapedLineIndexes[firstSlot]!,
      ]
      ;[heapedScores[firstSlot], heapedScores[secondSlot]] = [
        heapedScores[secondSlot]!,
        heapedScores[firstSlot]!,
      ]
    }
    return {
      push(lineIndex: number, score: number): void {
        heapedLineIndexes.push(lineIndex)
        heapedScores.push(score)
        let slot = heapedScores.length - 1
        while (slot > 0) {
          const parentSlot = (slot - 1) >> 1
          if (heapedScores[parentSlot]! <= heapedScores[slot]!) break
          swap(parentSlot, slot)
          slot = parentSlot
        }
      },
      pop(): number | null {
        if (heapedScores.length === 0) return null
        const poppedLineIndex = heapedLineIndexes[0]!
        swap(0, heapedScores.length - 1)
        heapedLineIndexes.pop()
        heapedScores.pop()
        let slot = 0
        while (true) {
          const leftSlot = slot * 2 + 1
          const rightSlot = leftSlot + 1
          let smallestSlot = slot
          if (leftSlot < heapedScores.length && heapedScores[leftSlot]! < heapedScores[smallestSlot]!)
            smallestSlot = leftSlot
          if (rightSlot < heapedScores.length && heapedScores[rightSlot]! < heapedScores[smallestSlot]!)
            smallestSlot = rightSlot
          if (smallestSlot === slot) break
          swap(slot, smallestSlot)
          slot = smallestSlot
        }
        return poppedLineIndex
      },
    }
  }

  // Bounded best-first search under `requestedRelativePath`, broot-style.
  // The pattern scores each entry's *subpath* from the search root (broot's
  // default PathFuzzy mode), so everything inside a matching directory is a
  // match too. Level-by-level breadth-first gather, round-robin across the
  // directories of the current level; scores are depth-doped so shallow
  // matches win; then the lowest-scoring leaves are trimmed until the tree
  // fits `limit` lines, keeping every ancestor chain and per-directory
  // "unlisted" counts. Symlinked directories are not descended into (no
  // cycles), and the client aborting the request stops the walk.
  async function searchSubtree(
    requestedRelativePath: string,
    searchOptions: SearchSubtreeOptions,
  ): Promise<SearchSubtreeServiceResult> {
    const searchRootAbsolutePath = resolveWithinRoot(requestedRelativePath)
    if (searchRootAbsolutePath === null) return { ok: false, reason: 'outside-root' }

    // The search root itself must be listable: report failures like listDirectory.
    try {
      await readdir(searchRootAbsolutePath)
    } catch (readError) {
      const errorCode = (readError as NodeJS.ErrnoException).code
      if (errorCode === 'ENOENT') return { ok: false, reason: 'not-found' }
      if (errorCode === 'ENOTDIR') return { ok: false, reason: 'not-a-directory' }
      return { ok: false, reason: 'not-readable' }
    }
    if (!(await isRealPathWithinRoot(searchRootAbsolutePath)))
      return { ok: false, reason: 'symlink-escapes-root' }

    const startedAt = performance.now()
    const goodEnoughDeadline = startedAt + SEARCH_TIME_BUDGET_MILLISECONDS
    const hardDeadline = startedAt + SEARCH_HARD_TIME_LIMIT_MILLISECONDS
    const overscanTarget = searchOptions.limit * SEARCH_OVERSCAN_FACTOR

    const baseContext = await buildIgnoreContext(searchRootAbsolutePath)
    const lines: BuildLine[] = [
      {
        parentIndex: null,
        name: '',
        subpath: '',
        absolutePath: searchRootAbsolutePath,
        depth: 0,
        kind: 'directory',
        isSymlink: false,
        isHidden: false,
        isGitignored: baseContext.isWithinIgnoredDirectory,
        ignoreChain: baseContext.ignoreChain,
        childIndexes: null,
        nextChildIndex: 0,
        hasMatch: true, // the root line always shows, like broot's from_root
        directMatch: false,
        score: 0,
        keptChildCount: 0,
      },
    ]
    let scannedDirectoryCount = 0
    let discoveredMatchCount = 0

    // broot's load_children: read a directory, filter, score, sort its
    // children case-insensitively, and report whether any child matched.
    // Non-matching files are dropped; directories always survive (they may
    // contain matches).
    async function loadChildren(directoryIndex: number): Promise<boolean> {
      const directoryLine = lines[directoryIndex]!
      // The directory's own .gitignore governs its children (the search
      // root's own file is already in its chain via buildIgnoreContext).
      if (directoryLine.subpath !== '') {
        const ownIgnoreFile = await loadIgnoreFile(directoryLine.absolutePath)
        if (ownIgnoreFile !== null)
          directoryLine.ignoreChain = [...directoryLine.ignoreChain, ownIgnoreFile]
      }
      let directoryEntries: Dirent[]
      try {
        directoryEntries = await readdir(directoryLine.absolutePath, { withFileTypes: true })
      } catch {
        // Unreadable subdirectory: treat as empty, keep searching elsewhere.
        directoryLine.childIndexes = []
        return false
      }
      scannedDirectoryCount++
      const childDepth = directoryLine.depth + 1
      const childIndexes: number[] = []
      let hasChildMatch = false
      for (const dirent of directoryEntries) {
        const entryName = dirent.name
        const entryIsHidden = entryName.startsWith('.')
        if (!searchOptions.showHidden && entryIsHidden) continue
        const entryIsDirectory = dirent.isDirectory()
        const entryAbsolutePath = join(directoryLine.absolutePath, entryName)
        const entryIsGitignored =
          directoryLine.isGitignored ||
          (entryName === '.git' && entryIsDirectory) ||
          isPathIgnored(directoryLine.ignoreChain, entryAbsolutePath, entryIsDirectory)
        if (!searchOptions.showGitignored && entryIsGitignored) continue

        const entrySubpath =
          directoryLine.subpath === '' ? entryName : `${directoryLine.subpath}/${entryName}`
        const scored = fuzzyScore(searchOptions.pattern, entrySubpath)
        if (scored === null && !entryIsDirectory) continue
        const directMatch = scored !== null
        if (directMatch) {
          discoveredMatchCount++
          hasChildMatch = true
        }
        childIndexes.push(lines.length)
        lines.push({
          parentIndex: directoryIndex,
          name: entryName,
          subpath: entrySubpath,
          absolutePath: entryAbsolutePath,
          depth: childDepth,
          kind: entryIsDirectory ? 'directory' : dirent.isFile() ? 'file' : 'other',
          isSymlink: dirent.isSymbolicLink(),
          isHidden: entryIsHidden,
          isGitignored: entryIsGitignored,
          ignoreChain: directoryLine.ignoreChain,
          childIndexes: null,
          nextChildIndex: 0,
          hasMatch: directMatch,
          directMatch,
          score:
            SEARCH_DEPTH_DOPING_BASE -
            childDepth +
            (scored === null ? 0 : scored.score + SEARCH_DIRECT_MATCH_BONUS),
          keptChildCount: 0,
        })
      }
      childIndexes.sort((firstIndex, secondIndex) => {
        const firstName = lines[firstIndex]!.name.toLowerCase()
        const secondName = lines[secondIndex]!.name.toLowerCase()
        return firstName < secondName ? -1 : firstName > secondName ? 1 : 0
      })
      directoryLine.childIndexes = childIndexes
      return hasChildMatch
    }

    function nextChild(directoryIndex: number): number | null {
      const directoryLine = lines[directoryIndex]!
      const childIndexes = directoryLine.childIndexes!
      if (directoryLine.nextChildIndex >= childIndexes.length) return null
      return childIndexes[directoryLine.nextChildIndex++]!
    }

    // Gather, broot's gather_lines: emit lines one at a time, round-robin
    // across the open directories of the current level; descend a level only
    // when the current one is exhausted. `okLineCount` counts lines that
    // would display (matches + directories containing matches).
    const outLineIndexes: number[] = [0]
    let okLineCount = 1
    let totalSearch = true
    await loadChildren(0)
    const openDirectories: number[] = [0]
    let openDirectoriesHead = 0
    let nextLevelDirectories: number[] = []

    gather: while (true) {
      if (
        searchOptions.abortSignal.aborted ||
        performance.now() > hardDeadline ||
        okLineCount > overscanTarget ||
        (okLineCount >= searchOptions.limit && performance.now() > goodEnoughDeadline)
      ) {
        totalSearch = false
        break
      }
      if (openDirectoriesHead < openDirectories.length) {
        const directoryIndex = openDirectories[openDirectoriesHead++]!
        const childIndex = nextChild(directoryIndex)
        if (childIndex !== null) {
          openDirectories.push(directoryIndex)
          const childLine = lines[childIndex]!
          if (childLine.hasMatch) okLineCount++
          if (childLine.kind === 'directory') nextLevelDirectories.push(childIndex)
          outLineIndexes.push(childIndex)
        }
      } else {
        // This level is finished: go deeper.
        if (nextLevelDirectories.length === 0) break
        for (const nextLevelDirectoryIndex of nextLevelDirectories) {
          if (searchOptions.abortSignal.aborted || performance.now() > hardDeadline) {
            totalSearch = false
            break gather
          }
          const hasChildMatch = await loadChildren(nextLevelDirectoryIndex)
          if (hasChildMatch) {
            // Make the whole ancestor chain displayable (broot: "we must
            // ensure the ancestors are made Ok").
            let ancestorIndex: number | null = nextLevelDirectoryIndex
            while (ancestorIndex !== null) {
              const ancestorLine: BuildLine = lines[ancestorIndex]!
              if (!ancestorLine.hasMatch) {
                ancestorLine.hasMatch = true
                okLineCount++
              }
              ancestorIndex = ancestorLine.parentIndex
            }
          }
          openDirectories.push(nextLevelDirectoryIndex)
        }
        nextLevelDirectories = []
      }
    }
    const walkMatchCount = discoveredMatchCount

    // With a pattern the root is never trimmed (broot's trim_root=false):
    // finish emitting the search root's children so every top-level match
    // is at least present before trimming.
    let remainingRootChildIndex: number | null
    while ((remainingRootChildIndex = nextChild(0)) !== null) {
      outLineIndexes.push(remainingRootChildIndex)
    }

    // Trim, broot's trim_excess: only when the walk stopped early. Repeatedly
    // drop the lowest-scoring displayable leaf (never a top-level line),
    // cascading to parents left childless; each removal feeds the parent's
    // unlisted count through nextChildIndex.
    if (!totalSearch) {
      let keptLineCount = 1
      for (const lineIndex of outLineIndexes) {
        if (lineIndex === 0) continue
        const line = lines[lineIndex]!
        if (line.hasMatch) {
          keptLineCount++
          lines[line.parentIndex!]!.keptChildCount++
        }
      }
      const removalHeap = createRemovalHeap()
      for (const lineIndex of outLineIndexes) {
        if (lineIndex === 0) continue
        const line = lines[lineIndex]!
        if (line.hasMatch && line.keptChildCount === 0 && line.depth > 1) {
          removalHeap.push(lineIndex, line.score)
        }
      }
      while (keptLineCount > searchOptions.limit) {
        const removedLineIndex = removalHeap.pop()
        if (removedLineIndex === null) break
        const removedLine = lines[removedLineIndex]!
        removedLine.hasMatch = false
        const parentIndex = removedLine.parentIndex!
        const parentLine = lines[parentIndex]!
        parentLine.keptChildCount--
        parentLine.nextChildIndex--
        if (parentLine.keptChildCount === 0 && parentIndex !== 0) {
          removalHeap.push(parentIndex, parentLine.score)
        }
        keptLineCount--
      }
    }

    // Assemble the kept lines, in emission order. Kept directories whose
    // children were never loaded get a listing now, purely to count their
    // unlisted entries (broot's take_as_tree does the same). Only kept files
    // are stat'ed — the walk itself never stats.
    const nodes: SearchNode[] = []
    let returnedMatchCount = 0
    for (const lineIndex of outLineIndexes) {
      if (lineIndex === 0) continue
      const line = lines[lineIndex]!
      if (!line.hasMatch) continue
      if (line.kind === 'directory' && line.childIndexes === null) await loadChildren(lineIndex)
      const unlisted =
        line.kind === 'directory' ? line.childIndexes!.length - line.nextChildIndex : 0
      // Search results resolve symlinks to show what they point at, so they
      // need the same withholding as a listing: check before the stat below,
      // never after.
      const escapesRoot = line.isSymlink && !(await isRealPathWithinRoot(line.absolutePath))
      let entry: DirectoryEntry = {
        name: line.name,
        kind: line.kind === 'directory' ? 'directory' : 'other',
        sizeBytes: null,
        childCount: null,
        isExecutable: false,
        isSymlink: line.isSymlink,
        isHidden: line.isHidden,
        isGitignored: line.isGitignored,
        escapesRoot,
      }
      if (!escapesRoot && (line.kind === 'file' || (line.kind === 'other' && line.isSymlink))) {
        try {
          const entryInfo = await stat(line.absolutePath)
          if (entryInfo.isDirectory()) {
            entry = { ...entry, kind: 'directory' }
          } else if (entryInfo.isFile()) {
            entry = {
              ...entry,
              kind: 'file',
              sizeBytes: entryInfo.size,
              isExecutable: (entryInfo.mode & 0o111) !== 0,
            }
          }
        } catch {
          // Vanished or broken symlink: stays `other`.
        }
      }
      if (line.directMatch) returnedMatchCount++
      nodes.push({
        path: line.subpath,
        entry,
        score: line.directMatch ? line.score : null,
        directMatch: line.directMatch,
        unlisted,
      })
    }

    return {
      ok: true,
      result: {
        rootPath: rootAbsolutePath,
        relativePath: relative(rootAbsolutePath, searchRootAbsolutePath),
        pattern: searchOptions.pattern,
        nodes,
        stats: {
          matchCount: walkMatchCount,
          returnedMatchCount,
          scannedDirectoryCount,
          truncated: !totalSearch,
          elapsedMilliseconds: Math.round(performance.now() - startedAt),
        },
      },
    }
  }

  return { rootAbsolutePath, listDirectory, resolveFile, openFile, searchSubtree }
}

export type FilesystemService = ReturnType<typeof createFilesystemService>
