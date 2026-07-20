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

// One "page" of rows for PageDown/ctrl-d, measured from the rendered tree —
// rows are fixed-height direct children of the scroll container.
function measurePageRowCount(): number {
  const rowElement = document.querySelector<HTMLElement>('[data-row-path]')
  const scrollContainer = rowElement?.parentElement ?? null
  if (rowElement === null || scrollContainer === null || rowElement.offsetHeight === 0) return 10
  return Math.max(1, Math.floor(scrollContainer.clientHeight / rowElement.offsetHeight) - 1)
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
  const [openPaths, setOpenPaths] = useState<ReadonlySet<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(initialSelectedPath)
  const [pattern, setPattern] = useState('')
  const { viewSettings, setViewSettings } = useViewSettings()
  const { showSizes, showHidden, showGitignored, showPreview, wrapPreview, previewRatio } =
    viewSettings
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

  const toggleDirectory = useCallback(
    (directoryPath: string) => {
      // Search rows are a server-pruned view; expand/collapse is browse-only.
      if (isSearching) return
      setOpenPaths((previousOpenPaths) => {
        const nextOpenPaths = new Set(previousOpenPaths)
        if (nextOpenPaths.has(directoryPath)) nextOpenPaths.delete(directoryPath)
        else nextOpenPaths.add(directoryPath)
        return nextOpenPaths
      })
      if (listings[directoryPath] === undefined) void loadListing(directoryPath)
    },
    [listings, loadListing, isSearching],
  )

  const browseView = useMemo(
    () => buildTreeRows({ focusPath, listings, openPaths, showHidden, showGitignored, showSizes }),
    [focusPath, listings, openPaths, showHidden, showGitignored, showSizes],
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

  const toggleWrapPreview = useCallback(() => {
    setViewSettings((previousViewSettings) => ({
      ...previousViewSettings,
      wrapPreview: !previousViewSettings.wrapPreview,
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
          onToggleDirectory={toggleDirectory}
          onFocusDirectory={focusDirectory}
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
