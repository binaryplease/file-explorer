---
id: 001-unconfined-root-anchor
title: The served root is a display anchor, not a security boundary
summary: "The served root is where the tree starts, not where it ends — confinement is a default flip behind a flag, so out-of-root paths travel the wire as absolute paths."
status: shipped
rank: 1
tags: [server, security, config]
blocks: [003-embeddable-file-explorer, 004-host-app-endpoints]
blocked_by: []
research: []
decisions: [2026-07-20-no-path-confinement-for-local-use, 2026-07-20-the-origin-is-the-security-boundary]
conventions: [factory-services, fail-loud-ports, code-lives-with-dependencies]
shipped: 2026-07-20
updated: 2026-07-27
---

# The served root is a display anchor, not a security boundary

bfe runs on the user's own machine against their own filesystem. Confining it to
the served root buys nothing there and costs a `realpath()` per resolved path
plus the ability to browse anywhere. The root becomes where the tree *starts*,
not where it *ends*.

Delivered as a **default flip behind a `confine` flag, not a deletion** — the
refusal path stays implemented and tested, because a hosted surface serving a
subtree that is not the user's own is exactly the case confinement exists for.

## What shipped

- `createFilesystemService({ rootAbsolutePath, confine })`, with `confine`
  defaulting to **true at the factory** (strongest posture is the default) and
  `EXPLORER_CONFINE` (default false) wiring the local-tool flip from config.
- `createFilesystemRoutes` / `createPreviewRoutes` factories, so a host app
  mounts the routes as a plugin (factory services).
- Confinement stayed implemented and tested across 11 files — a default flip, as
  planned.

## The consequence downstream requirements depend on

Out-of-root paths travel the wire as **absolute paths**, not `../../` chains.
`ListDirectoryQuerySchema` needed no change and the client's `joinTreePath`
composes them correctly — but the embeddable component
([003](003-embeddable-file-explorer.md)) must not assume `relativePath` is
relative.

## Loose ends

- ~~`parentTreePath('/etc')` → `''` walked up to the anchor rather than `/`.~~ →
  **fixed 2026-07-27** as part of enabling above-anchor navigation.
  `DirectoryListingSchema` now
  carries `confined` (default **true** — fail-safe: a client that can't read it
  treats the root as a boundary), and the client ascends past the anchor only
  when the server says it is unconfined.

## Related decisions

- [**No path confinement for local-machine use**](../decisions/2026-07-20-no-path-confinement-for-local-use.md)
  (2026-07-20). Supersedes the standing "local-only tool" requirement *in
  respect of path confinement only*; the loopback bind stays
  ([100](100-loopback-only-service.md)).
- [**The origin is the security boundary, not the path**](../decisions/2026-07-20-the-origin-is-the-security-boundary.md)
  (2026-07-20). Probing the running server showed the confinement default was
  never the exposure; the hole was an unvalidated `Host` header, fixed with a
  Host guard (`server/services/trusted-host.ts`).
