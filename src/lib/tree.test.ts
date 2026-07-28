import { describe, expect, test } from 'bun:test'
import type { DirectoryEntry } from '../../shared/filesystem.schema'
import {
  absoluteTreePath,
  buildTreeRows,
  canonicalizeFocusPath,
  joinTreePath,
  parentTreePath,
  planAutoOpen,
  posixRelativePath,
  relativeTreePath,
  type EntryRow,
} from './tree'

describe('absoluteTreePath', () => {
  const root = '/home/enrico'

  test('joins an in-root relative path onto the anchor', () => {
    expect(absoluteTreePath('Music/song.mp3', root)).toBe('/home/enrico/Music/song.mp3')
  })

  test('the empty path is the anchor itself', () => {
    expect(absoluteTreePath('', root)).toBe('/home/enrico')
  })

  test('an out-of-root absolute path stands on its own', () => {
    expect(absoluteTreePath('/etc/hosts', root)).toBe('/etc/hosts')
  })

  test('does not double the slash against a filesystem-root anchor', () => {
    expect(absoluteTreePath('bin', '/')).toBe('/bin')
    expect(absoluteTreePath('', '/')).toBe('/')
  })
})

describe('posixRelativePath', () => {
  test('a descendant is expressed without any ../', () => {
    expect(posixRelativePath('/home/enrico', '/home/enrico/Music/song.mp3')).toBe('Music/song.mp3')
  })

  test('the directory itself is .', () => {
    expect(posixRelativePath('/home/enrico', '/home/enrico')).toBe('.')
  })

  test('an ancestor and sibling climb out with ../', () => {
    expect(posixRelativePath('/home/enrico', '/home')).toBe('..')
    expect(posixRelativePath('/home/enrico/src', '/home/enrico/docs/readme.md')).toBe(
      '../docs/readme.md',
    )
  })

  test('a filesystem-root anchor and trailing slashes are tolerated', () => {
    expect(posixRelativePath('/', '/etc/hosts')).toBe('etc/hosts')
    expect(posixRelativePath('/home/enrico/', '/home/enrico/Music')).toBe('Music')
  })
})

describe('relativeTreePath', () => {
  const root = '/home/enrico'

  test('an in-root tree path already is the relative path', () => {
    expect(relativeTreePath('Music/song.mp3', root)).toBe('Music/song.mp3')
  })

  test('the empty path (the anchor) is .', () => {
    expect(relativeTreePath('', root)).toBe('.')
  })

  test('an out-of-root absolute path becomes a ../ chain', () => {
    expect(relativeTreePath('/etc/hosts', root)).toBe('../../etc/hosts')
  })
})

describe('canonicalizeFocusPath', () => {
  const root = '/home/enrico'

  test('leaves an in-root relative path untouched', () => {
    expect(canonicalizeFocusPath('src/lib', root)).toBe('src/lib')
  })

  test('collapses the served root itself to the empty relative path', () => {
    expect(canonicalizeFocusPath('/home/enrico', root)).toBe('')
  })

  test('rewrites an absolute path inside the root to its relative form', () => {
    expect(canonicalizeFocusPath('/home/enrico/Developer', root)).toBe('Developer')
  })

  test('leaves an absolute path above the anchor absolute', () => {
    expect(canonicalizeFocusPath('/home', root)).toBe('/home')
  })

  test('does not mistake a sibling prefix for containment', () => {
    expect(canonicalizeFocusPath('/home/enrico-backup', root)).toBe('/home/enrico-backup')
  })

  test('handles a filesystem-root anchor', () => {
    expect(canonicalizeFocusPath('/bin', '/')).toBe('bin')
    expect(canonicalizeFocusPath('/', '/')).toBe('')
  })

  test('passes through unchanged before the root is known', () => {
    expect(canonicalizeFocusPath('/home/enrico', null)).toBe('/home/enrico')
  })
})

describe('joinTreePath', () => {
  test('names a top-level entry by its bare name (in-root relative format)', () => {
    expect(joinTreePath('', 'src')).toBe('src')
  })

  test('joins a relative parent and child with one slash', () => {
    expect(joinTreePath('src/lib', 'tree.ts')).toBe('src/lib/tree.ts')
  })

  test('joins an absolute parent and child with one slash', () => {
    expect(joinTreePath('/home/enrico', 'Developer')).toBe('/home/enrico/Developer')
  })

  // Climbing to `/` unconfined: the root carries its own slash, so a child must
  // not double it into `//bin`.
  test('does not double the slash under the filesystem root', () => {
    expect(joinTreePath('/', 'bin')).toBe('/bin')
  })
})

describe('parentTreePath', () => {
  test('drops the last segment of an in-root relative path', () => {
    expect(parentTreePath('src/lib/tree.ts')).toBe('src/lib')
  })

  test('bottoms a single in-root segment out at the anchor root', () => {
    expect(parentTreePath('src')).toBe('')
  })

  test('rises a nested absolute path one level, keeping it absolute', () => {
    expect(parentTreePath('/home/enrico/Developer')).toBe('/home/enrico')
  })

  // The documented loose end: a top-level absolute path must climb to `/`, not
  // collapse to '' — which would teleport back down to the served anchor.
  test('rises a top-level absolute path to the filesystem root', () => {
    expect(parentTreePath('/home')).toBe('/')
  })

  test('makes the filesystem root its own parent, stopping the climb', () => {
    expect(parentTreePath('/')).toBe('/')
  })
})

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
    expect(plan.childRowLimits.size).toBe(0)
  })

  test('truncates a directory that does not fit, never overshooting the viewport', () => {
    const listings = {
      '': [directory('big', 10)],
      big: Array.from({ length: 10 }, (unused, childIndex) =>
        makeEntry({ name: `child-${String(childIndex).padStart(2, '0')}` }),
      ),
    }
    const plan = planAutoOpen({
      focusPath: '',
      listings,
      manuallyOpenPaths: new Set(),
      closedPaths: new Set(),
      ...filters,
      rowCapacity: 6,
    })
    // 1 focus row + 4 children + the "6 unlisted" pruning row = 6, exactly.
    expect([...plan.autoOpenPaths]).toEqual(['big'])
    expect(plan.childRowLimits.get('big')).toBe(4)
  })

  test('spreads the space round-robin across sibling directories, broot-style', () => {
    const children = (prefix: string) =>
      Array.from({ length: 6 }, (unused, childIndex) =>
        makeEntry({ name: `${prefix}${childIndex}` }),
      )
    const listings = {
      '': [directory('a', 6), directory('b', 6)],
      a: children('a'),
      b: children('b'),
    }
    const plan = planAutoOpen({
      focusPath: '',
      listings,
      manuallyOpenPaths: new Set(),
      closedPaths: new Set(),
      ...filters,
      rowCapacity: 9,
    })
    // Neither directory swallows the budget: 2 focus rows + (3 + pruning row)
    // under 'a' + (2 + pruning row) under 'b' = 9, exactly.
    expect([...plan.autoOpenPaths].sort()).toEqual(['a', 'b'])
    expect(plan.childRowLimits.get('a')).toBe(3)
    expect(plan.childRowLimits.get('b')).toBe(2)
  })

  test('never truncates to "1 unlisted" — the last child takes the pruning row\'s place', () => {
    const listings = {
      '': [directory('a', 3)],
      a: [makeEntry({ name: 'a1' }), makeEntry({ name: 'a2' }), makeEntry({ name: 'a3' })],
    }
    const plan = planAutoOpen({
      focusPath: '',
      listings,
      manuallyOpenPaths: new Set(),
      closedPaths: new Set(),
      ...filters,
      rowCapacity: 4,
    })
    // Budget 3 = 2 children + escrowed pruning row; the third child costs the
    // same as "1 unlisted", so the directory completes instead.
    expect([...plan.autoOpenPaths]).toEqual(['a'])
    expect(plan.childRowLimits.size).toBe(0)
  })

  test('a plan plus the row builder never renders more rows than the capacity', () => {
    const children = (prefix: string, count: number) =>
      Array.from({ length: count }, (unused, childIndex) =>
        makeEntry({ name: `${prefix}${String(childIndex).padStart(2, '0')}` }),
      )
    const listings = {
      '': [directory('a', 10), directory('b', 10)],
      a: children('a', 10),
      b: children('b', 10),
    }
    const rowCapacity = 12
    const plan = planAutoOpen({
      focusPath: '',
      listings,
      manuallyOpenPaths: new Set(),
      closedPaths: new Set(),
      ...filters,
      rowCapacity,
    })
    const { rows } = buildTreeRows({
      focusPath: '',
      listings,
      openPaths: plan.autoOpenPaths,
      autoOpenChildLimits: plan.childRowLimits,
      ...allViewOptions,
    })
    expect(rows.length).toBeLessThanOrEqual(rowCapacity)
    expect(rows.length).toBe(12)
  })
})

describe('buildTreeRows — screen-fit truncation', () => {
  test('caps a limited directory and appends its "N unlisted" pruning row', () => {
    const listings = {
      '': [directory('a', 5)],
      a: [
        makeEntry({ name: 'a1' }),
        makeEntry({ name: 'a2' }),
        makeEntry({ name: 'a3' }),
        makeEntry({ name: 'a4' }),
        makeEntry({ name: 'a5' }),
      ],
    }
    const { rows } = buildTreeRows({
      focusPath: '',
      listings,
      openPaths: new Set(['a']),
      autoOpenChildLimits: new Map([['a', 2]]),
      ...allViewOptions,
    })
    expect(entryNames(rows)).toEqual(['a', 'a/a1', 'a/a2'])
    const prunedRow = rows.at(-1)!
    expect(prunedRow.type).toBe('pruned')
    if (prunedRow.type === 'pruned') {
      expect(prunedRow.unlistedCount).toBe(3)
      // Nothing follows the pruning row here, so it closes the branch.
      expect(prunedRow.connector.isLastChild).toBe(true)
    }
  })

  test('a pruning row followed by the hidden/gitignored tally keeps the branch open', () => {
    const listings = {
      '': [directory('a', 4)],
      a: [
        makeEntry({ name: 'a1' }),
        makeEntry({ name: 'a2' }),
        makeEntry({ name: 'a3' }),
        makeEntry({ name: '.secret', isHidden: true }),
      ],
    }
    const { rows } = buildTreeRows({
      focusPath: '',
      listings,
      openPaths: new Set(['a']),
      autoOpenChildLimits: new Map([['a', 1]]),
      ...allViewOptions,
    })
    expect(entryNames(rows)).toEqual(['a', 'a/a1'])
    const [prunedRow, tallyRow] = rows.slice(-2)
    expect(prunedRow!.type).toBe('pruned')
    expect(tallyRow!.type).toBe('unlisted')
    if (prunedRow!.type === 'pruned') {
      expect(prunedRow!.unlistedCount).toBe(2)
      // The tally row follows it, so the branch stays open past the cut.
      expect(prunedRow!.connector.isLastChild).toBe(false)
    }
  })

  test('a limit at or above the visible child count changes nothing', () => {
    const listings = {
      '': [directory('a', 2)],
      a: [makeEntry({ name: 'a1' }), makeEntry({ name: 'a2' })],
    }
    const { rows } = buildTreeRows({
      focusPath: '',
      listings,
      openPaths: new Set(['a']),
      autoOpenChildLimits: new Map([['a', 2]]),
      ...allViewOptions,
    })
    expect(entryNames(rows)).toEqual(['a', 'a/a1', 'a/a2'])
    expect(rows.every((row) => row.type === 'entry')).toBe(true)
  })
})
