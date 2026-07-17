import { ThemeToggle } from './ThemeToggle'
import type { ThemeMode } from '../lib/theme'

type TitleBarProps = {
  rootPath: string | null
  themeMode: ThemeMode
  onSelectThemeMode: (nextThemeMode: ThemeMode) => void
}

export function TitleBar({ rootPath, themeMode, onSelectThemeMode }: TitleBarProps) {
  return (
    <div className="flex flex-none items-center gap-3 border-b border-line bg-chrome px-4 py-2.5">
      <div className="flex gap-[7px]" aria-hidden="true">
        <span className="size-[11px] rounded-full border border-white/5 bg-[#ff5f57]" />
        <span className="size-[11px] rounded-full border border-white/5 bg-[#febc2e]" />
        <span className="size-[11px] rounded-full border border-white/5 bg-[#28c840]" />
      </div>
      <div className="flex-1 truncate text-center text-xs tracking-[0.02em] text-dim">
        <b className="font-semibold text-fg">binp-file-explorer</b>
        {rootPath === null ? '' : ` — ${rootPath}`}
      </div>
      <div className="flex flex-none items-center gap-2.5 text-[11px] text-faint">
        <span className="hidden font-semibold text-prompt sm:inline">grove</span>
        <ThemeToggle themeMode={themeMode} onSelectThemeMode={onSelectThemeMode} />
      </div>
    </div>
  )
}
