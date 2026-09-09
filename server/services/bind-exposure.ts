// Startup exposure policy for the bind address.
//
// The Host guard in services/trusted-host.ts is a DNS-rebinding defence against
// *browsers*, which cannot forge a Host header. It is not access control: any
// non-browser peer can send `Host: localhost` and pass it. So the only thing
// keeping this unauthenticated filesystem API off the network is the loopback
// bind — and `HOST=0.0.0.0` removes it.
//
// That deployment is documented (behind an authenticating Caddy), so it stays
// possible. But it must not be reachable by accident: an operator who exports
// HOST=0.0.0.0 without thinking has published `/etc/passwd` — and, with
// `EXPLORER_CONFINE` off, everything else the server's user can read, because
// unconfined mode resolves absolute paths.
//
// The rule, evaluated once at startup and never per request:
// non-loopback bind + no named hosts = refuse to start. Naming the served hosts
// in EXPLORER_ALLOWED_HOSTS is the acknowledgement that a proxy is in front.

import { isLoopbackAddress } from './trusted-host'

// A bind address carries no port, so the Host-header parser (which would eat
// `::1` at its first colon) is the wrong tool. Case and whitespace still need
// normalising before the loopback set is consulted.
function normaliseBindHostname(bindHost: string): string {
  return bindHost.trim().toLowerCase()
}

export type BindExposureDecision =
  | { kind: 'loopback' }
  | { kind: 'refused'; reason: string }
  | { kind: 'exposed'; warnings: string[] }

const NON_LOOPBACK_REFUSAL = (bindHost: string) =>
  `refusing to start: HOST=${bindHost} is not a loopback address, and ` +
  'EXPLORER_ALLOWED_HOSTS is empty.\n\n' +
  'binp-file-explorer is an UNAUTHENTICATED filesystem API. Binding a ' +
  'non-loopback address publishes it to every peer that can reach this port: ' +
  'the Host-header guard stops browsers being rebound onto it, but any client ' +
  'can simply send `Host: localhost` and read files.\n\n' +
  'To run this way deliberately:\n' +
  '  1. Put an AUTHENTICATING reverse proxy (e.g. Caddy) in front of this ' +
  'port, and make sure the port itself is not reachable from anywhere else.\n' +
  '  2. Set EXPLORER_ALLOWED_HOSTS to the host name(s) that proxy serves ' +
  '(e.g. EXPLORER_ALLOWED_HOSTS=files.example.com) to acknowledge it.\n' +
  '  3. Strongly consider EXPLORER_CONFINE=true with an EXPLORER_ROOT worth ' +
  'confining to — otherwise absolute paths resolve anywhere on the filesystem.\n\n' +
  'To run locally instead, leave HOST unset (defaults to 127.0.0.1).'

const UNCONFINED_WARNING =
  'WARNING: bound to a non-loopback address with EXPLORER_CONFINE=false.\n' +
  '  Unconfined mode resolves absolute paths, so the ENTIRE filesystem readable ' +
  'by this process — not just EXPLORER_ROOT — is reachable through the API.\n' +
  '  Set EXPLORER_CONFINE=true unless the reverse proxy in front is trusted to ' +
  'authenticate every request.'

// Pure decision (`composable-design`): no logging, no exiting, so tests can
// assert on it.
export function evaluateBindExposure(options: {
  bindHost: string
  additionalAllowedHosts: string[]
  isConfined: boolean
}): BindExposureDecision {
  const { bindHost, additionalAllowedHosts, isConfined } = options

  if (isLoopbackAddress(normaliseBindHostname(bindHost))) return { kind: 'loopback' }

  if (additionalAllowedHosts.length === 0) {
    return { kind: 'refused', reason: NON_LOOPBACK_REFUSAL(bindHost) }
  }

  return { kind: 'exposed', warnings: isConfined ? [] : [UNCONFINED_WARNING] }
}

// Factory per `factory-services`. Orchestration half: turns the decision into
// the process outcome — a fatal exit or a warning on stderr. Injectable sinks
// keep it testable without killing the test runner.
export function createBindExposurePolicy(options: {
  reportWarning?: (message: string) => void
  fail?: (message: string) => never
} = {}) {
  const reportWarning = options.reportWarning ?? ((message: string) => console.warn(message))
  const exitFatally = (message: string): never => {
    console.error(message)
    process.exit(1)
  }
  const fail = options.fail ?? exitFatally

  return {
    // Call before listen(). Returns only when it is safe to serve.
    enforce(bindOptions: {
      bindHost: string
      additionalAllowedHosts: string[]
      isConfined: boolean
    }): BindExposureDecision {
      const decision = evaluateBindExposure(bindOptions)
      if (decision.kind === 'refused') fail(decision.reason)
      if (decision.kind === 'exposed') decision.warnings.forEach(reportWarning)
      return decision
    },
  }
}
