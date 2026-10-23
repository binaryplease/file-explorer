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
decisions: [2026-07-17-re-engineer-the-broot-engine, 2026-10-22-the-tree-renders-a-window]
conventions: []
shipped: null
updated: 2026-10-22
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

Real-tree sanity check: Downloads with 1397 entries renders fine today. A real
`/tmp` of ~74 500 entries (2026-10-22, Chromium, production build) paints
~0.4–0.5s after it is entered. It took 36–43s before the tree rendered a window
of rows. Moving the focus through it costs ~2ms of handler and render and
lands on the next frame, so the keypress row is met there. The "focus / expand"
row is missed at ~4×, and most of that is moving and parsing a 13 MB listing —
see [013](013-large-directory-listing-performance.md). Against the stress
fixture below: 4 000 entries serve in ~5ms and the 40 000-entry mixed directory
in ~33–47ms, both inside the server row, and that directory paints ~0.3–0.4s
after it is entered cold. A 40 000-entry directory of plain files still serves
in ~83–89ms; see the suspects below.

## The responsiveness principle (AGENTS.md, binding)

The core navigation loop — list / fuzzy-search / move — always comes first. Every
feature beyond it must be async and non-blocking: a listing or search response
never waits on enrichment (git status, previews, directory sizes, thumbnails).
Enrichment arrives after the tree has painted, is cancellable when the user
navigates away, and degrades to *absent* rather than delaying the core. **If a
feature cannot be built this way, it does not ship** — see
[005-git-status-column](005-git-status-column.md) and
[007-directory-sizes](007-directory-sizes.md).

### First paint does not reflow the tree — decided 2026-09-16

Self-hosting the monospace face put a font on the critical path for the first
time. `@fontsource-variable/*` ships `font-display: swap`, and a `@font-face`
inside the render-blocking stylesheet is discoverable only *after* that
stylesheet is fetched and parsed — so the tree painted in the system fallback and
then reflowed to Fira Code. Mono is the app's primary face (`--font-mono` in
theme.css draws the whole explorer, not one panel), so that flash crossed every
row of the core navigation surface.

Two ways to close that: preload the subset, or accept the swap in writing. **We
preload.** The reflow lands on the list / fuzzy-search / move loop itself, which
is the one surface this principle says comes first, and the fix costs a single
`<link rel="preload">` — no dependency, no new asset, ~36K already in the bundle.
Accepting a visible reflow of the core loop to save one tag would have inverted
the principle.

The tag cannot be written into `src/index.html` by hand, because the filename is
content-hashed at build time. `vite.config.ts` carries a `preload-mono-latin-subset`
plugin that reads the emitted name out of the bundle and injects the link, and
**throws if no asset matches** — so a future font swap fails the build loudly
rather than silently restoring the reflow. Only the latin subset is preloaded:
the other six cuts are `unicode-range`-gated and off the first-paint path.

Fonts beyond the primary face do not get this treatment. Inter is an accent face
for rendered markdown — enrichment, arriving after the tree has painted — so it
stays on plain `swap`.

## Where serious optimization starts

Two requirements are *inherently* performance work, and that is when the
optimization happens — as part of the feature, not as a separate pass:

1. **[007-directory-sizes](007-directory-sizes.md)** — aggregated du is the known
   rabbit hole. Needs caching / progressive computation by design.
2. **[013-large-directory-listing-performance](013-large-directory-listing-performance.md)**
   — a directory of tens of thousands of entries. In progress: it built the
   gate below, cut the per-entry syscalls, moved `childCount` off the listing
   (the server half, met), and made the tree render a window of rows (the
   client no longer hangs). Navigating into such a directory still misses the
   "focus / expand" budget.

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
- ~~`/api/fs/list` does one readdir per child directory (childCount)~~ — gone
  from the listing (2026-10-22,
  [013](013-large-directory-listing-performance.md),
  [decision](../decisions/2026-10-22-child-counts-are-enrichment.md)): the count
  is enrichment, served after paint by `GET /api/fs/child-counts` and aborted on
  navigate-away, and the screen-fit auto-open in
  [010](010-broot-tree-display-and-navigation.md) waits for it rather than
  reading an uncounted directory as empty. A 40 000-entry, 37 200-directory
  listing went from 37 200 child readdirs to none, and from ~104–117ms to
  ~33–47ms. The work did not vanish: the counts request costs ~74–110ms on that
  directory, off the budget, and `bench:list` prints it on its own line.
- `/api/fs/list` does **one `stat` per plain file**, for size and execute bit →
  O(files) syscalls. Measured, not suspected: a 40 000-plain-file directory
  (`--path wide-files`) serves in ~83–89ms and misses this budget at ~1.7×,
  unchanged by the `childCount` move because it holds no directories. The next
  thing to design against this budget — the size bars read `sizeBytes` at
  render time, so moving it off the listing is the same shape of question
  `childCount` was, and wants its own record.
- ~~No row virtualization: the tree renders every visible row~~ — gone
  (2026-10-22, [013](013-large-directory-listing-performance.md),
  [decision](../decisions/2026-10-22-the-tree-renders-a-window.md)). Measured
  first: ~73 500 DOM rows and seconds per keypress on a real `/tmp`. The tree
  now renders the viewport's rows plus an overscan, located by arithmetic on
  the one shared row height. The same measurement found a larger cost nobody
  had suspected: `localeCompare` with an options object, ~4.7s per sort of that
  directory, re-run on every row build. Now it is one shared `Intl.Collator`
  and one sort per listing.
- The client parses, validates and orders a whole listing before it can paint
  any of it: ~0.2s of main thread for a 13 MB, ~74 500-entry listing, on top of
  transferring it. Measured, and the reason the "focus / expand" row is missed
  on directories that large — see
  [013](013-large-directory-listing-performance.md).
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
| `mise run bench:list` | Drives the real route against the fixture and reports the split that says *why* — service phases, syscall counts, `JSON.stringify`, framework remainder, payload bytes — with a verdict against the budget, and **exits non-zero on MISSES**, so the gate is decided by exit code. Also reports the deferred `GET /api/fs/child-counts` on its own line, outside the budget. `--path`, `--runs`, `--confine`. |
| `Server-Timing` header | Every listing reports its own phases and syscall counts, always, so a miss in ordinary use is legible in a browser's network panel with nothing restarted or rebuilt. `EXPLORER_TIMING=true` also logs one line per listing. |

A performance claim about the listing path is expected to quote a before and an
after from that bench, on the same fixture. The syscall *counts* are the durable
half of it: they are asserted in the unit tests, so a change that reintroduces a
per-entry stat fails a test rather than waiting for someone to re-run a
benchmark on a machine that happens to be idle.
