import type { RefObject } from 'react'
import {
  IconAlertTriangle,
  IconBinary,
  IconFileOff,
  IconFileText,
  IconFileUnknown,
  IconFolder,
  IconLock,
  IconPhoto,
} from '@tabler/icons-react'
import type { Preview, PreviewKind } from '../../shared/preview.schema'
import { CONFINEMENT_BADGE_LABEL, confinementRefusalMessage } from '../lib/confinement'
import { useApiBase, withApiBase } from '../lib/apiBase'
import { formatBytes } from '../lib/format'
import { ToggleChip } from './ToggleChip'

// One descriptor per preview kind (ADR-0026): the icon and the label the header
// badge and the marker block both read from, so they can never disagree.
const PREVIEW_KIND_DESCRIPTORS: Record<PreviewKind, { label: string; Icon: typeof IconFileText }> = {
  text: { label: 'text', Icon: IconFileText },
  image: { label: 'image', Icon: IconPhoto },
  binary: { label: 'binary', Icon: IconBinary },
  empty: { label: 'empty', Icon: IconFileOff },
  'too-large': { label: 'too large', Icon: IconAlertTriangle },
  directory: { label: 'directory', Icon: IconFolder },
  // Same icon and words as the tree row's badge: one vocabulary for the state,
  // so the panel and the row are recognisably describing the same thing.
  blocked: { label: CONFINEMENT_BADGE_LABEL, Icon: IconLock },
  unsupported: { label: 'no preview', Icon: IconFileUnknown },
}

// The markers that stand in for content we deliberately do not dump into the
// panel — binary bytes, an oversized image, an empty or unpreviewable entry.
function PreviewMarker({ preview }: { preview: Preview }) {
  const { label, Icon } = PREVIEW_KIND_DESCRIPTORS[preview.kind]
  // The refusal wording lives on the client (one source, shared with the tree
  // row), so the server sends the `blocked` marker bare and the explanation is
  // filled in here rather than duplicated across the seam.
  const note =
    preview.kind === 'blocked' ? confinementRefusalMessage(preview.name) : preview.note
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <Icon size={28} stroke={1.4} className="text-faint" />
      <span className="text-xs text-dim">{label}</span>
      {note !== null && <span className="text-[11px] text-faint">{note}</span>}
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="text-[11.5px] text-dim">{label}</span>
      <span className="text-[11.5px] tabular-nums text-fg">{value}</span>
    </div>
  )
}

// Directory summary: counts and byte totals for the *direct* children only —
// aggregated (recursive) sizes are a separate, opt-in feature precisely because
// they cost a walk, and the preview must never pay for one.
function DirectorySummaryView({ preview }: { preview: Preview }) {
  const summary = preview.directory
  if (summary === null) return <PreviewMarker preview={preview} />
  return (
    <div className="px-4 py-3">
      <SummaryRow label="entries" value={String(summary.entryCount)} />
      <SummaryRow label="directories" value={String(summary.directoryCount)} />
      <SummaryRow label="files" value={String(summary.fileCount)} />
      {summary.otherCount > 0 && <SummaryRow label="other" value={String(summary.otherCount)} />}
      <SummaryRow label="hidden" value={String(summary.hiddenCount)} />
      <SummaryRow label="gitignored" value={String(summary.gitignoredCount)} />
      <SummaryRow
        label="files size"
        value={summary.directFileBytes === 0 ? '0 B' : formatBytes(summary.directFileBytes)}
      />
      {summary.largestEntries.length > 0 && (
        <div className="mt-3 border-t border-line-2 pt-2">
          <div className="pb-1 text-[10.5px] tracking-wide text-faint uppercase">largest files</div>
          {summary.largestEntries.map((entry) => (
            <div key={entry.name} className="flex items-baseline justify-between gap-3 py-[2px]">
              <span className="overflow-hidden text-[11.5px] text-ellipsis whitespace-nowrap text-file">
                {entry.name}
              </span>
              <span className="flex-none text-[11.5px] tabular-nums text-dim">
                {formatBytes(entry.sizeBytes)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TextPreviewView({ preview, wrapText }: { preview: Preview; wrapText: boolean }) {
  return (
    <div className="py-2">
      {preview.lines.map((line) => (
        <div key={line.number} className="flex">
          <span className="w-12 flex-none px-2 text-right text-[11px] tabular-nums text-faint select-none">
            {line.number}
          </span>
          {/* Soft wrap by default: continuation lines hang under the text,
              past the fixed number gutter. Off restores exact columns and the
              panel's horizontal scrollbar for code readers. */}
          <span
            className={`min-w-0 pr-4 text-[12px] text-file ${
              wrapText ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
            }`}
          >
            {line.text}
          </span>
        </div>
      ))}
      {preview.isTruncated && (
        <div className="px-4 py-2 text-[11px] text-faint">
          … preview bounded — the file continues past what was read
        </div>
      )}
    </div>
  )
}

type PreviewPanelProps = {
  scrollRef: RefObject<HTMLDivElement | null>
  isFocused: boolean
  targetPath: string
  preview: Preview | null
  previewError: string | null
  isLoading: boolean
  // The column's resolved pixel width — the divider beside it owns the drag; the
  // panel just fills whatever width it is handed.
  width: number
  // Soft-wrap the text preview, and the header toggle that flips it.
  wrapText: boolean
  onToggleWrap: () => void
  onFocusChange: (isFocused: boolean) => void
}

// The right column: a bounded look at whatever the tree has selected. It is
// enrichment by the AGENTS.md responsiveness principle — it loads after the
// tree has painted, is aborted when the selection moves on, and degrades to a
// marker rather than delaying or blocking navigation.
export function PreviewPanel({
  scrollRef,
  isFocused,
  targetPath,
  preview,
  previewError,
  isLoading,
  width,
  wrapText,
  onToggleWrap,
  onFocusChange,
}: PreviewPanelProps) {
  // The image `<img src>` is a server-built path (`/api/fs/raw?...`); like every
  // other request it resolves against the configured API base, so an embedded
  // mount loads the bytes from the explorer server's origin, not the host page.
  const apiBase = useApiBase()
  // The served root has no basename of its own; name it by the path it is.
  const headerName = preview !== null && preview.name !== '' ? preview.name : targetPath || '/'
  const descriptor = preview === null ? null : PREVIEW_KIND_DESCRIPTORS[preview.kind]

  return (
    <div
      // The width comes from the divider beside it (the drag lives there); the
      // panel just fills it. The focus accent lives on the divider's edge now
      // (ADR-0028's shared interaction token), so the panel only tints its
      // surface to echo which side holds the keyboard.
      style={{ width }}
      className={`flex min-h-0 flex-none flex-col ${isFocused ? 'bg-term-2' : ''}`}
    >
      <div className="flex flex-none items-center gap-2 border-b border-line-2 px-3 py-1.5">
        {descriptor !== null && (
          <descriptor.Icon size={14} stroke={1.5} className="flex-none text-dim" />
        )}
        <span className="overflow-hidden text-[11.5px] text-ellipsis whitespace-nowrap text-fg">
          {headerName}
        </span>
        <span className="flex-1" />
        {/* The wrap control sits on the region it governs (ADR-0031) — the
            preview itself — beside the size/kind badges. It only means anything
            for text, so it rides with the text preview rather than every kind. */}
        {preview?.kind === 'text' && (
          <ToggleChip
            label="wrap"
            isOn={wrapText}
            compact
            title="Soft-wrap long lines. Off shows exact columns with a horizontal scrollbar."
            onToggle={onToggleWrap}
          />
        )}
        {preview?.sizeBytes != null && preview.sizeBytes > 0 && (
          <span className="flex-none text-[11px] tabular-nums text-dim">
            {formatBytes(preview.sizeBytes)}
          </span>
        )}
        {preview !== null && (
          <span className="flex-none text-[11px] text-faint">{descriptor?.label}</span>
        )}
      </div>
      {/* Focusable so ctrl/cmd-→ can hand it the keyboard and the arrow keys
          scroll the content natively instead of moving the tree selection. */}
      <div
        ref={scrollRef}
        tabIndex={0}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
        className="min-h-0 flex-1 overflow-auto outline-none"
      >
        {previewError !== null ? (
          <div className="px-4 py-3 text-xs text-bar-a">{previewError}</div>
        ) : preview === null ? (
          <div className="px-4 py-3 text-xs text-faint">{isLoading ? 'reading…' : 'no selection'}</div>
        ) : preview.kind === 'text' ? (
          <TextPreviewView preview={preview} wrapText={wrapText} />
        ) : preview.kind === 'directory' ? (
          <DirectorySummaryView preview={preview} />
        ) : preview.kind === 'image' && preview.imageUrlPath !== null ? (
          <div className="grid h-full place-items-center p-4">
            <img
              src={withApiBase(apiBase, preview.imageUrlPath)}
              alt={preview.name}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : (
          <PreviewMarker preview={preview} />
        )}
      </div>
    </div>
  )
}
