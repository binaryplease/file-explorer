import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { IconAlertTriangle } from '@tabler/icons-react'
import { nextMermaidDiagramId, renderMermaidSvg } from '../lib/mermaid'
import { useResolvedTheme } from '../lib/theme'

// One ```mermaid fenced block, painted as a diagram. Presentational: the
// diagram source in, an SVG out — it knows nothing about files or previews, and
// the caller hands it the very code block it would otherwise have rendered
// (`sourceFallback`), so the fenced-block frame has exactly one definition
// (ADR-0027) and this component owns only the diagram/error states.
//
// Three states, and the source is visible in two of them:
//   pending — the fenced source, already on screen, unchanged. The engine is
//             dynamically imported, so the document never waits on it
//             (AGENTS.md responsiveness principle).
//   drawn   — the SVG replaces the source.
//   failed  — the source plus the parse error. Nothing is hidden: a diagram
//             that cannot be drawn is still text the reader can read.

// Mermaid's parse errors open with the useful sentence ("Parse error on line 3:")
// and continue with a caret diagram and a dump of every token it expected —
// paragraphs of noise above a code block that already shows the offending line.
// The first line is what the reader acts on; the rest stays on the title so it
// is one hover away rather than gone.
function firstLineOf(message: string): string {
  const [firstLine] = message.split('\n')
  return firstLine?.trim() ?? ''
}

function DiagramError({ message, sourceFallback }: { message: string; sourceFallback: ReactNode }) {
  return (
    <div className="my-2">
      <div className="flex items-start gap-1.5 pb-1 text-[11px] text-dim" title={message}>
        <IconAlertTriangle size={13} stroke={1.6} className="mt-px flex-none text-faint" />
        <span>
          This mermaid diagram couldn&apos;t be drawn — showing its source. {firstLineOf(message)}
        </span>
      </div>
      {sourceFallback}
    </div>
  )
}

export function MermaidDiagram({
  source,
  sourceFallback,
}: {
  source: string
  sourceFallback: ReactNode
}) {
  // Mermaid paints colours into the SVG it returns, so a theme flip needs a
  // fresh render — CSS tokens cannot reach inside finished markup.
  const resolvedTheme = useResolvedTheme()
  // One id per mounted diagram, held for its lifetime: Mermaid stamps it into
  // the SVG's id and its scoped selectors, so re-using one across two diagrams
  // would cross-style them.
  const diagramId = useMemo(() => nextMermaidDiagramId(), [])
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    // The same supersede-on-move guard the syntax highlighter uses: a render
    // that lands after the source or theme changed is dropped rather than
    // painting a stale diagram.
    let cancelled = false
    renderMermaidSvg(source, diagramId, resolvedTheme)
      .then((svg) => {
        if (cancelled) return
        setSvgMarkup(svg)
        setRenderError(null)
      })
      .catch((diagramError: unknown) => {
        if (cancelled) return
        setSvgMarkup(null)
        setRenderError(diagramError instanceof Error ? diagramError.message : String(diagramError))
      })
    return () => {
      cancelled = true
    }
  }, [source, diagramId, resolvedTheme])

  if (renderError !== null) {
    return <DiagramError message={renderError} sourceFallback={sourceFallback} />
  }
  if (svgMarkup === null) return <>{sourceFallback}</>

  return (
    <figure
      // `figure` names the diagram for assistive tech; Mermaid's own
      // `accTitle`/`accDescr` directives, when the author wrote them, land
      // inside the SVG as its title/desc and are read within this region.
      aria-label="Mermaid diagram"
      // Same frame as the fenced code block it replaces, so a document of mixed
      // fences reads as one surface. `[&>svg]` sizes whatever Mermaid returned:
      // its inline `max-width` is respected, the height follows the viewBox.
      className="my-2 overflow-auto rounded border border-line-2 bg-void/50 p-3 [&>svg]:mx-auto [&>svg]:h-auto"
      // The one `dangerouslySetInnerHTML` in the app, and a deliberate one:
      // Mermaid hands back finished SVG markup as a string, and it is the
      // renderer — not this component — that decides what is in it. What makes
      // it safe is the `securityLevel: 'strict'` engine config (src/lib/mermaid.ts):
      // every label is DOMPurify-sanitised, HTML in labels stays escaped, and
      // interaction directives are disabled, so untrusted previewed content
      // cannot inject script or markup through this seam.
      dangerouslySetInnerHTML={{ __html: svgMarkup }}
    />
  )
}
