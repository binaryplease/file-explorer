---
id: 101-performance-budgets
title: Speed budgets, and when optimization starts
summary: "Optimize when a real interaction misses a budget on a real tree, not before — no stress fixture, no optimization. The fixture and the per-listing timing now exist, so the gate is a command, not an intention."
status: standing
rank: null
tags: [perf, server, client]
blocks: []
blocked_by: []
research: [../research/2026-07-17-broot-engine.md]
decisions: [2026-07-17-re-engineer-the-broot-engine]
conventions: []
shipped: null
updated: 2026-08-21
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

Real-tree sanity check: Downloads with 1397 entries renders fine today. Against
the stress fixture below (2026-08-21): 4 000 entries serve in ~21ms, meeting the
row above as written; 40 000 entries serve in ~98ms, which does not — the
remainder is named in [013](013-large-directory-listing-performance.md).

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

Two requirements are *inherently* performance work, and that is when the
optimization happens — as part of the feature, not as a separate pass:

1. **[007-directory-sizes](007-directory-sizes.md)** — aggregated du is the known
   rabbit hole. Needs caching / progressive computation by design.
2. **[013-large-directory-listing-performance](013-large-directory-listing-performance.md)**
   — a directory of tens of thousands of entries. In progress: it built the gate
   below, and cut the per-entry syscalls that were the first half of its miss.

(Server-side recursive search shipped 2026-07-17 with its bounds built in — 10×
overscan cap, 900ms budget, gitignore-aware pruning, abort-on-keystroke.)

## Known cheap-to-fix suspects

Touch these only when measurements name them:

- ~~`/api/fs/list` does lstat+stat per entry~~ — gone (2026-08-21,
  [013](013-large-directory-listing-performance.md)): entry kinds come from the
  directory's own `readdir(…, { withFileTypes: true })`, so a plain directory
  costs no stat at all and a plain file costs one instead of two. A
  40 000-entry listing went from 80 000 stats to 2 802, and from ~243ms to
  ~98ms.
- `/api/fs/list` still does **one readdir per child directory** (childCount) →
  O(subdirs) syscalls. This is now the measured remainder rather than a
  suspicion: ~61ms of the ~98ms a 40 000-entry, 37 200-directory listing costs,
  and the only thing between that listing and this budget. Still the first thing
  to drop or batch — but note it is read at *listing* time by the screen-fit
  auto-open in [010](010-broot-tree-display-and-navigation.md), so deferring it
  changes that shipped behaviour and needs its own record.
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

Both halves exist as of 2026-08-21
([013](013-large-directory-listing-performance.md) built them), so the gate is a
command rather than an intention — and the bar it sets went up with it, because
"I could not measure it" is no longer available:

| | |
|---|---|
| `mise run stress:fixture` | Generates the tree, idempotently, outside the repo. Four cases: `wide-mixed` (40 000 entries, 93% directories), `few-thousand` (4 000, same mix — the scale the `GET /api/fs/list` budget above is *written* for), `wide-files` (40 000 plain files), `deep` (256 nested levels, for the `.gitignore` chain). Each mixed case carries a contained and an escaping symlink, so confinement is measured under load too. |
| `mise run bench:list` | Drives the real route against the fixture and reports the split that says *why* — service phases, syscall counts, `JSON.stringify`, framework remainder, payload bytes — with a verdict against the budget. `--path`, `--runs`, `--confine`. |
| `Server-Timing` header | Every listing reports its own phases and syscall counts, always, so a miss in ordinary use is legible in a browser's network panel with nothing restarted or rebuilt. `EXPLORER_TIMING=true` also logs one line per listing. |

A performance claim about the listing path is expected to quote a before and an
after from that bench, on the same fixture. The syscall *counts* are the durable
half of it: they are asserted in the unit tests, so a change that reintroduces a
per-entry stat fails a test rather than waiting for someone to re-run a
benchmark on a machine that happens to be idle.
