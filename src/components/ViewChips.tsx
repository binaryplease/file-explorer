import { ToggleChip } from './ToggleChip'

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
// line, directly above the rows they change (`affordances-adjacent`). The
// preview chip sits last, at the edge the preview column opens from.
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
