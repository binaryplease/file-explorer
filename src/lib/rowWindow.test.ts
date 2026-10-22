import { describe, expect, test } from 'bun:test'
import { rowsOffsetWithinScroll, scrollTopRevealingRow, visibleRowWindow } from './rowWindow'

const rowHeight = 27
const viewportHeight = 270 // ten rows

describe('visibleRowWindow', () => {
  test('at the top, renders the visible rows plus the overscan below', () => {
    expect(
      visibleRowWindow({ rowCount: 40_000, rowsScrollTop: 0, viewportHeight, rowHeight, overscanRowCount: 5 }),
    ).toEqual({ firstRowIndex: 0, endRowIndex: 16 })
  })

  test('scrolled into the middle, overscans on both sides', () => {
    expect(
      visibleRowWindow({
        rowCount: 40_000,
        rowsScrollTop: 1000 * rowHeight,
        viewportHeight,
        rowHeight,
        overscanRowCount: 5,
      }),
    ).toEqual({ firstRowIndex: 995, endRowIndex: 1016 })
  })

  test('scrolled to the bottom, the last row is rendered — every row is reachable', () => {
    const rowCount = 40_000
    const bottomWindow = visibleRowWindow({
      rowCount,
      rowsScrollTop: rowCount * rowHeight - viewportHeight,
      viewportHeight,
      rowHeight,
      overscanRowCount: 5,
    })
    expect(bottomWindow.endRowIndex).toBe(rowCount)
    expect(bottomWindow.endRowIndex - bottomWindow.firstRowIndex).toBeLessThan(30)
  })

  test('the window size does not depend on the row count', () => {
    const windowSize = (rowCount: number) => {
      const { firstRowIndex, endRowIndex } = visibleRowWindow({
        rowCount,
        rowsScrollTop: 50 * rowHeight,
        viewportHeight,
        rowHeight,
        overscanRowCount: 5,
      })
      return endRowIndex - firstRowIndex
    }
    expect(windowSize(74_000)).toBe(windowSize(400))
  })

  test('content above the rows (scrolled past) never yields a negative index', () => {
    expect(
      visibleRowWindow({ rowCount: 3, rowsScrollTop: -40, viewportHeight, rowHeight, overscanRowCount: 5 }),
    ).toEqual({ firstRowIndex: 0, endRowIndex: 3 })
  })

  test('no rows, no window', () => {
    expect(
      visibleRowWindow({ rowCount: 0, rowsScrollTop: 0, viewportHeight, rowHeight, overscanRowCount: 5 }),
    ).toEqual({ firstRowIndex: 0, endRowIndex: 0 })
  })
})

describe('scrollTopRevealingRow — block: nearest, for a row that may not be rendered', () => {
  const placement = { rowHeight, rowsOffsetTop: 0, viewportHeight }

  test('a fully visible row needs no scroll', () => {
    expect(scrollTopRevealingRow({ ...placement, rowIndex: 3, scrollTop: 0 })).toBeNull()
  })

  test('a row below the viewport scrolls just far enough to show its bottom edge', () => {
    expect(scrollTopRevealingRow({ ...placement, rowIndex: 10, scrollTop: 0 })).toBe(
      11 * rowHeight - viewportHeight,
    )
  })

  test('a row above the viewport scrolls its top edge to the top', () => {
    expect(scrollTopRevealingRow({ ...placement, rowIndex: 5, scrollTop: 40 * rowHeight })).toBe(
      5 * rowHeight,
    )
  })

  test('the last of 40 000 rows, far outside any window, is reached', () => {
    expect(scrollTopRevealingRow({ ...placement, rowIndex: 39_999, scrollTop: 0 })).toBe(
      40_000 * rowHeight - viewportHeight,
    )
  })

  test('content above the rows shifts every row down by its height', () => {
    expect(
      scrollTopRevealingRow({ ...placement, rowsOffsetTop: 30, rowIndex: 0, scrollTop: 30 }),
    ).toBeNull()
    expect(
      scrollTopRevealingRow({ ...placement, rowsOffsetTop: 30, rowIndex: 0, scrollTop: 31 }),
    ).toBe(30)
  })
})

// The scroll container sits below 67px of panel chrome (the view chips and the
// root line), as it does in the app. A rows offset measured against anything
// but the scroll container's own content frame shifts every row by that much:
// moving the focus up past the top edge then scrolled the focused row to
// `top=-67`, out of view, for every row after it.
describe('rowsOffsetWithinScroll — the frame scrollTop is measured in', () => {
  const chromeAboveScroll = 67

  test('rows directly at the top of the content start at 0, however far scrolled', () => {
    for (const scrollTop of [0, 500, 27_000]) {
      expect(
        rowsOffsetWithinScroll({
          rowsTop: chromeAboveScroll - scrollTop,
          scrollContainerTop: chromeAboveScroll,
          scrollContainerBorderTop: 0,
          scrollTop,
        }),
      ).toBe(0)
    }
  })

  test('a line above the rows inside the scroll (an error) counts; chrome outside it does not', () => {
    expect(
      rowsOffsetWithinScroll({
        rowsTop: chromeAboveScroll + 30 - 500,
        scrollContainerTop: chromeAboveScroll,
        scrollContainerBorderTop: 0,
        scrollTop: 500,
      }),
    ).toBe(30)
  })

  test('moving up past the top edge brings the focused row to the top, not above it', () => {
    // Scrolled so row 40 is the first visible row; the focus moves up to row 39.
    const scrollTop = 40 * rowHeight
    const rowsOffsetTop = rowsOffsetWithinScroll({
      rowsTop: chromeAboveScroll - scrollTop,
      scrollContainerTop: chromeAboveScroll,
      scrollContainerBorderTop: 0,
      scrollTop,
    })
    const revealingScrollTop = scrollTopRevealingRow({
      rowIndex: 39,
      rowHeight,
      rowsOffsetTop,
      scrollTop,
      viewportHeight,
    })
    expect(revealingScrollTop).toBe(39 * rowHeight)
    // The row's top in the viewport after the scroll: exactly the top edge.
    expect(rowsOffsetTop + 39 * rowHeight - revealingScrollTop!).toBe(0)
  })
})
