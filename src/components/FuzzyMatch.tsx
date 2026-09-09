import type { FuzzySegment } from '../../shared/fuzzy'

// The one owner of the fuzzy-match highlight styling (`interaction-token`):
// every surface that shows *why* a fuzzy pattern matched — the tree rows and
// the preview's in-document search — composes this token instead of
// re-declaring the classes inline, so the highlight can never drift between
// them. `<mark>` carries the right semantics for a search hit; the classes
// fully override its default user-agent colours.
export const MATCH_HIGHLIGHT_CLASS = 'rounded-[2px] bg-match-bg text-match'

// Renders pre-split fuzzy segments, marking the matched runs with the shared
// token (`highlight-what-matched`: the matched characters are shown, not just a
// yes/no result).
export function HighlightedSegments({ segments }: { segments: FuzzySegment[] }) {
  return (
    <>
      {segments.map((segment, segmentIndex) =>
        segment.matched ? (
          <mark key={segmentIndex} className={MATCH_HIGHLIGHT_CLASS}>
            {segment.text}
          </mark>
        ) : (
          <span key={segmentIndex}>{segment.text}</span>
        ),
      )}
    </>
  )
}
