---
id: 018-reveal-in-file-manager
title: The context menu reveals the right-clicked entry in the OS file manager
summary: "Right-clicking a file, a directory or the root line offers a verb that opens the operating system's file manager on that entry; today the menu only copies paths."
status: planned
rank: 18
tags: [client, server, tree, api]
blocks: []
blocked_by: []
research: []
decisions: [2026-07-20-the-origin-is-the-security-boundary]
conventions: [never-hide-a-control, affordances-adjacent, descriptive-names]
shipped: null
updated: 2026-11-18
---

# The context menu reveals the right-clicked entry in the OS file manager

## Current behaviour

Right-clicking an entry row or the tree's root line opens a menu with two
verbs, `Copy path` and `Copy relative path` (`openCopyMenu`,
`src/components/TreeView.tsx:396-418`). No verb hands the entry to the
operating system. The server exposes `POST /api/fs/open`, which opens a file
with its default application (`server/routes/filesystem.ts:344`), and the
client calls it from `src/lib/api.ts:40`. The `POST /api/fs/reveal` endpoint
that [004](004-host-app-endpoints.md) specifies has no route at HEAD.

Revealing an entry spawns a process on the machine that runs the server, from a
request to the unauthenticated API, so this record touches the same exposure as
`open`.

## Desired outcome

Right-clicking a file, a directory or the root line offers a verb that opens the
operating system's file manager on that entry.

## Done when

On macOS, choosing the verb from the context menu of a file row, a directory row
and the root line each opens Finder showing that entry, the two copy verbs still
work, and `mise run typecheck` and `mise run test` stay green.

## Relation to other records

- [004-host-app-endpoints](004-host-app-endpoints.md) specifies the `reveal`
  endpoint and its per-platform launchers; this record is the menu verb that
  uses it. The `exists` half of 004 is not needed here.
- [011-command-palette-verbs](011-command-palette-verbs.md) lists reveal among
  the palette's first verbs; this record covers the context menu only.

## Out of scope

- A palette entry or a keyboard shortcut for the verb, which belong to
  [011](011-command-palette-verbs.md).
- An "open with default application" verb in the menu; `open` stays reachable
  the way it is today.

## Note

- The file manager opens on the machine that runs the server. A browser on
  another machine sees nothing open there; a later record would have to decide
  what the verb shows in that deployment.
- Whether a directory opens as its own window or shows selected inside its
  parent is a builder's default; a reveal that fails (no launcher on `PATH`)
  reports its reason the way a failed copy does today.
