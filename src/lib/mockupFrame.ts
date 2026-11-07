// The window-preview mockup flag for the standalone shell. By default the
// explorer fills the whole viewport. `?mockup=1` (or `?mockup=true`) in the page
// URL renders it as a centred window card instead — rounded frame, drop shadow,
// gradient backdrop and traffic-light dots — for product screenshots.
//
// It is a query parameter so it switches at runtime in dev and in the production
// build alike, with no rebuild and no server config. It is deliberately not
// persisted: a reload without the parameter returns to the full-viewport layout.

export const MOCKUP_FRAME_QUERY_PARAMETER = 'mockup'

const ENABLED_VALUES = new Set(['1', 'true'])

// Whether a page query string (`window.location.search`, with or without the
// leading `?`) asks for the mockup frame. Absent or any other value → false.
export function isMockupFrameRequested(search: string): boolean {
  const flagValue = new URLSearchParams(search).get(MOCKUP_FRAME_QUERY_PARAMETER)
  return flagValue !== null && ENABLED_VALUES.has(flagValue)
}
