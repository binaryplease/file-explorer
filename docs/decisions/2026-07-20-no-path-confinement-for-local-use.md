---
id: 2026-07-20-no-path-confinement-for-local-use
title: No path confinement for local-machine use — the root is a display anchor
summary: "Confining a local tool to its served root buys nothing and costs a realpath per path, so confinement became a default flip behind a flag rather than a deletion; the loopback bind stays the boundary."
decided: 2026-07-20
status: accepted
requirements: [001-unconfined-root-anchor, 100-loopback-only-service]
research: []
---

# No path confinement for local-machine use

## The question

The server refused any path resolving outside `EXPLORER_ROOT`. Is that refusal
buying security, or is it just a fence around the user's own filesystem?

## Decided

**The served root stops being a security boundary and becomes a display
anchor** — where the tree *starts*, not where it *ends*.

The explorer runs on the user's own machine against their own filesystem.
Confining it there buys nothing an attacker could not get by reading the same
files directly, and it costs a `realpath()` per resolved path plus the ability
to browse anywhere.

**A default flip behind a `confine` flag, not a deletion.** The distinction
matters: a hosted surface serving a subtree that is *not* the user's own is
exactly the case confinement exists for, so the refusal path stays implemented
and tested (11 files' worth). `confine` defaults to **true at the factory** —
the strongest posture is the default — and `EXPLORER_CONFINE` (default false)
is what wires the local-tool flip from config.

## Scope

This supersedes the original standing requirement "local-only tool: loopback
bind, never hosted" **in respect of path confinement only**. The loopback bind
stays, and it is what keeps an unauthenticated filesystem API off the network —
see [100-loopback-only-service](../requirements/100-loopback-only-service.md).

## Consequences

- Out-of-root paths travel the wire as **absolute** paths, not `../../` chains.
  Anything consuming the listing must not assume `relativePath` is relative
  ([003](../requirements/003-embeddable-file-explorer.md) carries this
  constraint).
- The listing response carries `confined` (default **true** — fail-safe: a
  client that cannot read it treats the root as a boundary), and the client
  ascends past the anchor only when the server says it is unconfined.
