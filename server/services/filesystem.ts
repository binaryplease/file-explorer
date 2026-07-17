import { statSync } from 'node:fs'
import { lstat, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { DirectoryEntry, DirectoryListing } from '../../shared/filesystem.schema'

export type ListDirectoryFailureReason =
  | 'outside-root'
  | 'not-found'
  | 'not-a-directory'
  | 'not-readable'

export type ListDirectoryResult =
  | { ok: true; listing: DirectoryListing }
  | { ok: false; reason: ListDirectoryFailureReason }

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

    const entries = await Promise.all(
      entryNames.map((entryName) => describeEntry(absolutePath, entryName)),
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

  return { rootAbsolutePath, listDirectory }
}

export type FilesystemService = ReturnType<typeof createFilesystemService>
