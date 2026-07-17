type ToggleChipProps = {
  label: string
  isOn: boolean
  onToggle: () => void
}

function ToggleChip({ label, isOn, onToggle }: ToggleChipProps) {
  return (
    <button
      type="button"
      aria-pressed={isOn}
      onClick={onToggle}
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

type RootLineProps = {
  rootName: string
  focusPath: string
  showSizes: boolean
  showHidden: boolean
  showGitignored: boolean
  onFocusDirectory: (path: string) => void
  onToggleSizes: () => void
  onToggleHidden: () => void
  onToggleGitignored: () => void
}

// Breadcrumb of the focused directory plus the view-mode chips. The chips sit
// here, directly above the tree they reconfigure (ADR-0031).
export function RootLine({
  rootName,
  focusPath,
  showSizes,
  showHidden,
  showGitignored,
  onFocusDirectory,
  onToggleSizes,
  onToggleHidden,
  onToggleGitignored,
}: RootLineProps) {
  const focusSegments = focusPath === '' ? [] : focusPath.split('/')

  return (
    <div className="flex flex-none flex-wrap items-center gap-2.5 px-[18px] pt-2.5 pb-2">
      <span className="truncate text-dim">
        <button
          type="button"
          onClick={() => onFocusDirectory('')}
          className="cursor-pointer font-semibold text-dir hover:underline"
        >
          {rootName}
        </button>
        {focusSegments.map((segmentName, segmentIndex) => (
          <span key={focusSegments.slice(0, segmentIndex + 1).join('/')}>
            <span className="mx-0.5 text-faint">/</span>
            <button
              type="button"
              onClick={() => onFocusDirectory(focusSegments.slice(0, segmentIndex + 1).join('/'))}
              className="cursor-pointer hover:text-fg hover:underline"
            >
              {segmentName}
            </button>
          </span>
        ))}
      </span>
      <span className="flex-1" />
      <ToggleChip label="sizes" isOn={showSizes} onToggle={onToggleSizes} />
      <ToggleChip label="hidden" isOn={showHidden} onToggle={onToggleHidden} />
      <ToggleChip label="gitignored" isOn={showGitignored} onToggle={onToggleGitignored} />
    </div>
  )
}
