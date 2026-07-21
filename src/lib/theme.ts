import { useCallback, useEffect, useState } from 'react'
import { z } from 'zod/v4'

// Persisted-client-state schema (ADR-0013/0029): the mode the user picked,
// validated on read so a stale/garbage localStorage value falls back cleanly
// to the default rather than throwing. `system` follows the OS preference.
export const THEME_MODES = ['system', 'light', 'dark'] as const
export const ThemeModeSchema = z.enum(THEME_MODES).default('system').catch('system')
export type ThemeMode = z.infer<typeof ThemeModeSchema>

// A resolved theme is always concrete — `system` has been collapsed to whichever
// the OS currently prefers. This is what lands on <html data-theme>.
export type ResolvedTheme = 'dark' | 'light'

// Keep this key in sync with the pre-paint shim in index.html.
const THEME_STORAGE_KEY = 'binp-file-explorer:theme'
const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'

function readStoredThemeMode(): ThemeMode {
  return ThemeModeSchema.parse(window.localStorage.getItem(THEME_STORAGE_KEY) ?? undefined)
}

function systemResolvedTheme(): ResolvedTheme {
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? 'dark' : 'light'
}

function resolveThemeMode(themeMode: ThemeMode): ResolvedTheme {
  return themeMode === 'system' ? systemResolvedTheme() : themeMode
}

function applyResolvedTheme(resolvedTheme: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolvedTheme
  // Aligns native affordances (scrollbars, form controls, caret) with the theme.
  document.documentElement.style.colorScheme = resolvedTheme
}

// Owns the app's color-theme state: the persisted mode plus the side effect of
// projecting the resolved theme onto <html>. Re-resolves live when the mode is
// `system` and the OS preference flips.
//
// `manageDocument` (default true) is the standalone/embedded switch. Standalone,
// the explorer owns the page and writes `<html data-theme>` itself. Embedded,
// the *host* owns that attribute — and the explorer's grove tokens ride the very
// same `[data-theme]` selector (see index.css), so it simply inherits the host's
// resolved scheme. Writing the attribute there would fight the host, so an
// embedded mount passes `false`: no document write, no localStorage, no
// matchMedia listener — the hook goes read-only.
export function useTheme(
  options: { manageDocument?: boolean } = {},
): { themeMode: ThemeMode; setThemeMode: (nextThemeMode: ThemeMode) => void } {
  const { manageDocument = true } = options
  const [themeMode, setThemeModeState] = useState<ThemeMode>(readStoredThemeMode)

  useEffect(() => {
    if (!manageDocument) return
    applyResolvedTheme(resolveThemeMode(themeMode))
    if (themeMode !== 'system') return

    const darkMediaQuery = window.matchMedia(DARK_MEDIA_QUERY)
    function handlePreferenceChange() {
      applyResolvedTheme(systemResolvedTheme())
    }
    darkMediaQuery.addEventListener('change', handlePreferenceChange)
    return () => darkMediaQuery.removeEventListener('change', handlePreferenceChange)
  }, [themeMode, manageDocument])

  const setThemeMode = useCallback(
    (nextThemeMode: ThemeMode) => {
      if (manageDocument) window.localStorage.setItem(THEME_STORAGE_KEY, nextThemeMode)
      setThemeModeState(nextThemeMode)
    },
    [manageDocument],
  )

  return { themeMode, setThemeMode }
}
