import { extname } from 'node:path'
import type { DirectoryEntry } from '../../shared/filesystem.schema'
import type { DirectorySummary, Preview, PreviewTruncationReason } from '../../shared/preview.schema'
import { languageForPath } from '../../shared/language'
import type { FilesystemService, OpenReadableFileResult } from './filesystem'

// The success half of what the filesystem service hands over: an opened file,
// carrying the verified descriptor when confinement is on.
type OpenedFile = Extract<OpenReadableFileResult, { ok: true }>

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

// Two budgets, and a line is never part of either. A line is returned whole or
// not at all — clipping one is a silent lie about the file's contents, and an
// ordinary document (prose in unwrapped paragraphs, a long import list, a JSON
// blob on one line) hits a per-line clip constantly. Only *how far into the
// file* the read goes is bounded, and whenever it is, the panel says so loudly
// with the exact shortfall.
//
// `WINDOW` is what every selection costs: the first look, taken without anyone
// asking for it, so a 40 GB log still costs one bounded read. Big enough that
// ordinary documents and source files arrive whole and no notice ever appears.
const PREVIEW_WINDOW_BYTES = 1024 * 1024
const PREVIEW_WINDOW_MAX_LINES = 4_000
// `FULL` is what the reader opts into from that notice (`?fullText=true`) — a
// ceiling rather than a glance, chosen so the panel can still render what comes
// back. Past it the notice stays, honestly reporting the remainder.
const PREVIEW_FULL_BYTES = 8 * 1024 * 1024
const PREVIEW_FULL_MAX_LINES = 40_000

// One read budget, picked per request. Both fields travel together because
// either one alone can cut the file short, and the notice must name which did.
type PreviewReadBudget = { maxBytes: number; maxLines: number }

const PREVIEW_WINDOW_BUDGET: PreviewReadBudget = {
  maxBytes: PREVIEW_WINDOW_BYTES,
  maxLines: PREVIEW_WINDOW_MAX_LINES,
}
const PREVIEW_FULL_BUDGET: PreviewReadBudget = {
  maxBytes: PREVIEW_FULL_BYTES,
  maxLines: PREVIEW_FULL_MAX_LINES,
}

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

// Audio and video are never head-read: the client fetches them from the raw
// endpoint into an `<audio>`/`<video>` element, which streams progressively via
// Range and seeks without downloading the whole file — so unlike images they
// carry no size ceiling. Extension-classified because their bytes are binary and
// would otherwise fall through to the `binary` marker. Formats a browser cannot
// decode still classify here and surface a play error in the panel (honest, and
// more useful than "binary") rather than being withheld.
const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.ogg',
  '.oga',
  '.opus',
  '.m4a',
  '.aac',
  '.flac',
  '.weba',
])

const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.m4v',
  '.webm',
  '.ogv',
  '.mov',
  '.mkv',
])

// A PDF is rendered inline by the browser's own viewer in an `<iframe>` off the
// raw endpoint — never head-read into the panel. Extension-classified for the
// same reason as audio/video: its bytes are binary and would otherwise fall
// through to the `binary` marker. The raw endpoint serves `.pdf` with an
// `inline` disposition so the iframe renders it instead of downloading it.
const PDF_EXTENSIONS = new Set(['.pdf'])

// The raw byte-serving URL an image/audio/video preview points its element at.
// The whole file is fetched (progressively for media), never head-read.
function rawUrlPath(relativePath: string): string {
  return `/api/fs/raw?path=${encodeURIComponent(relativePath)}`
}

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

const textEncoder = new TextEncoder()

export type PreviewLinesResult = {
  lines: Preview['lines']
  isTruncated: boolean
  truncationReason: PreviewTruncationReason | null
  totalLineCount: number | null
  bytesShown: number
}

// Splits a decoded read into display lines, whole ones only. `hasMoreBytes`
// says the read stopped short of the file's end, in which case the final line
// is a fragment and is dropped rather than shown cut in half. Every line that
// *is* returned is returned in full, however long it is — the cut is always
// between lines, never inside one, and `bytesShown` reports exactly how much of
// the file the returned lines account for.
export function toPreviewLines(
  decodedText: string,
  hasMoreBytes: boolean,
  maxLines: number,
): PreviewLinesResult {
  const rawLines = decodedText.split('\n')
  // A trailing newline yields a final empty element that is not a line.
  const hasTrailingNewline = rawLines.length > 0 && rawLines[rawLines.length - 1] === ''
  let droppedFragmentLine = false
  if (hasTrailingNewline) rawLines.pop()
  else if (hasMoreBytes && rawLines.length > 1) {
    rawLines.pop()
    droppedFragmentLine = true
  }
  // A single line longer than the whole budget is the one case where dropping
  // the fragment would leave nothing at all — a minified bundle previewing as an
  // empty panel. Keep it; the notice above it says how much is missing.

  const isLineCapped = rawLines.length > maxLines
  const keptLines = isLineCapped ? rawLines.slice(0, maxLines) : rawLines
  const lines = keptLines.map((rawLine, lineIndex) => {
    const withoutCarriageReturn = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    return { number: lineIndex + 1, text: withoutCarriageReturn.replaceAll('\t', TAB_EXPANSION) }
  })

  const isTruncated = hasMoreBytes || isLineCapped
  // Measured on the source text — before tab expansion changes its length — so
  // "showing X of sizeBytes" is an exact statement, not an estimate. The kept
  // lines are followed by a newline in the file unless they run to a final line
  // that ends the file without one.
  const isFollowedByNewline = isLineCapped || hasTrailingNewline || droppedFragmentLine
  const bytesShown =
    keptLines.length === 0
      ? 0
      : textEncoder.encode(keptLines.join('\n')).length + (isFollowedByNewline ? 1 : 0)

  return {
    lines,
    isTruncated,
    // When both budgets bind, the line budget is the one the reader hits first
    // in file order, so it is the one worth naming.
    truncationReason: isLineCapped ? 'line-budget' : hasMoreBytes ? 'byte-budget' : null,
    totalLineCount: isTruncated ? null : lines.length,
    bytesShown,
  }
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
    language: 'txt',
    isTruncated: false,
    truncationReason: null,
    bytesShown: 0,
    totalLineCount: null,
    mediaUrlPath: null,
    directory: null,
    note: null,
  }
}

// Factory per ADR-0007. Confinement is not re-implemented here — it belongs to
// the filesystem service, and every path this service touches has been resolved
// through it first.
export function createPreviewService(options: { filesystemService: FilesystemService }) {
  const { filesystemService } = options

  // The head read, bounded to the request's byte budget whichever source it
  // comes from. Confined, `handle` is the descriptor the filesystem service
  // verified, and the bytes are read positionally from it — never by re-opening
  // the path, which is what would reintroduce the check/use gap the raw endpoint
  // closes. Unconfined there is no handle and nothing to confine, so the read
  // stays the BunFile slice it has always been.
  async function readBoundedHead(source: OpenedFile, maxBytes: number): Promise<Uint8Array> {
    if (source.handle === null) {
      const file = Bun.file(source.absolutePath)
      return new Uint8Array(await file.slice(0, maxBytes).arrayBuffer())
    }
    const headBuffer = new Uint8Array(Math.min(maxBytes, source.sizeBytes))
    const { bytesRead } = await source.handle.read(headBuffer, 0, headBuffer.length, 0)
    return headBuffer.subarray(0, bytesRead)
  }

  async function previewFile(
    relativePath: string,
    source: OpenedFile,
    readBudget: PreviewReadBudget,
  ): Promise<Preview> {
    const preview = emptyPreview(relativePath)
    const sizeBytes = source.sizeBytes
    preview.sizeBytes = sizeBytes

    if (sizeBytes === 0) {
      return { ...preview, kind: 'empty', note: 'This file is empty.' }
    }

    const extension = extname(relativePath).toLowerCase()

    if (IMAGE_EXTENSIONS.has(extension)) {
      if (sizeBytes > IMAGE_MAX_BYTES) {
        return {
          ...preview,
          kind: 'too-large',
          note: 'Image too large to render in the panel — open it to view it.',
        }
      }
      return { ...preview, kind: 'image', mediaUrlPath: rawUrlPath(relativePath) }
    }

    if (AUDIO_EXTENSIONS.has(extension)) {
      return { ...preview, kind: 'audio', mediaUrlPath: rawUrlPath(relativePath) }
    }

    if (VIDEO_EXTENSIONS.has(extension)) {
      return { ...preview, kind: 'video', mediaUrlPath: rawUrlPath(relativePath) }
    }

    if (PDF_EXTENSIONS.has(extension)) {
      return { ...preview, kind: 'pdf', mediaUrlPath: rawUrlPath(relativePath) }
    }

    let headBytes: Uint8Array
    try {
      headBytes = await readBoundedHead(source, readBudget.maxBytes)
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
    const { lines, isTruncated, truncationReason, totalLineCount, bytesShown } = toPreviewLines(
      decodedHead,
      sizeBytes > headBytes.length,
      readBudget.maxLines,
    )
    // A metadata hint only — a grammar name the client tokenizes with. The
    // bounded-read design is untouched: no bytes beyond the head are read, and a
    // path with no known grammar keeps the schema default (`'txt'`), which the
    // client renders as plain text.
    return {
      ...preview,
      kind: 'text',
      lines,
      language: languageForPath(relativePath),
      isTruncated,
      truncationReason,
      totalLineCount,
      bytesShown,
    }
  }

  // Previews one entry. An entry that exists but has no content to show — a
  // socket, a broken link — is a successful preview carrying a marker, not an
  // error: the panel always has something honest to render.
  //
  // `fullText` is the reader's explicit opt-in from the truncation notice: it
  // swaps the cheap per-selection window for the far larger full-read ceiling.
  // Default off, so browsing the tree keeps costing one bounded read per file.
  async function previewEntry(
    relativePath: string,
    options: { fullText?: boolean } = {},
  ): Promise<PreviewServiceResult> {
    const readBudget = options.fullText === true ? PREVIEW_FULL_BUDGET : PREVIEW_WINDOW_BUDGET
    const resolvedFile = await filesystemService.openReadableFile(relativePath)
    if (resolvedFile.ok) {
      try {
        return { ok: true, preview: await previewFile(relativePath, resolvedFile, readBudget) }
      } finally {
        // Confined, the service handed over an open descriptor; the preview is
        // the only reader of it and owns closing it.
        await resolvedFile.handle?.close()
      }
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
