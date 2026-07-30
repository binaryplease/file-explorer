---
id: 002-preview-parity
title: Preview parity — the preview is the viewer, not a glance
status: in-progress
rank: 2
tags: [preview, client, server]
blocks: [003-embeddable-file-explorer]
blocked_by: []
research: [../.nightshift/research/2026-07-20-nightshift-ui-adoption.md]
adrs: [ADR-0013, ADR-0019, ADR-0025, ADR-0026, ADR-0027, ADR-0028, ADR-0031]
shipped: null
updated: 2026-07-31
---

# Preview parity — the preview is the viewer, not a glance

The deliberate "bounded head" scope was right for a glance and is **not**
sufficient for being the only viewer. Since the 2026-07-20 decision that bfe is
the single source of truth for tree and preview across binp apps, a gap in the
preview is a gap in every consuming app.

Everything below is a renderer addition on top of the existing kind dispatch:
`PreviewKind` grows, the bounding design does not change. Kinds that fall
through land on `binary` / `unsupported` (`shared/preview.schema.ts:8-16`).

## Open

### Windowed reads for long text

`PREVIEW_HEAD_BYTES = 128 KiB` / `PREVIEW_MAX_LINES = 600`
(`services/preview.ts:22-23`) is right for a glance, not for reading. Add a
ranged read so the panel scrolls past line 600 — keep the bounded *first*
response (it is what makes a 40 GB log cheap) and fetch further windows on
scroll. The responsiveness principle holds: first paint stays bounded, extra
reads are async and cancellable.

Blocks: in-document find across windows (see below).

## Delivered

### Mermaid diagrams — shipped 2026-07-31

A ```` ```mermaid ```` fenced block in a rendered markdown file paints as a
diagram instead of as code. `mermaidDiagramSource` (`src/lib/mermaid.ts`, pure,
unit-tested) decides whether a hast `<pre>` node is a diagram and hands back its
text; the `pre` component in `MarkdownPreview.tsx` builds the code-block frame
once and passes it to `MermaidDiagram` as the source fallback, so the diagram's
pending and failed states render the identical block rather than a second copy
of its styling (ADR-0027).

Non-blocking by construction (responsiveness principle): the fenced source is
already on screen and the engine arrives via `import('mermaid')`, code-split by
Vite into its own chunks — the entry bundle only references them by URL, it does
not carry them (ADR-0016: bundled, never a CDN). A render that lands after the
source or theme changed is dropped under the same `cancelled` guard the
highlighter uses.

Themed off the grove tokens, not a second palette: `groveThemeVariables` reads
the very `--color-*` custom properties theme.css defines and hands them to
Mermaid's `base` theme, at the document's own 13.5px/`--font-sans` type scale
rather than Mermaid's 16px default. Because Mermaid bakes colours into finished
SVG, a theme flip must re-render — new `useResolvedTheme` (`src/lib/theme.ts`)
watches `<html data-theme>`, the one signal standalone (explorer-written) and
embedded (host-written) mounts agree on.

Security is the justified opt-in, not the default: this is the app's single
`dangerouslySetInnerHTML`, and what makes it safe is `securityLevel: 'strict'` —
every label goes through Mermaid's DOMPurify pass, HTML in labels stays escaped,
and `click`/`callback` interaction directives are disabled, so an untrusted
previewed file cannot script the explorer through the seam.
`suppressErrorRendering: true` keeps Mermaid's own error graphic out of the
document; a diagram that will not parse degrades to its source plus a one-line
explanation (full parser dump on the title) — nothing is hidden.

Verified in-browser in both themes: flowchart and sequence diagrams render in
grove colours, an ordinary ```` ```typescript ```` fence still renders as code,
a broken diagram shows source + reason, and the dark toggle re-renders the SVG
live. 257 tests (+6) + typecheck green; `nix build` green after
`mise run deps:hash`.

**Not done:** no per-diagram source/diagram toggle (the header `rendered` chip
already puts the whole file's source one click away), no pan/zoom for a diagram
wider than the panel (it scrolls), and a diagram whose source is cut off by the
bounded head read fails to parse and shows that truncated source — the same
boundary the frontmatter card has.

### PDF — shipped 2026-07-28

Extension-classified in `services/preview.ts` (`PDF_EXTENSIONS`, alongside
audio/video and before the head read so its binary bytes don't fall through to
`binary`) into a new `pdf` `PreviewKind` (`shared/preview.schema.ts`), reusing
the shared `mediaUrlPath` → `/api/fs/raw` (the same "fetch raw bytes" invariant
as image/audio/video, ADR-0026/0027). `PdfPreviewView`
(`components/PreviewPanel.tsx`) renders an `<iframe>` off
`withApiBase(mediaUrlPath)` with an accessible `title`; header badge +
`IconFileTypePdf` via `PREVIEW_KIND_DESCRIPTORS`.

**Security seam:** the raw endpoint's hardening (`Content-Disposition:
attachment` + `CSP: sandbox; default-src 'none'`) would download/blank a PDF
iframe, so a `.pdf` is the one raw byte served `inline` with `Content-Type:
application/pdf` and `CSP: default-src 'none'` (no `sandbox`). Safe because
`nosniff` (kept, load-bearing) forbids re-interpreting the bytes as a scriptable
same-origin document — the exact attack the sandbox exists to stop — and the
browser's built-in PDF viewer runs isolated from the explorer origin.
Disposition is chosen server-side from the resolved basename, never client
input; `attachmentDispositionFor` was refactored to a shared
`contentDispositionFor(type, name)` so inline reuses the same header-injection
sanitisation.

Verified in-browser (default unconfined): the native viewer renders a one-page
PDF with full toolbar under `default-src 'none'` (the CSP does *not* blank it);
raw headers confirmed via curl (`inline`, `application/pdf`, `nosniff`, no
`sandbox`). 235 tests (+2) + typecheck green.

**Caveats:** (1) the same confined-mode Range gap as audio/video — under
`EXPLORER_CONFINE=true` the descriptor-stream branch ignores `Range`, so a
multi-page PDF loads but jumping to an unbuffered page may re-fetch; backend
work, unscheduled. (2) A PDF that isn't a `.pdf` by extension still classifies
as `binary` (extension-driven, like the other media kinds).

### Video / audio — shipped 2026-07-21

Extension-classified in `services/preview.ts`
(`AUDIO_EXTENSIONS`/`VIDEO_EXTENSIONS`, before the head read so binary bytes
don't fall through to the `binary` marker) into two new `PreviewKind`s
(`shared/preview.schema.ts`); the image-only `imageUrlPath` field was renamed to
the shared `mediaUrlPath` (one field for the image/audio/video "fetch raw bytes"
invariant, ADR-0026/0027). `MediaPreviewView` renders native `<audio controls>` /
`<video controls>` off `withApiBase(mediaUrlPath)`, with an `onError` fallback to
a marker note for codecs the browser can't decode (ADR-0025).

Verified in-browser (default unconfined): both players render with native
controls, and `/api/fs/raw` answers `206 Partial Content` with `accept-ranges:
bytes`, so seeking works. 171 tests + typecheck green.

**Caveat left:** under `EXPLORER_CONFINE=true` the raw endpoint's
descriptor-stream branch (`routes/filesystem.ts:195`) does *not* parse `Range` —
it always streams from byte 0 with the full `Content-Length`, so progressive
playback works but seeking to an unbuffered position does not. Adding Range
handling to that confined branch is backend work, unscheduled.

### Markdown rendering — shipped 2026-07-21

A markdown file (`kind:'text'` + `language:'markdown'`, read off the shared
`shared/language.ts` hint, no re-sniffing) renders as a formatted document by
default. New presentational primitive `components/MarkdownPreview.tsx`
(react-markdown@10 + remark-gfm@4) maps each element to grove tokens
(`text-fg`/`text-file`/`bg-inset`/`border-line-2`, mono inherited — no
proportional face that would clash with the terminal surface).

Security fails safe: react-markdown renders React elements (never
`dangerouslySetInnerHTML`), no `rehype-raw` so inline HTML is escaped, and the
built-in url transform drops `javascript:` links; external `<a>` get
`target=_blank rel=noreferrer noopener`.

A `renderMarkdown` view-setting (default true, `lib/viewSettings.ts`) drives a
header `rendered` ToggleChip (ADR-0031, beside the kind badges); off restores the
highlighted source view, and the `wrap` chip only shows while source is displayed
since it governs the line-gutter renderer (ADR-0025: source is one click away,
not hidden). The truncation caveat is a shared `TruncationNote` used by both
views. 171 tests + typecheck green.

**Not done:** syntax-highlighting fenced code blocks *inside* rendered markdown
(they render mono-plain; the source toggle still highlights the whole file).

### Frontmatter card — shipped 2026-07-28

A markdown file whose source opens with a Jekyll-style YAML frontmatter block
(`---` fence on line 1, closed by `---`/`...`) renders that block as a metadata
card above the rendered document instead of the old garbage (leading `---` →
thematic break, `key: value` → a giant setext heading). New `extractFrontmatter`
helper in `components/MarkdownPreview.tsx` splits the block with one regex and
parses it with `yaml@^2` (added dep — arbitrary user YAML, no fixed schema, so
ADR-0013/Zod doesn't apply). Rendered as a native `<dl>` in a `FrontmatterCard`:
scalars as text, scalar arrays as `bg-inset` chips (the `tags:` case), nested
maps as indented sub-lists.

Fails safe / hides nothing: no fence, malformed YAML, a scalar (non-mapping)
root, or a truncated block whose closing fence fell outside the bounded preview
all degrade to `{data:null}` → the raw source renders untouched. Only the
*rendered* view parses it; the source toggle still shows the frontmatter
verbatim.

Verified in-browser (metadata card + document body both render; a11y tree
confirms the `region "Document frontmatter"` + term/definition pairs); typecheck
green. **Not done:** highlighting inside the frontmatter values, and rendering
inside *truncated* frontmatter.

> This is also what makes the requirements folder self-hosting: every file here
> opens with frontmatter, so bfe renders its own notebook as metadata card +
> document.

### Syntax highlighting — shipped 2026-07-21

Client-side Shiki (`shiki@^3`, dual github-light/dark themes), an
extract-and-transplant (ADR-0006) of binp-git-graph's `highlighter.ts` singleton
+ `languageForPath` detector, retargeted to standalone Shiki's grammar IDs
(`cpp`/`csharp`, not `c++`/`c#`). New pure `shared/language.ts` (client+server
agree, no round trip); `PreviewSchema` grew a `language: z.string().default('txt')`
the server stamps for `kind:'text'` only (bounded-read design untouched —
metadata hint). `TextPreviewView` paints plain first, then decorates from
`codeToTokens` per-line `ThemedToken[][]` (1:1 with the gutter renderer) under a
`cancelled` guard; `'txt'`/unknown-grammar/pending → plain.
`--shiki-light`/`--shiki-dark` custom props (defaultColor false) swapped by
`[data-theme]` in theme.css. Grammars code-split by Vite, warmed fire-and-forget
at app mount. Verified both themes in-browser; 162 tests + typecheck green.

### In-document fuzzy find — shipped 2026-07-21

When the preview holds the keyboard (broot's ctrl/cmd-→ hand-off) and shows a
source text view, typing drives a fuzzy search over the document's *words* and
highlights the matched characters (ADR-0019), overlaid on top of the Shiki syntax
colours (unmatched runs keep their token colour). New pure
`src/lib/documentSearch.ts` (`searchDocument` word-tokenises each line and scores
with the shared `shared/fuzzy.ts` engine, all in code-point space;
`splitRunByMatch` slices plain lines or Shiki tokens into matched/unmatched runs).

The match-highlight styling is now a single shared token (`MATCH_HIGHLIGHT_CLASS`
+ `HighlightedSegments` in `src/components/FuzzyMatch.tsx`, ADR-0028) that
TreeView and the preview both compose — the tree's two inline `bg-match-bg
text-match` copies were folded into it. Capture lives on the preview's focusable
scroll container: printable keys append, Backspace deletes, Space still scrolls
(useless in a word query), Esc clears, Enter / Shift-Enter jump between matching
lines (`data-doc-line` + `scrollIntoView`); each query change auto-scrolls the
first match into view. A header find control (search icon → focuses the doc,
query, live match count, clear-✕) sits beside the wrap/rendered chips
(ADR-0031/0025).

Bounded, client-only, non-blocking (the preview is already head-capped) — the
core loop never waits on it. Verified in-browser; 179 tests + typecheck green.

**Not done:** find inside *rendered* markdown (only the source text view is
searchable) and across windowed reads (blocked on the open item above).
