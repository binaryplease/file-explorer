import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DirectoryEntry } from '../shared/filesystem.schema'
import { fetchDirectoryListing } from './lib/api'
import { buildTreeRows, joinTreePath, parentTreePath, type EntryRow } from './lib/tree'
import { TitleBar } from './components/TitleBar'
import { RootLine } from './components/RootLine'
import { TreeView } from './components/TreeView'
import { CommandBar } from './components/CommandBar'

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
  const [listingError, setListingError] = useState<string | null>(null)

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

  const toggleDirectory = useCallback(
    (directoryPath: string) => {
      setOpenPaths((previousOpenPaths) => {
        const nextOpenPaths = new Set(previousOpenPaths)
        if (nextOpenPaths.has(directoryPath)) nextOpenPaths.delete(directoryPath)
        else nextOpenPaths.add(directoryPath)
        return nextOpenPaths
      })
      if (listings[directoryPath] === undefined) void loadListing(directoryPath)
    },
    [listings, loadListing],
  )

  const { rows, entryRowCount, matchCount } = useMemo(
    () => buildTreeRows({ focusPath, listings, openPaths, pattern, showHidden, showSizes }),
    [focusPath, listings, openPaths, pattern, showHidden, showSizes],
  )
  const entryRows = useMemo(
    () => rows.filter((row): row is EntryRow => row.type === 'entry'),
    [rows],
  )
  const focusListing = listings[focusPath]
  const focusEntryCount = focusListing === undefined ? null : focusListing.length

  // Keep the selection on a visible row. While the listing is still loading
  // (no rows yet) leave the selection alone so a pre-seeded selection — e.g.
  // the directory we just came out of — survives until the rows arrive.
  useEffect(() => {
    if (entryRows.length === 0) return
    if (selectedPath !== null && entryRows.some((entryRow) => entryRow.path === selectedPath)) return
    setSelectedPath(entryRows[0]!.path)
  }, [entryRows, selectedPath])

  useEffect(() => {
    if (selectedPath === null) return
    document
      .querySelector(`[data-row-path="${CSS.escape(selectedPath)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedPath])

  const selectedRow = entryRows.find((entryRow) => entryRow.path === selectedPath)

  const moveSelection = useCallback(
    (delta: number) => {
      if (entryRows.length === 0) return
      const currentIndex = entryRows.findIndex((entryRow) => entryRow.path === selectedPath)
      const nextIndex = Math.max(
        0,
        Math.min(entryRows.length - 1, (currentIndex === -1 ? 0 : currentIndex) + delta),
      )
      setSelectedPath(entryRows[nextIndex]!.path)
    },
    [entryRows, selectedPath],
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
        if (selectedRow !== undefined && selectedRow.entry.kind === 'directory') {
          focusDirectory(selectedRow.path)
        }
      } else if (keyboardEvent.key === 'ArrowRight') {
        if (selectedRow !== undefined && selectedRow.entry.kind === 'directory' && !selectedRow.isOpen) {
          keyboardEvent.preventDefault()
          toggleDirectory(selectedRow.path)
        }
      } else if (keyboardEvent.key === 'ArrowLeft') {
        if (selectedRow === undefined) return
        keyboardEvent.preventDefault()
        if (selectedRow.entry.kind === 'directory' && selectedRow.isOpen) {
          toggleDirectory(selectedRow.path)
        } else {
          const parentPath = parentTreePath(selectedRow.path)
          if (parentPath !== focusPath) setSelectedPath(parentPath)
        }
      } else if (keyboardEvent.key === 'Backspace' && pattern === '') {
        keyboardEvent.preventDefault()
        focusParentDirectory()
      } else if (keyboardEvent.key === 'Escape') {
        setPattern('')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [moveSelection, selectedRow, focusDirectory, toggleDirectory, focusParentDirectory, pattern, focusPath])

  const rootName = rootPath === null ? '…' : baseName(rootPath) || rootPath
  const focusLabel = focusPath === '' ? rootName : baseName(focusPath)

  return (
    <div className="grid min-h-screen place-items-center bg-void bg-[radial-gradient(120%_80%_at_50%_-10%,rgba(111,183,255,0.08),transparent_55%),radial-gradient(90%_70%_at_80%_120%,rgba(255,110,199,0.06),transparent_60%)] p-[clamp(14px,3vw,40px)] font-mono text-[13.5px] leading-[1.62] text-fg antialiased selection:bg-accent selection:text-void">
      <div className="flex h-[min(720px,92vh)] w-full max-w-[1080px] flex-col overflow-hidden rounded-[14px] border border-line bg-term shadow-[0_40px_120px_-30px_rgba(0,0,0,0.8),0_1px_0_rgba(255,255,255,0.05)_inset]">
        <TitleBar rootPath={rootPath} />
        <RootLine
          rootName={rootName}
          focusPath={focusPath}
          showSizes={showSizes}
          showHidden={showHidden}
          onFocusDirectory={focusDirectory}
          onToggleSizes={() => setShowSizes((previousShowSizes) => !previousShowSizes)}
          onToggleHidden={() => setShowHidden((previousShowHidden) => !previousShowHidden)}
        />
        <TreeView
          rootName={focusLabel}
          focusEntryCount={focusEntryCount}
          rows={rows}
          showSizes={showSizes}
          selectedPath={selectedPath}
          listingError={listingError}
          onSelect={setSelectedPath}
          onToggleDirectory={toggleDirectory}
          onFocusDirectory={focusDirectory}
        />
        <CommandBar
          focusLabel={focusLabel}
          pattern={pattern}
          isFiltering={pattern !== ''}
          matchCount={matchCount}
          entryRowCount={entryRowCount}
          focusEntryCount={focusEntryCount}
          onPatternChange={setPattern}
        />
      </div>
    </div>
  )
}
