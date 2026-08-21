import { constants as fileSystemConstants, realpathSync, statSync } from 'node:fs'
import type { Dirent, Stats } from 'node:fs'
import { lstat, open, readdir, realpath, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { DirectoryEntry, DirectoryListing } from '../../shared/filesystem.schema'
import type { SearchNode, SearchSubtreeResult } from '../../shared/search.schema'
import { fuzzyScore } from '../../shared/fuzzy'
import { isPathIgnored, loadIgnoreFile, type IgnoreFile } from './ignore'
import {
  createListingCounters,
  type ListingCounters,
  type ListingTiming,
} from './listing-timing'
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

// A successful listing carries what it cost alongside what it found. The
// budget in `docs/requirements/101-performance-budgets.md` is only enforceable
// if every listing reports its own timing, so the measurement is part of the
// result rather than something a caller has to wrap the call to obtain.
export type ListDirectoryResult =
  | { ok: true; listing: DirectoryListing; timing: ListingTiming }
  | { ok: false; reason: ListDirectoryFailureReason }

export type ReadFileFailureReason =
  | 'outside-root'
  | 'symlink-escapes-root'
  | 'not-found'
  | 'not-a-file'
  | 'not-readable'

export type ResolveFileResult =
  | { ok: true; absolutePath: string; sizeBytes: number }
  | { ok: false; reason: ReadFileFailureReason }

// A file that has been *opened*, not merely resolved — see `openReadableFile`.
// Confined, `handle` is an open descriptor whose containment has been verified
// and which the caller must read the bytes from, then close. Unconfined there
// is nothing to confine, so `handle` is null and the caller reads by path
// exactly as before (ADR-0024: the property is emitted either way).
export type OpenReadableFileResult =
  | { ok: true; absolutePath: string; sizeBytes: number; handle: FileHandle | null }
  | { ok: false; reason: ReadFileFailureReason }

// `O_NONBLOCK` so that opening a FIFO or a device node cannot park the request
// forever waiting for a writer: the kind verdict below rejects them anyway, but
// only once the open has returned. Harmless for regular files.
const READ_ONLY_OPEN_FLAGS = fileSystemConstants.O_RDONLY | fileSystemConstants.O_NONBLOCK

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
// `docs/research/2026-07-17-broot-engine.md`.
const SEARCH_TIME_BUDGET_MILLISECONDS = 900
const SEARCH_OVERSCAN_FACTOR = 10
// broot walks until interrupted by a keystroke; a server request needs a hard
// stop even when matches are scarce and the good-enough rule never fires.
const SEARCH_HARD_TIME_LIMIT_MILLISECONDS = 3000
// Depth doping, per broot's make_bline: shallow lines outrank deep ones, and
// direct matches get a small extra bump over ancestor-only directories.
const SEARCH_DEPTH_DOPING_BASE = 10_000
const SEARCH_DIRECT_MATCH_BONUS = 10

// What a directory entry is *before* following it — the `lstat` verdict. The
// one `readdir(…, { withFileTypes: true })` that reads the directory already
// carries it, so asking the entry costs nothing.
//
// `unknown` is the case that must not be quietly folded into `other`: a
// filesystem that does not fill in the kernel's `d_type` (some network and
// older on-disk filesystems) reports every entry as unknown, and treating that
// as `other` would blank the whole listing on those mounts. It is answered with
// an `lstat` that no other entry pays for.
type EntryLinkKind = 'directory' | 'file' | 'symlink' | 'other' | 'unknown'

function direntLinkKind(dirent: Dirent): EntryLinkKind {
  if (dirent.isSymbolicLink()) return 'symlink'
  if (dirent.isDirectory()) return 'directory'
  if (dirent.isFile()) return 'file'
  if (
    dirent.isBlockDevice() ||
    dirent.isCharacterDevice() ||
    dirent.isFIFO() ||
    dirent.isSocket()
  ) {
    return 'other'
  }
  return 'unknown'
}

function statsLinkKind(entryInfo: Stats): EntryLinkKind {
  if (entryInfo.isSymbolicLink()) return 'symlink'
  if (entryInfo.isDirectory()) return 'directory'
  if (entryInfo.isFile()) return 'file'
  return 'other'
}

// `join(parent, name)` for the one case a listing ever needs: an already
// normalized absolute parent, and a dirent name, which cannot contain a
// separator. `join` re-normalizes both on every call, which is 40 000 wasted
// normalizations on a directory that size, so the prefix is built once per
// listing and the name concatenated onto it.
function entryPathPrefixOf(directoryAbsolutePath: string): string {
  return directoryAbsolutePath.endsWith('/') ? directoryAbsolutePath : `${directoryAbsolutePath}/`
}

// True when `absolutePath` is `containerAbsolutePath` itself or sits beneath
// it. Compares path segments, so a sibling (`../elsewhere`) is rejected while a
// legitimately-named child (`..config`) is not.
function isPathWithin(containerAbsolutePath: string, absolutePath: string): boolean {
  const pathFromContainer = relative(containerAbsolutePath, absolutePath)
  if (pathFromContainer === '') return true
  if (isAbsolute(pathFromContainer)) return false
  return pathFromContainer !== '..' && !pathFromContainer.startsWith('../')
}

// Factory per ADR-0007.
//
// `confine` decides what the root *is*. Confined (the default, and what any
// hosted surface must use), the root is a security boundary: a request that
// escapes it — lexically, or through a symlink pointing outside it — is
// rejected, never resolved. Unconfined, the root is only the tree's starting
// anchor: absolute paths anywhere on the machine resolve, nothing is refused
// for leaving the root, and the per-symlink `realpath()` disappears from the
// hot path. Local-machine use runs unconfined (the process already has the
// user's own filesystem privileges); see
// `docs/decisions/2026-07-20-no-path-confinement-for-local-use.md`.
export function createFilesystemService(options: {
  rootAbsolutePath: string
  confine?: boolean
}) {
  const confine = options.confine ?? true
  const rootAbsolutePath = resolve(options.rootAbsolutePath)

  const rootInfo = statSync(rootAbsolutePath, { throwIfNoEntry: false })
  if (rootInfo === undefined || !rootInfo.isDirectory()) {
    throw new Error(`explorer root is not a directory: ${rootAbsolutePath}`)
  }

  // The root may itself be reached through a symlink (`/tmp`, a home directory
  // on a mounted volume). Real paths are only comparable against another real
  // path, so resolve the root once here rather than on every request. Only
  // confinement compares against it, so only confinement pays for it.
  const rootRealPath = confine ? realpathSync(rootAbsolutePath) : null

  function resolveWithinRoot(requestedRelativePath: string): string | null {
    const absolutePath = resolve(rootAbsolutePath, requestedRelativePath)
    if (confine && !isPathWithin(rootAbsolutePath, absolutePath)) return null
    return absolutePath
  }

  // The path a resolved entry is addressed by on the wire, and the counterpart
  // of `resolveWithinRoot`. Inside the anchor it stays relative, which keeps
  // in-root browsing byte-identical to the confined format; outside it (only
  // reachable unconfined) it is the absolute path rather than a `../../` chain
  // — both round-trip through `resolve(root, …)`, but an absolute path also
  // survives the client's plain string join (`lib/tree.ts:63`) and reads
  // correctly in a breadcrumb.
  function pathFromRoot(absolutePath: string): string {
    if (!isPathWithin(rootAbsolutePath, absolutePath)) return absolutePath
    return relative(rootAbsolutePath, absolutePath)
  }

  // The lexical check above cannot see through symlinks: a link *inside* the
  // root pointing *outside* it resolves to a path that still looks contained.
  // Re-check containment against the root's real path for paths that exist.
  //
  // Callers run this only after their own stat/readdir has succeeded, so a
  // non-existent path is reported as not-found by that check and never reaches
  // here — which also keeps the extra syscall off the miss path. Unconfined
  // there is nothing to check and the syscall is skipped entirely; call sites
  // short-circuit on `confine` first so no promise is even allocated.
  async function isRealPathWithinRoot(
    absolutePath: string,
    counters?: ListingCounters,
  ): Promise<boolean> {
    if (!confine) return true
    if (counters !== undefined) counters.realpathCount++
    try {
      return isPathWithin(rootRealPath!, await realpath(absolutePath))
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

    // Unconfined, a directory can sit outside the anchor entirely, and the
    // anchor's ancestors are not its ancestors — walking up from the anchor
    // would apply unrelated rules. Such a directory is its own base: only its
    // own `.gitignore` governs it.
    if (!isPathWithin(rootAbsolutePath, directoryAbsolutePath)) {
      const ownIgnoreFile = await loadIgnoreFile(directoryAbsolutePath)
      if (ownIgnoreFile !== null) ignoreChain.push(ownIgnoreFile)
      return { ignoreChain, isWithinIgnoredDirectory }
    }

    const rootIgnoreFile = await loadIgnoreFile(rootAbsolutePath)
    if (rootIgnoreFile !== null) ignoreChain.push(rootIgnoreFile)

    const pathBelowRoot = relative(rootAbsolutePath, directoryAbsolutePath)
    if (pathBelowRoot === '') return { ignoreChain, isWithinIgnoredDirectory }
    let currentAbsolutePath = rootAbsolutePath
    for (const pathSegment of pathBelowRoot.split('/')) {
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

  // Describes one entry of a listing from the dirent its parent's `readdir`
  // produced. Every syscall past that `readdir` is issued only where the
  // dirent cannot answer the question:
  //
  //   - a plain directory needs no `stat` at all — the dirent already says
  //     `directory`, and a listing reports neither size nor mode for one;
  //   - a plain file needs one `stat`, for its size and execute bit;
  //   - `other` (socket, FIFO, device) needs none: the listing reports nothing
  //     about it beyond its kind;
  //   - only a *symlink* needs following, because what a listing shows for one
  //     is what it points at.
  //
  // Before this took its kinds from the dirent, every entry paid an `lstat`
  // *and* a `stat` — see `docs/requirements/013-large-directory-listing-performance.md`.
  //
  // One race narrowed: an entry deleted between its parent's `readdir` and this
  // call used to fall through to `other`, and a directory now reports as the
  // directory the `readdir` saw, with a null `childCount`. That is the more
  // faithful of the two answers — it existed when the directory was read — and
  // `childCount: null` already means "could not be counted".
  //
  // One race WIDENED, and it is the one to know about. The kind below is a
  // *snapshot*, taken by the parent's `readdir`, and the escaping-symlink guard
  // fires on the snapshot: an entry that was a real directory when the directory
  // was read and is a symlink out of the root by the time it is described is
  // followed with no containment check, reporting the new target's `childCount`
  // (or, on the file branch, its size and execute bit) with `escapesRoot: false`.
  // The check itself is not new — the non-symlink path never had one — but it
  // used to sit an `lstat` away from the syscall that followed the path, and now
  // sits a whole describe phase away (~76ms on a 40 000-entry directory), which
  // is a window a hostile writer inside a confined root can hit by looping.
  // Metadata only; no bytes cross. Closing it means resolving each entry through
  // a descriptor rather than a path, as `openReadableFile` does — a syscall per
  // entry, so it is a design against this budget, not a patch. Recorded in
  // `docs/requirements/013-large-directory-listing-performance.md`.
  async function describeDirent(
    dirent: Dirent,
    absolutePath: string,
    counters: ListingCounters,
    // The listing's `.gitignore` verdict, applied here rather than patched onto
    // the finished entry by the caller: a directory and a file are ignored by
    // different rules, so the verdict cannot be reached until the kind is
    // known, and reaching it here saves an async frame per entry — 40 000 of
    // them on the directory this exists to make fast.
    isGitignoredEntry: (
      entryAbsolutePath: string,
      entryName: string,
      isDirectory: boolean,
    ) => boolean,
  ): Promise<DirectoryEntry> {
    const entryName = dirent.name
    const isHidden = entryName.startsWith('.')

    let linkKind = direntLinkKind(dirent)
    if (linkKind === 'unknown') {
      try {
        counters.statCount++
        linkKind = statsLinkKind(await lstat(absolutePath))
      } catch {
        // Entry vanished between readdir and lstat; fall through to `other`.
        linkKind = 'other'
      }
    }
    const isSymlink = linkKind === 'symlink'

    // An escaping symlink is described loudly but blankly: the row stays in the
    // listing (`never-hide-a-control` — never hide a thing to say it is
    // unavailable) while every fact about its target is withheld, including
    // whether it is a file or a directory. Stat-ing it would follow the link and
    // leak exactly the metadata the confinement exists to withhold, so this
    // returns first, before any call that follows the link.
    //
    // Costs one `realpath` per symlink, and nothing at all for ordinary entries:
    // the `isSymlink` above came free with the parent's `readdir`.
    if (confine && isSymlink && !(await isRealPathWithinRoot(absolutePath, counters))) {
      return {
        name: entryName,
        kind: 'other',
        sizeBytes: null,
        childCount: null,
        isExecutable: false,
        isHidden,
        isSymlink: true,
        isGitignored: isGitignoredEntry(absolutePath, entryName, false),
        escapesRoot: true,
      }
    }

    // A symlink is the only kind whose dirent does not answer the question:
    // what a listing shows for one is what it points at. Everything else is
    // already known, so the `stat` is skipped.
    let targetKind = linkKind
    let targetInfo: Stats | null = null
    if (isSymlink) {
      try {
        counters.statCount++
        targetInfo = await stat(absolutePath)
        targetKind = statsLinkKind(targetInfo)
      } catch {
        // Broken link: reported as `other`, exactly as before.
        targetKind = 'other'
      }
    }

    if (targetKind === 'directory') {
      let childCount: number | null = null
      try {
        counters.childReaddirCount++
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
        isGitignored: isGitignoredEntry(absolutePath, entryName, true),
        escapesRoot: false,
      }
    }

    if (targetKind === 'file') {
      if (targetInfo === null) {
        try {
          counters.statCount++
          targetInfo = await stat(absolutePath)
        } catch {
          // Vanished between its parent's readdir and here: `other` below.
          targetInfo = null
        }
      }
      if (targetInfo !== null) {
        return {
          name: entryName,
          kind: 'file',
          sizeBytes: targetInfo.size,
          childCount: null,
          isExecutable: (targetInfo.mode & 0o111) !== 0,
          isHidden,
          isSymlink,
          isGitignored: isGitignoredEntry(absolutePath, entryName, false),
          escapesRoot: false,
        }
      }
    }

    return {
      name: entryName,
      kind: 'other',
      sizeBytes: null,
      childCount: null,
      isExecutable: false,
      isHidden,
      isSymlink,
      isGitignored: isGitignoredEntry(absolutePath, entryName, false),
      escapesRoot: false,
    }
  }

  async function listDirectory(requestedRelativePath: string): Promise<ListDirectoryResult> {
    const startedAt = performance.now()
    const counters = createListingCounters()

    const absolutePath = resolveWithinRoot(requestedRelativePath)
    if (absolutePath === null) return { ok: false, reason: 'outside-root' }

    // With dirent kinds, so the per-entry work below can skip the `lstat` that
    // used to precede every single entry, and the `stat` that used to follow
    // it for everything but a plain file. This is the shape the recursive
    // search walk has always used; the listing path predated it.
    let dirents: Dirent[]
    try {
      dirents = await readdir(absolutePath, { withFileTypes: true })
    } catch (readError) {
      const errorCode = (readError as NodeJS.ErrnoException).code
      if (errorCode === 'ENOENT') return { ok: false, reason: 'not-found' }
      if (errorCode === 'ENOTDIR') return { ok: false, reason: 'not-a-directory' }
      return { ok: false, reason: 'not-readable' }
    }
    if (confine && !(await isRealPathWithinRoot(absolutePath, counters)))
      return { ok: false, reason: 'symlink-escapes-root' }
    const readdirFinishedAt = performance.now()

    const { ignoreChain, isWithinIgnoredDirectory } = await buildIgnoreContext(absolutePath)
    const ignoreFinishedAt = performance.now()

    // The chain is the same for every entry of this listing, so the verdict is
    // closed over once here and handed down, rather than rebuilt per entry.
    const isGitignoredEntry = (
      entryAbsolutePath: string,
      entryName: string,
      isDirectory: boolean,
    ): boolean =>
      isWithinIgnoredDirectory ||
      (entryName === '.git' && isDirectory) ||
      isPathIgnored(ignoreChain, entryAbsolutePath, isDirectory)

    const entryPathPrefix = entryPathPrefixOf(absolutePath)
    const entries = await Promise.all(
      dirents.map((dirent) =>
        describeDirent(dirent, entryPathPrefix + dirent.name, counters, isGitignoredEntry),
      ),
    )
    const finishedAt = performance.now()

    return {
      ok: true,
      listing: {
        rootPath: rootAbsolutePath,
        relativePath: pathFromRoot(absolutePath),
        entries,
        confined: confine,
      },
      timing: {
        totalMilliseconds: finishedAt - startedAt,
        readdirMilliseconds: readdirFinishedAt - startedAt,
        ignoreMilliseconds: ignoreFinishedAt - readdirFinishedAt,
        describeMilliseconds: finishedAt - ignoreFinishedAt,
        entryCount: entries.length,
        directoryCount: entries.reduce(
          (runningCount, entry) => runningCount + (entry.kind === 'directory' ? 1 : 0),
          0,
        ),
        statCount: counters.statCount,
        childReaddirCount: counters.childReaddirCount,
        realpathCount: counters.realpathCount,
      },
    }
  }

  // Resolves a relative path to an absolute file path. Same confinement as
  // listings: paths that escape the root are rejected.
  //
  // This returns a *string*, so confined callers that go on to read bytes must
  // not use it — between this check and their open, a path component can be
  // swapped for a symlink leaving the root. `openReadableFile` below exists for
  // exactly that case and hands back the checked descriptor instead. What is
  // left here is `openFile`, which hands the path to the OS launcher: that
  // gap is irreducible (the launcher takes a path, and re-resolves it in
  // another process), and it opens the file as the user in their own session
  // rather than serving its bytes over HTTP.
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
    if (confine && !(await isRealPathWithinRoot(absolutePath)))
      return { ok: false, reason: 'symlink-escapes-root' }
    if (!entryInfo.isFile()) return { ok: false, reason: 'not-a-file' }
    return { ok: true, absolutePath, sizeBytes: entryInfo.size }
  }

  // Containment for a file that is already *open*, asked of the descriptor
  // rather than of the path that produced it — the difference that closes the
  // check/use gap.
  //
  // Linux publishes the kernel's own name for an open file at
  // `/proc/self/fd/<fd>`. Resolving that magic link asks the kernel where *this
  // inode* lives; there is no user-space path walk in it, so there is no window
  // in which a component can be swapped for a symlink. A `realpath()` of the
  // requested path answers a different, weaker question — "where does this name
  // point *right now*" — which is precisely what an attacker with write access
  // to the tree can change between the answer and the read.
  //
  // Where `/proc` is absent (macOS, BSD) there is no such primitive in Node, so
  // fall back to resolving the path and pinning the result to the descriptor by
  // identity: the resolved path must be inside the root *and* name the very
  // inode the handle holds. A swap is then still caught unless the attacker can
  // also reproduce the device/inode pair, which is strictly harder than today's
  // bare re-open by path.
  async function isOpenHandleWithinRoot(
    handle: FileHandle,
    absolutePath: string,
    handleInfo: Stats,
  ): Promise<boolean> {
    try {
      const kernelNameForHandle = await realpath(`/proc/self/fd/${handle.fd}`)
      return isPathWithin(rootRealPath!, kernelNameForHandle)
    } catch {
      // No /proc (or the entry is unnamed): fall back to path + identity.
    }
    try {
      const resolvedPath = await realpath(absolutePath)
      if (!isPathWithin(rootRealPath!, resolvedPath)) return false
      const resolvedInfo = await stat(resolvedPath)
      return resolvedInfo.dev === handleInfo.dev && resolvedInfo.ino === handleInfo.ino
    } catch {
      // Vanished mid-check. Deny: confinement must not depend on winning a race.
      return false
    }
  }

  // Resolves a file *and opens it*, so the caller can serve the bytes of the
  // descriptor that passed the containment check instead of re-opening the path
  // afterwards. `resolveFile` hands back a string, and a string has to be
  // resolved again at the point of use — between the two, an attacker holding
  // write access to the served tree can swap a path component for a symlink
  // pointing out of the root and have the out-of-confinement bytes served. This
  // returns the handle itself, so there is no second lookup to poison.
  //
  // Unconfined there is nothing to confine, and this must stay exactly as cheap
  // as it was: no open, no descriptor, no extra syscall — the caller reads by
  // path as before.
  async function openReadableFile(
    requestedRelativePath: string,
  ): Promise<OpenReadableFileResult> {
    if (!confine) {
      const resolved = await resolveFile(requestedRelativePath)
      if (!resolved.ok) return { ok: false, reason: resolved.reason }
      return {
        ok: true,
        absolutePath: resolved.absolutePath,
        sizeBytes: resolved.sizeBytes,
        handle: null,
      }
    }

    const absolutePath = resolveWithinRoot(requestedRelativePath)
    if (absolutePath === null) return { ok: false, reason: 'outside-root' }

    let handle: FileHandle
    try {
      handle = await open(absolutePath, READ_ONLY_OPEN_FLAGS)
    } catch (openError) {
      const errorCode = (openError as NodeJS.ErrnoException).code
      if (errorCode === 'ENOENT' || errorCode === 'ENOTDIR') return { ok: false, reason: 'not-found' }
      // A directory opened read-only succeeds on Linux and is rejected by the
      // kind verdict below; where the platform refuses it outright, the same
      // verdict has to be reached from the error.
      if (errorCode === 'EISDIR') return { ok: false, reason: 'not-a-file' }
      return { ok: false, reason: 'not-readable' }
    }

    try {
      const handleInfo = await handle.stat()
      // Confinement outranks the kind verdict and is answered first, exactly as
      // in `resolveFile`: replying `not-a-file` for an escaping symlink would
      // disclose that its target is a directory.
      if (!(await isOpenHandleWithinRoot(handle, absolutePath, handleInfo))) {
        await handle.close()
        return { ok: false, reason: 'symlink-escapes-root' }
      }
      if (!handleInfo.isFile()) {
        await handle.close()
        return { ok: false, reason: 'not-a-file' }
      }
      return { ok: true, absolutePath, sizeBytes: handleInfo.size, handle }
    } catch {
      await handle.close().catch(() => {})
      return { ok: false, reason: 'not-readable' }
    }
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
    return { ok: true, relativePath: pathFromRoot(resolved.absolutePath) }
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
    if (confine && !(await isRealPathWithinRoot(searchRootAbsolutePath)))
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
      const escapesRoot =
        confine && line.isSymlink && !(await isRealPathWithinRoot(line.absolutePath))
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
        relativePath: pathFromRoot(searchRootAbsolutePath),
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

  return {
    rootAbsolutePath,
    confine,
    listDirectory,
    resolveFile,
    openReadableFile,
    openFile,
    searchSubtree,
  }
}

export type FilesystemService = ReturnType<typeof createFilesystemService>
