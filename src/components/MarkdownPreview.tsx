import { useMemo, type AnchorHTMLAttributes, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { parse as parseYaml } from 'yaml'
import { mermaidDiagramSource } from '../lib/mermaid'
import { MermaidDiagram } from './MermaidDiagram'

// Rendered-markdown primitive for the preview panel. Presentational and
// data-agnostic (a UI-kit-style leaf): it takes the bounded head text a text
// preview already carries and paints it as formatted markdown, styled entirely
// with the app's grove tokens (theme.css). Prose reads in the proportional
// --font-sans face (Inter) so a rendered document looks like a document, while
// code — inline chips and fenced blocks — stays on --font-mono to preserve
// alignment; the container flips the inherited mono family to sans and the
// code/pre nodes flip back.
//
// Security fails safe (persona default): react-markdown renders to React
// elements, never `dangerouslySetInnerHTML`. Without `rehype-raw` any inline
// HTML in the source is escaped as text, and the built-in url transform drops
// `javascript:`-style link protocols — untrusted preview content cannot inject
// markup or script. GitHub-flavored extensions (tables, task lists,
// strikethrough, autolinks) come from `remark-gfm`.

// External links open in a new tab and are severed from `window.opener`; the
// url transform already blocked dangerous protocols, this just hardens the
// navigation. Relative links (bare file paths) render as anchors too — inert
// here, but honest about what the source wrote.
function MarkdownLink({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const isExternal = href !== undefined && /^https?:\/\//i.test(href)
  return (
    <a
      href={href}
      {...(isExternal ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
      className="text-accent underline decoration-line underline-offset-2 hover:text-dir"
      {...rest}
    >
      {children}
    </a>
  )
}

// One element → one set of grove-token utilities. Kept as a module constant so
// the map is built once, not per render.
const MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="mt-4 mb-2 border-b border-line-2 pb-1 text-[16px] font-semibold text-fg first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-4 mb-1.5 border-b border-line-2 pb-1 text-[14.5px] font-semibold text-fg first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 mb-1 text-[13.5px] font-semibold text-fg first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-3 mb-1 text-[13px] font-semibold text-fg first:mt-0">{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="mt-3 mb-1 text-[12.5px] font-semibold text-dim first:mt-0">{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 className="mt-3 mb-1 text-[12.5px] font-semibold text-dim first:mt-0">{children}</h6>
  ),
  p: ({ children }) => <p className="my-2 text-[13.5px] leading-relaxed text-file">{children}</p>,
  a: MarkdownLink,
  strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-dim line-through">{children}</del>,
  ul: ({ children }) => (
    <ul className="my-2 list-disc pl-5 text-[13.5px] leading-relaxed text-file marker:text-faint">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal pl-5 text-[13.5px] leading-relaxed text-file marker:text-faint">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="my-0.5">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-line pl-3 text-[13.5px] text-dim italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-line-2" />,
  // Inline code carries the inset chip; a fenced block renders through `pre`
  // (below), whose child `code` inherits transparent styling so the chip does
  // not double up. react-markdown flags fenced blocks with no `inline` prop, so
  // we distinguish by whether a `pre` ancestor will wrap it — here we style the
  // inline case and let `pre` own the block case.
  code: ({ children, className }) => {
    const isFenced = className?.startsWith('language-') ?? false
    if (isFenced) return <code className="font-mono text-[12.5px] text-file">{children}</code>
    return (
      <code className="rounded bg-inset px-1 py-0.5 font-mono text-[12.5px] text-fg">{children}</code>
    )
  },
  // A fenced block is a code block — unless it is a ```mermaid one, which is a
  // diagram. The block's frame is built here either way and handed to the
  // diagram as its source fallback, so the pending and failed-to-parse states
  // render the identical code block rather than a second copy of its styling
  // (ADR-0027: the frame is the invariant).
  pre: ({ children, node }) => {
    const codeBlock = (
      <pre className="my-2 overflow-auto rounded border border-line-2 bg-void/50 p-3 font-mono whitespace-pre">
        {children}
      </pre>
    )
    const diagramSource = mermaidDiagramSource(node)
    if (diagramSource === null) return codeBlock
    return <MermaidDiagram source={diagramSource} sourceFallback={codeBlock} />
  },
  table: ({ children }) => (
    <div className="my-2 overflow-auto">
      <table className="border-collapse text-[12.5px] text-file">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-line-2 px-2 py-1 text-left font-semibold text-fg">{children}</th>
  ),
  td: ({ children }) => <td className="border border-line-2 px-2 py-1">{children}</td>,
  img: ({ src, alt }) => (
    <img src={typeof src === 'string' ? src : undefined} alt={alt ?? ''} className="max-w-full rounded" />
  ),
}

// Frontmatter is a mapping of arbitrary keys to arbitrary YAML values; there is
// no fixed schema to model (so ADR-0013 does not apply here), which is exactly
// why we lean on a real YAML parser rather than hand-rolling one.
type FrontmatterData = Record<string, unknown>

// Split a leading Jekyll-style YAML frontmatter block (a `---` fence on the very
// first line, closed by a `---` or `...` fence on its own line) from the markdown
// body. Returns the parsed mapping plus the body with the block removed. Anything
// that is not a clean, parseable *mapping* — no fence, malformed YAML, a scalar
// or a truncated block whose closing fence fell outside the bounded preview —
// degrades to `{ data: null, body: source }`, so the raw text renders untouched
// and nothing is ever silently hidden (persona default: fail safe, hide nothing).
function extractFrontmatter(source: string): { data: FrontmatterData | null; body: string } {
  const frontmatterMatch =
    /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n([\s\S]*)|$)/.exec(source)
  if (frontmatterMatch === null) return { data: null, body: source }
  const [, yamlText, bodyText] = frontmatterMatch
  let parsed: unknown
  try {
    parsed = parseYaml(yamlText)
  } catch {
    return { data: null, body: source }
  }
  const isMapping =
    parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && !(parsed instanceof Date)
  if (!isMapping) return { data: null, body: source }
  return { data: parsed as FrontmatterData, body: bodyText ?? '' }
}

// A single scalar rendered as display text. YAML's core schema keeps timestamps
// as strings, but a Date can still arrive through an explicit tag — normalise it
// so a value never renders as `[object Object]`.
function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

// One frontmatter value, painted by shape: an em-dash for empties, chip rows for
// scalar arrays (the common `tags: [a, b]` case), nested definition lists for
// maps and non-scalar arrays, and plain text for scalars.
function FrontmatterValue({ value }: { value: unknown }): ReactNode {
  if (value === null || value === undefined) return <span className="text-faint">—</span>

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-faint">—</span>
    const isScalarList = value.every((item) => item === null || typeof item !== 'object')
    if (isScalarList) {
      return (
        <span className="flex flex-wrap gap-1">
          {value.map((item, itemIndex) => (
            <span key={itemIndex} className="rounded bg-inset px-1.5 py-0.5 text-[11px] text-file">
              {formatScalar(item)}
            </span>
          ))}
        </span>
      )
    }
    return (
      <div className="flex flex-col gap-1">
        {value.map((item, itemIndex) => (
          <FrontmatterValue key={itemIndex} value={item} />
        ))}
      </div>
    )
  }

  if (value instanceof Date) return <span>{formatScalar(value)}</span>
  if (typeof value === 'object') return <FrontmatterEntries data={value as FrontmatterData} nested />
  return <span>{formatScalar(value)}</span>
}

// The key/value rows themselves, as a native `<dl>` (persona: prefer native
// semantics) so assistive tech reads the metadata as the term/definition pairs
// it is. Nested maps hang under a left rule to show their depth.
function FrontmatterEntries({ data, nested = false }: { data: FrontmatterData; nested?: boolean }) {
  return (
    <dl className={`flex flex-col gap-1${nested ? ' border-l border-line-2 pl-2' : ''}`}>
      {Object.keys(data).map((key) => (
        <div key={key} className="flex items-baseline gap-3">
          <dt className="w-28 flex-none truncate text-[11.5px] text-dim">{key}</dt>
          <dd className="min-w-0 flex-1 text-[11.5px] break-words text-file">
            <FrontmatterValue value={data[key]} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

// The metadata card that sits above the rendered document — visually distinct
// from the prose so it reads as the document's frontmatter, not its content.
function FrontmatterCard({ data }: { data: FrontmatterData }) {
  return (
    <section
      aria-label="Document frontmatter"
      className="mb-3 rounded border border-line-2 bg-void/40 px-3 py-2.5"
    >
      <div className="pb-1.5 text-[10.5px] tracking-wide text-faint uppercase">frontmatter</div>
      <FrontmatterEntries data={data} />
    </section>
  )
}

export function MarkdownPreview({ source }: { source: string }): ReactNode {
  const { data, body } = useMemo(() => extractFrontmatter(source), [source])
  return (
    <div className="px-4 py-2 font-sans">
      {data !== null && <FrontmatterCard data={data} />}
      <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {body}
      </Markdown>
    </div>
  )
}
