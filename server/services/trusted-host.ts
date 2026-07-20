// DNS-rebinding defence for a loopback-bound, unauthenticated server.
//
// Binding to 127.0.0.1 keeps the network out, and shipping no CORS headers
// keeps the same-origin policy between a malicious page and our responses. But
// neither survives DNS rebinding: an attacker points `evil.example` at
// 127.0.0.1, the user's browser treats `http://evil.example:3000` as that
// origin's *own* server, and the same-origin policy stops applying. Every
// filesystem endpoint is then readable by a page the user merely visited.
//
// The one signal that still distinguishes the two cases is the `Host` header:
// a rebound request carries the attacker's name, never a loopback one. So the
// server answers only for the names it is actually reachable under.
//
// This is what confinement cannot do. `EXPLORER_ROOT` defaults to the user's
// home directory, so a confined server still hands over `~/.ssh` and `~/.gnupg`
// to a rebound origin. The boundary that matters here is the origin, not the
// path.

// Loopback literals a browser or proxy legitimately puts in a Host header.
// Matched exactly: `evil.localhost` is a name an attacker can register and
// point at 127.0.0.1, so subdomain matching would reopen the hole it closes.
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

// Splits `127.0.0.1:3000` / `[::1]:3000` / `localhost` into the hostname alone.
// Bracketed IPv6 literals keep their brackets so they compare against the set
// above in the form a Host header actually carries.
export function hostnameFromHostHeader(hostHeader: string): string {
  const trimmedHostHeader = hostHeader.trim().toLowerCase()
  if (trimmedHostHeader.startsWith('[')) {
    const closingBracketIndex = trimmedHostHeader.indexOf(']')
    if (closingBracketIndex === -1) return trimmedHostHeader
    return trimmedHostHeader.slice(0, closingBracketIndex + 1)
  }
  const colonIndex = trimmedHostHeader.indexOf(':')
  return colonIndex === -1 ? trimmedHostHeader : trimmedHostHeader.slice(0, colonIndex)
}

// The whole 127.0.0.0/8 block is loopback, not just 127.0.0.1. Exported because
// the startup exposure policy (services/bind-exposure.ts) asks the same question
// of the *bind* address that this file asks of the Host header.
export function isLoopbackAddress(hostname: string): boolean {
  if (LOOPBACK_HOSTNAMES.has(hostname)) return true
  const octets = hostname.split('.')
  if (octets.length !== 4) return false
  if (octets[0] !== '127') return false
  return octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
}

export function isTrustedHostHeader(
  hostHeader: string | null,
  additionalAllowedHosts: string[],
): boolean {
  // HTTP/1.1 requires Host. Absent means a hand-rolled client, not a browser —
  // and we cannot prove it is not rebound, so it does not get an answer.
  if (hostHeader === null || hostHeader.trim() === '') return false
  const hostname = hostnameFromHostHeader(hostHeader)
  if (isLoopbackAddress(hostname)) return true
  return additionalAllowedHosts.some(
    (allowedHost) => hostnameFromHostHeader(allowedHost) === hostname,
  )
}

// Factory per ADR-0007. `additionalAllowedHosts` is the escape hatch for the
// documented non-local deployment (`HOST=0.0.0.0` behind Caddy on the same
// box): that operator has to name the domain, because we cannot guess it and
// will not accept anything.
export function createTrustedHostGuard(options: { additionalAllowedHosts: string[] }) {
  const { additionalAllowedHosts } = options
  return {
    isTrusted(hostHeader: string | null): boolean {
      return isTrustedHostHeader(hostHeader, additionalAllowedHosts)
    },
  }
}
