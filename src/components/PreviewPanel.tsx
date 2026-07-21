import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react'
import type { ThemedToken } from 'shiki'
import {
  IconAlertTriangle,
  IconBinary,
  IconFileOff,
  IconFileText,
  IconFileUnknown,
  IconFolder,
  IconLock,
  IconMovie,
  IconMusic,
  IconPhoto,
  IconSearch,
  IconX,
} from '@tabler/icons-react'
import type { Preview, PreviewKind } from '../../shared/preview.schema'
import { CONFINEMENT_BADGE_LABEL, confinementRefusalMessage } from '../lib/confinement'
import { useApiBase, withApiBase } from '../lib/apiBase'
import {
  searchDocument,
  splitRunByMatch,
  type DocumentLineMatch,
  type DocumentSearchResult,
} from '../lib/documentSearch'
import { formatBytes } from '../lib/format'
import { tokenizePreviewLines } from '../lib/highlighter'
import { MATCH_HIGHLIGHT_CLASS } from './FuzzyMatch'
import { MarkdownPreview } from './MarkdownPreview'
import { ToggleChip } from './ToggleChip'

// A stable empty result for previews that carry no searchable lines, so the
// document-search memo never re-runs on identity churn for non-text kinds.
const NO_DOCUMENT_LINES: Preview['lines'] = []
const EMPTY_MATCHED_INDEXES: ReadonlySet<number> = new Set()

// One descriptor per preview kind (ADR-0026): the icon and the label the header
// badge and the marker block both read from, so they can never disagree.
const PREVIEW_KIND_DESCRIPTORS: Record<PreviewKind, { label: string; Icon: typeof IconFileText }> = {
  text: { label: 'text', Icon: IconFileText },
  image: { label: 'image', Icon: IconPhoto },
  audio: { label: 'audio', Icon: IconMusic },
  video: { label: 'video', Icon: IconMovie },
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

// Inline playback for audio/video: the browser streams the bytes from the raw
// endpoint into a native element (Range-seekable and progressive, so nothing is
// buffered into the panel) — enrichment, exactly like the image preview. A
// format the browser cannot decode fires `onError`; we then fall back to a
// marker that explains why instead of leaving a dead player on screen (ADR-0025:
// the affordance stays, its unavailable state explained rather than hidden).
function MediaPreviewView({ preview, src }: { preview: Preview; src: string }) {
  const [playbackFailed, setPlaybackFailed] = useState(false)
  // Reset when the selection moves to another media file — otherwise a prior
  // failure would suppress the next file's player before it even tries to load.
  useEffect(() => setPlaybackFailed(false), [src])

  if (playbackFailed) {
    return (
      <PreviewMarker
        preview={{
          ...preview,
          note: `This ${preview.kind} format can't be played in the browser — open it to play it.`,
        }}
      />
    )
  }

  if (preview.kind === 'audio') {
    return (
      <div className="grid h-full place-items-center p-4">
        <audio
          src={src}
          controls
          aria-label={preview.name}
          className="w-full max-w-md"
          onError={() => setPlaybackFailed(true)}
        />
      </div>
    )
  }

  return (
    <div className="grid h-full place-items-center p-4">
      <video
        src={src}
        controls
        aria-label={preview.name}
        className="max-h-full max-w-full"
        onError={() => setPlaybackFailed(true)}
      />
    </div>
  )
}

// One wording for the bounded-read caveat, shared by the source and the
// rendered-markdown views so they can never describe the boundary differently.
function TruncationNote() {
  return (
    <div className="px-4 py-2 text-[11px] text-faint">
      … preview bounded — the file continues past what was read
    </div>
  )
}

// Renders one line's content, overlaying the document-search highlight on top
// of whatever the line already shows — plain text, or Shiki tokens. Matched
// character runs get the shared highlight token (ADR-0028); on syntax-coloured
// lines the unmatched runs keep their token colour, so highlighting a match
// never strips the surrounding code of its colours. When nothing on the line
// matched, the untouched fast paths render exactly as before.
function renderLineContent(
  lineText: string,
  lineTokens: ThemedToken[] | null,
  matchedIndexes: ReadonlySet<number>,
) {
  const hasMatches = matchedIndexes.size > 0

  if (lineTokens === null) {
    if (!hasMatches) return lineText
    return splitRunByMatch(Array.from(lineText), 0, matchedIndexes).map((piece, pieceIndex) =>
      piece.matched ? (
        <mark key={pieceIndex} className={MATCH_HIGHLIGHT_CLASS}>
          {piece.text}
        </mark>
      ) : (
        <span key={pieceIndex}>{piece.text}</span>
      ),
    )
  }

  let codePointCursor = 0
  return lineTokens.map((token, tokenIndex) => {
    const tokenCharacters = Array.from(token.content)
    const tokenStartIndex = codePointCursor
    codePointCursor += tokenCharacters.length
    if (!hasMatches) {
      return (
        <span key={tokenIndex} className="shiki-token" style={token.htmlStyle as CSSProperties}>
          {token.content}
        </span>
      )
    }
    return splitRunByMatch(tokenCharacters, tokenStartIndex, matchedIndexes).map(
      (piece, pieceIndex) =>
        piece.matched ? (
          <mark key={`${tokenIndex}:${pieceIndex}`} className={MATCH_HIGHLIGHT_CLASS}>
            {piece.text}
          </mark>
        ) : (
          <span
            key={`${tokenIndex}:${pieceIndex}`}
            className="shiki-token"
            style={token.htmlStyle as CSSProperties}
          >
            {piece.text}
          </span>
        ),
    )
  })
}

function TextPreviewView({
  preview,
  wrapText,
  lineMatches,
}: {
  preview: Preview
  wrapText: boolean
  // 1:1 with `preview.lines`: which characters the in-document search matched on
  // each line. All-empty (an inactive search) takes the untouched render paths.
  lineMatches: DocumentLineMatch[]
}) {
  // Highlighting decorates the plain text that painted first (AGENTS.md
  // responsiveness principle): tokens start null so the very first render is the
  // plain string, and a `cancelled` flag drops a stale tokenization when the
  // selection moves on before Shiki answers — the same supersede-on-move pattern
  // the App-level preview fetch uses. Null stays null for `'txt'`, an unknown
  // grammar, or a still-pending tokenization, so those render plain throughout.
  const [tokenLines, setTokenLines] = useState<ThemedToken[][] | null>(null)
  useEffect(() => {
    setTokenLines(null)
    let cancelled = false
    const joinedWindow = preview.lines.map((line) => line.text).join('\n')
    tokenizePreviewLines(joinedWindow, preview.language, preview.lines.length)
      .then((tokens) => {
        if (!cancelled) setTokenLines(tokens)
      })
      .catch(() => {
        // Tokenization failed — leave the plain text that is already on screen.
      })
    return () => {
      cancelled = true
    }
  }, [preview.path, preview.language, preview.lines])

  return (
    <div className="py-2">
      {preview.lines.map((line, lineIndex) => {
        // Look the tokens up per line rather than trusting `tokenLines` to match
        // `preview.lines` wholesale. When the selection moves to a new file the
        // render sees the new `preview.lines` for one paint while `tokenLines`
        // still holds the *previous* file's tokens (its reset effect runs after
        // this render), so a longer new file would index past the stale array —
        // a crash that unmounts the whole tree. A missing token line just falls
        // back to plain text, which is what the very first paint shows anyway.
        const lineTokens = tokenLines?.[lineIndex] ?? null
        const matchedIndexes = lineMatches[lineIndex]?.matchedIndexes ?? EMPTY_MATCHED_INDEXES
        return (
          <div key={line.number} data-doc-line={lineIndex} className="flex">
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
              {renderLineContent(line.text, lineTokens, matchedIndexes)}
            </span>
          </div>
        )
      })}
      {preview.isTruncated && <TruncationNote />}
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
  // Render a markdown file as formatted markdown (on) or as raw highlighted
  // source (off), and the header toggle that flips it. Meaningful only for a
  // markdown text preview; ignored for every other kind.
  renderMarkdown: boolean
  onToggleRenderMarkdown: () => void
  onFocusChange: (isFocused: boolean) => void
}

// A markdown text preview is the one text kind that can render two ways. The
// server tags it via the shared language detector (shared/language.ts), so the
// panel reads that single hint rather than re-sniffing the extension.
function isMarkdownPreview(preview: Preview | null): boolean {
  return preview !== null && preview.kind === 'text' && preview.language === 'markdown'
}

// The in-document find affordance, on the preview header beside the toggles it
// keeps company with (ADR-0031 — it governs the document shown right below it).
// Always present for a searchable text preview so the capability is discoverable
// (ADR-0025); the search icon hands focus to the document so typing can start,
// and the match count / clear appear once a query exists.
function DocumentSearchIndicator({
  query,
  matchCount,
  onFocusDocument,
  onClear,
}: {
  query: string
  matchCount: number
  onFocusDocument: () => void
  onClear: () => void
}) {
  const hasQuery = query !== ''
  return (
    <div className="flex flex-none items-center gap-1">
      <button
        type="button"
        onClick={onFocusDocument}
        aria-label="Search within this document"
        title="Focus the document and type to fuzzy-search its words. Enter jumps between matches; Esc clears."
        className="flex items-center gap-1 rounded-[3px] px-1 py-px text-[11px] text-dim outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-accent"
      >
        <IconSearch size={13} stroke={1.6} className="flex-none" />
        {hasQuery ? (
          <span className="max-w-[9rem] truncate font-mono text-match">{query}</span>
        ) : (
          <span className="text-faint">find</span>
        )}
      </button>
      {hasQuery && (
        <span aria-live="polite" className="flex-none text-[11px] tabular-nums text-faint">
          {matchCount === 0 ? 'no matches' : `${matchCount} match${matchCount === 1 ? '' : 'es'}`}
        </span>
      )}
      {hasQuery && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear document search"
          className="flex-none rounded-[3px] p-px text-faint outline-none hover:text-fg focus-visible:ring-1 focus-visible:ring-accent"
        >
          <IconX size={13} stroke={1.6} />
        </button>
      )}
    </div>
  )
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
  renderMarkdown,
  onToggleRenderMarkdown,
  onFocusChange,
}: PreviewPanelProps) {
  // The image `<img src>` is a server-built path (`/api/fs/raw?...`); like every
  // other request it resolves against the configured API base, so an embedded
  // mount loads the bytes from the explorer server's origin, not the host page.
  const apiBase = useApiBase()
  // The served root has no basename of its own; name it by the path it is.
  const headerName = preview !== null && preview.name !== '' ? preview.name : targetPath || '/'
  const descriptor = preview === null ? null : PREVIEW_KIND_DESCRIPTORS[preview.kind]
  const isMarkdown = isMarkdownPreview(preview)
  // Rendered markdown mounts the document renderer; raw source (toggle off, or a
  // non-markdown text file) mounts the line-gutter text renderer that `wrap`
  // governs — so `wrap` only belongs in the header when source is what's shown.
  const showingRenderedMarkdown = isMarkdown && renderMarkdown

  // In-document fuzzy search: typing while the preview holds the keyboard filters
  // the source text's words and highlights the matches (ADR-0019). It is offered
  // only for the source text view — the one surface whose characters this can
  // decorate — never the rendered-markdown or media kinds.
  const isSearchableText = preview?.kind === 'text' && !showingRenderedMarkdown
  const [documentQuery, setDocumentQuery] = useState('')
  const [activeMatchOrdinal, setActiveMatchOrdinal] = useState(0)

  // A new file is a fresh document: drop any query so the last file's search
  // never lingers over the next one's text.
  useEffect(() => {
    setDocumentQuery('')
    setActiveMatchOrdinal(0)
  }, [preview?.path])

  const documentLines = preview?.kind === 'text' ? preview.lines : NO_DOCUMENT_LINES
  const documentSearch: DocumentSearchResult = useMemo(
    () => searchDocument(documentLines, isSearchableText ? documentQuery : ''),
    [documentLines, documentQuery, isSearchableText],
  )

  // Bring a match into view by its ordinal among the matching lines, and record
  // that ordinal so Enter/Shift-Enter can walk on from it.
  const revealMatch = (matchOrdinal: number) => {
    const lineIndex = documentSearch.matchedLineIndexes[matchOrdinal]
    if (lineIndex === undefined) return
    setActiveMatchOrdinal(matchOrdinal)
    scrollRef.current
      ?.querySelector(`[data-doc-line="${lineIndex}"]`)
      ?.scrollIntoView({ block: 'center' })
  }

  // Find-as-you-type: each query change resets to and scrolls the first match
  // into view, so the highlight the user is chasing is never left off-screen.
  useEffect(() => {
    setActiveMatchOrdinal(0)
    const firstMatchLine = documentSearch.matchedLineIndexes[0]
    if (firstMatchLine === undefined) return
    scrollRef.current
      ?.querySelector(`[data-doc-line="${firstMatchLine}"]`)
      ?.scrollIntoView({ block: 'center' })
    // Re-run when the match set changes (which subsumes every query change).
  }, [documentSearch, scrollRef])

  // Typing into the focused document drives the find query — the same
  // "type-anywhere" gesture the tree uses, scoped to the preview (App leaves
  // every non-chord key to the preview while it holds the keyboard). Space keeps
  // scrolling the panel: it can never be part of a word, so it is useless here.
  const handleDocumentKeyDown = (keyboardEvent: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!isSearchableText) return
    if (keyboardEvent.ctrlKey || keyboardEvent.metaKey || keyboardEvent.altKey) return
    const { key } = keyboardEvent
    if (key === 'Enter') {
      if (documentSearch.matchedLineIndexes.length === 0) return
      keyboardEvent.preventDefault()
      const matchCount = documentSearch.matchedLineIndexes.length
      const step = keyboardEvent.shiftKey ? -1 : 1
      revealMatch((activeMatchOrdinal + step + matchCount) % matchCount)
      return
    }
    if (key === 'Escape') {
      if (documentQuery === '') return
      keyboardEvent.preventDefault()
      setDocumentQuery('')
      return
    }
    if (key === 'Backspace') {
      if (documentQuery === '') return
      keyboardEvent.preventDefault()
      setDocumentQuery((previous) => Array.from(previous).slice(0, -1).join(''))
      return
    }
    if (key === ' ') return
    if (key.length === 1) {
      keyboardEvent.preventDefault()
      setDocumentQuery((previous) => previous + key)
    }
  }

  const clearDocumentSearch = () => {
    setDocumentQuery('')
    scrollRef.current?.focus()
  }

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
        {isSearchableText && (
          <DocumentSearchIndicator
            query={documentQuery}
            matchCount={documentSearch.totalMatchCount}
            onFocusDocument={() => scrollRef.current?.focus()}
            onClear={clearDocumentSearch}
          />
        )}
        {/* Both preview toggles sit on the region they govern (ADR-0031) — the
            preview itself — beside the size/kind badges, and each rides with the
            renderer it controls. The markdown render/source switch shows for a
            markdown file; the wrap switch governs the source-text renderer, so
            it drops out while rendered markdown is on. */}
        {isMarkdown && (
          <ToggleChip
            label="rendered"
            isOn={renderMarkdown}
            compact
            title="Render this markdown file as formatted document. Off shows the raw source with syntax highlighting."
            onToggle={onToggleRenderMarkdown}
          />
        )}
        {preview?.kind === 'text' && !showingRenderedMarkdown && (
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
          scroll the content natively instead of moving the tree selection. For a
          text document, typing here drives the in-document fuzzy search. */}
      <div
        ref={scrollRef}
        tabIndex={0}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
        onKeyDown={handleDocumentKeyDown}
        aria-label={
          isSearchableText
            ? 'File preview. Type to fuzzy-search this document; Enter jumps between matches.'
            : 'File preview'
        }
        className="min-h-0 flex-1 overflow-auto outline-none"
      >
        {previewError !== null ? (
          <div className="px-4 py-3 text-xs text-bar-a">{previewError}</div>
        ) : preview === null ? (
          <div className="px-4 py-3 text-xs text-faint">{isLoading ? 'reading…' : 'no selection'}</div>
        ) : preview.kind === 'text' && showingRenderedMarkdown ? (
          <>
            <MarkdownPreview source={preview.lines.map((line) => line.text).join('\n')} />
            {preview.isTruncated && <TruncationNote />}
          </>
        ) : preview.kind === 'text' ? (
          <TextPreviewView
            preview={preview}
            wrapText={wrapText}
            lineMatches={documentSearch.lineMatches}
          />
        ) : preview.kind === 'directory' ? (
          <DirectorySummaryView preview={preview} />
        ) : preview.kind === 'image' && preview.mediaUrlPath !== null ? (
          <div className="grid h-full place-items-center p-4">
            <img
              src={withApiBase(apiBase, preview.mediaUrlPath)}
              alt={preview.name}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : (preview.kind === 'audio' || preview.kind === 'video') &&
          preview.mediaUrlPath !== null ? (
          <MediaPreviewView preview={preview} src={withApiBase(apiBase, preview.mediaUrlPath)} />
        ) : (
          <PreviewMarker preview={preview} />
        )}
      </div>
    </div>
  )
}
