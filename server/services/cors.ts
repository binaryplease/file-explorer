// Cross-origin (CORS) access for the deliberate embedding seam.
//
// The explorer ships no CORS by default (README security model): the
// same-origin policy guards its responses and it is loopback-bound. But an
// embedding host runs this server as a *separate* process on another port and
// mounts the explorer's frontend into its own page — so the browser issues a
// cross-origin request that the same-origin policy would otherwise block the
// page from reading. Opening that seam is an explicit, named opt-in: only the
// Origins the operator lists (EXPLORER_ALLOWED_ORIGINS → `allowedOrigins`) get
// CORS headers reflected back; an unlisted Origin gets none and the browser
// blocks the read, exactly as before. This never touches the loopback bind or
// the Host-header guard — it only lets a named Origin *read* a response it is
// already allowed to receive.

// Methods and request headers the explorer's own routes actually use: GET for
// the reads, POST (with a JSON body) for `open`, OPTIONS for the preflight.
const ALLOWED_METHODS = 'GET, POST, OPTIONS'
const ALLOWED_HEADERS = 'content-type'
const PREFLIGHT_MAX_AGE_SECONDS = '600'

// The CORS response headers to attach for `requestOrigin`, or `{}` when it is
// absent or not on the allowlist (no headers → the browser blocks the read).
// `Vary: Origin` keeps a shared cache from serving one Origin's allow header to
// another.
export function corsHeadersFor(
  requestOrigin: string | null,
  allowedOrigins: string[],
): Record<string, string> {
  if (requestOrigin === null) return {}
  if (!allowedOrigins.includes(requestOrigin)) return {}
  return {
    'access-control-allow-origin': requestOrigin,
    vary: 'Origin',
    'access-control-allow-methods': ALLOWED_METHODS,
    'access-control-allow-headers': ALLOWED_HEADERS,
    'access-control-max-age': PREFLIGHT_MAX_AGE_SECONDS,
  }
}

// Factory per `factory-services`. Closes over the configured allowlist so the
// request path just asks "headers for this Origin?" without re-reading config.
export function createCorsPolicy(options: { allowedOrigins: string[] }) {
  const { allowedOrigins } = options
  return {
    headersFor(requestOrigin: string | null): Record<string, string> {
      return corsHeadersFor(requestOrigin, allowedOrigins)
    },
    isAllowed(requestOrigin: string | null): boolean {
      return requestOrigin !== null && allowedOrigins.includes(requestOrigin)
    },
  }
}
