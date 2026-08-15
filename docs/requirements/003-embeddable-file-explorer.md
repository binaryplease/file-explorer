---
id: 003-embeddable-file-explorer
title: Embeddable `<FileExplorer>` component
summary: "`App` is the shell and owns global browser state, so it cannot be mounted by a host or twice on a page — this is the work that makes it a component."
status: planned
rank: 3
tags: [client, packaging]
blocks: []
blocked_by: [001-unconfined-root-anchor, 002-preview-parity]
research: []
decisions: [2026-07-20-the-preview-is-the-viewer]
conventions: [one-descriptor-one-wrapper-one-guard, share-the-invariant, code-lives-with-dependencies, package-name-matches-repo]
shipped: null
updated: 2026-07-20
---

# Embeddable `<FileExplorer>` component

Today `App` *is* the shell and owns global browser state, so it cannot be mounted
by a host app or twice on a page. A host application retires its own file browser
and preview pane (≈1,265 LOC) and consumes this component instead — that adoption
is what ranks this requirement above everything except the preview work it stands
on. See
[the preview is the viewer](../decisions/2026-07-20-the-preview-is-the-viewer.md).

## Work

- **Lift the full-screen chrome** out of `App.tsx:573-574` (`min-h-screen`,
  gradient, the fixed `max-w-[1080px]` / `h-[min(720px,92vh)]` card) into the
  standalone entry; the component fills its container.
- **Controlled path.** Replace `?path=` URL ownership (`App.tsx:27-38`,
  `181-195`) with `path` / `onPathChange` props, and the same for `goBack()` →
  `window.history.back()` (`App.tsx:356-359`). The standalone app wires those
  props back to `history`; a host owns its own routing.
- **Scope the keyboard.** The `window` keydown listener (`App.tsx:436-565`) moves
  to a container ref with an `isActive` guard. The bare-printable-key typeahead
  capture (`:480-490`) is the worst offender — embedded, it steals every
  keystroke in the host page.
- **Namespace per instance:** the `localStorage` keys (`lib/theme.ts`,
  `lib/viewSettings.ts:25,44`) and the `[data-row-path]` document queries
  (`App.tsx:47-52`, `258-263`).
- **Accept a `rowClassName` prop** — a host may enforce its own selected-row
  token through its own conventions guard, and cannot do that through a class
  this component hardcodes.
- **Parameterize the API base** in `lib/api.ts:30,40,51,75` (hardcoded
  same-origin `/api/fs/*`).
- **Package:** drop `"private": true`, add an `exports` map (`.`, `./server`,
  `./shared`) and a library build target, plus a `files` allowlist deciding what
  is actually packed before a version is spent on it.

## Constraint carried in from [001](001-unconfined-root-anchor.md)

Out-of-root paths arrive as **absolute** paths. The embeddable component must not
assume `relativePath` is relative.
