import { describe, expect, it } from 'bun:test'
import {
  MINIMUM_PREVIEW_WIDTH_PIXELS,
  MINIMUM_TREE_WIDTH_PIXELS,
  resolvePreviewWidth,
} from './resizableSplit'

// The split geometry is the one piece worth pinning: intent picks the initial
// proportion, a dragged ratio overrides it, and neither pane may be squeezed
// past its minimum. The drag wiring itself is DOM plumbing, exercised in-app.
describe('resolvePreviewWidth', () => {
  const CONTAINER_WIDTH = 1000

  it('opens directory intent tree-dominant (~42% preview)', () => {
    expect(resolvePreviewWidth(CONTAINER_WIDTH, null, false)).toBe(420)
  })

  it('opens file intent preview-dominant, leaving the tree a fixed sidebar', () => {
    // 1000 − 320px tree sidebar → the preview takes the rest.
    expect(resolvePreviewWidth(CONTAINER_WIDTH, null, true)).toBe(680)
  })

  it('lets a dragged ratio override the entry intent', () => {
    expect(resolvePreviewWidth(CONTAINER_WIDTH, 0.6, true)).toBe(600)
    expect(resolvePreviewWidth(CONTAINER_WIDTH, 0.6, false)).toBe(600)
  })

  it('never squeezes the tree below its minimum', () => {
    const previewWidth = resolvePreviewWidth(CONTAINER_WIDTH, 0.95, false)
    expect(previewWidth).toBe(CONTAINER_WIDTH - MINIMUM_TREE_WIDTH_PIXELS)
  })

  it('never squeezes the preview below its minimum', () => {
    const previewWidth = resolvePreviewWidth(CONTAINER_WIDTH, 0.05, false)
    expect(previewWidth).toBe(MINIMUM_PREVIEW_WIDTH_PIXELS)
  })

  it('degrades to the preview minimum before the container is measured', () => {
    expect(resolvePreviewWidth(0, null, false)).toBe(MINIMUM_PREVIEW_WIDTH_PIXELS)
  })
})
