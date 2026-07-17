import { IconChevronRight } from '@tabler/icons-react'

const KEY_HINTS: Array<{ keyLabel: string; action: string }> = [
  { keyLabel: '↑↓ j k', action: 'move' },
  { keyLabel: '↵ →', action: 'open' },
  { keyLabel: '← esc', action: 'back' },
  { keyLabel: 'h ⌫', action: 'parent' },
  { keyLabel: 'tab', action: 'next match' },
  { keyLabel: '^d ^u', action: 'page' },
]

type CommandBarProps = {
  focusLabel: string
  pattern: string
  isFiltering: boolean
  matchCount: number
  // True when the search walk stopped early (time budget / overscan cap), so
  // `matchCount` is a lower bound.
  matchCountIsLowerBound: boolean
  entryRowCount: number
  focusEntryCount: number | null
  onPatternChange: (nextPattern: string) => void
}

export function CommandBar({
  focusLabel,
  pattern,
  isFiltering,
  matchCount,
  matchCountIsLowerBound,
  entryRowCount,
  focusEntryCount,
  onPatternChange,
}: CommandBarProps) {
  return (
    <div className="flex-none border-t border-line bg-chrome">
      <div className="flex items-center gap-2.5 px-[18px] py-[11px]">
        <span className="flex-none font-semibold text-dir">{focusLabel}</span>
        <IconChevronRight className="size-4 flex-none text-prompt" stroke={3} />
        <input
          autoFocus
          type="text"
          value={pattern}
          onChange={(changeEvent) => onPatternChange(changeEvent.target.value)}
          placeholder="type to fuzzy-search this subtree…"
          autoComplete="off"
          spellCheck={false}
          className="w-full flex-1 bg-transparent font-mono text-[13.5px] text-fg caret-prompt outline-none placeholder:text-faint"
        />
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
          {KEY_HINTS.map((keyHint) => (
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
