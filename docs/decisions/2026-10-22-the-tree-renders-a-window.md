---
id: 2026-10-22-the-tree-renders-a-window
title: The tree renders a window of its rows, and orders each listing once
summary: "Opening /tmp (~74 500 entries) took 36–43s to first paint, and the measured causes were a per-call localeCompare collator (~4.7s per sort, re-run on every row build and re-plan) and one DOM row per entry. Now each listing is ordered once with a shared collator, and the tree renders only the rows the viewport shows, located by arithmetic on one fixed row height: first paint ~0.4–0.5s, one frame per keypress, every row still reachable. The ~100ms navigation budget is still missed."
decided: 2026-10-22
status: accepted
requirements: [013-large-directory-listing-performance, 101-performance-budgets, 010-broot-tree-display-and-navigation]
research: []
---

# The tree renders a window of its rows, and orders each listing once

## The question

Navigating into a directory of tens of thousands of entries hung the explorer.
The server was not the cause: `bench-listing` serves the real 74 506-entry
`/tmp` in ~83ms and the 40 000-entry `wide-mixed` fixture inside its budget
([013](../requirements/013-large-directory-listing-performance.md)). broot,
which this explorer's navigation model comes from, hangs on the same directory
too. So porting its approach could not meet the outcome, and the technique had
to be worked out here.

The causes were measured in Chromium against the dev server, at `HEAD` before
any change. The candidates were rendering, the row and auto-open model, the
child-count merge, search indexing and payload parsing.

| | `/tmp`, ~74 500 entries | `wide-mixed`, 40 000 |
|---|---|---|
| navigate → first paint | 36.5–42.8s (3 runs) | 13.4s (1 run, cold) |
| main thread busy after navigating | 54–62s, longest single task 30–37s | 24s, longest single task 8s |
| ArrowDown → paint | 4.9s and 6.2s for the first press; in both runs the second press had not painted when the run was stopped minutes later | 2.9–3.6s |
| DOM rows | ~73 400–73 700 | 40 000 |

Two causes, in this order:

1. **The name comparator.** `compareEntryNames` called
   `localeCompare(…, { sensitivity: 'base', numeric: true })`, which resolves a
   collator on every call. Sorting `/tmp`'s names took **4 679ms in V8**,
   against 87ms for the same sort through one shared `Intl.Collator`. Both
   `buildTreeRows` and `planAutoOpen` sorted the focus listing every time they
   ran: when the listing arrived, when its counts merged, and on each re-plan.
   That made a navigation several sorts of seconds each.
2. **Every row rendered.** One DOM row per entry: ~73 500 rows of ~12 elements.
   Every keypress changed `selectedPath`, so React re-rendered all of them.

Payload parsing was not a cause. `JSON.parse` of the 13 MB `/tmp` listing takes
~30–45ms and its Zod parse ~45–60ms, both measured. Search was not a cause
either: it is server-side and does not run while browsing.

## Decided

**The tree renders a window.** `TreeView` renders only the rows the scroll
viewport can show, plus 12 rows of overscan on each side. The rest of the
listing is two spacer `div`s of the right height, so the scrollbar spans the
whole listing. This is arithmetic, not measurement: every tree line has one
height, an invariant `TREE_ROW_METRICS_CLASS` already held so that the
screen-fit budget could divide by it. Locating row *n* is `n × rowHeight`
(`src/lib/rowWindow.ts`, pure and unit-tested). Two consequences follow:

- **The selection is revealed by index, not through the DOM.** The old
  `scrollIntoView` on `[data-row-path=…]` cannot reach a row that is not
  rendered. `scrollTopRevealingRow` computes the `block: 'nearest'` offset for
  any index. TreeView applies it in a layout effect, before paint, so a keypress
  that moves the selection out of the window still lands in one frame. The
  arithmetic is only as good as the frame it runs in. Row positions and
  `scrollTop` must both be measured from the scroll container's own content
  frame, so the rows' offset is read from bounding rects
  (`rowsOffsetWithinScroll`), not from `offsetTop`. `offsetTop` is relative to
  the nearest *positioned* ancestor. As first shipped, that put every reveal
  67px off, the height of the chrome above the scroll container, and left the
  focused row out of view when moving up. Review caught it.
  Keyboard movement walks the full row list in App, so every entry stays
  reachable by keyboard and by scrolling. Nothing is cut from the listing.
- **Rows are memoized.** Each row's props are its stable row model, a selected
  or refused flag, and App's stable callbacks. A keypress therefore re-renders
  the two rows whose selection changed, not the whole window.

**Each listing is ordered once, with one collator.** `compareEntryNames` uses a
module-level `Intl.Collator` with the same options, so it orders exactly as
before (asserted against `localeCompare` in the tests). App sorts a listing as
it is stored (`sortEntriesByName`). The row builder and the auto-open planner
still order what they read, so a caller that hands them an unsorted listing
gets the same rows. They first check the order in one linear pass and sort only
when the check fails, which on a stored listing it never does. That holds in
every engine, not only in engines whose built-in sort detects a sorted run.

**The planner bails out before ordering a listing that already fills the
screen.** When the focus listing alone exceeds the viewport, the screen-fit
fill can open nothing. `planAutoOpen` now returns its empty plan before
ordering the listing, building tens of thousands of candidates, or waiting for
counts it would never read. The plan is the same one it reached before.

## Rejected

- **Port broot's approach.** broot hangs on this directory as well.
- **Bound the listing** ("N unlisted" past a cut-off). This would hit the
  number by cutting the content. Whether a huge directory may be bounded is
  still [013](../requirements/013-large-directory-listing-performance.md)'s open
  product question, and this change does not answer it.
- **A virtualization library.** A fixed row height reduces windowing to two
  multiplications. A library would also own scrolling, but the tree must reveal
  a selection by index from its own keyboard model. And every dependency is a
  `flake.nix` hash refresh.
- **Measure each row's height** (variable-height virtualization). The rows are
  uniform by contract. The one exception is the reason line under a selected
  out-of-root link. It flows inside the rendered slice, and its height is never
  needed to locate another row.
- **`content-visibility: auto`, or render the first screen and the rest in idle
  chunks.** Both still create one DOM row per entry, and React still reconciles
  all 73 000 of them on every keypress. That was the second cause.
- **Sort on the server.** The same collator costs ~130ms in Bun (JavaScriptCore)
  for `/tmp`, which would move straight onto the listing budget the server only
  just meets.
- **Presort by a cheap string key, then let the collator verify and fix up.**
  The key's character order was read from the collator itself, so the result
  was exact. Measured: it saved ~56ms on the fixture (78 vs 134ms) but *cost*
  ~50ms on `/tmp` (153 vs 101ms). Its long shared name prefixes make even plain
  string compares expensive there. Not a win on the directory the hang was
  reported on.

## Consequences

Measured in Chromium after the change, three runs per cell. "Production"
means a client bundle built with `NODE_ENV=production`, as the Nix package
builds it, served by the production server. "Cold" means the fixture was
entered from a directory that had not already loaded it.

| | dev server | production |
|---|---|---|
| `/tmp`: click → first paint | 409–496ms | 391–470ms |
| `wide-mixed`, cold: navigate → first paint | 297–423ms | 282–382ms |
| longest main-thread task after navigating (`/tmp`) | 386–439ms | 146–189ms |
| ArrowDown handler + render (Event Timing processing), median per run | 6.3–7.2ms | 1.8–2.3ms |
| DOM rows | 33 | 33 |

The keypress paints on the next frame. A 30-entry directory (`/etc`) measures
the same 24ms Event Timing duration in this headless harness, so that figure is
the harness's frame floor, not this code's cost. The dev column is slower
because React's development build profiles every component whose props change,
including a diff of the large `rows` prop. That cost does not exist in a
production bundle.

**The navigation budget is still missed**, at ~4× on `/tmp` and ~3× on the
fixture. What remains is on the critical path. For `/tmp`: the server answers
in ~100–130ms (time to first byte) and transfers 13 MB; `JSON.parse` takes
~30–45ms; the Zod parse plus the one sort, ~130–165ms in a single task; one row
build and commit, ~60–190ms. The server and the parse alone exceed 100ms. So
`/tmp` cannot paint inside the budget while the whole listing crosses the wire
as it does now. Closing that gap means changing what crosses the wire: a more
compact encoding, a listing ordered and paged by the server, or the bounded
listing 013 leaves open. Each is its own record.
