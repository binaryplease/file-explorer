import type { DirectoryEntry } from '../../shared/filesystem.schema'
import { fuzzyMatch, type FuzzySegment } from './fuzzy'

export type EntryRow = {
  type: 'entry'
  path: string
  entry: DirectoryEntry
  connectorPrefix: string
  isOpen: boolean
  nameSegments: FuzzySegment[]
  isMatch: boolean
  // Size-bar width relative to the largest file among visible siblings.
  barFraction: number | null
}

export type UnlistedRow = {
  type: 'unlisted'
  path: string
  connectorPrefix: string
  hiddenCount: number
}

export type TreeRowModel = EntryRow | UnlistedRow

export type TreeViewOptions = {
  focusPath: string
  listings: Record<string, DirectoryEntry[] | undefined>
  openPaths: ReadonlySet<string>
  pattern: string
  showHidden: boolean
  showSizes: boolean
}

export type TreeRowsResult = { rows: TreeRowModel[]; entryRowCount: number; matchCount: number }

export function joinTreePath(parentPath: string, childName: string): string {
  return parentPath === '' ? childName : `${parentPath}/${childName}`
}

export function parentTreePath(path: string): string {
  const lastSlashIndex = path.lastIndexOf('/')
  return lastSlashIndex === -1 ? '' : path.slice(0, lastSlashIndex)
}

function sortEntries(entries: DirectoryEntry[], showSizes: boolean): DirectoryEntry[] {
  return [...entries].sort((firstEntry, secondEntry) => {
    const firstIsDirectory = firstEntry.kind === 'directory'
    const secondIsDirectory = secondEntry.kind === 'directory'
    if (firstIsDirectory !== secondIsDirectory) return firstIsDirectory ? -1 : 1
    if (showSizes && !firstIsDirectory) {
      const sizeDifference = (secondEntry.sizeBytes ?? 0) - (firstEntry.sizeBytes ?? 0)
      if (sizeDifference !== 0) return sizeDifference
    }
    return firstEntry.name.localeCompare(secondEntry.name)
  })
}

// Flattens the loaded tree under `focusPath` into display rows, in the broot
// style: box-drawing connectors, dirs first, fuzzy filter with auto-expanded
// ancestors of matches, and a trailing "… N hidden" line per folder.
export function buildTreeRows(options: TreeViewOptions): TreeRowsResult {
  const { focusPath, listings, openPaths, pattern, showHidden, showSizes } = options
  const isFiltering = pattern !== ''
  const rows: TreeRowModel[] = []
  let matchCount = 0

  function subtreeHasMatch(entryPath: string, entry: DirectoryEntry): boolean {
    if (!showHidden && entry.isHidden) return false
    if (fuzzyMatch(pattern, entry.name).matched) return true
    if (entry.kind !== 'directory') return false
    const children = listings[entryPath]
    if (children === undefined) return false
    return children.some((child) => subtreeHasMatch(joinTreePath(entryPath, child.name), child))
  }

  function loadedDescendantMatches(directoryPath: string): boolean {
    const children = listings[directoryPath]
    if (children === undefined) return false
    return children.some((child) => subtreeHasMatch(joinTreePath(directoryPath, child.name), child))
  }

  function walk(parentPath: string, ancestorWasLastFlags: boolean[]): void {
    const children = listings[parentPath]
    if (children === undefined) return

    let visibleChildren = children.filter((child) => showHidden || !child.isHidden)
    if (isFiltering) {
      visibleChildren = visibleChildren.filter((child) =>
        subtreeHasMatch(joinTreePath(parentPath, child.name), child),
      )
    }
    visibleChildren = sortEntries(visibleChildren, showSizes)

    const hiddenCount =
      !isFiltering && !showHidden ? children.filter((child) => child.isHidden).length : 0
    const largestFileSize = Math.max(
      ...visibleChildren.map((child) => child.sizeBytes ?? 0),
      0,
    )
    const leadPrefix = ancestorWasLastFlags
      .map((ancestorWasLast) => (ancestorWasLast ? '   ' : '│  '))
      .join('')

    visibleChildren.forEach((child, childIndex) => {
      const childPath = joinTreePath(parentPath, child.name)
      const isLastRow = childIndex === visibleChildren.length - 1 && hiddenCount === 0
      const fuzzyResult = fuzzyMatch(pattern, child.name)
      const isMatch = isFiltering && fuzzyResult.matched
      if (isMatch) matchCount++
      const isOpen =
        child.kind === 'directory' &&
        (isFiltering ? loadedDescendantMatches(childPath) : openPaths.has(childPath))
      rows.push({
        type: 'entry',
        path: childPath,
        entry: child,
        connectorPrefix: leadPrefix + (isLastRow ? '└─ ' : '├─ '),
        isOpen,
        nameSegments: fuzzyResult.segments,
        isMatch,
        barFraction:
          showSizes && child.kind === 'file' && child.sizeBytes !== null && largestFileSize > 0
            ? Math.max(child.sizeBytes / largestFileSize, 0.03)
            : null,
      })
      if (isOpen) walk(childPath, [...ancestorWasLastFlags, isLastRow])
    })

    if (hiddenCount > 0) {
      rows.push({
        type: 'unlisted',
        path: `${parentPath}#hidden`,
        connectorPrefix: `${leadPrefix}└─ `,
        hiddenCount,
      })
    }
  }

  walk(focusPath, [])
  const entryRowCount = rows.filter((row) => row.type === 'entry').length
  return { rows, entryRowCount, matchCount }
}
