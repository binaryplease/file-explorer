import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DirectoryEntry } from '../shared/filesystem.schema'
import type { SearchSubtreeResult } from '../shared/search.schema'
import { fetchDirectoryListing, fetchSearchResult } from './lib/api'
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

export function App() {
  const [rootPath, setRootPath] = useState<string | null>(null)
  const [focusPath, setFocusPath] = useState<string>(readFocusPathFromUrl)
  const [listings, setListings] = useState<Record<string, DirectoryEntry[] | undefined>>({})
  const [openPaths, setOpenPaths] = useState<ReadonlySet<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [pattern, setPattern] = useState('')
  const [showSizes, setShowSizes] = useState(true)
  const [showHidden, setShowHidden] = useState(false)
  const [showGitignored, setShowGitignored] = useState(false)
  const [searchResult, setSearchResult] = useState<SearchSubtreeResult | null>(null)
  const [listingError, setListingError] = useState<string | null>(null)
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
      limit: 100,
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
    const previousFocusPath = focusPath
    focusDirectory(parentTreePath(focusPath))
    // Land on the directory we just came out of.
    setSelectedPath(previousFocusPath)
    setOpenPaths((previousOpenPaths) => new Set(previousOpenPaths).add(previousFocusPath))
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
  // sitting above the entry rows. Enter on it walks up one level, broot-style.
  const selectablePaths = useMemo(
    () => [ROOT_LINE_PATH, ...entryRows.map((entryRow) => entryRow.path)],
    [entryRows],
  )

  // Keep the selection on a visible row. While the listing is still loading
  // (no rows yet) leave the selection alone so a pre-seeded selection — e.g.
  // the directory we just came out of — survives until the rows arrive.
  useEffect(() => {
    if (entryRows.length === 0) return
    if (selectedPath !== null && selectablePaths.includes(selectedPath)) return
    setSelectedPath(entryRows[0]!.path)
  }, [entryRows, selectablePaths, selectedPath])

  useEffect(() => {
    if (selectedPath === null) return
    document
      .querySelector(`[data-row-path="${CSS.escape(selectedPath)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedPath])

  const selectedRow = entryRows.find((entryRow) => entryRow.path === selectedPath)

  const moveSelection = useCallback(
    (delta: number) => {
      if (selectablePaths.length === 0) return
      const currentIndex = selectablePaths.indexOf(selectedPath ?? '')
      const nextIndex = Math.max(
        0,
        Math.min(selectablePaths.length - 1, (currentIndex === -1 ? 0 : currentIndex) + delta),
      )
      setSelectedPath(selectablePaths[nextIndex]!)
    },
    [selectablePaths, selectedPath],
  )

  useEffect(() => {
    function handleKeyDown(keyboardEvent: KeyboardEvent) {
      if (keyboardEvent.key === 'ArrowDown') {
        keyboardEvent.preventDefault()
        moveSelection(1)
      } else if (keyboardEvent.key === 'ArrowUp') {
        keyboardEvent.preventDefault()
        moveSelection(-1)
      } else if (keyboardEvent.key === 'Enter') {
        keyboardEvent.preventDefault()
        // The root line goes up a level; a directory row goes into it.
        if (selectedPath === ROOT_LINE_PATH) focusParentDirectory()
        else if (selectedRow !== undefined && selectedRow.entry.kind === 'directory') {
          focusDirectory(selectedRow.path)
        }
      } else if (keyboardEvent.key === 'ArrowRight') {
        if (selectedRow !== undefined && selectedRow.entry.kind === 'directory' && !selectedRow.isOpen) {
          keyboardEvent.preventDefault()
          toggleDirectory(selectedRow.path)
        }
      } else if (keyboardEvent.key === 'ArrowLeft') {
        keyboardEvent.preventDefault()
        // On the root line, left also walks up a level.
        if (selectedPath === ROOT_LINE_PATH) {
          focusParentDirectory()
        } else if (selectedRow === undefined) {
          return
        } else if (!isSearching && selectedRow.entry.kind === 'directory' && selectedRow.isOpen) {
          toggleDirectory(selectedRow.path)
        } else {
          const parentPath = parentTreePath(selectedRow.path)
          setSelectedPath(parentPath === focusPath ? ROOT_LINE_PATH : parentPath)
        }
      } else if (keyboardEvent.key === 'Escape') {
        setPattern('')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [moveSelection, selectedRow, selectedPath, focusDirectory, toggleDirectory, focusParentDirectory, isSearching, focusPath])

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
          onToggleSizes={() => setShowSizes((previousShowSizes) => !previousShowSizes)}
          onToggleHidden={() => setShowHidden((previousShowHidden) => !previousShowHidden)}
          onToggleGitignored={() =>
            setShowGitignored((previousShowGitignored) => !previousShowGitignored)
          }
        />
        <CommandBar
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
