import { useEffect, useState } from 'react'
import { z } from 'zod/v4'

// Persisted-client-state schema (`zod-single-source`, `zod-defaults`): the
// view-mode toggles that reconfigure the tree and its side panels. Every field
// declares a default so a stale localStorage blob written before the schema
// grew still parses, filling any newly-added toggle with its default rather
// than throwing. The tree-listing
// toggles default off — the tree opens as a clean name-only listing until the
// user opts in.
export const ViewSettingsSchema = z.object({
  showSizes: z.boolean().default(false),
  showHidden: z.boolean().default(false),
  showGitignored: z.boolean().default(false),
  // The preview column. Off by default like the rest: the core browse loop
  // paints alone until the user asks for enrichment.
  showPreview: z.boolean().default(false),
  // Soft-wrap long lines in the text preview. On by default so a reader sees
  // the whole line without the panel's horizontal scrollbar; a code reader who
  // wants exact columns turns it off (restoring `whitespace-pre` + h-scroll).
  wrapPreview: z.boolean().default(true),
  // Render a markdown file's preview as formatted markdown rather than its raw
  // source. On by default — a `.md` reads as the document it is; a reader who
  // wants the raw source (and its syntax highlighting) turns it off, restoring
  // the plain text-preview renderer that every other text file uses.
  renderMarkdown: z.boolean().default(true),
  // The tree/preview split, as the fraction of the row's width the preview
  // column takes. `null` means "no dragged preference yet" — the split falls
  // back to the entry-intent default (preview-dominant when opened on a file,
  // tree-dominant when opened on a directory). Once the user drags the divider
  // the stored ratio wins, here and across reloads.
  previewRatio: z.number().nullable().default(null),
})
export type ViewSettings = z.infer<typeof ViewSettingsSchema>

const VIEW_SETTINGS_STORAGE_KEY = 'binp-file-explorer:view-settings'

// Read the persisted toggles, tolerating a missing, malformed, or partial blob:
// anything that doesn't parse falls back through the schema defaults rather than
// throwing, so a garbage localStorage value can never break startup.
function readStoredViewSettings(): ViewSettings {
  const storedValue = window.localStorage.getItem(VIEW_SETTINGS_STORAGE_KEY)
  if (storedValue === null) return ViewSettingsSchema.parse({})
  try {
    return ViewSettingsSchema.parse(JSON.parse(storedValue))
  } catch {
    return ViewSettingsSchema.parse({})
  }
}

// Owns the persisted view-mode toggles: seeds state from localStorage on mount
// and writes back whenever any toggle flips, so the choices survive reloads and
// same-tab file navigation.
export function useViewSettings(): {
  viewSettings: ViewSettings
  setViewSettings: (updateViewSettings: (previousViewSettings: ViewSettings) => ViewSettings) => void
} {
  const [viewSettings, setViewSettings] = useState<ViewSettings>(readStoredViewSettings)

  useEffect(() => {
    window.localStorage.setItem(VIEW_SETTINGS_STORAGE_KEY, JSON.stringify(viewSettings))
  }, [viewSettings])

  return { viewSettings, setViewSettings }
}
