import { useMemo } from 'react'
import { App } from './App'
import { ApiBaseContext } from './lib/apiBase'
import { createInternalFocusNavigation } from './lib/focusNavigation'

// The library entry point: the whole file-browsing + preview surface as one
// component a host app mounts into its own page (no iframe). It composes the
// same <App> the standalone shell does, but wired for embedding:
//
//   - `apiBaseUrl` points every request at the separately-running explorer
//     server (a different origin/port), so no traffic is proxied through the
//     host.
//   - the focus history is in-memory, not the page URL — the host owns its own
//     URL and back button.
//   - `embedded` drops the standalone chrome (the host frames it) and makes the
//     theme read-only so the explorer inherits the host's `[data-theme]`.
//
// Styling: the host's own Tailwind build emits the explorer's utilities and
// ships the grove tokens (`binp-file-explorer/theme.css` + an `@source` over
// this `src/`), so this entry imports no CSS of its own — importing `index.css`
// here would pull a second `@import "tailwindcss"` into the host bundle.
//
// Re-opening at a different path: the caller keys this element on the path so a
// new open remounts fresh (the initial focus/selection seed the state once).
export type FileExplorerProps = {
  // Absolute origin of the explorer server, e.g. `http://127.0.0.1:4600`. '' =
  // same-origin (unused by hosts, kept so the type mirrors the standalone case).
  apiBaseUrl?: string
  // The directory to open focused, relative to the server's served root.
  initialFocusPath?: string
  // A file to open selected and previewed, relative to the served root. `null`
  // opens the directory with nothing pre-selected.
  initialSelectedPath?: string | null
  // Called when the explorer's own layered Escape is exhausted — no filter to
  // clear, the selection already on the root line, and the in-memory focus
  // history empty. The host wires its modal's close here so the explorer owns
  // Escape end to end (and can advertise `esc close` truthfully). Omitted, the
  // final Escape is simply a no-op, as it was before.
  onRequestClose?: () => void
}

export function FileExplorer({
  apiBaseUrl = '',
  initialFocusPath = '',
  initialSelectedPath = null,
  onRequestClose,
}: FileExplorerProps) {
  const navigation = useMemo(
    () => createInternalFocusNavigation(initialFocusPath),
    [initialFocusPath],
  )
  return (
    <ApiBaseContext.Provider value={apiBaseUrl}>
      <App
        navigation={navigation}
        initialSelectedPath={initialSelectedPath}
        onRequestClose={onRequestClose}
        embedded
      />
    </ApiBaseContext.Provider>
  )
}
