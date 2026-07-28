import type { AnchorHTMLAttributes, ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

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
  pre: ({ children }) => (
    <pre className="my-2 overflow-auto rounded border border-line-2 bg-void/50 p-3 font-mono whitespace-pre">
      {children}
    </pre>
  ),
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

export function MarkdownPreview({ source }: { source: string }): ReactNode {
  return (
    <div className="px-4 py-2 font-sans">
      <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {source}
      </Markdown>
    </div>
  )
}
