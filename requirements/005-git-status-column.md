---
id: 005-git-status-column
title: Git status column, async and degradable
status: planned
rank: 5
tags: [tree, server, client, perf]
blocks: []
blocked_by: []
research: [../.nightshift/research/2026-07-18-file-explorer-vs-fex-comparison.md]
adrs: [ADR-0025, ADR-0031]
shipped: null
updated: 2026-07-20
---

# Git status column

Working-tree status per entry, aggregated up to directories, plus a toggle and a
glyph column. The idea is validated in binp-fex; the implementation is ours (the
2026-07-20 consolidation decision — fex is an ideas reference, its code is never
ported).

## Requirements

- **Async and non-blocking, or it does not ship.** The listing renders
  immediately *without* status; status arrives afterwards as enrichment, is
  cancellable when the user navigates away, and is cached per repo. A listing
  must never wait on a git subprocess. This is the AGENTS.md responsiveness
  principle, and it is the specific thing fex gets wrong — its listings block on
  uncached git subprocesses.
- **Degrades silently to "no status"** outside a repo or when git is absent —
  absent enrichment, not an error state.
- **Directory aggregation**: a directory shows the roll-up of its subtree's
  status, so a collapsed tree still tells you where the changes are.
- **The toggle sits on the tree it governs** (ADR-0031), beside the existing
  sizes/hidden/gitignored chips, and stays visible-but-disabled with a reason
  when there is no repo (ADR-0025).
