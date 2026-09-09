import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DirectoryEntry } from '../../shared/filesystem.schema'
import { createFilesystemService } from './filesystem'
import { createPreviewService, looksBinary, summarizeDirectory, toPreviewLines } from './preview'

function textBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

// A line budget far above every fixture here, for the cases that are about
// something other than the cap itself.
const LINE_BUDGET = 100_000

function entry(overrides: Partial<DirectoryEntry> & { name: string }): DirectoryEntry {
  return {
    kind: 'file',
    sizeBytes: null,
    childCount: null,
    isExecutable: false,
    isHidden: false,
    isSymlink: false,
    isGitignored: false,
    escapesRoot: false,
    ...overrides,
  }
}

describe('looksBinary', () => {
  test('plain text is not binary', () => {
    expect(looksBinary(textBytes('hello\nworld\n\tindented\r\n'))).toBe(false)
  })

  test('a NUL byte anywhere makes it binary', () => {
    expect(looksBinary(new Uint8Array([0x68, 0x69, 0x00, 0x68]))).toBe(true)
  })

  test('a high share of control bytes makes it binary without any NUL', () => {
    expect(looksBinary(new Uint8Array([0x01, 0x02, 0x03, 0x68, 0x69, 0x6f]))).toBe(true)
  })

  test('UTF-8 multibyte text is not binary', () => {
    expect(looksBinary(textBytes('héllo wörld — ünïcode ✓\n'))).toBe(false)
  })

  test('an empty head is not binary', () => {
    expect(looksBinary(new Uint8Array())).toBe(false)
  })
})

describe('toPreviewLines', () => {
  test('numbers lines from one and drops the trailing-newline artefact', () => {
    const result = toPreviewLines('alpha\nbeta\n', false, LINE_BUDGET)
    expect(result.lines).toEqual([
      { number: 1, text: 'alpha' },
      { number: 2, text: 'beta' },
    ])
    expect(result.isTruncated).toBe(false)
    expect(result.truncationReason).toBeNull()
    expect(result.totalLineCount).toBe(2)
    expect(result.bytesShown).toBe('alpha\nbeta\n'.length)
  })

  test('strips carriage returns and expands tabs', () => {
    const { lines } = toPreviewLines('a\tb\r\n', false, LINE_BUDGET)
    expect(lines[0]!.text).toBe('a    b')
  })

  test('drops the half-read final line when the read stopped short', () => {
    const result = toPreviewLines('alpha\nbet', true, LINE_BUDGET)
    expect(result.lines).toEqual([{ number: 1, text: 'alpha' }])
    expect(result.isTruncated).toBe(true)
    expect(result.truncationReason).toBe('byte-budget')
    // The total is unknowable from a bounded read — it must not be guessed.
    expect(result.totalLineCount).toBeNull()
    // Exactly the bytes the one kept line accounts for, its newline included.
    expect(result.bytesShown).toBe('alpha\n'.length)
  })

  test('caps the line count, names the budget that bit, and counts what it shows', () => {
    const manyLines = Array.from({ length: 900 }, (_unused, index) => `line ${index}`).join('\n')
    const result = toPreviewLines(`${manyLines}\n`, false, 600)
    expect(result.lines.length).toBe(600)
    expect(result.isTruncated).toBe(true)
    expect(result.truncationReason).toBe('line-budget')
    expect(result.totalLineCount).toBeNull()
    const shownSource = manyLines.split('\n').slice(0, 600).join('\n')
    expect(result.bytesShown).toBe(shownSource.length + 1)
  })

  // The regression this all exists for: a document with long prose lines must
  // come back verbatim. A clipped line is a silent lie about the file.
  test('never clips a long line — it is returned whole', () => {
    const longLine = 'x'.repeat(5000)
    const { lines, isTruncated } = toPreviewLines(`${longLine}\n`, false, LINE_BUDGET)
    expect(lines[0]!.text).toBe(longLine)
    expect(isTruncated).toBe(false)
  })

  // Dropping the fragment is right when there are whole lines to fall back on;
  // when it is the only line there is, dropping it would empty the panel.
  test('keeps a lone unterminated line rather than showing nothing', () => {
    const result = toPreviewLines('x'.repeat(5000), true, LINE_BUDGET)
    expect(result.lines.length).toBe(1)
    expect(result.lines[0]!.text.length).toBe(5000)
    expect(result.isTruncated).toBe(true)
    expect(result.truncationReason).toBe('byte-budget')
  })

  test('counts bytes, not characters, for a multibyte document', () => {
    const { bytesShown } = toPreviewLines('héllo — wörld\n', false, LINE_BUDGET)
    expect(bytesShown).toBe(new TextEncoder().encode('héllo — wörld\n').length)
  })
})

describe('summarizeDirectory', () => {
  test('counts by kind and sums only the direct child files', () => {
    const summary = summarizeDirectory([
      entry({ name: 'src', kind: 'directory' }),
      entry({ name: 'a.ts', sizeBytes: 100 }),
      entry({ name: '.env', sizeBytes: 20, isHidden: true }),
      entry({ name: 'node_modules', kind: 'directory', isGitignored: true }),
      entry({ name: 'a.sock', kind: 'other' }),
    ])
    expect(summary.entryCount).toBe(5)
    expect(summary.directoryCount).toBe(2)
    expect(summary.fileCount).toBe(2)
    expect(summary.otherCount).toBe(1)
    expect(summary.hiddenCount).toBe(1)
    expect(summary.gitignoredCount).toBe(1)
    expect(summary.directFileBytes).toBe(120)
    expect(summary.largestEntries.map((largest) => largest.name)).toEqual(['a.ts', '.env'])
  })

  test('an empty directory summarizes to zeroes, not to nulls', () => {
    const summary = summarizeDirectory([])
    expect(summary.entryCount).toBe(0)
    expect(summary.directFileBytes).toBe(0)
    expect(summary.largestEntries).toEqual([])
  })
})

describe('previewEntry', () => {
  async function createScratchRoot() {
    const rootPath = await mkdtemp(join(tmpdir(), 'binp-preview-test-'))
    const filesystemService = createFilesystemService({ rootAbsolutePath: rootPath })
    const previewService = createPreviewService({ filesystemService })
    return { rootPath, previewService }
  }

  test('previews a text file as numbered head lines', async () => {
    const { rootPath, previewService } = await createScratchRoot()
    await writeFile(join(rootPath, 'notes.txt'), 'alpha\nbeta\n')
    const result = await previewService.previewEntry('notes.txt')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.kind).toBe('text')
    expect(result.preview.lines.map((line) => line.text)).toEqual(['alpha', 'beta'])
    expect(result.preview.totalLineCount).toBe(2)
    expect(result.preview.sizeBytes).toBe(11)
    // An unmapped extension keeps the plain-text default (the client renders it
    // unhighlighted).
    expect(result.preview.language).toBe('txt')
    // `emit-nullish`: the shape is complete whichever kind came back.
    expect(result.preview.directory).toBeNull()
    expect(result.preview.mediaUrlPath).toBeNull()
  })

  test('stamps a syntax-highlighting language onto a recognised code file', async () => {
    const { rootPath, previewService } = await createScratchRoot()
    await writeFile(join(rootPath, 'main.ts'), 'export const answer = 42\n')
    const result = await previewService.previewEntry('main.ts')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.kind).toBe('text')
    expect(result.preview.language).toBe('typescript')
  })

  test('leaves the language at its default for non-text kinds', async () => {
    const { rootPath, previewService } = await createScratchRoot()
    await writeFile(join(rootPath, 'blob.bin'), new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]))
    const result = await previewService.previewEntry('blob.bin')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.kind).toBe('binary')
    expect(result.preview.language).toBe('txt')
  })

  test('marks a binary file instead of dumping its bytes', async () => {
    const { rootPath, previewService } = await createScratchRoot()
    await writeFile(join(rootPath, 'blob.bin'), new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]))
    const result = await previewService.previewEntry('blob.bin')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.kind).toBe('binary')
    expect(result.preview.lines).toEqual([])
    expect(result.preview.note).not.toBeNull()
  })

  test('marks an empty file', async () => {
    const { rootPath, previewService } = await createScratchRoot()
    await writeFile(join(rootPath, 'empty.txt'), '')
    const result = await previewService.previewEntry('empty.txt')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.kind).toBe('empty')
    expect(result.preview.sizeBytes).toBe(0)
  })

  test('points an image at the raw endpoint rather than inlining it', async () => {
    const { rootPath, previewService } = await createScratchRoot()
    await writeFile(join(rootPath, 'shot one.png'), new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    const result = await previewService.previewEntry('shot one.png')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.kind).toBe('image')
    expect(result.preview.mediaUrlPath).toBe('/api/fs/raw?path=shot%20one.png')
    expect(result.preview.lines).toEqual([])
  })

  test('points audio and video at the raw endpoint instead of reading them as text', async () => {
    const { rootPath, previewService } = await createScratchRoot()
    // Bytes that would trip the binary classifier if they were ever head-read;
    // classification is by extension, so they never are.
    await writeFile(join(rootPath, 'track.mp3'), new Uint8Array([0x49, 0x44, 0x33, 0x00]))
    await writeFile(join(rootPath, 'clip.mp4'), new Uint8Array([0x00, 0x00, 0x00, 0x18]))

    const audioResult = await previewService.previewEntry('track.mp3')
    expect(audioResult.ok).toBe(true)
    if (!audioResult.ok) return
    expect(audioResult.preview.kind).toBe('audio')
    expect(audioResult.preview.mediaUrlPath).toBe('/api/fs/raw?path=track.mp3')
    expect(audioResult.preview.lines).toEqual([])

    const videoResult = await previewService.previewEntry('clip.mp4')
    expect(videoResult.ok).toBe(true)
    if (!videoResult.ok) return
    expect(videoResult.preview.kind).toBe('video')
    expect(videoResult.preview.mediaUrlPath).toBe('/api/fs/raw?path=clip.mp4')
    expect(videoResult.preview.lines).toEqual([])
  })

  test('points a PDF at the raw endpoint rather than reading its bytes as binary', async () => {
    const { rootPath, previewService } = await createScratchRoot()
    // A minimal PDF header — binary bytes that would classify as `binary` if the
    // extension branch did not catch them first.
    await writeFile(join(rootPath, 'report.pdf'), new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))
    const result = await previewService.previewEntry('report.pdf')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.kind).toBe('pdf')
    expect(result.preview.mediaUrlPath).toBe('/api/fs/raw?path=report.pdf')
    expect(result.preview.lines).toEqual([])
  })

  test('summarizes a directory from its own listing', async () => {
    const { rootPath, previewService } = await createScratchRoot()
    await mkdir(join(rootPath, 'project'))
    await mkdir(join(rootPath, 'project', 'src'))
    await writeFile(join(rootPath, 'project', 'a.ts'), 'export {}\n')
    const result = await previewService.previewEntry('project')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.kind).toBe('directory')
    expect(result.preview.directory?.entryCount).toBe(2)
    expect(result.preview.directory?.directoryCount).toBe(1)
    expect(result.preview.directory?.fileCount).toBe(1)
  })

  test('reads a bounded window, never the whole file', async () => {
    const { rootPath, previewService } = await createScratchRoot()
    const oneLine = `${'y'.repeat(99)}\n`
    await writeFile(join(rootPath, 'big.txt'), oneLine.repeat(20_000)) // ~2 MB
    const result = await previewService.previewEntry('big.txt')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.kind).toBe('text')
    expect(result.preview.isTruncated).toBe(true)
    expect(result.preview.truncationReason).toBe('line-budget')
    expect(result.preview.totalLineCount).toBeNull()
    expect(result.preview.lines.length).toBe(4_000)
    // What the panel needs to say "showing X of Y": exact, not an estimate.
    expect(result.preview.bytesShown).toBe(4_000 * 100)
    expect(result.preview.sizeBytes).toBe(20_000 * 100)
  })

  // An ordinary document — long prose lines, no trailing wrap — must come back
  // exactly as written. This is the regression the per-line clip caused.
  test('returns long lines verbatim, and reports the file as whole', async () => {
    const { rootPath, previewService } = await createScratchRoot()
    const longParagraph = `${'sentence — '.repeat(200)}end`
    await writeFile(join(rootPath, 'notes.md'), `# Title\n\n${longParagraph}\n`)
    const result = await previewService.previewEntry('notes.md')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.lines[2]!.text).toBe(longParagraph)
    expect(result.preview.isTruncated).toBe(false)
    expect(result.preview.truncationReason).toBeNull()
    expect(result.preview.totalLineCount).toBe(3)
  })

  // The way out of a truncated preview: the reader asks for the file whole and
  // the read runs to the far larger ceiling instead of the per-selection window.
  test('reads past the window when full text is asked for', async () => {
    const { rootPath, previewService } = await createScratchRoot()
    const oneLine = `${'y'.repeat(99)}\n`
    await writeFile(join(rootPath, 'big.txt'), oneLine.repeat(20_000)) // ~2 MB
    const result = await previewService.previewEntry('big.txt', { fullText: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.lines.length).toBe(20_000)
    expect(result.preview.isTruncated).toBe(false)
    expect(result.preview.truncationReason).toBeNull()
    expect(result.preview.totalLineCount).toBe(20_000)
    expect(result.preview.bytesShown).toBe(20_000 * 100)
  })

  // Even the opt-in is a ceiling, not "read anything": a huge file still comes
  // back bounded, and still says so.
  test('the full-text read is itself bounded, and reports the remainder', async () => {
    const { rootPath, previewService } = await createScratchRoot()
    const oneLine = `${'y'.repeat(99)}\n`
    await writeFile(join(rootPath, 'huge.log'), oneLine.repeat(60_000)) // ~6 MB, 60k lines
    const result = await previewService.previewEntry('huge.log', { fullText: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.lines.length).toBe(40_000)
    expect(result.preview.isTruncated).toBe(true)
    expect(result.preview.truncationReason).toBe('line-budget')
  })

  // A blocked entry is described, not errored: the panel always has something
  // honest to render, the same contract as `empty` or `binary`.
  test('marks a path that escapes the root through a symlink as blocked', async () => {
    const { rootPath, previewService } = await createScratchRoot()
    const outsidePath = await mkdtemp(join(tmpdir(), 'binp-preview-outside-'))
    await writeFile(join(outsidePath, 'secret.txt'), 'secret\n')
    await symlink(outsidePath, join(rootPath, 'escape'))
    const result = await previewService.previewEntry('escape/secret.txt')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.kind).toBe('blocked')
    // Describing it must not disclose anything read through the link.
    expect(result.preview.lines).toEqual([])
    expect(result.preview.sizeBytes).toBeNull()
    expect(result.preview.directory).toBeNull()
  })

  // The symlink itself, not a path through it. Its target is a directory, which
  // the marker must not reveal by summarising it.
  test('marks an escaping symlink to a directory as blocked, not as a directory', async () => {
    const { rootPath, previewService } = await createScratchRoot()
    const outsidePath = await mkdtemp(join(tmpdir(), 'binp-preview-outside-'))
    await writeFile(join(outsidePath, 'secret.txt'), 'secret\n')
    await symlink(outsidePath, join(rootPath, 'escape'))
    const result = await previewService.previewEntry('escape')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.kind).toBe('blocked')
    expect(result.preview.directory).toBeNull()
  })

  test('reports a missing entry as not-found', async () => {
    const { previewService } = await createScratchRoot()
    const result = await previewService.previewEntry('nope.txt')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('not-found')
  })

  // Confined, the head is read positionally from the descriptor the filesystem
  // service verified, not by re-opening the path — the same check/use gap the
  // raw endpoint closes. The bound must survive that change: a huge file still
  // costs one window read.
  test('reads only the bounded window of a large file, from the verified descriptor', async () => {
    const { rootPath, previewService } = await createScratchRoot()
    const oneLine = `${'x'.repeat(99)}\n`
    const hugeFileBytes = oneLine.repeat(20_000) // ~2 MB, well past the 1 MiB window
    await writeFile(join(rootPath, 'huge.log'), hugeFileBytes)

    const result = await previewService.previewEntry('huge.log')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.kind).toBe('text')
    expect(result.preview.sizeBytes).toBe(hugeFileBytes.length)
    // Truncated, line-capped, and starting at byte zero of the file — a
    // descriptor read that forgot its position would start mid-file instead.
    expect(result.preview.isTruncated).toBe(true)
    expect(result.preview.totalLineCount).toBeNull()
    expect(result.preview.lines.length).toBe(4_000)
    expect(result.preview.lines[0]?.text).toBe('x'.repeat(99))
  })

  test('does not leak a descriptor per preview', async () => {
    const { rootPath, previewService } = await createScratchRoot()
    await writeFile(join(rootPath, 'notes.txt'), 'alpha\nbeta\n')
    const descriptorsBefore = openDescriptorCount()
    for (let previewIndex = 0; previewIndex < 20; previewIndex++) {
      await previewService.previewEntry('notes.txt')
    }
    expect(openDescriptorCount()).toBeLessThan(descriptorsBefore + 20)
  })
})

// Descriptors this process holds open, used to catch a per-preview leak. Linux
// only; elsewhere the check degrades to a no-op rather than a false failure.
function openDescriptorCount(): number {
  try {
    return readdirSync('/proc/self/fd').length
  } catch {
    return 0
  }
}
