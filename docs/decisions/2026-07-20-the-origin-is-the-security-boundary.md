---
id: 2026-07-20-the-origin-is-the-security-boundary
title: The origin is the security boundary, not the path
summary: "Probing the running server showed path confinement was never the exposure — a confined server still serves ~/.ssh to a DNS-rebound origin; the hole was an unvalidated Host header, fixed with a guard ahead of routing."
decided: 2026-07-20
status: accepted
requirements: [100-loopback-only-service, 001-unconfined-root-anchor]
research: []
---

# The origin is the security boundary, not the path

## The question

`EXPLORER_CONFINE` defaults to false. Challenged as a security regression:
should it default to true?

## Decided

**No — and the challenge pointed at the wrong control.** `EXPLORER_CONFINE`
stays false as a considered decision, and the real hole was fixed instead.

Probing the running server settled it. Confinement's default root is `$HOME`,
so a *confined* server still returns `~/.ssh/id_rsa` to an attacker who reaches
it. Flipping the default protects nothing, because the thing that decides
whether an attacker reaches it at all is **who is allowed to call the API**, not
which subtree it will answer for.

The actual exposure was an **unvalidated `Host` header**. A loopback bind and
absent CORS both stop mattering once an attacker's domain resolves to
`127.0.0.1` and the browser treats the call as same-origin — classic DNS
rebinding. Fixed with a Host guard (`server/services/trusted-host.ts`:
loopback-exact plus `127.0.0.0/8`, with `EXPLORER_ALLOWED_HOSTS` as the
deliberate opt-out) running **ahead of routing**.

## What confinement is actually for

A control for a **hosted** surface serving a subtree that is not the user's own.
Enable it *with* a root worth confining to — not as a reflex on a local tool
whose default root is the user's home directory.

## Consequences

- The Host guard is a DNS-rebinding defence against *browsers*. It is **not
  access control**: any non-browser peer can send `Host: localhost` and pass it.
  That is precisely why the loopback bind, not the guard, is the boundary.
- Standing consequence:
  [100-loopback-only-service](../requirements/100-loopback-only-service.md) — a
  non-loopback `HOST` fails closed unless the operator names the served hosts,
  and the decision is made once at startup, never per request.
