import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DirectoryEntry } from '../shared/filesystem.schema'
import type { SearchSubtreeResult } from '../shared/search.schema'
import { fetchDirectoryListing, fetchSearchResult, rawFileUrl } from './lib/api'
import {
  buildSearchRows,
  buildTreeRows,
  joinTreePath,
  parentTreePath,
  ROOT_LINE_PATH,
  type EntryRow,
} from './lib/tree'
import { TitleBar } from './components/TitleBar'
import { TreeView } from './components/TreeView'
import { CommandBar } from './components/CommandBar'
import { useTheme } from './lib/theme'
import { useViewSettings } from './lib/viewSettings'

function readFocusPathFromUrl(): string {
  return new URLSearchParams(window.location.search).get('path') ?? ''
}

function pushFocusPathToUrl(focusPath: string): void {
  const nextUrl =
    focusPath === ''
      ? window.location.pathname
      : `${window.location.pathname}?path=${encodeURIComponent(focusPath)}`
  const currentUrl = `${window.location.pathname}${window.location.search}`
  if (nextUrl !== currentUrl) window.history.pushState({}, '', nextUrl)
}

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

export function App() {
  const [rootPath, setRootPath] = useState<string | null>(null)
  const [focusPath, setFocusPath] = useState<string>(readFocusPathFromUrl)
  const [listings, setListings] = useState<Record<string, DirectoryEntry[] | undefined>>({})
  const [openPaths, setOpenPaths] = useState<ReadonlySet<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [pattern, setPattern] = useState('')
  const { viewSettings, setViewSettings } = useViewSettings()
  const { showSizes, showHidden, showGitignored } = viewSettings
  const [searchResult, setSearchResult] = useState<SearchSubtreeResult | null>(null)
  const [listingError, setListingError] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const { themeMode, setThemeMode } = useTheme()

  const loadListing = useCallback(async (relativePath: string) => {
    try {
      const listing = await fetchDirectoryListing(relativePath)
      setRootPath(listing.rootPath)
      setListings((previousListings) => ({
        ...previousListings,
        [listing.relativePath]: listing.entries,
      }))
      setListingError(null)
    } catch (loadError) {
      setListingError(loadError instanceof Error ? loadError.message : String(loadError))
    }
  }, [])

  useEffect(() => {
    void loadListing(focusPath)
  }, [focusPath, loadListing])

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
  }, [pattern, focusPath, showHidden, showGitignored])

  // Browser back/forward walks the focus history naturally.
  useEffect(() => {
    function handlePopState() {
      setFocusPath(readFocusPathFromUrl())
      setPattern('')
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const focusDirectory = useCallback((nextFocusPath: string) => {
    pushFocusPathToUrl(nextFocusPath)
    setFocusPath(nextFocusPath)
    setPattern('')
    setSelectedPath(null)
  }, [])

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

  // "Open" is a same-tab navigation to the file's raw URL, so the browser
  // back button returns to the tree with its history intact.
  const openFileInPlace = useCallback((filePath: string) => {
    window.location.assign(rawFileUrl(filePath))
  }, [])

  // broot's open_stay (Enter / →): the root line goes to the parent, a
  // directory becomes the new root, a file opens in place.
  const openSelection = useCallback(() => {
    if (selectedPath === ROOT_LINE_PATH) focusParentDirectory()
    else if (selectedRow === undefined) return
    else if (selectedRow.entry.kind === 'directory') focusDirectory(selectedRow.path)
    else if (selectedRow.entry.kind === 'file') openFileInPlace(selectedRow.path)
  }, [selectedPath, selectedRow, focusParentDirectory, focusDirectory, openFileInPlace])

  // broot's back verb: pop the most recent state change — an active filter
  // first, then the focus history (which lives in the browser history, so
  // this also composes with the browser's own back button).
  const goBack = useCallback(() => {
    if (pattern !== '') setPattern('')
    else window.history.back()
  }, [pattern])

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
      const inputTarget =
        keyboardEvent.target instanceof HTMLInputElement ? keyboardEvent.target : null

      const searchInputElement = searchInputRef.current
      const isSearchInputFocused =
        searchInputElement !== null && document.activeElement === searchInputElement

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
      } else if (key === 'ArrowRight') {
        // Inside a typed pattern the caret moves; at its end, → opens.
        if (inputTarget !== null && inputTarget.selectionStart !== inputTarget.value.length) return
        keyboardEvent.preventDefault()
        openSelection()
      } else if (key === 'ArrowLeft') {
        // Inside a typed pattern the caret moves; at its start, ← goes back.
        if (inputTarget !== null && (inputTarget.selectionStart ?? 0) > 0) return
        keyboardEvent.preventDefault()
        goBack()
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
  ])

  const rootName = rootPath === null ? '…' : baseName(rootPath) || rootPath
  const focusLabel = focusPath === '' ? rootName : baseName(focusPath)
  const focusFullPath =
    rootPath === null ? '…' : focusPath === '' ? rootPath : `${rootPath}/${focusPath}`

  return (
    <div className="grid min-h-screen place-items-center bg-void bg-[radial-gradient(120%_80%_at_50%_-10%,rgba(111,183,255,0.08),transparent_55%),radial-gradient(90%_70%_at_80%_120%,rgba(255,110,199,0.06),transparent_60%)] p-[clamp(14px,3vw,40px)] font-mono text-[13.5px] leading-[1.62] text-fg antialiased selection:bg-accent selection:text-void">
      <div className="flex h-[min(720px,92vh)] w-full max-w-[1080px] flex-col overflow-hidden rounded-[14px] border border-line bg-term shadow-[0_40px_120px_-30px_rgba(0,0,0,0.8),0_1px_0_rgba(255,255,255,0.05)_inset]">
        <TitleBar rootPath={rootPath} themeMode={themeMode} onSelectThemeMode={setThemeMode} />
        <TreeView
          rootFullPath={focusFullPath}
          isRootLineSelected={selectedPath === ROOT_LINE_PATH}
          focusEntryCount={focusEntryCount}
          rows={rows}
          showSizes={showSizes}
          showHidden={showHidden}
          showGitignored={showGitignored}
          selectedPath={selectedPath}
          listingError={listingError}
          onSelect={setSelectedPath}
          onFocusParent={focusParentDirectory}
          onToggleDirectory={toggleDirectory}
          onFocusDirectory={focusDirectory}
          onOpenFile={openFileInPlace}
          onToggleSizes={toggleSizes}
          onToggleHidden={toggleHidden}
          onToggleGitignored={toggleGitignored}
        />
        <CommandBar
          inputRef={searchInputRef}
          focusLabel={focusLabel}
          pattern={pattern}
          isFiltering={isSearching}
          matchCount={matchCount}
          matchCountIsLowerBound={searchResult?.stats.truncated ?? false}
          entryRowCount={entryRowCount}
          focusEntryCount={focusEntryCount}
          onPatternChange={setPattern}
        />
      </div>
    </div>
  )
}
