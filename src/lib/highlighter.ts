import { createHighlighter, type Highlighter, type ThemedToken } from 'shiki'

// The one syntax highlighter for the app — one wrapper and one guard, per
// `one-descriptor-one-wrapper-one-guard`. It is a whole-window tokenizer:
// Shiki's `codeToTokens` returns one token array per line, which maps 1:1 onto
// the preview panel's existing per-line gutter renderer, so no HTML
// re-splitting is needed.
//
// Highlighting is enrichment (AGENTS.md responsiveness principle): the panel
// paints plain text first and decorates from these tokens after, the singleton
// loads grammars lazily and off the main paint, and an unknown grammar degrades
// to plain text rather than throwing. Per `bundled-never-cdn`, grammars and the
// engine are bundled and code-split by Vite, never fetched from a CDN at
// runtime.

// Dual themes so a single tokenization serves both app themes: every token
// carries `--shiki-light` / `--shiki-dark` custom properties (defaultColor
// false, below) and theme.css chooses which one paints. github-light/dark match
// the app's dark-default / [data-theme="light"] discipline.
export const HIGHLIGHT_THEMES = { light: 'github-light', dark: 'github-dark' } as const

// Warmed at app mount so the first grammar load — the bundled engine plus these
// grammars — is off the first preview a user selects. These are the languages a
// codebase served by the explorer is mostly made of; everything else loads on
// demand in `loadHighlighter`.
const WARM_LANGUAGES = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'json',
  'jsonc',
  'css',
  'html',
  'markdown',
  'bash',
  'python',
  'yaml',
] as const

let highlighterPromise: Promise<Highlighter> | null = null
// Grammars already asked for, so a repeated preview of the same language does
// not re-enter the lazy `loadLanguage` path.
const requestedLanguages = new Set<string>(WARM_LANGUAGES)

// The shared highlighter, started on first call and reused thereafter. A
// `language` beyond the warm set is loaded lazily before the caller tokenizes
// with it; an unknown grammar is swallowed (the preview renders unhighlighted,
// which is what `'txt'` does anyway), never thrown.
export async function loadHighlighter(language?: string): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({
    themes: [HIGHLIGHT_THEMES.light, HIGHLIGHT_THEMES.dark],
    langs: [...WARM_LANGUAGES],
  })
  const highlighter = await highlighterPromise
  if (language !== undefined && language !== 'txt' && !requestedLanguages.has(language)) {
    requestedLanguages.add(language)
    try {
      await highlighter.loadLanguage(language as Parameters<Highlighter['loadLanguage']>[0])
    } catch {
      // No such grammar — the caller falls back to plain text below.
    }
  }
  return highlighter
}

// Fire-and-forget warm-up for app mount: kicks off the engine + warm grammars
// so the first real preview does not pay for them. Failures are irrelevant — a
// preview that arrives before warm-up finishes simply awaits the same promise.
export function warmHighlighter(): void {
  void loadHighlighter().catch(() => {})
}

// Tokenizing is one synchronous pass over the whole window, so it scales with
// the window: past this many lines it would hold the main thread long enough to
// be felt, and a reader who asked to see a 40 000-line file whole asked for its
// *text*, not its colours. Above it the panel renders plain and says so, rather
// than dropping the colours silently (`never-hide-a-control`).
export const HIGHLIGHT_MAX_LINES = 10_000

// Tokenizes one preview window into per-line `ThemedToken` arrays, or `null`
// when it should render as plain text: a `'txt'` hint, an unknown grammar that
// never loaded, a window past `HIGHLIGHT_MAX_LINES`, or a line-count mismatch (a
// defensive guard so a token line can never land on the wrong source line). One
// job — the panel owns rendering.
export async function tokenizePreviewLines(
  code: string,
  language: string,
  expectedLineCount: number,
): Promise<ThemedToken[][] | null> {
  if (language === 'txt') return null
  if (expectedLineCount > HIGHLIGHT_MAX_LINES) return null
  const highlighter = await loadHighlighter(language)
  if (!highlighter.getLoadedLanguages().includes(language)) return null
  const { tokens } = highlighter.codeToTokens(code, {
    // Narrowed at runtime by the `getLoadedLanguages` guard above; the string
    // type just needs bridging to Shiki's bundled-language union.
    lang: language as Parameters<Highlighter['codeToTokens']>[1]['lang'],
    themes: HIGHLIGHT_THEMES,
    // No base `color` on the tokens — only the `--shiki-light` / `--shiki-dark`
    // custom properties, so theme.css picks the active color per theme.
    defaultColor: false,
  })
  if (tokens.length !== expectedLineCount) return null
  return tokens
}
