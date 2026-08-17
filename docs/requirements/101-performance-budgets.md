---
id: 101-performance-budgets
title: Speed budgets, and when optimization starts
summary: "Optimize when a real interaction misses a budget on a real tree, not before — no stress fixture, no optimization."
status: standing
rank: null
tags: [perf, server, client]
blocks: []
blocked_by: []
research: [../research/2026-07-17-broot-engine.md]
decisions: [2026-07-17-re-engineer-the-broot-engine]
conventions: []
shipped: null
updated: 2026-08-17
---

# Speed budgets, and when optimization starts

Speed is a first-class requirement — but no premature optimization. **Optimize
when a real interaction misses a budget on a real tree, not before.** Decided
2026-07-17.

## Budgets for "broot-like feel"

| Interaction | Budget |
|---|---|
| keypress → paint (move / filter) | one frame, ~16ms |
| focus / expand a directory | listing served + rendered < ~100ms perceived |
| server `GET /api/fs/list` | < ~50ms for a few-thousand-entry directory |

Real-tree sanity check: Downloads with 1397 entries renders fine today.

## The responsiveness principle (AGENTS.md, binding)

The core navigation loop — list / fuzzy-search / move — always comes first. Every
feature beyond it must be async and non-blocking: a listing or search response
never waits on enrichment (git status, previews, directory sizes, thumbnails).
Enrichment arrives after the tree has painted, is cancellable when the user
navigates away, and degrades to *absent* rather than delaying the core. **If a
feature cannot be built this way, it does not ship** — see
[005-git-status-column](005-git-status-column.md) and
[007-directory-sizes](007-directory-sizes.md).

## Where serious optimization starts

One requirement is *inherently* performance work, and that is when the
optimization happens — as part of the feature, not as a separate pass:

1. **[007-directory-sizes](007-directory-sizes.md)** — aggregated du is the known
   rabbit hole. Needs caching / progressive computation by design.

(Server-side recursive search shipped 2026-07-17 with its bounds built in — 10×
overscan cap, 900ms budget, gitignore-aware pruning, abort-on-keystroke.)

## Known cheap-to-fix suspects

Touch these only when measurements name them:

- `/api/fs/list` does lstat+stat per entry plus one readdir per child dir
  (childCount) → O(entries + subdirs) syscalls. Fine locally today; first thing
  to drop or batch if listing lag ever shows.
- No row virtualization: the tree renders every visible row. Expect jank
  somewhere ≳5–10k rows; virtualize then, not before.
- ~~`subtreeHasMatch` re-walks the loaded tree per render while filtering~~ —
  gone; filtering is server-side (2026-07-17).
- `/api/fs/list` also loads the `.gitignore` chain per listing (one readFile
  attempt per ancestor level) — negligible locally; batch/cache if it ever shows.
- In-document find (`searchDocument`, [002](002-preview-parity.md)) re-scans
  every line of the preview window per keystroke. It shipped against a 600-line
  window; the window is now 4000 lines, and 40 000 under the full-text opt-in,
  so its ceiling grew 66× without review. The highlighter took an explicit
  10 000-line cut-off in that same change — this pass did not, on the grounds
  that word-scoring a line is far cheaper than tokenizing it. Unmeasured either
  way: type into a 40 000-line file and watch the keypress→paint budget before
  capping it.

## The gate

Before optimizing anything: build a stress fixture (a script that generates e.g.
50k files / deep nesting), log server timing per listing, and reproduce the miss.
**No fixture, no optimization.**
