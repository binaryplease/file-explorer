import type { DirectoryEntry } from '../../shared/filesystem.schema'
import type { SearchNode, SearchSubtreeResult } from '../../shared/search.schema'
import { fuzzyMatch, type FuzzySegment } from '../../shared/fuzzy'

export type EntryRow = {
  type: 'entry'
  path: string
  entry: DirectoryEntry
  connectorPrefix: string
  isOpen: boolean
  // Search rows show the whole subpath, broot-style: the parent part renders
  // dimmed ahead of the name. Empty outside searches / for top-level rows.
  pathPrefixSegments: FuzzySegment[]
  nameSegments: FuzzySegment[]
  isMatch: boolean
  // broot's " …" suffix: this directory holds matches that are not displayed.
  showUnlistedSuffix: boolean
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

// broot's "N unlisted" pruning line: trailing marker under a search-result
// directory whose matching children were trimmed from the view.
export type SearchUnlistedRow = {
  type: 'search-unlisted'
  path: string
  connectorPrefix: string
  unlistedCount: number
}

export type TreeRowModel = EntryRow | UnlistedRow | SearchUnlistedRow

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
        pathPrefixSegments: [],
        nameSegments: unmatchedSegments(child.name),
        isMatch: false,
        showUnlistedSuffix: false,
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

// Splits the segments of a matched subpath at its last `/` — broot's
// split_on_last: the parent part (slash included) renders dimmed, the name
// part renders like any entry name. Matched characters stay highlighted on
// both sides.
function splitSubpathSegments(segments: FuzzySegment[]): {
  pathPrefixSegments: FuzzySegment[]
  nameSegments: FuzzySegment[]
} {
  for (let segmentIndex = segments.length - 1; segmentIndex >= 0; segmentIndex--) {
    const segment = segments[segmentIndex]!
    const slashIndex = segment.text.lastIndexOf('/')
    if (slashIndex === -1) continue
    const pathPrefixSegments = segments.slice(0, segmentIndex)
    pathPrefixSegments.push({ text: segment.text.slice(0, slashIndex + 1), matched: segment.matched })
    const nameHead = segment.text.slice(slashIndex + 1)
    const nameSegments = [
      ...(nameHead === '' ? [] : [{ text: nameHead, matched: segment.matched }]),
      ...segments.slice(segmentIndex + 1),
    ]
    return { pathPrefixSegments, nameSegments }
  }
  return { pathPrefixSegments: [], nameSegments: segments }
}

// Renders a server search result — broot's pruned best-scoring tree — as
// rows. Faithful to broot's search display: children sort case-insensitively
// with files and directories interleaved, direct matches show their whole
// subpath (parent part dimmed) with matched characters highlighted, and
// directories with trimmed matches carry a " …" suffix or a trailing
// "N unlisted" line.
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

  function walk(
    parentNodePath: string,
    ancestorWasLastFlags: boolean[],
    trailingUnlistedCount: number,
  ): void {
    const children = (childrenByParent.get(parentNodePath) ?? []).sort((firstNode, secondNode) => {
      const firstName = firstNode.entry.name.toLowerCase()
      const secondName = secondNode.entry.name.toLowerCase()
      return firstName < secondName ? -1 : firstName > secondName ? 1 : 0
    })
    const largestFileSize = Math.max(...children.map((child) => child.entry.sizeBytes ?? 0), 0)
    const leadPrefix = connectorLead(ancestorWasLastFlags)

    children.forEach((child, childIndex) => {
      // Row paths are relative to the served root, like browse rows, so
      // selection and focus handlers work unchanged.
      const rowPath = joinTreePath(result.relativePath, child.path)
      const isLastRow = childIndex === children.length - 1 && trailingUnlistedCount === 0
      const hasChildren = childrenByParent.has(child.path)
      // broot: a directory whose matches are all hidden shows its plain name
      // plus " …"; otherwise a direct match displays as its full subpath.
      const showUnlistedSuffix = child.unlisted > 0 && !hasChildren
      const { pathPrefixSegments, nameSegments } =
        child.directMatch && !showUnlistedSuffix
          ? splitSubpathSegments(fuzzyMatch(result.pattern, child.path).segments)
          : { pathPrefixSegments: [], nameSegments: unmatchedSegments(child.entry.name) }
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
        pathPrefixSegments,
        nameSegments,
        isMatch: child.directMatch,
        showUnlistedSuffix,
        barFraction:
          showSizes &&
          child.entry.kind === 'file' &&
          child.entry.sizeBytes !== null &&
          largestFileSize > 0
            ? Math.max(child.entry.sizeBytes / largestFileSize, 0.03)
            : null,
      })
      if (hasChildren) walk(child.path, [...ancestorWasLastFlags, isLastRow], child.unlisted)
    })

    if (trailingUnlistedCount > 0) {
      rows.push({
        type: 'search-unlisted',
        path: `${parentNodePath}#search-unlisted`,
        connectorPrefix: `${leadPrefix}└──`,
        unlistedCount: trailingUnlistedCount,
      })
    }
  }

  walk('', [], 0)
  return {
    rows,
    entryRowCount: rows.filter((row) => row.type === 'entry').length,
    matchCount: result.stats.matchCount,
    bestMatchPath,
  }
}
