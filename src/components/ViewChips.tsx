type ToggleChipProps = {
  label: string
  isOn: boolean
  title?: string
  onToggle: () => void
}

function ToggleChip({ label, isOn, title, onToggle }: ToggleChipProps) {
  return (
    <button
      type="button"
      aria-pressed={isOn}
      title={title}
      // Chips sit on the selectable root line; a click must toggle the view,
      // not select or navigate the row underneath.
      onClick={(clickEvent) => {
        clickEvent.stopPropagation()
        onToggle()
      }}
      onDoubleClick={(doubleClickEvent) => doubleClickEvent.stopPropagation()}
      className={`cursor-pointer rounded-md border px-[9px] py-[3px] text-[11px] transition-colors ${
        isOn
          ? 'border-accent/45 bg-accent/15 text-accent'
          : 'border-line text-dim hover:border-accent hover:text-fg'
      }`}
    >
      {label}
    </button>
  )
}

type ViewChipsProps = {
  showSizes: boolean
  showHidden: boolean
  showGitignored: boolean
  showPreview: boolean
  onToggleSizes: () => void
  onToggleHidden: () => void
  onToggleGitignored: () => void
  onTogglePreview: () => void
}

// The view-mode chips that reconfigure the tree. They ride on the tree's root
// line, directly above the rows they change (ADR-0031). The preview chip sits
// last, at the edge the preview column opens from.
export function ViewChips({
  showSizes,
  showHidden,
  showGitignored,
  showPreview,
  onToggleSizes,
  onToggleHidden,
  onToggleGitignored,
  onTogglePreview,
}: ViewChipsProps) {
  return (
    <div className="flex flex-none items-center gap-2">
      <ToggleChip label="sizes" isOn={showSizes} onToggle={onToggleSizes} />
      <ToggleChip label="hidden" isOn={showHidden} onToggle={onToggleHidden} />
      <ToggleChip label="gitignored" isOn={showGitignored} onToggle={onToggleGitignored} />
      <ToggleChip
        label="preview"
        isOn={showPreview}
        title="Preview panel — ctrl/cmd-→ opens it and then focuses it; ctrl/cmd-← focuses the tree and then closes it"
        onToggle={onTogglePreview}
      />
    </div>
  )
}
