import type { DirectoryEntry } from '../../shared/filesystem.schema'
import type { SearchNode, SearchSubtreeResult } from '../../shared/search.schema'
import { fuzzyMatch, type FuzzySegment } from '../../shared/fuzzy'

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
  ignoredCount: number
}

export type TreeRowModel = EntryRow | UnlistedRow

export type TreeViewOptions = {
  focusPath: string
  listings: Record<string, DirectoryEntry[] | undefined>
  openPaths: ReadonlySet<string>
  showHidden: boolean
  showGitignored: boolean
  showSizes: boolean
}

export type TreeRowsResult = {
  rows: TreeRowModel[]
  entryRowCount: number
  matchCount: number
  bestMatchPath: string | null
}

// Sentinel selection value for the tree's first line — the current directory
// itself. It can never collide with a real entry path (those are relative to
// the served root and never start with a slash). Selecting it and pressing
// Enter walks up one level, broot-style.
export const ROOT_LINE_PATH = '/__root_line__'

export function joinTreePath(parentPath: string, childName: string): string {
  return parentPath === '' ? childName : `${parentPath}/${childName}`
}

export function parentTreePath(path: string): string {
  const lastSlashIndex = path.lastIndexOf('/')
  return lastSlashIndex === -1 ? '' : path.slice(0, lastSlashIndex)
}

function compareEntries(
  firstEntry: DirectoryEntry,
  secondEntry: DirectoryEntry,
  showSizes: boolean,
): number {
  const firstIsDirectory = firstEntry.kind === 'directory'
  const secondIsDirectory = secondEntry.kind === 'directory'
  if (firstIsDirectory !== secondIsDirectory) return firstIsDirectory ? -1 : 1
  if (showSizes && !firstIsDirectory) {
    const sizeDifference = (secondEntry.sizeBytes ?? 0) - (firstEntry.sizeBytes ?? 0)
    if (sizeDifference !== 0) return sizeDifference
  }
  return firstEntry.name.localeCompare(secondEntry.name)
}

function unmatchedSegments(name: string): FuzzySegment[] {
  return name === '' ? [] : [{ text: name, matched: false }]
}

function connectorLead(ancestorWasLastFlags: boolean[]): string {
  return ancestorWasLastFlags
    .map((ancestorWasLast) => (ancestorWasLast ? '   ' : '│  '))
    .join('')
}

// Flattens the loaded tree under `focusPath` into display rows, in the broot
// style: box-drawing connectors, dirs first, and a trailing "… N hidden" line
// per folder. Filtering while typing is the server's job (`buildSearchRows`);
// this is pure browse mode.
export function buildTreeRows(options: TreeViewOptions): TreeRowsResult {
  const { focusPath, listings, openPaths, showHidden, showGitignored, showSizes } = options
  const rows: TreeRowModel[] = []

  function walk(parentPath: string, ancestorWasLastFlags: boolean[]): void {
    const children = listings[parentPath]
    if (children === undefined) return

    let hiddenCount = 0
    let ignoredCount = 0
    const visibleChildren = children
      .filter((child) => {
        if (!showHidden && child.isHidden) {
          hiddenCount++
          return false
        }
        if (!showGitignored && child.isGitignored) {
          ignoredCount++
          return false
        }
        return true
      })
      .sort((firstChild, secondChild) => compareEntries(firstChild, secondChild, showSizes))

    const unlistedCount = hiddenCount + ignoredCount
    const largestFileSize = Math.max(...visibleChildren.map((child) => child.sizeBytes ?? 0), 0)
    const leadPrefix = connectorLead(ancestorWasLastFlags)

    visibleChildren.forEach((child, childIndex) => {
      const childPath = joinTreePath(parentPath, child.name)
      const isLastRow = childIndex === visibleChildren.length - 1 && unlistedCount === 0
      const isOpen = child.kind === 'directory' && openPaths.has(childPath)
      rows.push({
        type: 'entry',
        path: childPath,
        entry: child,
        connectorPrefix: leadPrefix + (isLastRow ? '└──' : '├──'),
        isOpen,
        nameSegments: unmatchedSegments(child.name),
        isMatch: false,
        barFraction:
          showSizes && child.kind === 'file' && child.sizeBytes !== null && largestFileSize > 0
            ? Math.max(child.sizeBytes / largestFileSize, 0.03)
            : null,
      })
      if (isOpen) walk(childPath, [...ancestorWasLastFlags, isLastRow])
    })

    if (unlistedCount > 0) {
      rows.push({
        type: 'unlisted',
        path: `${parentPath}#unlisted`,
        connectorPrefix: `${leadPrefix}└──`,
        hiddenCount,
        ignoredCount,
      })
    }
  }

  walk(focusPath, [])
  const entryRowCount = rows.filter((row) => row.type === 'entry').length
  return { rows, entryRowCount, matchCount: 0, bestMatchPath: null }
}

export type SearchViewOptions = {
  result: SearchSubtreeResult
  showSizes: boolean
}

// Renders a server search result — the best-scoring matches plus their
// ancestor chains — as tree rows in tree order, broot-style: structure stays
// alphabetical, matched characters highlight, the best match gets selected.
export function buildSearchRows(options: SearchViewOptions): TreeRowsResult {
  const { result, showSizes } = options
  const rows: TreeRowModel[] = []

  const childrenByParent = new Map<string, SearchNode[]>()
  for (const node of result.nodes) {
    const parentPath = parentTreePath(node.path)
    const siblings = childrenByParent.get(parentPath)
    if (siblings === undefined) childrenByParent.set(parentPath, [node])
    else siblings.push(node)
  }

  let bestMatchPath: string | null = null
  let bestMatchScore = -Infinity

  function walk(parentPath: string, ancestorWasLastFlags: boolean[]): void {
    const children = (childrenByParent.get(parentPath) ?? []).sort((firstNode, secondNode) =>
      compareEntries(firstNode.entry, secondNode.entry, showSizes),
    )
    const largestFileSize = Math.max(...children.map((child) => child.entry.sizeBytes ?? 0), 0)
    const leadPrefix = connectorLead(ancestorWasLastFlags)

    children.forEach((child, childIndex) => {
      // Row paths are relative to the served root, like browse rows, so
      // selection and focus handlers work unchanged.
      const rowPath = joinTreePath(result.relativePath, child.path)
      const isLastRow = childIndex === children.length - 1
      const isMatch = child.score !== null
      const hasChildren = childrenByParent.has(child.path)
      if (child.score !== null && child.score > bestMatchScore) {
        bestMatchScore = child.score
        bestMatchPath = rowPath
      }
      rows.push({
        type: 'entry',
        path: rowPath,
        entry: child.entry,
        connectorPrefix: leadPrefix + (isLastRow ? '└──' : '├──'),
        isOpen: hasChildren,
        nameSegments: isMatch
          ? fuzzyMatch(result.pattern, child.entry.name).segments
          : unmatchedSegments(child.entry.name),
        isMatch,
        barFraction:
          showSizes &&
          child.entry.kind === 'file' &&
          child.entry.sizeBytes !== null &&
          largestFileSize > 0
            ? Math.max(child.entry.sizeBytes / largestFileSize, 0.03)
            : null,
      })
      if (hasChildren) walk(child.path, [...ancestorWasLastFlags, isLastRow])
    })
  }

  walk('', [])
  return {
    rows,
    entryRowCount: rows.length,
    matchCount: result.stats.matchCount,
    bestMatchPath,
  }
}
