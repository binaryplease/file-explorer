// The explorer's "which directory is focused" history — factored out as a seam
// so the same App drives it two ways (ADR-0007 factories, ADR-0010 one job
// each):
//
//   - standalone: the focus lives in the page URL (`?path=`), so it is
//     deep-linkable and the browser's own back/forward walk it. This is the
//     historical behaviour, unchanged.
//   - embedded: the explorer is one surface inside a host app that owns the URL
//     and the back button. Touching `window.location`/`window.history` there
//     would hijack the host's navigation, so the focus history lives in memory
//     and the explorer's own "back" verb walks it.
//
// Both expose the same four operations; App never branches on which one it has.

export type FocusNavigation = {
  // The focus path the explorer opens at.
  initialFocusPath(): string
  // Record a move to a new focus path (URL push, or an in-memory stack push).
  push(focusPath: string): void
  // The "back" verb: return to the previously focused path. It drives the focus
  // change through the subscribed callback, exactly as an external
  // back/forward would — so App has one code path for "focus changed under me".
  back(): void
  // Whether `back()` has somewhere to go. The embedded Esc seam reads this to
  // decide between popping focus history and handing an exhausted Escape to the
  // host's `onRequestClose`, and to keep the command-bar hint honest.
  canGoBack(): boolean
  // Subscribe to focus changes that originate outside App (browser
  // back/forward, or `back()`). Returns an unsubscribe.
  subscribe(onExternalFocus: (focusPath: string) => void): () => void
}

// ── URL-backed (standalone) ─────────────────────────────────────────────────

function readFocusPathFromUrl(): string {
  return new URLSearchParams(window.location.search).get('path') ?? ''
}

export function createUrlFocusNavigation(): FocusNavigation {
  return {
    initialFocusPath: readFocusPathFromUrl,
    push(focusPath) {
      const nextUrl =
        focusPath === ''
          ? window.location.pathname
          : `${window.location.pathname}?path=${encodeURIComponent(focusPath)}`
      const currentUrl = `${window.location.pathname}${window.location.search}`
      if (nextUrl !== currentUrl) window.history.pushState({}, '', nextUrl)
    },
    back() {
      // Round-trips through the browser: history.back() fires popstate, which
      // the subscribed handler turns into a focus change.
      window.history.back()
    },
    canGoBack() {
      // The browser owns this history and does not expose whether a prior
      // in-app entry exists. The standalone app never wires `onRequestClose`,
      // so this answer only ever gates a browser `back()` that is itself a
      // no-op at the first entry — reporting "yes" keeps today's behaviour.
      return true
    },
    subscribe(onExternalFocus) {
      function handlePopState() {
        onExternalFocus(readFocusPathFromUrl())
      }
      window.addEventListener('popstate', handlePopState)
      return () => window.removeEventListener('popstate', handlePopState)
    },
  }
}

// ── In-memory (embedded) ────────────────────────────────────────────────────

// A memory-backed focus stack whose top is the current focus. `push` deepens
// it; `back` pops the current entry and re-focuses the one beneath, firing the
// subscriber so App re-focuses without also pushing (which would loop).
export function createInternalFocusNavigation(initialFocusPath: string): FocusNavigation {
  const focusStack: string[] = [initialFocusPath]
  let notifyExternalFocus: ((focusPath: string) => void) | null = null
  return {
    initialFocusPath() {
      return initialFocusPath
    },
    push(focusPath) {
      focusStack.push(focusPath)
    },
    back() {
      if (focusStack.length <= 1) return
      focusStack.pop()
      notifyExternalFocus?.(focusStack[focusStack.length - 1]!)
    },
    canGoBack() {
      return focusStack.length > 1
    },
    subscribe(onExternalFocus) {
      notifyExternalFocus = onExternalFocus
      return () => {
        if (notifyExternalFocus === onExternalFocus) notifyExternalFocus = null
      }
    },
  }
}
