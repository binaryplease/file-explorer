---
id: 005-git-status-column
title: Git status column, async and degradable
summary: "Working-tree git status per entry, aggregated up to directories — async enrichment after the listing paints, cancellable and degradable, or it does not ship."
status: planned
rank: 5
tags: [tree, server, client, perf]
blocks: []
blocked_by: []
research: []
decisions: []
conventions: [never-hide-a-control, affordances-adjacent]
shipped: null
updated: 2026-07-20
---

# Git status column

Working-tree status per entry, aggregated up to directories, plus a toggle and a
glyph column. The feature is well-proven in other explorers; the implementation
is engineered here, because the naive version of it is exactly what the
responsiveness principle forbids.

## Requirements

- **Async and non-blocking, or it does not ship.** The listing renders
  immediately *without* status; status arrives afterwards as enrichment, is
  cancellable when the user navigates away, and is cached per repo. A listing
  must never wait on a git subprocess. This is the AGENTS.md responsiveness
  principle, and it is the specific thing the obvious implementation gets wrong:
  computing status inside the listing handler makes every listing pay for an
  uncached `git` subprocess.
- **Degrades silently to "no status"** outside a repo or when git is absent —
  absent enrichment, not an error state.
- **Directory aggregation**: a directory shows the roll-up of its subtree's
  status, so a collapsed tree still tells you where the changes are.
- **The toggle sits on the tree it governs** (affordances sit beside what they change), beside the existing
  sizes/hidden/gitignored chips, and stays visible-but-disabled with a reason
  when there is no repo (never hide a control).
