import { describe, expect, test } from 'bun:test'
import { renderToString } from 'react-dom/server'
import type { DirectoryEntry } from '../../shared/filesystem.schema'
import { buildTreeRows } from '../lib/tree'
import { OVERSCAN_ROW_COUNT, UNMEASURED_VIEWPORT_ROW_COUNT } from '../lib/rowWindow'
import { TreeView } from './TreeView'

// The shape of the stress fixture's `wide-mixed` case: 40 000 entries, most of
// them directories.
function wideListing(entryCount: number): DirectoryEntry[] {
  return Array.from({ length: entryCount }, (unused, entryIndex) => ({
    name: `entry-${String(entryIndex).padStart(5, '0')}`,
    kind: entryIndex % 14 === 0 ? ('file' as const) : ('directory' as const),
    sizeBytes: entryIndex % 14 === 0 ? 1024 : null,
    childCount: null,
    isExecutable: false,
    isHidden: false,
    isSymlink: false,
    escapesRoot: false,
    isGitignored: false,
  }))
}

function renderTree(selectedPath: string | null, entryCount: number): string {
  const { rows } = buildTreeRows({
    focusPath: '',
    listings: { '': wideListing(entryCount) },
    openPaths: new Set(),
    showHidden: false,
    showGitignored: false,
    showSizes: true,
  })
  const ignore = () => {}
  return renderToString(
    <TreeView
      rootFullPath="/tmp"
      rootPath="/"
      isRootLineSelected={selectedPath === null}
      focusEntryCount={entryCount}
      rows={rows}
      showSizes
      showHidden={false}
      showGitignored={false}
      showPreview={false}
      selectedPath={selectedPath}
      refusedPath={null}
      listingError={null}
      onSelect={ignore}
      onFocusParent={ignore}
      onFocusDirectory={ignore}
      onPreviewFile={ignore}
      onOpenFile={ignore}
      onToggleSizes={ignore}
      onToggleHidden={ignore}
      onToggleGitignored={ignore}
      onTogglePreview={ignore}
    />,
  )
}

function renderedRowPaths(html: string): string[] {
  return [...html.matchAll(/data-row-path="([^"]*)"/g)].map((match) => match[1]!)
}

// The hang this guards against: entering a 74 000-entry directory rendered one
// DOM row per entry, and every keypress re-rendered all of them. A paint must
// cost what the viewport shows, not what the directory holds.
describe('TreeView — a very large listing paints a window, not every row', () => {
  // The root line, plus the unmeasured window and its overscan on both sides.
  const windowRowBound = 1 + UNMEASURED_VIEWPORT_ROW_COUNT + 2 * OVERSCAN_ROW_COUNT + 2

  test('40 000 entries render a bounded number of rows', () => {
    const rowPaths = renderedRowPaths(renderTree(null, 40_000))
    expect(rowPaths.length).toBeGreaterThan(UNMEASURED_VIEWPORT_ROW_COUNT)
    expect(rowPaths.length).toBeLessThanOrEqual(windowRowBound)
    // The window starts at the top, in display order.
    expect(rowPaths[1]).toBe('entry-00000')
  })

  test('the rendered row count does not grow with the listing', () => {
    expect(renderedRowPaths(renderTree(null, 40_000)).length).toBe(
      renderedRowPaths(renderTree(null, 400)).length,
    )
  })

  test('the rows outside the window still take their height, so every row stays reachable', () => {
    const html = renderTree(null, 40_000)
    const spacerHeights = [...html.matchAll(/height:(\d+(?:\.\d+)?)px/g)].map((match) =>
      Number(match[1]),
    )
    const renderedEntryCount = renderedRowPaths(html).length - 1
    // One fallback-height spacer stands in for every row below the window.
    expect(Math.max(...spacerHeights)).toBe((40_000 - renderedEntryCount) * 27)
  })
})
