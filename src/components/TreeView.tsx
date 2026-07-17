import { IconChevronDown } from '@tabler/icons-react'
import type { EntryRow, TreeRowModel } from '../lib/tree'
import { formatBytes, LARGE_FILE_THRESHOLD_BYTES } from '../lib/format'

function entryNameColorClass(row: EntryRow): string {
  if (row.entry.kind === 'directory') return 'font-semibold text-dir'
  if (row.entry.kind === 'other') return 'text-dim italic'
  return row.entry.isExecutable ? 'text-exec' : 'text-file'
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
        isSelected ? 'bg-sel' : 'hover:bg-white/3'
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
        <span className="mr-3 h-2 justify-self-stretch overflow-hidden rounded-[3px] bg-white/5">
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
  rootName: string
  focusEntryCount: number | null
  rows: TreeRowModel[]
  showSizes: boolean
  selectedPath: string | null
  listingError: string | null
  onSelect: (path: string) => void
  onToggleDirectory: (path: string) => void
  onFocusDirectory: (path: string) => void
}

export function TreeView({
  rootName,
  focusEntryCount,
  rows,
  showSizes,
  selectedPath,
  listingError,
  onSelect,
  onToggleDirectory,
  onFocusDirectory,
}: TreeViewProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pt-1 pb-2.5">
      <div className="grid grid-cols-[1fr_104px_66px] items-center px-4 py-[3px]">
        <span className="font-bold text-dir">
          <IconChevronDown className="mr-1 inline size-3.5 align-[-2px] text-dim" stroke={2.5} />
          {rootName}
        </span>
        <span />
        <span className="text-right text-xs font-normal text-dim">
          {focusEntryCount === null ? '…' : focusEntryCount}
        </span>
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
            {row.connectorPrefix}… {row.hiddenCount} hidden ( .dotfile
            {row.hiddenCount !== 1 ? 's' : ''} )
          </div>
        ),
      )}
    </div>
  )
}
