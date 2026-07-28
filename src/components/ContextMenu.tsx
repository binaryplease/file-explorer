import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export type ContextMenuItem = {
  // Stable identity for the row key, distinct from the visible label.
  key: string
  label: string
  icon: ReactNode
  onSelect: () => void
}

// Where the menu was summoned and what it offers. Held by the surface that owns
// the right-click; `null` means no menu is open.
export type ContextMenuAnchor = {
  clientX: number
  clientY: number
  items: ContextMenuItem[]
}

type ContextMenuProps = {
  anchor: ContextMenuAnchor
  onClose: () => void
}

// Margin kept between the menu and the viewport edge when it would overflow.
const VIEWPORT_MARGIN = 8

// A floating menu pinned at the cursor. Generic on purpose (ADR-0027): it knows
// positioning, viewport clamping, and dismissal, but nothing about paths — the
// caller supplies labelled items with their own actions. It closes on any
// outside pointer press, Escape, scroll, resize, or selecting an item, so it
// never lingers after the context that summoned it has moved.
export function ContextMenu({ anchor, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ left: anchor.clientX, top: anchor.clientY })

  // Clamp into the viewport once the menu has measured itself, so a right-click
  // near the bottom or right edge flips the menu back on screen rather than
  // spilling off it.
  useLayoutEffect(() => {
    const menuElement = menuRef.current
    if (menuElement === null) return
    const { width, height } = menuElement.getBoundingClientRect()
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN
    const maxTop = window.innerHeight - height - VIEWPORT_MARGIN
    setPosition({
      left: Math.max(VIEWPORT_MARGIN, Math.min(anchor.clientX, maxLeft)),
      top: Math.max(VIEWPORT_MARGIN, Math.min(anchor.clientY, maxTop)),
    })
  }, [anchor.clientX, anchor.clientY])

  useEffect(() => {
    function handlePointerDown(pointerEvent: PointerEvent) {
      if (menuRef.current?.contains(pointerEvent.target as Node)) return
      onClose()
    }
    function handleKeyDown(keyboardEvent: KeyboardEvent) {
      if (keyboardEvent.key === 'Escape') {
        keyboardEvent.preventDefault()
        onClose()
      }
    }
    // Capture so an outside press dismisses before it lands on whatever is
    // underneath; scroll/resize invalidate the anchor point entirely.
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{ left: position.left, top: position.top }}
      className="fixed z-50 min-w-[190px] overflow-hidden rounded-[7px] border border-line bg-chrome py-1 shadow-[0_18px_50px_-16px_rgba(0,0,0,0.85)]"
    >
      {anchor.items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          onClick={() => {
            item.onSelect()
            onClose()
          }}
          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] text-fg transition-colors hover:bg-hover"
        >
          <span className="flex-none text-dim">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </div>
  )
}
