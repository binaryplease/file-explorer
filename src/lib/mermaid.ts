import type { ResolvedTheme } from './theme'

// The one Mermaid renderer for the app — one wrapper and one guard, per
// `one-descriptor-one-wrapper-one-guard`. It turns the text of a ```mermaid
// fenced block into an SVG string that the markdown preview paints.
//
// Diagrams are enrichment (AGENTS.md responsiveness principle): the fenced
// source paints first as an ordinary code block, the Mermaid engine is
// dynamically imported so none of its weight is in the app's entry chunk, and a
// diagram that fails to parse degrades to that same code block plus an
// explanation rather than throwing or blanking the document. Per
// `bundled-never-cdn`, the engine is bundled and code-split by Vite, never
// fetched from a CDN.

export const MERMAID_LANGUAGE = 'mermaid'

// The minimal shape this module reads off a hast `<pre>` node — structurally
// satisfied by react-markdown's `node` prop, and small enough to construct in a
// test without pulling hast in. Everything is optional because the extractor's
// whole job is deciding whether a node is the shape it wants.
type MarkdownNode = {
  tagName?: string | undefined
  properties?: { className?: unknown } | undefined
  children?: readonly MarkdownNode[] | undefined
  type?: string | undefined
  value?: unknown
}

// A fenced block's language classes arrive as `['language-mermaid']` from hast,
// but a hand-built or rehype-processed node may carry a plain string.
function classNamesOf(node: MarkdownNode): readonly string[] {
  const className = node.properties?.className
  if (Array.isArray(className)) return className.filter((entry) => typeof entry === 'string')
  if (typeof className === 'string') return className.split(/\s+/)
  return []
}

// The diagram source of a ```mermaid fenced block, or `null` for every other
// node — an ordinary fenced block, an indented one, an empty fence. One job:
// deciding *whether* this is a diagram and handing back its text; the caller
// decides what to render.
export function mermaidDiagramSource(preNode: MarkdownNode | undefined): string | null {
  if (preNode === undefined || preNode.tagName !== 'pre') return null
  const [codeNode] = preNode.children ?? []
  if (codeNode === undefined || codeNode.tagName !== 'code') return null
  if (!classNamesOf(codeNode).includes(`language-${MERMAID_LANGUAGE}`)) return null
  const source = (codeNode.children ?? [])
    .filter((child) => child.type === 'text' && typeof child.value === 'string')
    .map((child) => child.value as string)
    .join('')
    // remark keeps the fence's trailing newline; Mermaid does not care, but a
    // blank diagram should read as blank rather than as a one-newline diagram.
    .trim()
  return source === '' ? null : source
}

// Text in a diagram reads at the size of the rendered markdown around it
// (MarkdownPreview paints prose at 13.5px), so a diagram sits inside the
// document's type scale rather than towering over the paragraph that introduces
// it. Mermaid's own default is 16px, which belongs to no surface here.
const DIAGRAM_FONT_SIZE = 13.5

// Mermaid paints its own SVG — it cannot read the app's Tailwind utilities — so
// the grove palette is handed to it as theme variables read from the very same
// custom properties theme.css defines (docs/requirements/102-theme-token-model.md:
// one definition, no second palette to drift). Only the solid tokens are used:
// the overlay tokens (`--color-line`, `--color-hover`, `--color-inset`) are
// alpha-baked for compositing over a surface, which Mermaid's color maths
// handles poorly.
function groveToken(tokenName: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(tokenName).trim()
}

function groveThemeVariables(resolvedTheme: ResolvedTheme): Record<string, string> {
  const surface = groveToken('--color-term')
  const raisedSurface = groveToken('--color-term-2')
  const sunkenSurface = groveToken('--color-void')
  const chromeSurface = groveToken('--color-chrome')
  const foreground = groveToken('--color-fg')
  const dimForeground = groveToken('--color-dim')
  const faintForeground = groveToken('--color-faint')
  const accent = groveToken('--color-accent')

  return {
    darkMode: resolvedTheme === 'dark' ? 'true' : 'false',
    background: surface,
    // Node fills and their text/borders — the bulk of any flowchart.
    primaryColor: raisedSurface,
    primaryTextColor: foreground,
    primaryBorderColor: accent,
    secondaryColor: chromeSurface,
    secondaryTextColor: foreground,
    secondaryBorderColor: dimForeground,
    tertiaryColor: sunkenSurface,
    tertiaryTextColor: dimForeground,
    tertiaryBorderColor: faintForeground,
    mainBkg: raisedSurface,
    nodeBorder: accent,
    nodeTextColor: foreground,
    // Edges, labels and the boxes that group nodes.
    lineColor: dimForeground,
    textColor: foreground,
    titleColor: foreground,
    edgeLabelBackground: surface,
    clusterBkg: sunkenSurface,
    clusterBorder: faintForeground,
    // Mermaid sizes HTML node labels from this theme variable and everything
    // else from the top-level `fontSize` below — both are needed to move a
    // diagram off Mermaid's 16px default onto the document's scale.
    fontSize: `${DIAGRAM_FONT_SIZE}px`,
  }
}

type MermaidModule = typeof import('mermaid')['default']

let mermaidModulePromise: Promise<MermaidModule> | null = null
// The theme the engine is currently configured for. Mermaid's config is global,
// so a theme flip reconfigures it once and every diagram re-renders off that.
let configuredTheme: ResolvedTheme | null = null

// The shared engine, dynamically imported on the first diagram and reused
// after. Configuration is re-applied whenever the resolved theme changes.
async function loadMermaid(resolvedTheme: ResolvedTheme): Promise<MermaidModule> {
  mermaidModulePromise ??= import('mermaid').then((module) => module.default)
  const mermaid = await mermaidModulePromise
  if (configuredTheme !== resolvedTheme) {
    mermaid.initialize({
      // Nothing is scanned or rendered off page load; the preview asks for each
      // diagram explicitly, and only while it is on screen.
      startOnLoad: false,
      // Security fails safe (persona default): `strict` runs every label
      // through Mermaid's DOMPurify pass, keeps HTML in labels escaped, and
      // disables `click`/`callback` interaction directives — a previewed file
      // is untrusted content and must not be able to script the explorer.
      securityLevel: 'strict',
      // A broken diagram must not paint Mermaid's own error graphic into the
      // document; the caller catches the rejection and shows the source instead.
      suppressErrorRendering: true,
      theme: 'base',
      themeVariables: groveThemeVariables(resolvedTheme),
      fontFamily: groveToken('--font-sans'),
      fontSize: DIAGRAM_FONT_SIZE,
      // The per-diagram font knobs Mermaid does not derive from `fontSize`.
      sequence: {
        actorFontSize: DIAGRAM_FONT_SIZE,
        messageFontSize: DIAGRAM_FONT_SIZE,
        noteFontSize: DIAGRAM_FONT_SIZE,
      },
    })
    configuredTheme = resolvedTheme
  }
  return mermaid
}

// Renders one diagram to an SVG string, or rejects with the parse/render error
// so the caller can show the source and say why. `diagramId` must be unique per
// diagram on the page — Mermaid stamps it into the SVG's id and its scoped CSS
// selectors, so a collision would cross-style two diagrams.
export async function renderMermaidSvg(
  source: string,
  diagramId: string,
  resolvedTheme: ResolvedTheme,
): Promise<string> {
  const mermaid = await loadMermaid(resolvedTheme)
  const { svg } = await mermaid.render(diagramId, source)
  return svg
}

// Monotonic per-page ids. A counter, not a random or content-derived value: two
// identical diagrams in one document still need two distinct ids, and the
// module never runs outside a single page.
let diagramSequence = 0
export function nextMermaidDiagramId(): string {
  diagramSequence += 1
  return `mermaid-diagram-${diagramSequence}`
}
