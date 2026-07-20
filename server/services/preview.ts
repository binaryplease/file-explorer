import { extname } from 'node:path'
import type { DirectoryEntry } from '../../shared/filesystem.schema'
import type { DirectorySummary, Preview } from '../../shared/preview.schema'
import type { FilesystemService } from './filesystem'

// Bounded-read preview of one entry (AGENTS.md responsiveness principle: the
// panel is enrichment — it never blocks a listing, and it never reads more than
// the bounds below no matter how large the file is).

export type PreviewFailureReason =
  | 'outside-root'
  | 'symlink-escapes-root'
  | 'not-found'
  | 'not-readable'

export type PreviewServiceResult =
  | { ok: true; preview: Preview }
  | { ok: false; reason: PreviewFailureReason }

// Only ever read this much of a file, from its head. A 40 GB log costs the same
// as a 4 KB one.
const PREVIEW_HEAD_BYTES = 128 * 1024
const PREVIEW_MAX_LINES = 600
// A minified bundle is one enormous line; clip it rather than shipping it.
const PREVIEW_MAX_LINE_LENGTH = 500
const TAB_EXPANSION = '    '
// Images cannot be head-read — the client has to fetch the whole file to render
// one — so they are the one kind with a real size ceiling.
const IMAGE_MAX_BYTES = 12 * 1024 * 1024
const LARGEST_ENTRY_COUNT = 5
// Above this share of control bytes in the head, treat the file as binary even
// without a NUL (UTF-16 text, compressed payloads, most executables).
const BINARY_CONTROL_BYTE_RATIO = 0.1

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.bmp',
  '.ico',
  '.svg',
])

// A byte that no plain-text file uses: control codes other than tab, newline,
// carriage return and form feed.
function isControlByte(byteValue: number): boolean {
  if (byteValue === 0x09 || byteValue === 0x0a || byteValue === 0x0c || byteValue === 0x0d)
    return false
  return byteValue < 0x20 || byteValue === 0x7f
}

// Classifies the bytes actually read, not the extension: an unknown extension
// holding UTF-8 previews as text, and a `.txt` full of NULs does not.
export function looksBinary(headBytes: Uint8Array): boolean {
  if (headBytes.length === 0) return false
  let controlByteCount = 0
  for (const byteValue of headBytes) {
    if (byteValue === 0x00) return true
    if (isControlByte(byteValue)) controlByteCount++
  }
  return controlByteCount / headBytes.length > BINARY_CONTROL_BYTE_RATIO
}

// Splits a decoded head into bounded display lines. `hasMoreBytes` says the
// read stopped short of the file's end, in which case the final line is a
// fragment and is dropped rather than shown cut in half.
export function toPreviewLines(
  decodedHead: string,
  hasMoreBytes: boolean,
): { lines: Preview['lines']; isTruncated: boolean; totalLineCount: number | null } {
  const rawLines = decodedHead.split('\n')
  // A trailing newline yields a final empty element that is not a line.
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') rawLines.pop()
  else if (hasMoreBytes) rawLines.pop()

  const isLineCapped = rawLines.length > PREVIEW_MAX_LINES
  const keptLines = isLineCapped ? rawLines.slice(0, PREVIEW_MAX_LINES) : rawLines
  const lines = keptLines.map((rawLine, lineIndex) => {
    const withoutCarriageReturn = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    const expanded = withoutCarriageReturn.replaceAll('\t', TAB_EXPANSION)
    return {
      number: lineIndex + 1,
      text:
        expanded.length > PREVIEW_MAX_LINE_LENGTH
          ? `${expanded.slice(0, PREVIEW_MAX_LINE_LENGTH)}…`
          : expanded,
    }
  })
  const isTruncated = hasMoreBytes || isLineCapped
  return { lines, isTruncated, totalLineCount: isTruncated ? null : lines.length }
}

// Everything the summary reports comes from the listing that was already
// produced — no recursive walk, so a directory preview costs one readdir.
export function summarizeDirectory(entries: DirectoryEntry[]): DirectorySummary {
  const fileEntries = entries.filter((entry) => entry.kind === 'file')
  return {
    entryCount: entries.length,
    directoryCount: entries.filter((entry) => entry.kind === 'directory').length,
    fileCount: fileEntries.length,
    otherCount: entries.filter((entry) => entry.kind === 'other').length,
    hiddenCount: entries.filter((entry) => entry.isHidden).length,
    gitignoredCount: entries.filter((entry) => entry.isGitignored).length,
    directFileBytes: fileEntries.reduce((runningTotal, entry) => runningTotal + (entry.sizeBytes ?? 0), 0),
    largestEntries: [...fileEntries]
      .sort((firstEntry, secondEntry) => (secondEntry.sizeBytes ?? 0) - (firstEntry.sizeBytes ?? 0))
      .slice(0, LARGEST_ENTRY_COUNT),
  }
}

function baseName(relativePath: string): string {
  const lastSlashIndex = relativePath.lastIndexOf('/')
  return lastSlashIndex === -1 ? relativePath : relativePath.slice(lastSlashIndex + 1)
}

// Every field is emitted, nullish included (ADR-0024): the panel reads a
// complete shape whichever kind came back.
function emptyPreview(relativePath: string): Preview {
  return {
    path: relativePath,
    name: baseName(relativePath),
    kind: 'unsupported',
    sizeBytes: null,
    lines: [],
    isTruncated: false,
    totalLineCount: null,
    imageUrlPath: null,
    directory: null,
    note: null,
  }
}

// Factory per ADR-0007. Confinement is not re-implemented here — it belongs to
// the filesystem service, and every path this service touches has been resolved
// through it first.
export function createPreviewService(options: { filesystemService: FilesystemService }) {
  const { filesystemService } = options

  async function previewFile(relativePath: string, absolutePath: string): Promise<Preview> {
    const preview = emptyPreview(relativePath)
    const file = Bun.file(absolutePath)
    preview.sizeBytes = file.size

    if (file.size === 0) {
      return { ...preview, kind: 'empty', note: 'This file is empty.' }
    }

    if (IMAGE_EXTENSIONS.has(extname(relativePath).toLowerCase())) {
      if (file.size > IMAGE_MAX_BYTES) {
        return {
          ...preview,
          kind: 'too-large',
          note: 'Image too large to render in the panel — open it to view it.',
        }
      }
      return {
        ...preview,
        kind: 'image',
        imageUrlPath: `/api/fs/raw?path=${encodeURIComponent(relativePath)}`,
      }
    }

    let headBytes: Uint8Array
    try {
      headBytes = new Uint8Array(await file.slice(0, PREVIEW_HEAD_BYTES).arrayBuffer())
    } catch {
      return { ...preview, note: 'This file could not be read.' }
    }

    if (looksBinary(headBytes)) {
      return {
        ...preview,
        kind: 'binary',
        note: 'Binary content — not shown as text.',
      }
    }

    const decodedHead = new TextDecoder('utf-8').decode(headBytes)
    const { lines, isTruncated, totalLineCount } = toPreviewLines(
      decodedHead,
      file.size > headBytes.length,
    )
    return { ...preview, kind: 'text', lines, isTruncated, totalLineCount }
  }

  // Previews one entry. An entry that exists but has no content to show — a
  // socket, a broken link — is a successful preview carrying a marker, not an
  // error: the panel always has something honest to render.
  async function previewEntry(relativePath: string): Promise<PreviewServiceResult> {
    const resolvedFile = await filesystemService.resolveFile(relativePath)
    if (resolvedFile.ok) {
      return { ok: true, preview: await previewFile(relativePath, resolvedFile.absolutePath) }
    }
    if (resolvedFile.reason === 'outside-root') return { ok: false, reason: 'outside-root' }
    // A blocked entry is described, not refused. Reading *through* the symlink
    // stays forbidden (list/raw/open still answer 403) — but saying "this one is
    // out of bounds" discloses nothing the listing has not already told the
    // client, and it is the honest thing for the panel to render. Returns before
    // the directory branch below, which would otherwise summarise the target.
    if (resolvedFile.reason === 'symlink-escapes-root') {
      return { ok: true, preview: { ...emptyPreview(relativePath), kind: 'blocked' } }
    }
    if (resolvedFile.reason === 'not-found') return { ok: false, reason: 'not-found' }
    if (resolvedFile.reason === 'not-readable') return { ok: false, reason: 'not-readable' }

    // Not a file: a directory summary, or a marker for anything else.
    const listing = await filesystemService.listDirectory(relativePath)
    if (listing.ok) {
      return {
        ok: true,
        preview: {
          ...emptyPreview(relativePath),
          kind: 'directory',
          directory: summarizeDirectory(listing.listing.entries),
        },
      }
    }
    if (listing.reason === 'outside-root') return { ok: false, reason: 'outside-root' }
    // Same marker as the file branch above, so the answer does not depend on
    // which of the two resolutions noticed the escape first.
    if (listing.reason === 'symlink-escapes-root') {
      return { ok: true, preview: { ...emptyPreview(relativePath), kind: 'blocked' } }
    }
    if (listing.reason === 'not-found') return { ok: false, reason: 'not-found' }
    if (listing.reason === 'not-readable') return { ok: false, reason: 'not-readable' }
    return {
      ok: true,
      preview: {
        ...emptyPreview(relativePath),
        note: 'Not a regular file or directory — nothing to preview.',
      },
    }
  }

  return { previewEntry }
}

export type PreviewService = ReturnType<typeof createPreviewService>
