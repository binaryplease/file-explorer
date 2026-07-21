import { describe, expect, test } from 'bun:test'
import type { DirectoryEntry } from '../../shared/filesystem.schema'
import { buildTreeRows, planAutoOpen, type EntryRow } from './tree'

function makeEntry(overrides: Partial<DirectoryEntry> & { name: string }): DirectoryEntry {
  return {
    kind: 'file',
    sizeBytes: null,
    childCount: null,
    isExecutable: false,
    isHidden: false,
    isSymlink: false,
    escapesRoot: false,
    isGitignored: false,
    ...overrides,
  }
}

function directory(name: string, childCount: number): DirectoryEntry {
  return makeEntry({ name, kind: 'directory', childCount })
}

function entryNames(rows: ReturnType<typeof buildTreeRows>['rows']): string[] {
  return rows
    .filter((row): row is EntryRow => row.type === 'entry')
    .map((row) => row.path)
}

const allViewOptions = { showHidden: false, showGitignored: false, showSizes: true }

describe('browse ordering — broot Sort::None', () => {
  test('interleaves files and directories in case-insensitive name order', () => {
    const listings = {
      '': [
        makeEntry({ name: 'zebra.txt' }),
        directory('Albums', 3),
        makeEntry({ name: 'apple.txt' }),
        directory('Sets', 2),
      ],
    }
    const { rows } = buildTreeRows({
      focusPath: '',
      listings,
      openPaths: new Set(),
      ...allViewOptions,
    })
    // Neither dirs-first nor size order: plain alpha, folders mixed with files.
    expect(entryNames(rows)).toEqual(['Albums', 'apple.txt', 'Sets', 'zebra.txt'])
  })

  test('does not order files by size', () => {
    const listings = {
      '': [
        makeEntry({ name: 'small.txt', kind: 'file', sizeBytes: 10 }),
        makeEntry({ name: 'big.txt', kind: 'file', sizeBytes: 9_000_000 }),
      ],
    }
    const { rows } = buildTreeRows({
      focusPath: '',
      listings,
      openPaths: new Set(),
      ...allViewOptions,
    })
    expect(entryNames(rows)).toEqual(['big.txt', 'small.txt'])
  })
})

describe('planAutoOpen — screen-fit fill', () => {
  const filters = { showHidden: false, showGitignored: false }

  test('fills empty space by opening the next depth, shallowest first', () => {
    const listings = {
      '': [directory('a', 2), directory('b', 2)],
      a: [makeEntry({ name: 'a1.txt' }), makeEntry({ name: 'a2.txt' })],
      b: [makeEntry({ name: 'b1.txt' }), makeEntry({ name: 'b2.txt' })],
    }
    const plan = planAutoOpen({
      focusPath: '',
      listings,
      manuallyOpenPaths: new Set(),
      closedPaths: new Set(),
      ...filters,
      rowCapacity: 10,
    })
    // Focus has 2 rows; room for both directories to open (2 + 2 + 2 = 6 ≤ 10).
    expect([...plan.autoOpenPaths].sort()).toEqual(['a', 'b'])
    expect(plan.pendingListingPaths).toEqual([])
  })

  test('stops opening once the viewport budget is spent', () => {
    const listings = {
      '': [directory('a', 3), directory('b', 3), directory('c', 3)],
      a: [makeEntry({ name: 'a1' }), makeEntry({ name: 'a2' }), makeEntry({ name: 'a3' })],
      b: [makeEntry({ name: 'b1' }), makeEntry({ name: 'b2' }), makeEntry({ name: 'b3' })],
      c: [makeEntry({ name: 'c1' }), makeEntry({ name: 'c2' }), makeEntry({ name: 'c3' })],
    }
    const plan = planAutoOpen({
      focusPath: '',
      listings,
      manuallyOpenPaths: new Set(),
      closedPaths: new Set(),
      ...filters,
      rowCapacity: 6,
    })
    // 3 focus rows + open 'a' (3 rows) reaches 6; 'b' and 'c' stay closed.
    expect([...plan.autoOpenPaths]).toEqual(['a'])
  })

  test('requests listings it must fetch before descending deeper', () => {
    const listings: Record<string, DirectoryEntry[] | undefined> = {
      '': [directory('a', 4)],
      // 'a' not loaded yet.
    }
    const plan = planAutoOpen({
      focusPath: '',
      listings,
      manuallyOpenPaths: new Set(),
      closedPaths: new Set(),
      ...filters,
      rowCapacity: 20,
    })
    expect([...plan.autoOpenPaths]).toEqual(['a'])
    expect(plan.pendingListingPaths).toEqual(['a'])
  })

  test('never re-opens a directory the user collapsed', () => {
    const listings = {
      '': [directory('a', 2), directory('b', 2)],
      a: [makeEntry({ name: 'a1' }), makeEntry({ name: 'a2' })],
      b: [makeEntry({ name: 'b1' }), makeEntry({ name: 'b2' })],
    }
    const plan = planAutoOpen({
      focusPath: '',
      listings,
      manuallyOpenPaths: new Set(),
      closedPaths: new Set(['a']),
      ...filters,
      rowCapacity: 10,
    })
    expect([...plan.autoOpenPaths]).toEqual(['b'])
  })

  test('skips empty and unreadable directories', () => {
    const listings = {
      '': [directory('empty', 0), directory('unreadable', 0), directory('real', 1)],
      real: [makeEntry({ name: 'r1' })],
    }
    const plan = planAutoOpen({
      focusPath: '',
      listings,
      manuallyOpenPaths: new Set(),
      closedPaths: new Set(),
      ...filters,
      rowCapacity: 10,
    })
    expect([...plan.autoOpenPaths]).toEqual(['real'])
  })

  test('a full viewport auto-opens nothing', () => {
    const listings = {
      '': [directory('a', 5), makeEntry({ name: 'f1' }), makeEntry({ name: 'f2' })],
      a: [makeEntry({ name: 'a1' })],
    }
    const plan = planAutoOpen({
      focusPath: '',
      listings,
      manuallyOpenPaths: new Set(),
      closedPaths: new Set(),
      ...filters,
      rowCapacity: 3,
    })
    expect([...plan.autoOpenPaths]).toEqual([])
  })
})
