import { useCallback, useEffect, useState } from 'react'
import { z } from 'zod'

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
export function useTheme(): { themeMode: ThemeMode; setThemeMode: (nextThemeMode: ThemeMode) => void } {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(readStoredThemeMode)

  useEffect(() => {
    applyResolvedTheme(resolveThemeMode(themeMode))
    if (themeMode !== 'system') return

    const darkMediaQuery = window.matchMedia(DARK_MEDIA_QUERY)
    function handlePreferenceChange() {
      applyResolvedTheme(systemResolvedTheme())
    }
    darkMediaQuery.addEventListener('change', handlePreferenceChange)
    return () => darkMediaQuery.removeEventListener('change', handlePreferenceChange)
  }, [themeMode])

  const setThemeMode = useCallback((nextThemeMode: ThemeMode) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextThemeMode)
    setThemeModeState(nextThemeMode)
  }, [])

  return { themeMode, setThemeMode }
}
