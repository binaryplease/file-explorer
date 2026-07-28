---
id: 003-embeddable-file-explorer
title: Embeddable `<FileExplorer>` component
status: planned
rank: 3
tags: [client, packaging]
blocks: []
blocked_by: [001-unconfined-root-anchor, 002-preview-parity]
research: [../.nightshift/research/2026-07-20-nightshift-ui-adoption.md]
adrs: [ADR-0026, ADR-0027, ADR-0032]
shipped: null
updated: 2026-07-20
---

# Embeddable `<FileExplorer>` component

Today `App` *is* the shell and owns global browser state, so it cannot be mounted
by a host app or twice on a page. nightshift-ui retires its own file browser and
preview pane (≈1,265 LOC) and consumes this component instead — that adoption is
what ranks this requirement above everything except the preview work it stands on.

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
- **Accept a `rowClassName` prop** — nightshift-ui enforces its own
  `selectedRowClass` token via a conventions guard.
- **Parameterize the API base** in `lib/api.ts:30,40,51,75` (hardcoded
  same-origin `/api/fs/*`).
- **Package:** drop `"private": true`, add an `exports` map (`.`, `./server`,
  `./shared`) and a library build target. Mirror
  `nightshift-ui/design/nightshift/package.json` — that pattern is already proven
  in this workspace.

## Constraint carried in from [001](001-unconfined-root-anchor.md)

Out-of-root paths arrive as **absolute** paths. The embeddable component must not
assume `relativePath` is relative.
