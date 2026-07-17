import { ROOT_LINE_PATH, type EntryRow, type TreeRowModel } from '../lib/tree'
import { formatBytes, LARGE_FILE_THRESHOLD_BYTES } from '../lib/format'
import { ViewChips } from './ViewChips'

function entryNameColorClass(row: EntryRow): string {
  // Gitignored entries render dimmed wherever they are shown.
  const ignoredClass = row.entry.isGitignored ? ' opacity-55' : ''
  if (row.entry.kind === 'directory') return `font-semibold text-dir${ignoredClass}`
  if (row.entry.kind === 'other') return `text-dim italic${ignoredClass}`
  return (row.entry.isExecutable ? 'text-exec' : 'text-file') + ignoredClass
}

type EntryRowViewProps = {
  row: EntryRow
  isSelected: boolean
  showSizes: boolean
  onSelect: (path: string) => void
  onToggleDirectory: (path: string) => void
  onFocusDirectory: (path: string) => void
}

function EntryRowView({
  row,
  isSelected,
  showSizes,
  onSelect,
  onToggleDirectory,
  onFocusDirectory,
}: EntryRowViewProps) {
  const isDirectory = row.entry.kind === 'directory'
  const showChildCount = isDirectory && !row.isOpen && (row.entry.childCount ?? 0) > 0
  const isLargeFile =
    row.entry.sizeBytes !== null && row.entry.sizeBytes > LARGE_FILE_THRESHOLD_BYTES

  return (
    <div
      data-row-path={row.path}
      onClick={() => {
        onSelect(row.path)
        if (isDirectory) onToggleDirectory(row.path)
      }}
      onDoubleClick={() => {
        if (isDirectory) onFocusDirectory(row.path)
      }}
      className={`relative grid cursor-pointer grid-cols-[1fr_104px_66px] items-center px-4 py-[2.5px] whitespace-pre transition-colors ${
        isSelected ? 'bg-sel' : 'hover:bg-hover'
      }`}
    >
      {isSelected && <span className="absolute inset-y-0 left-0 w-[3px] bg-sel-bar" />}
      <span className="overflow-hidden text-ellipsis">
        <span className="text-faint">{row.connectorPrefix}</span>
        <span className={entryNameColorClass(row)}>
          {row.nameSegments.map((segment, segmentIndex) =>
            segment.matched ? (
              <span key={segmentIndex} className="rounded-[2px] bg-match-bg text-match">
                {segment.text}
              </span>
            ) : (
              <span key={segmentIndex}>{segment.text}</span>
            ),
          )}
        </span>
        {isDirectory && <span className="font-normal text-faint">/</span>}
        {showChildCount && (
          <span className="text-[11px] text-faint"> {row.entry.childCount}</span>
        )}
      </span>
      {showSizes && row.barFraction !== null ? (
        <span className="mr-3 h-2 justify-self-stretch overflow-hidden rounded-[3px] bg-inset">
          <span
            className="block h-full rounded-[3px] bg-linear-to-r from-bar-b to-bar-a"
            style={{ width: `${row.barFraction * 100}%` }}
          />
        </span>
      ) : (
        <span />
      )}
      <span
        className={`text-right text-xs tabular-nums ${isLargeFile ? 'text-bar-a' : 'text-dim'}`}
      >
        {formatBytes(row.entry.sizeBytes)}
      </span>
    </div>
  )
}

type TreeViewProps = {
  rootFullPath: string
  isRootLineSelected: boolean
  focusEntryCount: number | null
  rows: TreeRowModel[]
  showSizes: boolean
  showHidden: boolean
  showGitignored: boolean
  selectedPath: string | null
  listingError: string | null
  onSelect: (path: string) => void
  onFocusParent: () => void
  onToggleDirectory: (path: string) => void
  onFocusDirectory: (path: string) => void
  onToggleSizes: () => void
  onToggleHidden: () => void
  onToggleGitignored: () => void
}

export function TreeView({
  rootFullPath,
  isRootLineSelected,
  focusEntryCount,
  rows,
  showSizes,
  showHidden,
  showGitignored,
  selectedPath,
  listingError,
  onSelect,
  onFocusParent,
  onToggleDirectory,
  onFocusDirectory,
  onToggleSizes,
  onToggleHidden,
  onToggleGitignored,
}: TreeViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* View-mode chips ride a slim strip on the tree panel's header, above
          the rows they reconfigure (ADR-0031) — off the tree lines themselves,
          so the root line reads as an ordinary line. */}
      <div className="flex flex-none items-center justify-end px-4 py-1.5">
        <ViewChips
          showSizes={showSizes}
          showHidden={showHidden}
          showGitignored={showGitignored}
          onToggleSizes={onToggleSizes}
          onToggleHidden={onToggleHidden}
          onToggleGitignored={onToggleGitignored}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2.5">
        {/* The tree's first line is the current directory itself — a normal
            tree row, selected by default. Enter (or double-click) on it walks
            up one level, broot-style. */}
        <div
          data-row-path={ROOT_LINE_PATH}
          onClick={() => onSelect(ROOT_LINE_PATH)}
          onDoubleClick={onFocusParent}
          className={`relative grid cursor-pointer grid-cols-[1fr_104px_66px] items-center px-4 py-[2.5px] whitespace-pre transition-colors ${
            isRootLineSelected ? 'bg-sel' : 'hover:bg-hover'
          }`}
        >
          {isRootLineSelected && <span className="absolute inset-y-0 left-0 w-[3px] bg-sel-bar" />}
          <span className="overflow-hidden font-semibold text-ellipsis text-dir">
            {rootFullPath}
          </span>
          <span />
          <span />
        </div>
        {listingError !== null && (
          <div className="px-4 py-2 text-xs text-bar-a">{listingError}</div>
        )}
        {listingError === null && focusEntryCount === 0 && (
          <div className="px-4 py-2 text-xs text-faint">empty directory</div>
        )}
        {rows.map((row) =>
          row.type === 'entry' ? (
            <EntryRowView
              key={row.path}
              row={row}
              isSelected={row.path === selectedPath}
              showSizes={showSizes}
              onSelect={onSelect}
              onToggleDirectory={onToggleDirectory}
              onFocusDirectory={onFocusDirectory}
            />
          ) : (
            <div
              key={row.path}
              className="px-4 py-px text-[11.5px] whitespace-pre text-faint"
            >
              {row.connectorPrefix}…{' '}
              {[
                row.hiddenCount > 0
                  ? `${row.hiddenCount} hidden ( .dotfile${row.hiddenCount !== 1 ? 's' : ''} )`
                  : null,
                row.ignoredCount > 0
                  ? `${row.ignoredCount} gitignored`
                  : null,
              ]
                .filter((labelPart) => labelPart !== null)
                .join(' · ')}
            </div>
          ),
        )}
      </div>
    </div>
  )
}
