---
id: 100-loopback-only-service
title: Loopback-only service; exposure is an explicit opt-in
status: standing
rank: null
tags: [server, security, config]
blocks: []
blocked_by: []
research: []
adrs: [ADR-0018, ADR-0036, ADR-0037]
shipped: null
updated: 2026-07-27
---

# Loopback-only service; exposure is an explicit opt-in

This is an **unauthenticated filesystem API**. The loopback bind is what keeps it
off the network, and it is the default.

- **`HOST=127.0.0.1` is the default** and starts silently. No auth work is needed
  for the local tool.
- **Binding a non-loopback `HOST` fails closed** (`server/services/bind-exposure.ts`,
  fatal per ADR-0018) when `EXPLORER_ALLOWED_HOSTS` is empty. The documented
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
