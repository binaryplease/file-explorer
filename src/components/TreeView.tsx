import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { IconClipboardCopy, IconCopy, IconLock } from '@tabler/icons-react'
import {
  absoluteTreePath,
  relativeTreePath,
  ROOT_LINE_PATH,
  type EntryRow,
  type TreeConnector,
  type TreeRowModel,
} from '../lib/tree'
import { copyTextToClipboard } from '../lib/clipboard'
import { ContextMenu, type ContextMenuAnchor } from './ContextMenu'
import { formatBytes, LARGE_FILE_THRESHOLD_BYTES } from '../lib/format'
import {
  CONFINEMENT_BADGE_LABEL,
  CONFINEMENT_SHORT_REASON,
  confinementRefusalMessage,
  isConfinementBlocked,
} from '../lib/confinement'
import { ViewChips } from './ViewChips'
import { HighlightedSegments } from './FuzzyMatch'

// Every line inside the tree scroll — entry rows and the annotation lines
// ("N unlisted", the hidden/gitignored tally) alike — occupies one cell of a
// single character grid, so it carries exactly these metrics: the same
// horizontal padding, the same inherited font size, the same vertical padding.
// `relative` is part of the contract too: the guide rails are drawn against the
// row box, so they need it as their containing block.
//
// This is not only cosmetic. `measureTreeRowCapacity` in App.tsx budgets the
// screen-fit fill by dividing the viewport height by *one entry row's* height,
// so a line that renders shorter than an entry row makes the plan come up short
// and the tree ends in a blank strip. Annotation lines recede by color
// (`text-faint`), never by size.
const TREE_ROW_METRICS_CLASS = 'relative px-4 py-[2.5px] whitespace-pre'

// One tree level is three character cells wide — broot's `"│  "` lead and its
// `"├──"` / `"└──"` corners (`display/displayable_tree.rs`), so the rails sit
// where a terminal would put them. The rail itself runs down the middle of the
// first cell.
const RAIL_CELLS_PER_LEVEL = 3
const RAIL_CENTRE_CH = 0.5

// How far a row's own text is indented, in `ch`: one cell group per ancestor
// level plus the group holding this row's corner.
function railIndentCh(connector: TreeConnector): number {
  return (connector.ancestorRailsContinue.length + 1) * RAIL_CELLS_PER_LEVEL
}

// The tree's guide rails, drawn as CSS rules rather than written as `│`/`├──`
// box-drawing characters.
//
// The characters cannot do this job here. A glyph is only as tall as the font
// draws it — roughly 16px at our 13.5px type — while a row is 26.9px, so a
// column of `│` renders as a dashed line with a hole at every row seam. A
// terminal has no such hole because its cell *is* the line box; in a browser
// the leading has to be spanned deliberately. These rules take the row's full
// height (`inset-y-0`, padding included), so a rail meets its neighbour exactly
// and the tree reads as one continuous set of rails.
//
// Rendered once here and composed by every row kind (ADR-0026/0028) — entries,
// the pruning line and the filter tally all draw the same rails from the same
// descriptor, so they can never drift apart.
function TreeRails({ connector }: { connector: TreeConnector }) {
  const ownLevel = connector.ancestorRailsContinue.length
  const ownRailLeftCh = ownLevel * RAIL_CELLS_PER_LEVEL + RAIL_CENTRE_CH
  return (
    // Decorative: the row's meaning is its name and its indent, both of which
    // reach assistive tech as text. The rails are `aria-hidden` so a screen
    // reader is not read a wall of box drawing.
    <span aria-hidden className="pointer-events-none absolute inset-y-0 left-4">
      {connector.ancestorRailsContinue.map((railContinues, level) =>
        railContinues ? (
          <span
            key={level}
            className="absolute inset-y-0 w-px bg-faint"
            style={{ left: `${level * RAIL_CELLS_PER_LEVEL + RAIL_CENTRE_CH}ch` }}
          />
        ) : null,
      )}
      {/* This row's own corner. A last child stops at the row's middle (`└`);
          any other carries the rail through to the next row (`├`). */}
      <span
        className={`absolute top-0 w-px bg-faint ${connector.isLastChild ? 'h-1/2' : 'bottom-0'}`}
        style={{ left: `${ownRailLeftCh}ch` }}
      />
      {/* The corner's arm, reaching from the rail to where the text begins. */}
      <span
        className="absolute top-1/2 h-px bg-faint"
        style={{
          left: `${ownRailLeftCh}ch`,
          width: `${RAIL_CELLS_PER_LEVEL - RAIL_CENTRE_CH}ch`,
        }}
      />
    </span>
  )
}

// The row grid is a single shared invariant: the root line and every entry row
// must keep their columns aligned. When the size bars are hidden, the 104px bar
// track is dropped entirely rather than reserved-and-emptied, so the filename
// reclaims that width instead of truncating early. Both class strings are
// spelled out as literals so Tailwind's JIT emits them.
function rowGridColumnsClass(showSizes: boolean): string {
  return showSizes ? 'grid-cols-[1fr_104px_66px]' : 'grid-cols-[1fr_66px]'
}

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
  onFocusDirectory: (path: string) => void
  onPreviewFile: (path: string) => void
  onOpenFile: (path: string) => void
  onContextMenu: (mouseEvent: ReactMouseEvent, row: EntryRow) => void
}

function EntryRowView({
  row,
  isSelected,
  wasRefused,
  showSizes,
  onSelect,
  onFocusDirectory,
  onPreviewFile,
  onOpenFile,
  onContextMenu,
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
        // A single click acts like Enter (broot open_stay) for directories — the
        // directory becomes the new root — but a file reveals itself in the
        // preview panel rather than launching; the OS open is the double-click.
        // Still routed to the handlers when blocked: they own the refusal, so
        // acting on the row explains itself instead of silently doing nothing.
        if (isBlocked) onOpenFile(row.path)
        else if (isDirectory) onFocusDirectory(row.path)
        else if (row.entry.kind === 'file') onPreviewFile(row.path)
      }}
      onContextMenu={(mouseEvent) => onContextMenu(mouseEvent, row)}
      onDoubleClick={() => {
        // A file's double-click hands it to the OS default app; the single
        // clicks that led here only opened the preview. Directories already
        // navigated on the first click, so there is nothing left to do for them.
        if (isBlocked) onOpenFile(row.path)
        else if (row.entry.kind === 'file') onOpenFile(row.path)
      }}
      className={`grid cursor-pointer ${rowGridColumnsClass(showSizes)} items-center ${TREE_ROW_METRICS_CLASS} transition-colors ${
        isSelected ? 'bg-sel' : 'hover:bg-hover'
      }`}
    >
      {isSelected && <span className="absolute inset-y-0 left-0 w-[3px] bg-sel-bar" />}
      <TreeRails connector={row.connector} />
      <span
        className="overflow-hidden text-ellipsis"
        style={{ paddingLeft: `${railIndentCh(row.connector)}ch` }}
      >
        {/* broot path-search display: the parent part of a matched subpath
            rides ahead of the name, dimmed, matches still highlighted. */}
        {row.pathPrefixSegments.length > 0 && (
          <span className="text-dim">
            <HighlightedSegments segments={row.pathPrefixSegments} />
          </span>
        )}
        <span className={entryNameColorClass(row)}>
          <HighlightedSegments segments={row.nameSegments} />
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
      {/* The bar track only exists in the grid when sizes are shown; otherwise
          the column is gone and the name reclaims its width. A shown-but-null
          bar still needs the empty spacer to hold the 104px column open. */}
      {showSizes &&
        (row.barFraction !== null ? (
          <span className="mr-3 h-2 justify-self-stretch overflow-hidden rounded-[3px] bg-inset">
            <span
              className="block h-full rounded-[3px] bg-linear-to-r from-bar-b to-bar-a"
              style={{ width: `${row.barFraction * 100}%` }}
            />
          </span>
        ) : (
          <span />
        ))}
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
        // wrapped lines included. The `ch` unit resolves against *this*
        // element's font size, so the indent is measured here, at the tree's
        // inherited size — the smaller reason text sits in a child, where its
        // narrower `ch` can no longer pull the line out of the tree's grid.
        style={{ marginLeft: `${railIndentCh(row.connector)}ch` }}
        className="px-4 pb-1"
      >
        <span
          className={`text-[11.5px] leading-snug ${wasRefused ? 'text-bar-a' : 'text-dim'}`}
        >
          {CONFINEMENT_SHORT_REASON}
        </span>
      </div>
    )}
    </>
  )
}

type TreeViewProps = {
  rootFullPath: string
  // The served root's absolute path (the display anchor), used to resolve a
  // row's absolute and served-root-relative path for the copy-path menu. Null
  // until the first listing lands — the menu stays inert until then.
  rootPath: string | null
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
  onFocusDirectory: (path: string) => void
  onPreviewFile: (path: string) => void
  onOpenFile: (path: string) => void
  onToggleSizes: () => void
  onToggleHidden: () => void
  onToggleGitignored: () => void
  onTogglePreview: () => void
}

export function TreeView({
  rootFullPath,
  rootPath,
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
  onFocusDirectory,
  onPreviewFile,
  onOpenFile,
  onToggleSizes,
  onToggleHidden,
  onToggleGitignored,
  onTogglePreview,
}: TreeViewProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuAnchor | null>(null)
  // A short-lived confirmation that a copy landed (or didn't), so the action —
  // which otherwise produces no visible change — acknowledges itself.
  const [copyNotice, setCopyNotice] = useState<string | null>(null)
  const copyNoticeTimerRef = useRef<number | null>(null)

  const runCopy = useCallback((noun: string, text: string) => {
    void copyTextToClipboard(text).then((copied) => {
      setCopyNotice(copied ? `Copied ${noun}` : `Couldn't copy ${noun}`)
      if (copyNoticeTimerRef.current !== null) window.clearTimeout(copyNoticeTimerRef.current)
      copyNoticeTimerRef.current = window.setTimeout(() => setCopyNotice(null), 1800)
    })
  }, [])

  // Build the copy-path menu for whatever was right-clicked, given its resolved
  // absolute and served-root-relative paths. Shared by the entry rows and the
  // root line so both offer exactly the same two verbs.
  const openCopyMenu = useCallback(
    (mouseEvent: ReactMouseEvent, absolutePath: string, relativePath: string) => {
      mouseEvent.preventDefault()
      setContextMenu({
        clientX: mouseEvent.clientX,
        clientY: mouseEvent.clientY,
        items: [
          {
            key: 'copy-path',
            label: 'Copy path',
            icon: <IconCopy size={15} stroke={1.8} aria-hidden />,
            onSelect: () => runCopy('path', absolutePath),
          },
          {
            key: 'copy-relative-path',
            label: 'Copy relative path',
            icon: <IconClipboardCopy size={15} stroke={1.8} aria-hidden />,
            onSelect: () => runCopy('relative path', relativePath),
          },
        ],
      })
    },
    [runCopy],
  )

  const handleEntryContextMenu = useCallback(
    (mouseEvent: ReactMouseEvent, row: EntryRow) => {
      // The absolute path needs the anchor to resolve; without it (before the
      // first listing) there is nothing meaningful to copy.
      if (rootPath === null) return
      onSelect(row.path)
      openCopyMenu(mouseEvent, absoluteTreePath(row.path, rootPath), relativeTreePath(row.path, rootPath))
    },
    [rootPath, onSelect, openCopyMenu],
  )

  const handleRootLineContextMenu = useCallback(
    (mouseEvent: ReactMouseEvent) => {
      if (rootPath === null) return
      onSelect(ROOT_LINE_PATH)
      // The root line denotes the focused directory itself: its absolute path is
      // the full breadcrumb, its relative path is that read against the anchor.
      openCopyMenu(mouseEvent, rootFullPath, relativeTreePath(rootFullPath, rootPath))
    },
    [rootPath, rootFullPath, onSelect, openCopyMenu],
  )

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
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
      {/* The current directory is a separate signal, not one of the entries:
          it is the anchor the whole view hangs from. So it lives on its own
          chrome band — pinned above the scroll, divided from the rows by a
          border — rather than scrolling away as the first tree line. It stays a
          selectable row: Enter (or a click) on it walks up one level,
          broot-style. */}
      <div
        data-row-path={ROOT_LINE_PATH}
        // A single click acts like Enter: the root line walks up one level.
        onClick={() => {
          onSelect(ROOT_LINE_PATH)
          onFocusParent()
        }}
        onContextMenu={handleRootLineContextMenu}
        className={`relative grid flex-none cursor-pointer border-b border-line bg-chrome ${rowGridColumnsClass(showSizes)} items-center px-4 py-[3px] whitespace-pre transition-colors ${
          isRootLineSelected ? 'bg-sel' : 'hover:bg-hover'
        }`}
      >
        {isRootLineSelected && <span className="absolute inset-y-0 left-0 w-[3px] bg-sel-bar" />}
        <span className="overflow-hidden font-semibold text-ellipsis text-dir">
          {rootFullPath}
        </span>
        {/* Spacers for the size columns the root line leaves blank: the bar
            track only exists when sizes are shown, the size-text track always. */}
        {showSizes && <span />}
        <span />
      </div>
      <div data-tree-scroll className="min-h-0 flex-1 overflow-y-auto pb-2.5">
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
              onFocusDirectory={onFocusDirectory}
              onPreviewFile={onPreviewFile}
              onOpenFile={onOpenFile}
              onContextMenu={handleEntryContextMenu}
            />
          ) : row.type === 'pruned' ? (
            // broot's pruning line: children trimmed from this directory's view
            // (the search's best-scoring cut, or the auto-open screen-fit).
            <div key={row.path} className={`${TREE_ROW_METRICS_CLASS} text-faint`}>
              <TreeRails connector={row.connector} />
              <span style={{ paddingLeft: `${railIndentCh(row.connector)}ch` }}>
                {row.unlistedCount} unlisted
              </span>
            </div>
          ) : (
            // The filters' tally line. Its label starts in the same column as
            // every entry name and every pruning line — the rails are the whole
            // indent, with no extra marker glyph pushing it out of the grid.
            <div key={row.path} className={`${TREE_ROW_METRICS_CLASS} text-faint`}>
              <TreeRails connector={row.connector} />
              <span style={{ paddingLeft: `${railIndentCh(row.connector)}ch` }}>
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
              </span>
            </div>
          ),
        )}
      </div>
      {contextMenu !== null && (
        <ContextMenu anchor={contextMenu} onClose={() => setContextMenu(null)} />
      )}
      {copyNotice !== null && (
        // A calm, transient confirmation pinned to the panel's foot — the copy
        // produced no other visible change, so this is the acknowledgement.
        <div
          role="status"
          className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center"
        >
          <span className="rounded-full border border-line bg-chrome px-3 py-1 text-[11.5px] text-dim shadow-[0_10px_30px_-12px_rgba(0,0,0,0.85)]">
            {copyNotice}
          </span>
        </div>
      )}
    </div>
  )
}
