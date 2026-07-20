import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DirectoryEntry } from '../../shared/filesystem.schema'
import { createFilesystemService } from './filesystem'
import { createPreviewService, looksBinary, summarizeDirectory, toPreviewLines } from './preview'

function textBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

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
    const { lines, isTruncated, totalLineCount } = toPreviewLines('alpha\nbeta\n', false)
    expect(lines).toEqual([
      { number: 1, text: 'alpha' },
      { number: 2, text: 'beta' },
    ])
    expect(isTruncated).toBe(false)
    expect(totalLineCount).toBe(2)
  })

  test('strips carriage returns and expands tabs', () => {
    const { lines } = toPreviewLines('a\tb\r\n', false)
    expect(lines[0]!.text).toBe('a    b')
  })

  test('drops the half-read final line when the read stopped short', () => {
    const { lines, isTruncated, totalLineCount } = toPreviewLines('alpha\nbet', true)
    expect(lines).toEqual([{ number: 1, text: 'alpha' }])
    expect(isTruncated).toBe(true)
    // The total is unknowable from a bounded head — it must not be guessed.
    expect(totalLineCount).toBeNull()
  })

  test('caps the line count and reports the truncation', () => {
    const manyLines = Array.from({ length: 900 }, (_unused, index) => `line ${index}`).join('\n')
    const { lines, isTruncated, totalLineCount } = toPreviewLines(`${manyLines}\n`, false)
    expect(lines.length).toBe(600)
    expect(isTruncated).toBe(true)
    expect(totalLineCount).toBeNull()
  })

  test('clips a single enormous line rather than shipping it whole', () => {
    const { lines } = toPreviewLines(`${'x'.repeat(5000)}\n`, false)
    expect(lines[0]!.text.length).toBe(501)
    expect(lines[0]!.text.endsWith('…')).toBe(true)
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
    // ADR-0024: the shape is complete whichever kind came back.
    expect(result.preview.directory).toBeNull()
    expect(result.preview.imageUrlPath).toBeNull()
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
    expect(result.preview.imageUrlPath).toBe('/api/fs/raw?path=shot%20one.png')
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

  test('reads a bounded head, never the whole file', async () => {
    const { rootPath, previewService } = await createScratchRoot()
    const oneLine = `${'y'.repeat(99)}\n`
    await writeFile(join(rootPath, 'big.txt'), oneLine.repeat(4000)) // ~400 KB
    const result = await previewService.previewEntry('big.txt')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.kind).toBe('text')
    expect(result.preview.isTruncated).toBe(true)
    expect(result.preview.totalLineCount).toBeNull()
    expect(result.preview.lines.length).toBe(600)
  })

  test('refuses a path that escapes the root through a symlink', async () => {
    const { rootPath, previewService } = await createScratchRoot()
    const outsidePath = await mkdtemp(join(tmpdir(), 'binp-preview-outside-'))
    await writeFile(join(outsidePath, 'secret.txt'), 'secret\n')
    await symlink(outsidePath, join(rootPath, 'escape'))
    const result = await previewService.previewEntry('escape/secret.txt')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('symlink-escapes-root')
  })

  test('reports a missing entry as not-found', async () => {
    const { previewService } = await createScratchRoot()
    const result = await previewService.previewEntry('nope.txt')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('not-found')
  })
})
