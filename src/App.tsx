import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DirectoryEntry } from '../shared/filesystem.schema'
import type { Preview } from '../shared/preview.schema'
import type { SearchSubtreeResult } from '../shared/search.schema'
import {
  fetchDirectoryListing,
  fetchPreview,
  fetchSearchResult,
  openFileWithDefaultApplication,
} from './lib/api'
import { isConfinementBlocked } from './lib/confinement'
import {
  buildSearchRows,
  buildTreeRows,
  joinTreePath,
  parentTreePath,
  planAutoOpen,
  ROOT_LINE_PATH,
  type EntryRow,
} from './lib/tree'
import { PreviewPanel } from './components/PreviewPanel'
import { TitleBar } from './components/TitleBar'
import { TreeView } from './components/TreeView'
import { CommandBar } from './components/CommandBar'
import { useTheme } from './lib/theme'
import { useViewSettings } from './lib/viewSettings'
import { useApiBase } from './lib/apiBase'
import { createUrlFocusNavigation, type FocusNavigation } from './lib/focusNavigation'
import { useResizableSplit } from './lib/resizableSplit'
import { warmHighlighter } from './lib/highlighter'

function baseName(path: string): string {
  const lastSlashIndex = path.lastIndexOf('/')
  return lastSlashIndex === -1 ? path : path.slice(lastSlashIndex + 1)
}

// Fallback row height (px) used only before any entry row has rendered, so the
// first auto-open pass has a sane viewport estimate to work from.
const FALLBACK_TREE_ROW_HEIGHT = 27

// The tree's scroll viewport and its first entry row. The root line is pinned
// outside this container (a separate signal), so it is never mistaken for a
// scrolling row when measuring.
function measureTreeViewport(): { container: HTMLElement; rowHeight: number } | null {
  const container = document.querySelector<HTMLElement>('[data-tree-scroll]')
  if (container === null) return null
  const rowElement = container.querySelector<HTMLElement>('[data-row-path]')
  const rowHeight =
    rowElement !== null && rowElement.offsetHeight > 0
      ? rowElement.offsetHeight
      : FALLBACK_TREE_ROW_HEIGHT
  return { container, rowHeight }
}

// One "page" of rows for PageDown/ctrl-d, measured from the rendered tree.
function measurePageRowCount(): number {
  const viewport = measureTreeViewport()
  if (viewport === null) return 10
  return Math.max(1, Math.floor(viewport.container.clientHeight / viewport.rowHeight) - 1)
}

// How many entry rows fit the tree viewport — the auto-open budget (broot's
// targeted_size). Rounded down, padding excluded: the fill must never plan
// more rows than the height can show (broot's screen-fit), so a partially
// visible last row does not count as space worth filling.
function measureTreeRowCapacity(): number {
  const viewport = measureTreeViewport()
  if (viewport === null) return 0
  const paddingBottom = Number.parseFloat(getComputedStyle(viewport.container).paddingBottom) || 0
  return Math.max(0, Math.floor((viewport.container.clientHeight - paddingBottom) / viewport.rowHeight))
}

// Set equality by membership — the auto-open effect uses it to hold a stable
// reference when a re-plan lands on the same directories, so it does not loop.
function pathSetsEqual(first: ReadonlySet<string>, second: ReadonlySet<string>): boolean {
  if (first.size !== second.size) return false
  for (const value of first) if (!second.has(value)) return false
  return true
}

// Map equality by entries — same purpose as `pathSetsEqual`, for the fill's
// per-directory child limits.
function childLimitMapsEqual(
  first: ReadonlyMap<string, number>,
  second: ReadonlyMap<string, number>,
): boolean {
  if (first.size !== second.size) return false
  for (const [directoryPath, childLimit] of first)
    if (second.get(directoryPath) !== childLimit) return false
  return true
}

// Holding an arrow key walks the tree faster than any request can answer. The
// preview request is deferred by this much and the pending one is aborted on
// every move, so a run of keystrokes costs one preview — the tree paints each
// row immediately regardless (AGENTS.md responsiveness principle).
const PREVIEW_SETTLE_MILLISECONDS = 90

export type AppProps = {
  // The focus-history seam: URL-backed standalone (deep-linkable `?path=`,
  // browser back/forward), or in-memory when embedded in a host that owns the
  // page URL. Defaults to the URL seam so the standalone app is unchanged.
  navigation?: FocusNavigation
  // A file to open selected and previewed on mount — the embedded "open this
  // file" deep-link. When set, the preview column starts open so the file is
  // shown, not merely highlighted in the tree.
  initialSelectedPath?: string | null
  // Whether this App is embedded in a host that owns the page theme. Embedded,
  // the theme hook goes read-only (it inherits the host's `[data-theme]`) and
  // the title-bar theme toggle is omitted.
  embedded?: boolean
  // The host's close verb, wired by an embedding mount. When the explorer's own
  // layered Escape is exhausted (no filter, selection on the root line, focus
  // history empty), the final Escape calls this instead of dead-ending — and the
  // command-bar hint switches to `esc close`. Absent standalone: Escape keeps
  // today's wording and behaviour.
  onRequestClose?: () => void
}

export function App({
  navigation,
  initialSelectedPath = null,
  embedded = false,
  onRequestClose,
}: AppProps = {}) {
  // The navigation seam is created once (URL-backed by default). Threading it
  // through a stable memo keeps its subscription/effect identity stable.
  const focusNavigation = useMemo<FocusNavigation>(
    () => navigation ?? createUrlFocusNavigation(),
    [navigation],
  )
  // Where the API lives relative to this page ('' = same-origin standalone; an
  // absolute origin when embedded against a separate explorer server).
  const apiBaseUrl = useApiBase()
  const [rootPath, setRootPath] = useState<string | null>(null)
  const [focusPath, setFocusPath] = useState<string>(() => focusNavigation.initialFocusPath())
  const [listings, setListings] = useState<Record<string, DirectoryEntry[] | undefined>>({})
  // Three layers compose the effective open set. `openPaths` and `closedPaths`
  // are the user's manual overrides; `autoOpenFill` is broot's screen-fit fill,
  // computed to use the empty space below a short listing — its `paths` are the
  // directories the fill opened, its `childRowLimits` the per-directory
  // truncation for those it could only open partway. Effective open =
  // (manual-open ∪ auto-open) \ manual-closed.
  const [openPaths, setOpenPaths] = useState<ReadonlySet<string>>(new Set())
  const [closedPaths, setClosedPaths] = useState<ReadonlySet<string>>(new Set())
  const [autoOpenFill, setAutoOpenFill] = useState<{
    paths: ReadonlySet<string>
    childRowLimits: ReadonlyMap<string, number>
  }>({ paths: new Set(), childRowLimits: new Map() })
  // Directories the fill has already asked the server for, so a directory that
  // fails to load (or is slow) is not re-fetched on every re-plan.
  const autoOpenRequestedRef = useRef<Set<string>>(new Set())
  // Bumped on viewport resize to re-run the fill against the new height.
  const [viewportResizeTick, setViewportResizeTick] = useState(0)
  const [selectedPath, setSelectedPath] = useState<string | null>(initialSelectedPath)
  const [pattern, setPattern] = useState('')
  const { viewSettings, setViewSettings } = useViewSettings()
  const {
    showSizes,
    showHidden,
    showGitignored,
    showPreview,
    wrapPreview,
    renderMarkdown,
    previewRatio,
  } = viewSettings
  const [searchResult, setSearchResult] = useState<SearchSubtreeResult | null>(null)
  // Listing-scoped: the tree could not be loaded. Kept strictly separate from
  // row-scoped refusals, which the rows render themselves.
  const [listingError, setListingError] = useState<string | null>(null)
  const [refusedPath, setRefusedPath] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [isPreviewFocused, setIsPreviewFocused] = useState(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  // Embedded, the host owns `<html data-theme>`; the hook goes read-only so it
  // doesn't fight the host (the grove tokens inherit the host's scheme).
  const { themeMode, setThemeMode } = useTheme({ manageDocument: !embedded })

  const loadListing = useCallback(
    async (relativePath: string) => {
      try {
        const listing = await fetchDirectoryListing(apiBaseUrl, relativePath)
        setRootPath(listing.rootPath)
        setListings((previousListings) => ({
          ...previousListings,
          [listing.relativePath]: listing.entries,
        }))
        setListingError(null)
      } catch (loadError) {
        setListingError(loadError instanceof Error ? loadError.message : String(loadError))
      }
    },
    [apiBaseUrl],
  )

  useEffect(() => {
    void loadListing(focusPath)
  }, [focusPath, loadListing])

  // Warm the syntax highlighter off the first paint (AGENTS.md responsiveness
  // principle): the engine and common grammars load in the background so the
  // first text preview a user selects does not pay for them. Fire-and-forget —
  // a preview that arrives first simply awaits the same singleton promise.
  useEffect(() => {
    warmHighlighter()
  }, [])

  // Opening straight onto a file (the embedded "preview this file" deep-open)
  // must show it, not just highlight it — so the preview column starts open. A
  // one-shot on mount: thereafter the user's own toggle owns the column.
  useEffect(() => {
    if (initialSelectedPath === null) return
    setViewSettings((previousViewSettings) =>
      previousViewSettings.showPreview
        ? previousViewSettings
        : { ...previousViewSettings, showPreview: true },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Server-side recursive fuzzy search, broot-style: every keystroke fires a
  // request and aborts the one before it, which cancels the walk server-side.
  // The previous result stays on screen until the new one lands, so typing
  // never flashes an unfiltered tree.
  useEffect(() => {
    if (pattern === '') {
      setSearchResult(null)
      return
    }
    const abortController = new AbortController()
    fetchSearchResult({
      baseUrl: apiBaseUrl,
      relativePath: focusPath,
      pattern,
      showHidden,
      showGitignored,
      // broot's targeted_size is the screen height: the server trims the
      // result tree to roughly what fits the viewport, plus a little slack
      // since ours scrolls.
      limit: Math.min(500, Math.max(30, (measurePageRowCount() + 1) * 2)),
      abortSignal: abortController.signal,
    })
      .then((result) => {
        setSearchResult(result)
        setListingError(null)
        // Land the selection on the best-scoring match, like broot.
        const bestNode = result.nodes.reduce<(typeof result.nodes)[number] | null>(
          (currentBest, node) =>
            node.score !== null && (currentBest === null || node.score > (currentBest.score ?? 0))
              ? node
              : currentBest,
          null,
        )
        if (bestNode !== null) setSelectedPath(joinTreePath(result.relativePath, bestNode.path))
      })
      .catch((searchError: unknown) => {
        if (abortController.signal.aborted) return
        setListingError(searchError instanceof Error ? searchError.message : String(searchError))
      })
    return () => abortController.abort()
  }, [pattern, focusPath, showHidden, showGitignored, apiBaseUrl])

  // The preview always describes the selected row; the tree's first line (the
  // current directory itself) previews that directory.
  const previewTargetPath =
    selectedPath === null || selectedPath === ROOT_LINE_PATH ? focusPath : selectedPath

  // Preview is enrichment, never part of the navigation path: the request is
  // deferred past the paint, aborted the moment the selection moves on, and its
  // failure degrades to a message in the panel — it never touches the tree.
  useEffect(() => {
    if (!showPreview) {
      setPreview(null)
      setPreviewError(null)
      setIsPreviewLoading(false)
      return
    }
    const abortController = new AbortController()
    setIsPreviewLoading(true)
    const settleTimer = window.setTimeout(() => {
      fetchPreview(apiBaseUrl, previewTargetPath, abortController.signal)
        .then((loadedPreview) => {
          if (abortController.signal.aborted) return
          setPreview(loadedPreview)
          setPreviewError(null)
          setIsPreviewLoading(false)
        })
        .catch((previewFetchError: unknown) => {
          if (abortController.signal.aborted) return
          setPreview(null)
          setPreviewError(
            previewFetchError instanceof Error
              ? previewFetchError.message
              : String(previewFetchError),
          )
          setIsPreviewLoading(false)
        })
    }, PREVIEW_SETTLE_MILLISECONDS)
    return () => {
      window.clearTimeout(settleTimer)
      abortController.abort()
    }
  }, [showPreview, previewTargetPath, apiBaseUrl])

  // Focus changes that originate outside App — the browser back/forward buttons
  // (URL seam) or the explorer's own "back" verb (in-memory seam) — arrive here
  // and re-focus, exactly as a click does. One code path for both seams.
  useEffect(() => {
    return focusNavigation.subscribe((nextFocusPath) => {
      setFocusPath(nextFocusPath)
      setPattern('')
    })
  }, [focusNavigation])

  const focusDirectory = useCallback(
    (nextFocusPath: string) => {
      focusNavigation.push(nextFocusPath)
      setFocusPath(nextFocusPath)
      setPattern('')
      setSelectedPath(null)
    },
    [focusNavigation],
  )

  const focusParentDirectory = useCallback(() => {
    if (focusPath === '') return
    focusDirectory(parentTreePath(focusPath))
    // broot keeps the selection on the top line (the new current directory)
    // after walking up — it neither jumps to nor expands the directory we left.
    setSelectedPath(ROOT_LINE_PATH)
  }, [focusPath, focusDirectory])

  const isSearching = pattern !== ''

  // The tree the user actually sees: the fill's auto-opens plus the user's
  // manual opens, minus anything the user deliberately collapsed.
  const effectiveOpenPaths = useMemo(() => {
    const effective = new Set(autoOpenFill.paths)
    for (const manuallyOpenPath of openPaths) effective.add(manuallyOpenPath)
    for (const closedPath of closedPaths) effective.delete(closedPath)
    return effective
  }, [autoOpenFill, openPaths, closedPaths])

  // The fill's truncation caps, minus any directory the user has since opened
  // by hand — a manual open means "show me everything in here", so it always
  // renders in full.
  const autoOpenChildLimits = useMemo(() => {
    if (autoOpenFill.childRowLimits.size === 0 || openPaths.size === 0)
      return autoOpenFill.childRowLimits
    const limits = new Map(autoOpenFill.childRowLimits)
    for (const manuallyOpenPath of openPaths) limits.delete(manuallyOpenPath)
    return limits
  }, [autoOpenFill, openPaths])

  // Once the user has expanded or collapsed anything by hand, the tree is
  // theirs: the fill freezes at its current shape rather than second-guessing a
  // deliberate collapse by opening a sibling to reclaim the space.
  const userHasAdjustedTree = openPaths.size > 0 || closedPaths.size > 0

  // Each focus is a fresh view: clear the manual overrides and the fill so the
  // new directory is auto-filled from scratch, broot-style (focus = new root).
  useEffect(() => {
    setOpenPaths(new Set())
    setClosedPaths(new Set())
    setAutoOpenFill({ paths: new Set(), childRowLimits: new Map() })
    autoOpenRequestedRef.current = new Set()
  }, [focusPath])

  // broot's screen-fit fill: open the next depth of directories until the
  // viewport is full, so a short listing does not leave the panel half empty —
  // and no further: a directory that does not fit is truncated to a
  // "N unlisted" excerpt rather than overflowing the height. Enrichment, not
  // navigation — it runs after paint, descends one level per pass as listings
  // arrive, and never blocks the core listing from showing.
  useEffect(() => {
    if (isSearching || userHasAdjustedTree) return
    if (listings[focusPath] === undefined) return
    const rowCapacity = measureTreeRowCapacity()
    if (rowCapacity <= 0) return
    const plan = planAutoOpen({
      focusPath,
      listings,
      manuallyOpenPaths: openPaths,
      closedPaths,
      showHidden,
      showGitignored,
      rowCapacity,
    })
    setAutoOpenFill((previous) =>
      pathSetsEqual(previous.paths, plan.autoOpenPaths) &&
      childLimitMapsEqual(previous.childRowLimits, plan.childRowLimits)
        ? previous
        : { paths: plan.autoOpenPaths, childRowLimits: plan.childRowLimits },
    )
    for (const pendingPath of plan.pendingListingPaths) {
      if (autoOpenRequestedRef.current.has(pendingPath)) continue
      autoOpenRequestedRef.current.add(pendingPath)
      void loadListing(pendingPath)
    }
  }, [
    isSearching,
    userHasAdjustedTree,
    focusPath,
    listings,
    openPaths,
    closedPaths,
    showHidden,
    showGitignored,
    viewportResizeTick,
    loadListing,
  ])

  // A taller viewport has more space to fill; re-plan the fill on resize.
  useEffect(() => {
    function handleViewportResize() {
      setViewportResizeTick((tick) => tick + 1)
    }
    window.addEventListener('resize', handleViewportResize)
    return () => window.removeEventListener('resize', handleViewportResize)
  }, [])

  const browseView = useMemo(
    () =>
      buildTreeRows({
        focusPath,
        listings,
        openPaths: effectiveOpenPaths,
        autoOpenChildLimits,
        showHidden,
        showGitignored,
        showSizes,
      }),
    [focusPath, listings, effectiveOpenPaths, autoOpenChildLimits, showHidden, showGitignored, showSizes],
  )
  const searchView = useMemo(
    () => (searchResult === null ? null : buildSearchRows({ result: searchResult, showSizes })),
    [searchResult, showSizes],
  )
  const { rows, entryRowCount, matchCount } =
    isSearching && searchView !== null ? searchView : browseView
  const entryRows = useMemo(
    () => rows.filter((row): row is EntryRow => row.type === 'entry'),
    [rows],
  )
  const focusListing = listings[focusPath]
  const focusEntryCount = focusListing === undefined ? null : focusListing.length

  // The tree's first line (the current directory itself) is selectable too,
  // sitting above the entry rows. Enter on it walks up one level and the
  // selection stays on this line, broot-style.
  const selectablePaths = useMemo(
    () => [ROOT_LINE_PATH, ...entryRows.map((entryRow) => entryRow.path)],
    [entryRows],
  )

  // Keep the selection on a visible row, defaulting to the root line — broot
  // opens with the current-directory line selected, so Enter walks up out of
  // the box. While the listing is still loading (no rows yet) leave the
  // selection alone so a pre-seeded selection — e.g. the directory we just
  // came out of — survives until the rows arrive.
  useEffect(() => {
    if (entryRows.length === 0) return
    if (selectedPath !== null && selectablePaths.includes(selectedPath)) return
    setSelectedPath(ROOT_LINE_PATH)
  }, [entryRows, selectablePaths, selectedPath])

  useEffect(() => {
    if (selectedPath === null) return
    document
      .querySelector(`[data-row-path="${CSS.escape(selectedPath)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedPath])

  const selectedRow = entryRows.find((entryRow) => entryRow.path === selectedPath)

  // The visible filter matches, in tree order — Tab/BackTab walk these.
  const matchPaths = useMemo(
    () => entryRows.filter((entryRow) => entryRow.isMatch).map((entryRow) => entryRow.path),
    [entryRows],
  )

  const moveSelection = useCallback(
    (delta: number, movementMode: 'cycle' | 'clamp') => {
      if (selectablePaths.length === 0) return
      const currentIndex = selectablePaths.indexOf(selectedPath ?? '')
      const startIndex = currentIndex === -1 ? 0 : currentIndex
      const rowCount = selectablePaths.length
      // Single-line moves cycle past the ends like broot's line_down/line_up;
      // page moves stop at the ends.
      const nextIndex =
        movementMode === 'cycle'
          ? (((startIndex + delta) % rowCount) + rowCount) % rowCount
          : Math.max(0, Math.min(rowCount - 1, startIndex + delta))
      setSelectedPath(selectablePaths[nextIndex]!)
    },
    [selectablePaths, selectedPath],
  )

  const walkMatches = useCallback(
    (step: number) => {
      if (matchPaths.length === 0) return
      const currentMatchIndex = matchPaths.indexOf(selectedPath ?? '')
      const nextMatchIndex =
        currentMatchIndex === -1
          ? step > 0
            ? 0
            : matchPaths.length - 1
          : (currentMatchIndex + step + matchPaths.length) % matchPaths.length
      setSelectedPath(matchPaths[nextMatchIndex]!)
    },
    [matchPaths, selectedPath],
  )

  // Acting on a symlink that leaves the served root is refused here, before any
  // request (the server would refuse it too, with a 403). The reason itself is
  // not stored: the row renders it from `escapesRoot` whenever it is selected,
  // so there is no panel-scoped message to place, clear, or let go stale. All
  // this records is *which* row was refused, so its reason line can acknowledge
  // the attempt rather than appearing to ignore it.
  const refuseIfBlocked = useCallback(
    (entryPath: string): boolean => {
      const row = entryRows.find((entryRow) => entryRow.path === entryPath)
      if (row === undefined || !isConfinementBlocked(row.entry)) return false
      setRefusedPath(entryPath)
      return true
    },
    [entryRows],
  )

  // "Open" hands the file to the OS default application on the host machine
  // (the desktop double-click gesture); a launcher failure surfaces in the same
  // error strip as listing errors.
  const openFile = useCallback(
    (filePath: string) => {
      if (refuseIfBlocked(filePath)) return
      openFileWithDefaultApplication(apiBaseUrl, filePath).catch((openError: unknown) => {
        setListingError(openError instanceof Error ? openError.message : String(openError))
      })
    },
    [refuseIfBlocked, apiBaseUrl],
  )

  // broot's open_stay (Enter): the root line goes to the parent, a
  // directory becomes the new root, a file opens with the OS default app.
  const openSelection = useCallback(() => {
    if (selectedPath === ROOT_LINE_PATH) focusParentDirectory()
    else if (selectedRow === undefined) return
    // Before the kind branches: a blocked entry is reported as `other`, which
    // would otherwise fall off the end of this chain and do nothing at all.
    else if (refuseIfBlocked(selectedRow.path)) return
    else if (selectedRow.entry.kind === 'directory') focusDirectory(selectedRow.path)
    else if (selectedRow.entry.kind === 'file') openFile(selectedRow.path)
  }, [selectedPath, selectedRow, focusParentDirectory, focusDirectory, openFile, refuseIfBlocked])

  // broot's back verb: pop the most recent state change — an active filter
  // first, then the focus history through the navigation seam (the browser's
  // own history standalone, an in-memory stack when embedded).
  const goBack = useCallback(() => {
    if (pattern !== '') setPattern('')
    else if (focusNavigation.canGoBack()) focusNavigation.back()
    // Nothing left to pop: hand an exhausted Escape to the host's close verb.
    // Standalone (no `onRequestClose`) this is the historical no-op.
    else onRequestClose?.()
  }, [pattern, focusNavigation, onRequestClose])

  const toggleSizes = useCallback(() => {
    setViewSettings((previousViewSettings) => ({
      ...previousViewSettings,
      showSizes: !previousViewSettings.showSizes,
    }))
  }, [setViewSettings])

  const toggleHidden = useCallback(() => {
    setViewSettings((previousViewSettings) => ({
      ...previousViewSettings,
      showHidden: !previousViewSettings.showHidden,
    }))
  }, [setViewSettings])

  const toggleGitignored = useCallback(() => {
    setViewSettings((previousViewSettings) => ({
      ...previousViewSettings,
      showGitignored: !previousViewSettings.showGitignored,
    }))
  }, [setViewSettings])

  // broot's preview column, and its focus model: the panel is a second place
  // the keyboard can live, so opening it and focusing it are two distinct
  // steps in each direction.
  const setPreviewVisible = useCallback(
    (shouldShowPreview: boolean) => {
      setViewSettings((previousViewSettings) => ({
        ...previousViewSettings,
        showPreview: shouldShowPreview,
      }))
    },
    [setViewSettings],
  )

  const togglePreview = useCallback(() => {
    setViewSettings((previousViewSettings) => ({
      ...previousViewSettings,
      showPreview: !previousViewSettings.showPreview,
    }))
  }, [setViewSettings])

  // A file's single click reveals it in the preview panel — enrichment, not the
  // OS launch (that's the double-click's job). Selection already aims the
  // preview at this file; this only makes the panel visible. A blocked entry
  // refuses here instead, surfacing the reason line rather than previewing.
  const previewFile = useCallback(
    (filePath: string) => {
      if (refuseIfBlocked(filePath)) return
      setPreviewVisible(true)
    },
    [refuseIfBlocked, setPreviewVisible],
  )

  const toggleWrapPreview = useCallback(() => {
    setViewSettings((previousViewSettings) => ({
      ...previousViewSettings,
      wrapPreview: !previousViewSettings.wrapPreview,
    }))
  }, [setViewSettings])

  const toggleRenderMarkdown = useCallback(() => {
    setViewSettings((previousViewSettings) => ({
      ...previousViewSettings,
      renderMarkdown: !previousViewSettings.renderMarkdown,
    }))
  }, [setViewSettings])

  const setPreviewRatio = useCallback(
    (nextPreviewRatio: number) => {
      setViewSettings((previousViewSettings) => ({
        ...previousViewSettings,
        previewRatio: nextPreviewRatio,
      }))
    },
    [setViewSettings],
  )

  // Opening straight onto a file makes the file the point: the split starts
  // preview-dominant (until the user drags it). Fixed for the mount's life, like
  // the deep-open selection itself.
  const isFileIntent = initialSelectedPath !== null
  const { containerRef, previewWidth, onDividerPointerDown } = useResizableSplit({
    previewRatio,
    isFileIntent,
    onPreviewRatioChange: setPreviewRatio,
  })

  const focusPreviewPanel = useCallback(() => {
    previewScrollRef.current?.focus()
  }, [])

  // Handing the keyboard back to the tree means handing it to the always-active
  // search input, which is where tree-mode typing belongs.
  const focusTreeNavigation = useCallback(() => {
    previewScrollRef.current?.blur()
    searchInputRef.current?.focus()
  }, [])

  // Closing the panel while it holds the keyboard would strand focus on a
  // removed element; pull it back to the tree first.
  useEffect(() => {
    if (showPreview || !isPreviewFocused) return
    setIsPreviewFocused(false)
    searchInputRef.current?.focus()
  }, [showPreview, isPreviewFocused])

  // Reveal-everything toggle: flip both the hidden and gitignored views in a
  // single stroke. If either is currently off we turn both on; only once both
  // are on does it clear both back off — so the shortcut always lands on a
  // clean "show everything" / "show nothing extra" state.
  const toggleHiddenAndGitignored = useCallback(() => {
    setViewSettings((previousViewSettings) => {
      const shouldShowAll = !(previousViewSettings.showHidden && previousViewSettings.showGitignored)
      return {
        ...previousViewSettings,
        showHidden: shouldShowAll,
        showGitignored: shouldShowAll,
      }
    })
  }, [setViewSettings])

  useEffect(() => {
    function handleKeyDown(keyboardEvent: KeyboardEvent) {
      const { key } = keyboardEvent

      const searchInputElement = searchInputRef.current
      const isSearchInputFocused =
        searchInputElement !== null && document.activeElement === searchInputElement

      // broot's preview chords, one modifier + one arrow, four states:
      //   closed              + ctrl/cmd-→  open it, keyboard stays in the tree
      //   open, tree focused  + ctrl/cmd-→  hand the keyboard to the preview
      //   open, preview focused + ctrl/cmd-←  hand it back to the tree
      //   open, tree focused  + ctrl/cmd-←  close it
      // Each direction is two presses end to end, and neither ever skips a step.
      if (keyboardEvent.ctrlKey || keyboardEvent.metaKey) {
        if (key === 'ArrowRight') {
          keyboardEvent.preventDefault()
          if (!showPreview) setPreviewVisible(true)
          else focusPreviewPanel()
          return
        }
        if (key === 'ArrowLeft') {
          keyboardEvent.preventDefault()
          if (!showPreview) return
          if (isPreviewFocused) focusTreeNavigation()
          else setPreviewVisible(false)
          return
        }
      }

      // While the preview holds the keyboard, every other key is the preview's:
      // arrows scroll it natively, and typing must not be siphoned into the
      // search field behind it.
      if (isPreviewFocused) return

      // broot's always-active input: a character (or Backspace) typed while the
      // search field isn't focused is redirected into it, so filtering can start
      // from anywhere without clicking the box first. We focus the field and let
      // the browser deliver the keystroke natively, keeping insertion, caret
      // movement and deletion correct. Modifier combos stay browser/app shortcuts;
      // navigation keys (arrows, Enter, Tab, Esc) fall through to the handlers
      // below and keep working from anywhere.
      if (
        !isSearchInputFocused &&
        searchInputElement !== null &&
        !keyboardEvent.ctrlKey &&
        !keyboardEvent.metaKey &&
        !keyboardEvent.altKey &&
        (key.length === 1 || key === 'Backspace')
      ) {
        searchInputElement.focus()
        return
      }

      // DEVIATION FROM BROOT: broot has no single "reveal everything" key — it
      // exposes hidden and gitignored files through two separate toggles (its
      // `:toggle_hidden` / `:toggle_git_ignore`, bound by default to Alt-h and
      // Alt-i). We add Alt-a on top of those as a one-stroke shortcut that flips
      // both views together (both on / both off). `code === 'KeyA'` rather than
      // `key`, because Alt rewrites `key` to a composed character on some
      // keyboard layouts (e.g. 'å' on macOS) while the physical code is stable.
      if (keyboardEvent.altKey && keyboardEvent.code === 'KeyA') {
        keyboardEvent.preventDefault()
        toggleHiddenAndGitignored()
      } else if (keyboardEvent.altKey && keyboardEvent.code === 'KeyS') {
        // Alt-s flips the size column/bars on and off. `code === 'KeyS'` rather
        // than `key`, because Alt rewrites `key` to a composed character on some
        // keyboard layouts (e.g. 'ß' / 'Í') while the physical code is stable.
        keyboardEvent.preventDefault()
        toggleSizes()
      } else if (key === 'ArrowDown') {
        keyboardEvent.preventDefault()
        moveSelection(1, 'cycle')
      } else if (key === 'ArrowUp') {
        keyboardEvent.preventDefault()
        moveSelection(-1, 'cycle')
      } else if (key === 'PageDown' || (key === 'd' && keyboardEvent.ctrlKey)) {
        keyboardEvent.preventDefault()
        moveSelection(measurePageRowCount(), 'clamp')
      } else if (key === 'PageUp' || (key === 'u' && keyboardEvent.ctrlKey)) {
        keyboardEvent.preventDefault()
        moveSelection(-measurePageRowCount(), 'clamp')
      } else if (key === 'Enter') {
        keyboardEvent.preventDefault()
        openSelection()
      } else if (key === 'Escape') {
        // broot-style: Esc first pulls the selection back up to the tree's
        // first line (the current-directory line); only once that line is
        // already selected does a further Esc go back.
        keyboardEvent.preventDefault()
        if (selectedPath !== ROOT_LINE_PATH) setSelectedPath(ROOT_LINE_PATH)
        else goBack()
      } else if (key === 'Tab' && isSearching) {
        if (matchPaths.length === 0) return
        keyboardEvent.preventDefault()
        walkMatches(keyboardEvent.shiftKey ? -1 : 1)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    moveSelection,
    walkMatches,
    openSelection,
    goBack,
    toggleSizes,
    toggleHiddenAndGitignored,
    focusParentDirectory,
    pattern,
    isSearching,
    matchPaths,
    selectedPath,
    showPreview,
    isPreviewFocused,
    setPreviewVisible,
    focusPreviewPanel,
    focusTreeNavigation,
  ])

  const rootName = rootPath === null ? '…' : baseName(rootPath) || rootPath
  const focusLabel = focusPath === '' ? rootName : baseName(focusPath)
  // Join the served root and the focused subpath with exactly one slash: when
  // the served root is the filesystem root (`/`), a naive `${rootPath}/…` would
  // double it into `//home/…`.
  const focusFullPath =
    rootPath === null
      ? '…'
      : focusPath === ''
        ? rootPath
        : `${rootPath === '/' ? '' : rootPath}/${focusPath}`

  // The next Escape hands off to the host's close verb only once the layering is
  // spent: no filter, the selection already on the root line, and no focus
  // history left to pop. Drives the honest `esc close` vs `esc back` hint.
  const escapeWouldClose =
    onRequestClose !== undefined &&
    pattern === '' &&
    selectedPath === ROOT_LINE_PATH &&
    !focusNavigation.canGoBack()

  // The tree/preview/command-bar body is identical in both mounts; only the
  // outer chrome differs — a centred, full-screen card standalone, or a plain
  // fill of the host's container when embedded (the host owns the frame, header
  // and close, so the explorer drops its own TitleBar to avoid a second one).
  const explorerBody = (
    <>
      {!embedded && (
        <TitleBar rootPath={rootPath} themeMode={themeMode} onSelectThemeMode={setThemeMode} />
      )}
      {/* Tree and preview share one row; the preview is a column beside the
          rows it describes (ADR-0031), never a modal over them. A draggable
          divider between them sizes the split — measured against this row. */}
      <div ref={containerRef} className="flex min-h-0 flex-1">
        <TreeView
          rootFullPath={focusFullPath}
          isRootLineSelected={selectedPath === ROOT_LINE_PATH}
          focusEntryCount={focusEntryCount}
          rows={rows}
          showSizes={showSizes}
          showHidden={showHidden}
          showGitignored={showGitignored}
          showPreview={showPreview}
          selectedPath={selectedPath}
          refusedPath={refusedPath}
          listingError={listingError}
          onSelect={setSelectedPath}
          onFocusParent={focusParentDirectory}
          onFocusDirectory={focusDirectory}
          onPreviewFile={previewFile}
          onOpenFile={openFile}
          onToggleSizes={toggleSizes}
          onToggleHidden={toggleHidden}
          onToggleGitignored={toggleGitignored}
          onTogglePreview={togglePreview}
        />
        {showPreview && (
          <>
            {/* The resize handle owns the split. It also carries the focus
                accent on the edge it occupies between the two panes (ADR-0028's
                shared interaction token), lighting up when the preview holds the
                keyboard. */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the preview panel"
              onPointerDown={onDividerPointerDown}
              className={`w-1 flex-none cursor-col-resize transition-colors ${
                isPreviewFocused ? 'bg-sel-bar' : 'bg-line hover:bg-accent'
              }`}
            />
            <PreviewPanel
              scrollRef={previewScrollRef}
              isFocused={isPreviewFocused}
              targetPath={previewTargetPath}
              preview={preview}
              previewError={previewError}
              isLoading={isPreviewLoading}
              width={previewWidth}
              wrapText={wrapPreview}
              onToggleWrap={toggleWrapPreview}
              renderMarkdown={renderMarkdown}
              onToggleRenderMarkdown={toggleRenderMarkdown}
              onFocusChange={setIsPreviewFocused}
            />
          </>
        )}
      </div>
      <CommandBar
        inputRef={searchInputRef}
        focusLabel={focusLabel}
        pattern={pattern}
        isFiltering={isSearching}
        matchCount={matchCount}
        matchCountIsLowerBound={searchResult?.stats.truncated ?? false}
        entryRowCount={entryRowCount}
        focusEntryCount={focusEntryCount}
        escapeHintAction={escapeWouldClose ? 'close' : 'back'}
        onPatternChange={setPattern}
      />
    </>
  )

  if (embedded) {
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-term font-mono text-[13.5px] leading-[1.62] text-fg antialiased selection:bg-accent selection:text-void">
        {explorerBody}
      </div>
    )
  }

  return (
    <div className="grid min-h-screen place-items-center bg-void bg-[radial-gradient(120%_80%_at_50%_-10%,rgba(111,183,255,0.08),transparent_55%),radial-gradient(90%_70%_at_80%_120%,rgba(255,110,199,0.06),transparent_60%)] p-[clamp(14px,3vw,40px)] font-mono text-[13.5px] leading-[1.62] text-fg antialiased selection:bg-accent selection:text-void">
      <div className="flex h-[min(720px,92vh)] w-full max-w-[1080px] flex-col overflow-hidden rounded-[14px] border border-line bg-term shadow-[0_40px_120px_-30px_rgba(0,0,0,0.8),0_1px_0_rgba(255,255,255,0.05)_inset]">
        {explorerBody}
      </div>
    </div>
  )
}
