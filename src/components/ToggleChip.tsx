type ToggleChipProps = {
  label: string
  isOn: boolean
  title?: string
  // A tighter variant for dense headers (the preview panel's badge strip),
  // where the default chip padding would crowd the row. Only the padding and
  // type scale shift — the on/off interaction-state styling is the same shared
  // token either way (ADR-0028).
  compact?: boolean
  onToggle: () => void
}

// The shared on/off view-mode chip. One owner of the pressed/idle interaction
// styling (ADR-0028), composed by every surface that carries such a toggle —
// the tree's view chips and the preview header's `wrap` control — so the two
// can never drift apart.
export function ToggleChip({ label, isOn, title, compact = false, onToggle }: ToggleChipProps) {
  return (
    <button
      type="button"
      aria-pressed={isOn}
      title={title}
      // Chips can sit on a selectable row (the tree's root line); a click must
      // toggle the view, not select or navigate the row underneath.
      onClick={(clickEvent) => {
        clickEvent.stopPropagation()
        onToggle()
      }}
      onDoubleClick={(doubleClickEvent) => doubleClickEvent.stopPropagation()}
      className={`cursor-pointer rounded-md border transition-colors ${
        compact ? 'px-1.5 py-px text-[10.5px]' : 'px-[9px] py-[3px] text-[11px]'
      } ${
        isOn
          ? 'border-accent/45 bg-accent/15 text-accent'
          : 'border-line text-dim hover:border-accent hover:text-fg'
      }`}
    >
      {label}
    </button>
  )
}
