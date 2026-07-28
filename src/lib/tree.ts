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

// broot's "N unlisted" pruning line: a directory's trailing marker when some
// of its children were trimmed from the view — by the server's best-scoring
// search cut, or by the auto-open fill's screen-fit truncation.
export type PrunedRow = {
  type: 'pruned'
  path: string
  connectorPrefix: string
  unlistedCount: number
}

export type TreeRowModel = EntryRow | UnlistedRow | PrunedRow

export type TreeViewOptions = {
  focusPath: string
  listings: Record<string, DirectoryEntry[] | undefined>
  openPaths: ReadonlySet<string>
  // Per-directory visible-children caps from the auto-open fill (broot's
  // screen-fit truncation): an open directory listed here shows only its first
  // N children plus a "N unlisted" pruning row. The focus directory is never
  // capped — its full listing is the core content.
  autoOpenChildLimits?: ReadonlyMap<string, number>
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
  if (parentPath === '') return childName
  // The filesystem root already ends in its own slash — reached only unconfined,
  // once the user has climbed to `/`. Appending another would double it (`//bin`).
  if (parentPath === '/') return `/${childName}`
  return `${parentPath}/${childName}`
}

// The client's mirror of the server's `pathFromRoot`
// (`server/services/filesystem.ts`): the wire address for a directory the user
// focuses. An absolute path that lies inside the served root is spoken as its
// root-relative form (the in-root format, `''` for the root itself); an in-root
// relative path, or an absolute path above/outside the anchor, is already
// canonical and passes through untouched.
//
// This keeps `focusPath` byte-identical to the `relativePath` the server
// returns for it. It matters at exactly one seam: descending unconfined from
// above the anchor (an absolute path) back down through the served root, where
// the server switches from absolute to relative addressing and the client must
// switch with it — otherwise the focus load stores the listing under the
// server's key while the tree reads it under the absolute one, and paints empty.
export function canonicalizeFocusPath(path: string, rootPath: string | null): string {
  if (rootPath === null || !path.startsWith('/')) return path
  if (path === rootPath) return ''
  const rootPrefix = rootPath === '/' ? '/' : `${rootPath}/`
  return path.startsWith(rootPrefix) ? path.slice(rootPrefix.length) : path
}

// The absolute filesystem path a tree row (or the focused directory) denotes,
// for "copy path". An in-root row carries a root-relative tree path and is
// re-joined onto the served root; the empty path is the root itself; an
// out-of-root row — only reached unconfined, above the anchor — already carries
// an absolute path and stands on its own. Mirrors `focusFullPath` in App so the
// breadcrumb and a copied path never disagree.
export function absoluteTreePath(rowPath: string, rootPath: string): string {
  if (rowPath === '') return rootPath
  if (rowPath.startsWith('/')) return rowPath
  return rootPath === '/' ? `/${rowPath}` : `${rootPath}/${rowPath}`
}

// A POSIX path expressed relative to a directory, `../` chains included. Both
// arguments are absolute; segments are compared after dropping empty ones, so a
// filesystem-root anchor (`/`) and trailing slashes behave. Returns '.' when the
// path is the directory itself.
export function posixRelativePath(fromDirectory: string, toPath: string): string {
  const fromSegments = fromDirectory.split('/').filter((segment) => segment !== '')
  const toSegments = toPath.split('/').filter((segment) => segment !== '')
  let commonLength = 0
  while (
    commonLength < fromSegments.length &&
    commonLength < toSegments.length &&
    fromSegments[commonLength] === toSegments[commonLength]
  )
    commonLength++
  const upwardSegments = fromSegments.slice(commonLength).map(() => '..')
  const downwardSegments = toSegments.slice(commonLength)
  const relativeSegments = [...upwardSegments, ...downwardSegments]
  return relativeSegments.length === 0 ? '.' : relativeSegments.join('/')
}

// The served-root-relative path a tree row denotes, for "copy relative path".
// An in-root row's tree path already is exactly this, so it passes through
// untouched (the common case); the empty path is the root itself ('.'); an
// out-of-root absolute row is expressed as a `../` chain up out of the anchor.
export function relativeTreePath(rowPath: string, rootPath: string): string {
  if (rowPath === '') return '.'
  if (!rowPath.startsWith('/')) return rowPath
  return posixRelativePath(rootPath, rowPath)
}

// The parent of a tree path. Relative paths (in-root, the confined format)
// lose their last segment and bottom out at '' (the anchor root). Absolute
// paths — only reached unconfined, when the user has ascended above the anchor
// — keep their leading slash: a top-level absolute path (`/home`) rises to the
// filesystem root `/` rather than collapsing to '' (which would teleport back
// down to the served anchor), and `/` is its own parent (the walk stops there).
export function parentTreePath(path: string): string {
  const lastSlashIndex = path.lastIndexOf('/')
  if (lastSlashIndex === -1) return ''
  if (lastSlashIndex === 0) return '/'
  return path.slice(0, lastSlashIndex)
}

// broot's natural order (Sort::None): files and directories interleaved, sorted
// case-insensitively by name — no dirs-first grouping, no size ordering. One
// comparator drives both the browse tree and the search tree so their row order
// is a single invariant.
export function compareEntryNames(firstName: string, secondName: string): number {
  return firstName.localeCompare(secondName, undefined, { sensitivity: 'base', numeric: true })
}

function compareEntries(firstEntry: DirectoryEntry, secondEntry: DirectoryEntry): number {
  return compareEntryNames(firstEntry.name, secondEntry.name)
}

// A child survives the current view filters (dotfiles / gitignored). Shared by
// the row builder and the auto-open planner so both agree on what is visible.
function isVisibleChild(
  child: DirectoryEntry,
  showHidden: boolean,
  showGitignored: boolean,
): boolean {
  if (!showHidden && child.isHidden) return false
  if (!showGitignored && child.isGitignored) return false
  return true
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
  const {
    focusPath,
    listings,
    openPaths,
    autoOpenChildLimits,
    showHidden,
    showGitignored,
    showSizes,
  } = options
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
      .sort(compareEntries)

    // broot's screen-fit truncation: a directory the fill opened only partway
    // shows its first N children, then a "N unlisted" pruning row for the rest.
    const childLimit = autoOpenChildLimits?.get(parentPath)
    const prunedCount =
      childLimit !== undefined && childLimit < visibleChildren.length
        ? visibleChildren.length - childLimit
        : 0
    const shownChildren =
      prunedCount > 0 ? visibleChildren.slice(0, childLimit) : visibleChildren

    const unlistedCount = hiddenCount + ignoredCount
    const largestFileSize = Math.max(...visibleChildren.map((child) => child.sizeBytes ?? 0), 0)
    const leadPrefix = connectorLead(ancestorWasLastFlags)

    shownChildren.forEach((child, childIndex) => {
      const childPath = joinTreePath(parentPath, child.name)
      const isLastRow =
        childIndex === shownChildren.length - 1 && prunedCount === 0 && unlistedCount === 0
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

    if (prunedCount > 0) {
      rows.push({
        type: 'pruned',
        path: `${parentPath}#pruned`,
        connectorPrefix: leadPrefix + (unlistedCount === 0 ? '└──' : '├──'),
        unlistedCount: prunedCount,
      })
    }

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

export type AutoOpenPlanOptions = {
  focusPath: string
  listings: Record<string, DirectoryEntry[] | undefined>
  // Directories the user opened by hand. Their children always show and always
  // count against the viewport budget, whether or not the fill would have opened
  // them; the planner never closes them.
  manuallyOpenPaths: ReadonlySet<string>
  // Directories the user collapsed by hand. The planner never re-opens these,
  // so a deliberate collapse sticks even when there is room to fill.
  closedPaths: ReadonlySet<string>
  showHidden: boolean
  showGitignored: boolean
  // How many entry rows fit the tree viewport. The planner opens directories
  // until roughly this many rows are reserved.
  rowCapacity: number
}

export type AutoOpenPlan = {
  // Directories the fill decided to open, beyond the user's manual opens.
  autoOpenPaths: Set<string>
  // Auto-opened directories granted only part of the viewport: how many of
  // their sorted visible children the row builder should show before the
  // "N unlisted" pruning row. Directories opened in full are absent.
  childRowLimits: Map<string, number>
  // Directories whose listings must be fetched before the fill can descend into
  // them. Row counts here fall back to `childCount` until the listing arrives.
  pendingListingPaths: string[]
}

// One directory the fill is feeding child rows to, round-robin.
type FillCandidate = {
  directoryPath: string
  // Sorted visible children when the listing is loaded; null while pending.
  visibleChildren: DirectoryEntry[] | null
  // Total child rows this directory could show (estimated from `childCount`
  // while the listing is pending — it counts filtered children too, so it is
  // only used to pace the fill, never rendered).
  totalChildRowCount: number
  grantedChildRowCount: number
}

// broot's screen-fit openness, adapted to our lazy, scrolling tree: when a
// directory holds little content, open the next depth of sub-directories until
// the viewport is filled, so the empty space below a short listing is used
// rather than left blank — and never further. Like broot's builder, child rows
// are granted one at a time, round-robin across the open directories
// (shallowest and alphabetically-first get their turn first), so the space
// spreads evenly instead of the first directory swallowing it all. A directory
// that does not fit entirely is truncated: it shows the granted children plus
// a "N unlisted" pruning row (`childRowLimits`), whose own row cost is held in
// escrow from the moment the directory opens so the plan never overshoots the
// viewport.
//
// It is a pure function of the currently-loaded listings: directories it wants
// to descend into but has not fetched yet come back in `pendingListingPaths`,
// and the caller re-runs the plan once those listings load, walking one level
// deeper each pass until the budget is met or the tree runs out.
export function planAutoOpen(options: AutoOpenPlanOptions): AutoOpenPlan {
  const {
    focusPath,
    listings,
    manuallyOpenPaths,
    closedPaths,
    showHidden,
    showGitignored,
    rowCapacity,
  } = options
  const autoOpenPaths = new Set<string>()
  const childRowLimits = new Map<string, number>()
  const pendingListingPaths: string[] = []

  const focusChildren = listings[focusPath]
  if (focusChildren === undefined) return { autoOpenPaths, childRowLimits, pendingListingPaths }

  function sortedVisibleChildren(listing: DirectoryEntry[]): DirectoryEntry[] {
    return listing
      .filter((child) => isVisibleChild(child, showHidden, showGitignored))
      .sort(compareEntries)
  }

  // The "… N hidden · M gitignored" tally row a directory renders when the
  // filters hide some of its children — it costs viewport space too.
  function filterTallyRowCount(listing: DirectoryEntry[]): number {
    return listing.some((child) => !isVisibleChild(child, showHidden, showGitignored)) ? 1 : 0
  }

  function makeCandidate(parentPath: string, childDirectory: DirectoryEntry): FillCandidate | null {
    const directoryPath = joinTreePath(parentPath, childDirectory.name)
    if (closedPaths.has(directoryPath)) return null
    const listing = listings[directoryPath]
    if (listing === undefined) {
      const estimatedTotal = childDirectory.childCount ?? 0
      if (estimatedTotal <= 0 && !manuallyOpenPaths.has(directoryPath)) return null
      return {
        directoryPath,
        visibleChildren: null,
        totalChildRowCount: estimatedTotal,
        grantedChildRowCount: 0,
      }
    }
    const visibleChildren = sortedVisibleChildren(listing)
    if (visibleChildren.length === 0 && !manuallyOpenPaths.has(directoryPath)) return null
    return {
      directoryPath,
      visibleChildren,
      totalChildRowCount: visibleChildren.length,
      grantedChildRowCount: 0,
    }
  }

  // The focus directory is always fully open; its children and its filter
  // tally row are the baseline the fill adds onto — never truncated, since the
  // full focus listing is the core content (overflow there simply scrolls).
  const focusVisibleChildren = sortedVisibleChildren(focusChildren)
  let remainingRowBudget =
    rowCapacity - focusVisibleChildren.length - filterTallyRowCount(focusChildren)

  const candidateQueue: FillCandidate[] = []
  const openedCandidates: FillCandidate[] = []

  for (const focusChild of focusVisibleChildren) {
    if (focusChild.kind !== 'directory') continue
    const candidate = makeCandidate(focusPath, focusChild)
    if (candidate !== null) candidateQueue.push(candidate)
  }

  // A granted child row that turns out to be a directory becomes a fill
  // candidate of its own, at the back of the queue — deeper levels only get
  // space once every shallower open directory has had its turn.
  function enqueueNewlyGrantedChild(candidate: FillCandidate): void {
    if (candidate.visibleChildren === null) return
    const grantedChild = candidate.visibleChildren[candidate.grantedChildRowCount - 1]
    if (grantedChild === undefined || grantedChild.kind !== 'directory') return
    const childCandidate = makeCandidate(candidate.directoryPath, grantedChild)
    if (childCandidate !== null) candidateQueue.push(childCandidate)
  }

  while (remainingRowBudget > 0 && candidateQueue.length > 0) {
    const candidate = candidateQueue.shift()!

    if (candidate.grantedChildRowCount === 0) {
      // A directory the user opened by hand is open regardless: its children
      // always show in full and always count against the budget, and the fill
      // never truncates or closes it.
      if (manuallyOpenPaths.has(candidate.directoryPath)) {
        remainingRowBudget -= candidate.totalChildRowCount
        if (candidate.visibleChildren === null) {
          pendingListingPaths.push(candidate.directoryPath)
          continue
        }
        remainingRowBudget -= filterTallyRowCount(listings[candidate.directoryPath]!)
        for (const child of candidate.visibleChildren) {
          if (child.kind !== 'directory') continue
          const childCandidate = makeCandidate(candidate.directoryPath, child)
          if (childCandidate !== null) candidateQueue.push(childCandidate)
        }
        continue
      }

      // First grant decides whether opening is worth it at all: the directory
      // needs room for its filter tally row (if any), one child row, and —
      // unless it fits in a single row — the escrowed "N unlisted" row.
      const tallyRowCount =
        candidate.visibleChildren === null
          ? 0
          : filterTallyRowCount(listings[candidate.directoryPath]!)
      const rowsNeededToOpen = tallyRowCount + (candidate.totalChildRowCount === 1 ? 1 : 2)
      if (remainingRowBudget < rowsNeededToOpen) continue
      autoOpenPaths.add(candidate.directoryPath)
      openedCandidates.push(candidate)
      if (candidate.visibleChildren === null) pendingListingPaths.push(candidate.directoryPath)
      remainingRowBudget -= rowsNeededToOpen
      candidate.grantedChildRowCount = 1
      enqueueNewlyGrantedChild(candidate)
      if (candidate.grantedChildRowCount < candidate.totalChildRowCount)
        candidateQueue.push(candidate)
      continue
    }

    // Subsequent grant: one more child row. The final child is free — it takes
    // the place of the escrowed "N unlisted" row, which is then not needed.
    const grantCompletesDirectory =
      candidate.grantedChildRowCount === candidate.totalChildRowCount - 1
    if (!grantCompletesDirectory) remainingRowBudget -= 1
    candidate.grantedChildRowCount += 1
    enqueueNewlyGrantedChild(candidate)
    if (candidate.grantedChildRowCount < candidate.totalChildRowCount)
      candidateQueue.push(candidate)
  }

  for (const openedCandidate of openedCandidates) {
    // A directory one child short of complete completes for free: the last
    // child costs exactly the escrowed pruning row (and "1 unlisted" would be
    // a pointless swap for the child itself).
    if (openedCandidate.totalChildRowCount - openedCandidate.grantedChildRowCount === 1)
      openedCandidate.grantedChildRowCount += 1
    if (openedCandidate.grantedChildRowCount < openedCandidate.totalChildRowCount)
      childRowLimits.set(openedCandidate.directoryPath, openedCandidate.grantedChildRowCount)
  }

  return { autoOpenPaths, childRowLimits, pendingListingPaths }
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
    const children = (childrenByParent.get(parentNodePath) ?? []).sort((firstNode, secondNode) =>
      compareEntryNames(firstNode.entry.name, secondNode.entry.name),
    )
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
        type: 'pruned',
        path: `${parentNodePath}#pruned`,
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
