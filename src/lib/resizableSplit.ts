import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'

// The draggable tree/preview split. Extracted here
// (`code-lives-with-dependencies`) because its dependencies are its own — a
// measured container width, the persisted ratio, and the min-width geometry —
// none of which App otherwise carries. The pure width resolver is exported so
// the geometry is unit-testable without a DOM.

// Neither pane may be squeezed below these: the tree stops being a usable list
// and the preview stops showing readable content past them.
export const MINIMUM_TREE_WIDTH_PIXELS = 280
export const MINIMUM_PREVIEW_WIDTH_PIXELS = 320

// Entry-intent defaults, applied only while the user has not dragged the
// divider (a null ratio). Opening on a file makes the file the point, so the
// tree shrinks to a fixed sidebar and the preview takes the rest; opening on a
// directory keeps the historical tree-dominant proportion.
const FILE_INTENT_TREE_WIDTH_PIXELS = 320
const DIRECTORY_INTENT_PREVIEW_RATIO = 0.42

// Clamp a desired preview width to the geometry both panes can live with. When
// the container is too narrow to honour both minimums the preview minimum wins
// and the tree takes the squeeze — a graceful degrade rather than a negative
// width.
function clampPreviewWidth(containerWidth: number, desiredPreviewWidth: number): number {
  const maximumPreviewWidth = Math.max(
    MINIMUM_PREVIEW_WIDTH_PIXELS,
    containerWidth - MINIMUM_TREE_WIDTH_PIXELS,
  )
  return Math.round(
    Math.min(Math.max(desiredPreviewWidth, MINIMUM_PREVIEW_WIDTH_PIXELS), maximumPreviewWidth),
  )
}

// The preview column's pixel width for a given container width, persisted ratio,
// and entry intent. A non-null ratio (the user's dragged preference) always
// wins; a null ratio falls back to the intent default.
export function resolvePreviewWidth(
  containerWidth: number,
  previewRatio: number | null,
  isFileIntent: boolean,
): number {
  // Before the first measurement there is no container to size against; seed
  // with the minimum so the very first paint is never wider than it should be.
  if (containerWidth <= 0) return MINIMUM_PREVIEW_WIDTH_PIXELS
  const desiredPreviewWidth =
    previewRatio !== null
      ? containerWidth * previewRatio
      : isFileIntent
        ? containerWidth - FILE_INTENT_TREE_WIDTH_PIXELS
        : containerWidth * DIRECTORY_INTENT_PREVIEW_RATIO
  return clampPreviewWidth(containerWidth, desiredPreviewWidth)
}

type ResizableSplitOptions = {
  previewRatio: number | null
  isFileIntent: boolean
  onPreviewRatioChange: (nextPreviewRatio: number) => void
}

type ResizableSplit = {
  containerRef: RefObject<HTMLDivElement | null>
  previewWidth: number
  onDividerPointerDown: (pointerDownEvent: PointerEvent) => void
}

// Owns the split's live state: the measured container width (kept current by a
// ResizeObserver so the embedded mount reflows with its host) and a transient
// drag ratio that only commits to the persisted ratio on pointer-up, so a drag
// costs one localStorage write, not one per frame.
export function useResizableSplit({
  previewRatio,
  isFileIntent,
  onPreviewRatioChange,
}: ResizableSplitOptions): ResizableSplit {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [dragRatio, setDragRatio] = useState<number | null>(null)

  // Measure before paint so the first frame already has the real width, and
  // keep it current as the container (or its host) reflows.
  useLayoutEffect(() => {
    const containerElement = containerRef.current
    if (containerElement === null) return
    setContainerWidth(containerElement.clientWidth)
    const resizeObserver = new ResizeObserver((observerEntries) => {
      for (const observerEntry of observerEntries) {
        setContainerWidth(observerEntry.contentRect.width)
      }
    })
    resizeObserver.observe(containerElement)
    return () => resizeObserver.disconnect()
  }, [])

  const effectiveRatio = dragRatio ?? previewRatio
  const previewWidth = resolvePreviewWidth(containerWidth, effectiveRatio, isFileIntent)

  const onDividerPointerDown = useCallback(
    (pointerDownEvent: PointerEvent) => {
      const containerElement = containerRef.current
      if (containerElement === null) return
      // A drag is a pointer gesture, not a text selection; suppress the browser's
      // default so it never highlights the panes while the divider moves.
      pointerDownEvent.preventDefault()
      const containerRect = containerElement.getBoundingClientRect()

      function handlePointerMove(pointerMoveEvent: globalThis.PointerEvent) {
        const desiredPreviewWidth =
          containerRect.width - (pointerMoveEvent.clientX - containerRect.left)
        const clampedPreviewWidth = clampPreviewWidth(containerRect.width, desiredPreviewWidth)
        setDragRatio(clampedPreviewWidth / containerRect.width)
      }

      function handlePointerUp() {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        setDragRatio((currentDragRatio) => {
          if (currentDragRatio !== null) onPreviewRatioChange(currentDragRatio)
          return null
        })
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
    },
    [onPreviewRatioChange],
  )

  return { containerRef, previewWidth, onDividerPointerDown }
}
