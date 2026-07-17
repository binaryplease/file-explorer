import { statSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { lstat, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { DirectoryEntry, DirectoryListing } from '../../shared/filesystem.schema'
import type { SearchNode, SearchSubtreeResult } from '../../shared/search.schema'
import { fuzzyScore } from '../../shared/fuzzy'
import { isPathIgnored, loadIgnoreFile, type IgnoreFile } from './ignore'

export type ListDirectoryFailureReason =
  | 'outside-root'
  | 'not-found'
  | 'not-a-directory'
  | 'not-readable'

export type ListDirectoryResult =
  | { ok: true; listing: DirectoryListing }
  | { ok: false; reason: ListDirectoryFailureReason }

export type ReadFileFailureReason = 'outside-root' | 'not-found' | 'not-a-file' | 'not-readable'

export type ResolveFileResult =
  | { ok: true; absolutePath: string }
  | { ok: false; reason: ReadFileFailureReason }

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
// walking until 10× the wanted match count is gathered or ~900ms elapsed, then
// trim to the best-scoring matches. See
// `.nightshift/research/2026-07-17-broot-engine.md`.
const SEARCH_TIME_BUDGET_MILLISECONDS = 900
const SEARCH_OVERSCAN_FACTOR = 10

// Factory per ADR-0007. Confines every listing to `rootAbsolutePath`; a request
// that lexically escapes the root is rejected, never resolved.
export function createFilesystemService(options: { rootAbsolutePath: string }) {
  const rootAbsolutePath = resolve(options.rootAbsolutePath)

  const rootInfo = statSync(rootAbsolutePath, { throwIfNoEntry: false })
  if (rootInfo === undefined || !rootInfo.isDirectory()) {
    throw new Error(`explorer root is not a directory: ${rootAbsolutePath}`)
  }

  function resolveWithinRoot(requestedRelativePath: string): string | null {
    const absolutePath = resolve(rootAbsolutePath, requestedRelativePath)
    const pathFromRoot = relative(rootAbsolutePath, absolutePath)
    if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) return null
    return absolutePath
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
    try {
      const fileInfo = await stat(absolutePath)
      if (!fileInfo.isFile()) return { ok: false, reason: 'not-a-file' }
    } catch (statError) {
      const errorCode = (statError as NodeJS.ErrnoException).code
      if (errorCode === 'ENOENT' || errorCode === 'ENOTDIR') return { ok: false, reason: 'not-found' }
      return { ok: false, reason: 'not-readable' }
    }
    return { ok: true, absolutePath }
  }

  // --- Recursive fuzzy search (re-engineered from broot's tree builder) ---

  type PendingDirectory = {
    absolutePath: string
    relativePath: string // from the search root; '' for the search root itself
    ignoreChain: IgnoreFile[]
    isIgnored: boolean // the directory (or an ancestor) is gitignored
  }

  type WalkMatch = {
    relativePath: string
    name: string
    score: number
    dirent: Dirent
    isHidden: boolean
    isGitignored: boolean
  }

  type VisitedDirectory = { name: string; isHidden: boolean; isGitignored: boolean }

  function directoryNode(
    relativePath: string,
    directoryInfo: VisitedDirectory,
    score: number | null,
  ): SearchNode {
    return {
      path: relativePath,
      entry: {
        name: directoryInfo.name,
        kind: 'directory',
        sizeBytes: null,
        childCount: null,
        isExecutable: false,
        isHidden: directoryInfo.isHidden,
        isSymlink: false,
        isGitignored: directoryInfo.isGitignored,
      },
      score,
    }
  }

  // Resolves a kept match into a full DirectoryEntry. Only the trimmed final
  // matches are stat'ed — the walk itself never stats.
  async function describeMatch(searchRootAbsolutePath: string, match: WalkMatch): Promise<SearchNode> {
    const shared = { isHidden: match.isHidden, isGitignored: match.isGitignored }
    const isSymlink = match.dirent.isSymbolicLink()
    let entry: DirectoryEntry = {
      name: match.name,
      kind: 'other',
      sizeBytes: null,
      childCount: null,
      isExecutable: false,
      isSymlink,
      ...shared,
    }
    if (match.dirent.isDirectory()) {
      entry = { ...entry, kind: 'directory' }
    } else if (match.dirent.isFile() || isSymlink) {
      try {
        const entryInfo = await stat(join(searchRootAbsolutePath, match.relativePath))
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
    return { path: match.relativePath, entry, score: match.score }
  }

  // Bounded best-first search under `requestedRelativePath`, broot-style:
  // breadth-first over directories (shallow matches surface first), gathering
  // up to `limit × 10` scored name matches within a ~900ms budget, then
  // trimming to the best-scoring `limit` while keeping every ancestor chain.
  // Symlinked directories are not descended into (no cycles), and the client
  // aborting the request stops the walk.
  async function searchSubtree(
    requestedRelativePath: string,
    searchOptions: SearchSubtreeOptions,
  ): Promise<SearchSubtreeServiceResult> {
    const searchRootAbsolutePath = resolveWithinRoot(requestedRelativePath)
    if (searchRootAbsolutePath === null) return { ok: false, reason: 'outside-root' }

    const startedAt = performance.now()
    const deadline = startedAt + SEARCH_TIME_BUDGET_MILLISECONDS
    const overscanTarget = searchOptions.limit * SEARCH_OVERSCAN_FACTOR

    const baseContext = await buildIgnoreContext(searchRootAbsolutePath)
    const pendingDirectories: PendingDirectory[] = [
      {
        absolutePath: searchRootAbsolutePath,
        relativePath: '',
        ignoreChain: baseContext.ignoreChain,
        isIgnored: baseContext.isWithinIgnoredDirectory,
      },
    ]
    const visitedDirectories = new Map<string, VisitedDirectory>()
    const matches: WalkMatch[] = []
    let scannedDirectoryCount = 0
    let truncated = false
    let queueIndex = 0

    while (queueIndex < pendingDirectories.length) {
      if (
        searchOptions.abortSignal.aborted ||
        matches.length >= overscanTarget ||
        performance.now() > deadline
      ) {
        truncated = true
        break
      }
      const directory = pendingDirectories[queueIndex++]!

      let directoryEntries: Dirent[]
      try {
        directoryEntries = await readdir(directory.absolutePath, { withFileTypes: true })
      } catch (readError) {
        if (scannedDirectoryCount === 0 && queueIndex === 1) {
          // The search root itself is unreadable: report it like listDirectory.
          const errorCode = (readError as NodeJS.ErrnoException).code
          if (errorCode === 'ENOENT') return { ok: false, reason: 'not-found' }
          if (errorCode === 'ENOTDIR') return { ok: false, reason: 'not-a-directory' }
          return { ok: false, reason: 'not-readable' }
        }
        // Unreadable subdirectory: skip it, keep searching.
        continue
      }
      scannedDirectoryCount++

      // The search root's own .gitignore is already in the base chain.
      let effectiveIgnoreChain = directory.ignoreChain
      if (directory.relativePath !== '') {
        const ownIgnoreFile = await loadIgnoreFile(directory.absolutePath)
        if (ownIgnoreFile !== null) {
          effectiveIgnoreChain = [...directory.ignoreChain, ownIgnoreFile]
        }
      }

      for (const dirent of directoryEntries) {
        const entryName = dirent.name
        const entryIsHidden = entryName.startsWith('.')
        if (!searchOptions.showHidden && entryIsHidden) continue
        const entryIsDirectory = dirent.isDirectory()
        const entryAbsolutePath = join(directory.absolutePath, entryName)
        const entryIsGitignored =
          directory.isIgnored ||
          (entryName === '.git' && entryIsDirectory) ||
          isPathIgnored(effectiveIgnoreChain, entryAbsolutePath, entryIsDirectory)
        if (!searchOptions.showGitignored && entryIsGitignored) continue

        const entryRelativePath =
          directory.relativePath === '' ? entryName : `${directory.relativePath}/${entryName}`
        if (entryIsDirectory) {
          pendingDirectories.push({
            absolutePath: entryAbsolutePath,
            relativePath: entryRelativePath,
            ignoreChain: effectiveIgnoreChain,
            isIgnored: entryIsGitignored,
          })
          visitedDirectories.set(entryRelativePath, {
            name: entryName,
            isHidden: entryIsHidden,
            isGitignored: entryIsGitignored,
          })
        }
        const scored = fuzzyScore(searchOptions.pattern, entryName)
        if (scored !== null) {
          matches.push({
            relativePath: entryRelativePath,
            name: entryName,
            score: scored.score,
            dirent,
            isHidden: entryIsHidden,
            isGitignored: entryIsGitignored,
          })
        }
      }
    }

    matches.sort(
      (firstMatch, secondMatch) =>
        secondMatch.score - firstMatch.score ||
        firstMatch.relativePath.localeCompare(secondMatch.relativePath),
    )
    const keptMatches = matches.slice(0, searchOptions.limit)

    const nodesByPath = new Map<string, SearchNode>()
    for (const keptMatch of keptMatches) {
      nodesByPath.set(keptMatch.relativePath, await describeMatch(searchRootAbsolutePath, keptMatch))
      // Connect the match to the search root: every ancestor directory was
      // necessarily visited during the walk.
      let ancestorPath = keptMatch.relativePath
      while (true) {
        const lastSlashIndex = ancestorPath.lastIndexOf('/')
        if (lastSlashIndex === -1) break
        ancestorPath = ancestorPath.slice(0, lastSlashIndex)
        if (nodesByPath.has(ancestorPath)) break
        const directoryInfo = visitedDirectories.get(ancestorPath)
        if (directoryInfo === undefined) break
        nodesByPath.set(ancestorPath, directoryNode(ancestorPath, directoryInfo, null))
      }
    }

    return {
      ok: true,
      result: {
        rootPath: rootAbsolutePath,
        relativePath: relative(rootAbsolutePath, searchRootAbsolutePath),
        pattern: searchOptions.pattern,
        nodes: [...nodesByPath.values()],
        stats: {
          matchCount: matches.length,
          returnedMatchCount: keptMatches.length,
          scannedDirectoryCount,
          truncated,
          elapsedMilliseconds: Math.round(performance.now() - startedAt),
        },
      },
    }
  }

  return { rootAbsolutePath, listDirectory, resolveFile, searchSubtree }
}

export type FilesystemService = ReturnType<typeof createFilesystemService>
