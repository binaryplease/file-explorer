// Copies text to the system clipboard, resolving to whether it landed. The
// async Clipboard API is the path on a secure context (the tool runs on
// loopback, which counts as secure); a synchronous `execCommand` copy off a
// throwaway textarea is the fallback for any context where it is unavailable or
// rejected, so a copy action never silently does nothing.
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the legacy path below.
  }
  return copyViaTextarea(text)
}

function copyViaTextarea(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  // Keep it out of the layout and off screen readers while still selectable.
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '0'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  try {
    textarea.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}
