import { IconLock } from '@tabler/icons-react'
import { ROOT_LINE_PATH, type EntryRow, type TreeRowModel } from '../lib/tree'
import { formatBytes, LARGE_FILE_THRESHOLD_BYTES } from '../lib/format'
import {
  CONFINEMENT_BADGE_LABEL,
  CONFINEMENT_SHORT_REASON,
  confinementRefusalMessage,
  isConfinementBlocked,
} from '../lib/confinement'
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
  wasRefused: boolean
  showSizes: boolean
  onSelect: (path: string) => void
  onToggleDirectory: (path: string) => void
  onFocusDirectory: (path: string) => void
  onOpenFile: (path: string) => void
}

function EntryRowView({
  row,
  isSelected,
  wasRefused,
  showSizes,
  onSelect,
  onToggleDirectory,
  onFocusDirectory,
  onOpenFile,
}: EntryRowViewProps) {
  const isDirectory = row.entry.kind === 'directory'
  const showChildCount = isDirectory && !row.isOpen && (row.entry.childCount ?? 0) > 0
  const isLargeFile =
    row.entry.sizeBytes !== null && row.entry.sizeBytes > LARGE_FILE_THRESHOLD_BYTES
  // A symlink out of the served root. The row stays selectable — selecting it is
  // how the user reads the explanation — but it never navigates or opens.
  const isBlocked = isConfinementBlocked(row.entry)
  const blockedExplanation = isBlocked ? confinementRefusalMessage(row.entry.name) : undefined
  // The reason appears as soon as the row is *selected*, not when an action is
  // refused (ADR-0031: it belongs beside the row it describes, and the panel's
  // error strip is scoped to the whole listing). Showing it on selection also
  // means acting on the row never moves the rows underneath the cursor — the
  // explanation is already on screen before the keypress.
  const showReasonLine = isBlocked && isSelected
  const reasonLineId = `blocked-reason-${encodeURIComponent(row.path)}`

  return (
    <>
    <div
      data-row-path={row.path}
      title={blockedExplanation}
      aria-disabled={isBlocked}
      // The explanation is a real element rather than a tooltip, so it reaches
      // keyboard and screen-reader users too.
      aria-describedby={showReasonLine ? reasonLineId : undefined}
      onClick={() => {
        onSelect(row.path)
        if (isDirectory && !isBlocked) onToggleDirectory(row.path)
      }}
      onDoubleClick={() => {
        // Still routed to the handlers when blocked: they own the refusal, so
        // acting on the row explains itself instead of silently doing nothing.
        if (isBlocked) onOpenFile(row.path)
        else if (isDirectory) onFocusDirectory(row.path)
        else if (row.entry.kind === 'file') onOpenFile(row.path)
      }}
      className={`relative grid cursor-pointer grid-cols-[1fr_104px_66px] items-center px-4 py-[2.5px] whitespace-pre transition-colors ${
        isSelected ? 'bg-sel' : 'hover:bg-hover'
      }`}
    >
      {isSelected && <span className="absolute inset-y-0 left-0 w-[3px] bg-sel-bar" />}
      <span className="overflow-hidden text-ellipsis">
        <span className="text-faint">{row.connectorPrefix}</span>
        {/* broot path-search display: the parent part of a matched subpath
            rides ahead of the name, dimmed, matches still highlighted. */}
        {row.pathPrefixSegments.length > 0 && (
          <span className="text-dim">
            {row.pathPrefixSegments.map((segment, segmentIndex) =>
              segment.matched ? (
                <span key={segmentIndex} className="rounded-[2px] bg-match-bg text-match">
                  {segment.text}
                </span>
              ) : (
                <span key={segmentIndex}>{segment.text}</span>
              ),
            )}
          </span>
        )}
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
        {/* broot's " …": matches hide inside this directory, unlisted. */}
        {row.showUnlistedSuffix && <span className="text-faint"> …</span>}
        {showChildCount && (
          <span className="text-[11px] text-faint"> {row.entry.childCount}</span>
        )}
        {/* The refusal is stated on the row, not just in a tooltip: the size and
            child-count columns are blank for these entries, and a reader owed an
            explanation for the blanks should not have to hover to find one. */}
        {isBlocked && (
          <span className="ml-2 inline-flex items-center gap-1 rounded-[3px] bg-inset px-1.5 py-px align-middle text-[10.5px] text-dim">
            <IconLock size={11} stroke={1.8} aria-hidden />
            {CONFINEMENT_BADGE_LABEL}
          </span>
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
    {showReasonLine && (
      // Indented to sit under the entry's name, in the same idiom as the tree's
      // other annotation lines ("N unlisted", "… hidden"). Calm while merely
      // selected; it takes the alert token only once an action was actually
      // refused, so the keypress gets an answer instead of silence.
      <div
        id={reasonLineId}
        // Indented by the connector width so it hangs under the entry's name,
        // wrapped lines included.
        style={{ marginLeft: `${row.connectorPrefix.length}ch` }}
        className={`px-4 pb-1 text-[11.5px] leading-snug ${
          wasRefused ? 'text-bar-a' : 'text-dim'
        }`}
      >
        {CONFINEMENT_SHORT_REASON}
      </div>
    )}
    </>
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
  showPreview: boolean
  selectedPath: string | null
  // The row whose action was last refused, so its reason line can acknowledge
  // the attempt. Row-scoped, unlike `listingError`, which is about the listing.
  refusedPath: string | null
  listingError: string | null
  onSelect: (path: string) => void
  onFocusParent: () => void
  onToggleDirectory: (path: string) => void
  onFocusDirectory: (path: string) => void
  onOpenFile: (path: string) => void
  onToggleSizes: () => void
  onToggleHidden: () => void
  onToggleGitignored: () => void
  onTogglePreview: () => void
}

export function TreeView({
  rootFullPath,
  isRootLineSelected,
  focusEntryCount,
  rows,
  showSizes,
  showHidden,
  showGitignored,
  showPreview,
  selectedPath,
  refusedPath,
  listingError,
  onSelect,
  onFocusParent,
  onToggleDirectory,
  onFocusDirectory,
  onOpenFile,
  onToggleSizes,
  onToggleHidden,
  onToggleGitignored,
  onTogglePreview,
}: TreeViewProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* View-mode chips ride a slim strip on the tree panel's header, above
          the rows they reconfigure (ADR-0031) — off the tree lines themselves,
          so the root line reads as an ordinary line. */}
      <div className="flex flex-none items-center justify-end px-4 py-1.5">
        <ViewChips
          showSizes={showSizes}
          showHidden={showHidden}
          showGitignored={showGitignored}
          showPreview={showPreview}
          onToggleSizes={onToggleSizes}
          onToggleHidden={onToggleHidden}
          onToggleGitignored={onToggleGitignored}
          onTogglePreview={onTogglePreview}
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
              wasRefused={row.path === refusedPath}
              showSizes={showSizes}
              onSelect={onSelect}
              onToggleDirectory={onToggleDirectory}
              onFocusDirectory={onFocusDirectory}
              onOpenFile={onOpenFile}
            />
          ) : row.type === 'search-unlisted' ? (
            // broot's pruning line: matches trimmed from this directory's view.
            <div
              key={row.path}
              className="px-4 py-px text-[11.5px] whitespace-pre text-faint"
            >
              {row.connectorPrefix}
              {row.unlistedCount} unlisted
            </div>
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
