// The tree renders a window of its rows, not all of them. Every tree line has
// one height (`TREE_ROW_METRICS_CLASS` in TreeView.tsx makes that a contract),
// so which rows the viewport can show is arithmetic on the scroll offset — no
// row has to exist in the DOM to be located, scrolled to or measured. A
// 74 000-entry directory therefore costs the same to paint, and to move the
// focus through, as a 40-entry one: the rows outside the window are two spacer
// heights, and every one of them is still reachable by scrolling and by the
// keyboard, because the row list itself is never cut.
//
// Pure functions of numbers, so the windowing can be asserted without a
// browser (`composable-design`).

// Rows rendered beyond each edge of the viewport, so a wheel flick or a held
// arrow key never shows a blank strip before the next window lands.
export const OVERSCAN_ROW_COUNT = 12

// The window assumed before the scroll viewport has been measured (the first
// render, and any render without a layout, such as a server render): enough
// rows to fill a tall panel, and a bounded number however long the listing is.
export const UNMEASURED_VIEWPORT_ROW_COUNT = 48

export type RowWindow = {
  // Index of the first rendered row.
  firstRowIndex: number
  // One past the last rendered row.
  endRowIndex: number
}

export type RowWindowOptions = {
  rowCount: number
  // How far the rows have scrolled past the top of the viewport, in px. Already
  // relative to the first row: content above the rows is subtracted by the caller.
  rowsScrollTop: number
  viewportHeight: number
  rowHeight: number
  overscanRowCount: number
}

export function visibleRowWindow(options: RowWindowOptions): RowWindow {
  const { rowCount, rowsScrollTop, viewportHeight, rowHeight, overscanRowCount } = options
  if (rowCount === 0 || rowHeight <= 0) return { firstRowIndex: 0, endRowIndex: 0 }
  const firstVisibleIndex = Math.floor(Math.max(0, rowsScrollTop) / rowHeight)
  const visibleRowCount = Math.ceil(Math.max(0, viewportHeight) / rowHeight) + 1
  const firstRowIndex = Math.min(rowCount, Math.max(0, firstVisibleIndex - overscanRowCount))
  const endRowIndex = Math.min(rowCount, firstVisibleIndex + visibleRowCount + overscanRowCount)
  return { firstRowIndex, endRowIndex }
}

export type RevealRowOptions = {
  rowIndex: number
  rowHeight: number
  // Offset of the first row inside the scroll container (an error or "empty"
  // line can sit above the rows).
  rowsOffsetTop: number
  scrollTop: number
  viewportHeight: number
}

// The scroll offset that brings one row fully into view, moving as little as
// possible — `scrollIntoView({ block: 'nearest' })` for a row that may not be
// rendered yet. Null when the row is already fully visible.
export function scrollTopRevealingRow(options: RevealRowOptions): number | null {
  const { rowIndex, rowHeight, rowsOffsetTop, scrollTop, viewportHeight } = options
  const rowTop = rowsOffsetTop + rowIndex * rowHeight
  const rowBottom = rowTop + rowHeight
  if (rowTop < scrollTop) return rowTop
  if (rowBottom > scrollTop + viewportHeight) return Math.max(0, rowBottom - viewportHeight)
  return null
}
