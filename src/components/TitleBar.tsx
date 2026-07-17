type TitleBarProps = {
  rootPath: string | null
}

export function TitleBar({ rootPath }: TitleBarProps) {
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
      <div className="flex flex-none items-center gap-1.5 text-[11px] text-faint">
        <span className="font-semibold text-prompt">grove</span>
        <span>· local only</span>
      </div>
    </div>
  )
}
