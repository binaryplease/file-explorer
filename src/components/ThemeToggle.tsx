import { IconDeviceDesktop, IconMoon, IconSun, type IconProps } from '@tabler/icons-react'
import type { ComponentType } from 'react'
import { THEME_MODES, type ThemeMode } from '../lib/theme'

const THEME_MODE_OPTIONS: Record<ThemeMode, { label: string; Icon: ComponentType<IconProps> }> = {
  system: { label: 'Match system theme', Icon: IconDeviceDesktop },
  light: { label: 'Light theme', Icon: IconSun },
  dark: { label: 'Dark theme', Icon: IconMoon },
}

type ThemeToggleProps = {
  themeMode: ThemeMode
  onSelectThemeMode: (nextThemeMode: ThemeMode) => void
}

// Segmented control for the color theme. `affordances-adjacent` puts a control
// on the region it governs, and theme governs the whole app — so this one
// genuinely earns global chrome and lives in the title bar. All three options
// stay visible; the active one is highlighted (`never-hide-a-control`).
// Icon-only buttons carry an aria-label so their meaning reaches assistive tech.
export function ThemeToggle({ themeMode, onSelectThemeMode }: ThemeToggleProps) {
  return (
    <div
      role="group"
      aria-label="Color theme"
      className="flex flex-none items-center gap-0.5 rounded-md border border-line p-0.5"
    >
      {THEME_MODES.map((optionThemeMode) => {
        const { label, Icon } = THEME_MODE_OPTIONS[optionThemeMode]
        const isActive = themeMode === optionThemeMode
        return (
          <button
            key={optionThemeMode}
            type="button"
            aria-label={label}
            aria-pressed={isActive}
            title={label}
            onClick={() => onSelectThemeMode(optionThemeMode)}
            className={`flex cursor-pointer items-center rounded-[5px] p-1 transition-colors ${
              isActive
                ? 'bg-accent/15 text-accent'
                : 'text-dim hover:bg-hover hover:text-fg'
            }`}
          >
            <Icon className="size-3.5" stroke={2} aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
