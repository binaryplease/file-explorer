import { IconChevronRight } from '@tabler/icons-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

// `esc`'s action is derived per render (`back` while Escape still has something
// to pop, `close` once it would hand off to the host's close verb), so the hint
// never lies about what the next Escape does. Enter says `open in app`, not a
// bare `open`, because it hands the file to the OS default application — a
// surprise inside an embedding host mid-preview otherwise.
function buildKeyHints(escapeHintAction: string): Array<{ keyLabel: string; action: string }> {
  return [
    { keyLabel: '↑↓', action: 'move' },
    { keyLabel: '↵', action: 'open in app' },
    { keyLabel: 'esc', action: escapeHintAction },
    { keyLabel: 'tab', action: 'next match' },
    { keyLabel: '^d ^u', action: 'page' },
    { keyLabel: '^← ^→', action: 'preview' },
  ]
}

// A monospace sample whose width, divided by its length, is one glyph's advance.
const CARET_MEASURE_SAMPLE = '0000000000'

type CommandBarProps = {
  // The search field's element, so the app can keep it always-active — any key
  // typed anywhere is redirected here (broot-style).
  inputRef: RefObject<HTMLInputElement | null>
  focusLabel: string
  pattern: string
  isFiltering: boolean
  matchCount: number
  // True when the search walk stopped early (time budget / overscan cap), so
  // `matchCount` is a lower bound.
  matchCountIsLowerBound: boolean
  entryRowCount: number
  focusEntryCount: number | null
  // The word shown beside `esc`: `back` while Escape still pops app state,
  // `close` once the next Escape would ask the embedding host to close.
  escapeHintAction: string
  onPatternChange: (nextPattern: string) => void
}

export function CommandBar({
  inputRef,
  focusLabel,
  pattern,
  isFiltering,
  matchCount,
  matchCountIsLowerBound,
  entryRowCount,
  focusEntryCount,
  escapeHintAction,
  onPatternChange,
}: CommandBarProps) {
  const measureRef = useRef<HTMLSpanElement | null>(null)
  const [glyphWidth, setGlyphWidth] = useState(0)
  const [caretIndex, setCaretIndex] = useState(0)
  const [horizontalScroll, setHorizontalScroll] = useState(0)

  // Monospace: every glyph advances by the same width, so the caret sits exactly
  // at caretIndex × glyphWidth. Measure that advance before first paint, and
  // again once web fonts load (the fallback metrics differ).
  useLayoutEffect(() => {
    function measureGlyphWidth() {
      const measureElement = measureRef.current
      if (measureElement === null) return
      setGlyphWidth(measureElement.getBoundingClientRect().width / CARET_MEASURE_SAMPLE.length)
    }
    measureGlyphWidth()
    void document.fonts?.ready.then(measureGlyphWidth)
  }, [])

  // Keep the custom caret glued to the real text cursor: its character index and
  // the input's horizontal scroll both shift it.
  const syncCaretFromInput = useCallback(() => {
    const inputElement = inputRef.current
    if (inputElement === null) return
    setCaretIndex(inputElement.selectionStart ?? inputElement.value.length)
    setHorizontalScroll(inputElement.scrollLeft)
  }, [inputRef])

  // selectionchange covers arrow-key and click cursor moves; the effect on
  // `pattern` covers programmatic edits (the type-anywhere redirect appends to
  // the value without firing the input's own events).
  useEffect(() => {
    document.addEventListener('selectionchange', syncCaretFromInput)
    return () => document.removeEventListener('selectionchange', syncCaretFromInput)
  }, [syncCaretFromInput])
  useEffect(() => {
    syncCaretFromInput()
  }, [pattern, syncCaretFromInput])

  const caretLeft = Math.max(0, caretIndex * glyphWidth - horizontalScroll)

  return (
    <div className="flex-none border-t border-line bg-chrome">
      <div className="flex items-center gap-2.5 px-[18px] py-[11px]">
        <span className="flex-none font-semibold text-dir">{focusLabel}</span>
        <IconChevronRight className="size-4 flex-none text-prompt" stroke={3} />
        <div className="relative flex min-w-0 flex-1 items-center">
          {/* Hidden monospace sample, measured only to derive one glyph's advance. */}
          <span
            ref={measureRef}
            aria-hidden="true"
            className="pointer-events-none invisible absolute font-mono text-[13.5px]"
          >
            {CARET_MEASURE_SAMPLE}
          </span>
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={pattern}
            onChange={(changeEvent) => onPatternChange(changeEvent.target.value)}
            onInput={syncCaretFromInput}
            onClick={syncCaretFromInput}
            onKeyUp={syncCaretFromInput}
            onScroll={syncCaretFromInput}
            placeholder="type to fuzzy-search this subtree…"
            autoComplete="off"
            spellCheck={false}
            aria-label="Fuzzy-search this subtree"
            className="w-full bg-transparent font-mono text-[13.5px] text-fg caret-transparent outline-none placeholder:text-faint"
          />
          {/* Always-on, always-blinking caret (width = --caret-width, default
              2px), drawn by us so it blinks regardless of focus and its width is
              a design token — neither of which the native caret allows. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 h-[1.05em] -translate-y-1/2 animate-caret-blink bg-prompt"
            style={{ left: caretLeft, width: 'var(--caret-width)' }}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 border-t border-line-2 px-[18px] py-[7px] text-[11px] text-dim">
        <span>
          {isFiltering ? (
            <>
              <span className="text-match">
                {matchCount}
                {matchCountIsLowerBound ? '+' : ''}
              </span>{' '}
              match{matchCount !== 1 || matchCountIsLowerBound ? 'es' : ''} ·{' '}
              <b className="font-semibold text-fg">{entryRowCount}</b> shown
            </>
          ) : (
            <>
              <b className="font-semibold text-fg">{focusEntryCount ?? '…'}</b> entries ·{' '}
              <b className="font-semibold text-fg">{entryRowCount}</b> visible
            </>
          )}
        </span>
        <span className="flex-1" />
        <div className="hidden flex-wrap gap-3.5 sm:flex">
          {buildKeyHints(escapeHintAction).map((keyHint) => (
            <span key={keyHint.action}>
              <b className="mr-1 rounded-sm border border-line bg-inset px-[5px] font-semibold text-dim">
                {keyHint.keyLabel}
              </b>
              {keyHint.action}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
