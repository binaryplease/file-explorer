// Which origin the ADR-0020 discovery document should advertise.
//
// `GET /api` must return absolute URLs, so it has to name an origin. The
// tempting source is `x-forwarded-proto` / `x-forwarded-host` — a proxy sets
// them, and honouring them makes the links match what the user typed. But
// those headers are just request headers: the Host guard in
// services/trusted-host.ts validates `Host`, and nothing validates these. Any
// request that passes the guard (`Host: localhost` — trivial for a non-browser
// peer) could therefore choose the origin echoed back in the docs / openapi /
// health links, poisoning whatever caches or follows them.
//
// The app cannot recognise its own proxy — a forwarded header from Caddy is
// byte-identical to one from curl. So trust is gated on the same operator
// acknowledgement that admits a proxy exists at all: EXPLORER_ALLOWED_HOSTS
// (see services/bind-exposure.ts). With it unset — the loopback default — the
// forwarded headers are ignored outright. With it set, a forwarded host is
// honoured only when it names one of the hosts the operator listed, which is
// exactly the set of origins the discovery document was ever allowed to claim.
//
// Worst case is then a link naming a host the operator already published, i.e.
// no gain for an attacker.

import { hostnameFromHostHeader } from './trusted-host'

// Proxies append rather than replace, so `x-forwarded-*` can be a list; the
// left-most entry is the one closest to the client.
function firstForwardedValue(headerValue: string | null): string {
  return headerValue?.split(',')[0]?.trim() ?? ''
}

// The value lands in a URL we hand to clients, so anything but the two schemes
// this server can actually be reached under is refused rather than reflected.
function isSupportedProtocol(protocol: string): boolean {
  return protocol === 'http' || protocol === 'https'
}

// `files.example.com` / `files.example.com:8443` / `[::1]:3000`. The hostname
// is checked against the allow-list separately; this rejects authorities
// carrying anything else (credentials, paths, whitespace, CRLF) that would let
// a forwarded header smuggle structure into the emitted URL.
function isWellFormedAuthority(authority: string): boolean {
  const hostname = hostnameFromHostHeader(authority)
  if (hostname === '') return false
  const remainder = authority.trim().toLowerCase().slice(hostname.length)
  return remainder === '' || /^:\d{1,5}$/.test(remainder)
}

function isAllowedHostname(hostname: string, additionalAllowedHosts: string[]): boolean {
  return additionalAllowedHosts.some(
    (allowedHost) => hostnameFromHostHeader(allowedHost) === hostname,
  )
}

// Pure decision (ADR-0010), mirroring services/bind-exposure.ts: no request
// object, no Elysia, so the trust rule can be tested without a live server.
export function resolvePublicOrigin(options: {
  requestUrl: string
  hostHeader: string | null
  forwardedProtocolHeader: string | null
  forwardedHostHeader: string | null
  additionalAllowedHosts: string[]
}): string {
  const {
    requestUrl,
    hostHeader,
    forwardedProtocolHeader,
    forwardedHostHeader,
    additionalAllowedHosts,
  } = options

  const url = new URL(requestUrl)
  const ownProtocol = url.protocol.replace(':', '')
  const ownAuthority = hostHeader?.trim() || url.host

  // Loopback default: no proxy was acknowledged, so no forwarded header is
  // worth anything. Answer as ourselves.
  if (additionalAllowedHosts.length === 0) return `${ownProtocol}://${ownAuthority}`

  const forwardedAuthority = firstForwardedValue(forwardedHostHeader)
  const isForwardedAuthorityTrusted =
    forwardedAuthority !== '' &&
    isWellFormedAuthority(forwardedAuthority) &&
    isAllowedHostname(hostnameFromHostHeader(forwardedAuthority), additionalAllowedHosts)

  const authority = isForwardedAuthorityTrusted ? forwardedAuthority : ownAuthority

  // A proxy may rewrite only the scheme (TLS terminated, Host passed through),
  // so `x-forwarded-proto` is honoured whenever the origin we are about to
  // advertise is one of the operator's named hosts — not only when the
  // forwarded host itself carried us there.
  const forwardedProtocol = firstForwardedValue(forwardedProtocolHeader).toLowerCase()
  const mayTrustForwardedProtocol =
    isAllowedHostname(hostnameFromHostHeader(authority), additionalAllowedHosts) &&
    isSupportedProtocol(forwardedProtocol)

  return `${mayTrustForwardedProtocol ? forwardedProtocol : ownProtocol}://${authority}`
}

// Factory per ADR-0007. Binds the operator's allow-list once at startup so the
// request path only supplies request-shaped inputs.
export function createPublicOriginResolver(options: { additionalAllowedHosts: string[] }) {
  const { additionalAllowedHosts } = options
  return {
    forRequest(request: Request): string {
      return resolvePublicOrigin({
        requestUrl: request.url,
        hostHeader: request.headers.get('host'),
        forwardedProtocolHeader: request.headers.get('x-forwarded-proto'),
        forwardedHostHeader: request.headers.get('x-forwarded-host'),
        additionalAllowedHosts,
      })
    },
  }
}
