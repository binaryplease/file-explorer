---
id: 100-loopback-only-service
title: Loopback-only service; exposure is an explicit opt-in
summary: "This is an unauthenticated filesystem API: the loopback bind is the boundary, and a non-loopback `HOST` fails closed unless the operator names the served hosts."
status: standing
rank: null
tags: [server, security, config]
blocks: []
blocked_by: []
research: []
decisions: [2026-07-20-the-origin-is-the-security-boundary, 2026-07-20-no-path-confinement-for-local-use]
conventions: [fail-loud-ports, explicit-flags, allocate-before-strict-bind]
shipped: null
updated: 2026-07-27
---

# Loopback-only service; exposure is an explicit opt-in

This is an **unauthenticated filesystem API**. The loopback bind is what keeps it
off the network, and it is the default.

- **`HOST=127.0.0.1` is the default** and starts silently. No auth work is needed
  for the local tool.
- **Binding a non-loopback `HOST` fails closed** (`server/services/bind-exposure.ts`,
  a fatal startup error) when `EXPLORER_ALLOWED_HOSTS` is empty. The documented
  `HOST=0.0.0.0`-behind-Caddy deployment therefore requires the operator to
  (a) front the port with an **authenticating** reverse proxy and (b) name the
  served host(s) in `EXPLORER_ALLOWED_HOSTS` as the acknowledgement.
- Non-loopback plus `EXPLORER_CONFINE=false` still starts, but **warns loudly**:
  unconfined mode resolves absolute paths, so the whole filesystem — not just
  `EXPLORER_ROOT` — is reachable.
- The decision is made **once at startup**, never per request.
- The **Host-header guard** (`services/trusted-host.ts`, loopback-exact +
  127.0.0.0/8, `EXPLORER_ALLOWED_HOSTS` as the deliberate opt-out) runs ahead of
  routing. It is a DNS-rebinding defence against *browsers*, **not access
  control** — any non-browser peer can send `Host: localhost` and pass it. That
  is precisely why the loopback bind, not the guard, is the boundary.

## Amendment

The 2026-07-20 decision "no path confinement for local-machine use" supersedes
the original standing requirement *in respect of path confinement only* — see
[001-unconfined-root-anchor](001-unconfined-root-anchor.md). **The loopback bind
stays.**
