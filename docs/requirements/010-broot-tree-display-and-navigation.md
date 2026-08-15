---
id: 010-broot-tree-display-and-navigation
title: broot tree display and navigation parity (R1–R8)
summary: "broot's exact connectors, screen-fit auto-open and interleaved alpha order are delivered; vim keys, the back-vs-parent split and the extra columns are open."
status: in-progress
rank: 10
tags: [tree, client]
blocks: []
blocked_by: []
research: [../research/2026-07-17-broot-tree-display-and-navigation.md, ../research/2026-07-17-broot-engine.md]
decisions: [2026-07-17-re-engineer-the-broot-engine]
conventions: [highlight-what-matched, share-the-invariant, interaction-token, affordances-adjacent]
shipped: null
updated: 2026-07-28
---

# broot tree display and navigation parity

The visual look (exact connectors, screen-fit ` …` truncation marker, column
set/defaults) and the navigation feel (vim keys, back-as-history vs parent,
Enter-focus / root-goes-up, Tab match-walking) are specced against **broot 1.58
source** in
[`../research/2026-07-17-broot-tree-display-and-navigation.md`](../research/2026-07-17-broot-tree-display-and-navigation.md)
as R1–R8. That research file is the spec; this file tracks what is delivered.

## Still open

- **R3 — columns**: dates, permissions, git status (git is
  [005](005-git-status-column.md)).
- **R4 — vim keys.**
- **R5 — back-vs-parent split**: broot's `back` is history, not "go up"; ours
  currently conflates them. `focusNavigation.ts` already models the history side.
- **R8 — computed screen-fit openness vs manual expand/collapse** was the
  architectural decision the rest hang on, and was deferred as one. It was
  answered in practice by the 2026-07-21/27 auto-open work below
  (computed openness won, with manual toggles layered over it) — worth an
  explicit ratification if the question resurfaces.

## Delivered — three specs, 2026-07-21 (overshoot fixed 2026-07-27)

1. **The root line is a separate signal, not content.** The current-directory
   line was the first *scrolling* row; it is now pinned on its own `bg-chrome`
   band above the scroll with a `border-b` divider (the same chrome idiom as the
   title bar / command bar), so it never scrolls away and reads as the view's
   anchor rather than an entry. Still selectable — Enter/double-click walks up.
   `TreeView.tsx`: the root line is lifted out of the `[data-tree-scroll]`
   container.

2. **Screen-fit auto-open (broot's computed openness, R8/R2).** New pure
   `planAutoOpen` in `lib/tree.ts`: breadth-first, shallowest-and-alpha-first,
   opening the next depth of directories until the viewport row budget is spent,
   so a short listing fills the empty space instead of leaving it blank. Wired in
   `App.tsx` as an after-paint effect (enrichment — never blocks the core
   listing) that descends one level per pass as listings load; capacity is
   `measureTreeRowCapacity()` off the scroll viewport, re-planned on resize.
   Three-layer open model: `effectiveOpen = (autoOpen ∪ manualOpen) \
   manualClosed`; the fill freezes once the user toggles anything by hand, and
   resets per focus.

   **Overshoot fixed 2026-07-27** (the fill expanded more than the height could
   show). The planner now grants child rows one at a time, round-robin across the
   open directories (broot's builder), so siblings share the space evenly, and it
   never exceeds `rowCapacity`: a directory that does not fit entirely is opened
   partway — `planAutoOpen` returns per-directory `childRowLimits`,
   `buildTreeRows` truncates to them and appends a broot-style "N unlisted"
   pruning row (R2's partial-open case, now implemented; the row type is the
   search cut's, renamed `PrunedRow`). The pruning row's cost is escrowed from
   the moment a directory opens, so the plan is exact; a directory one child short
   of complete completes for free ("1 unlisted" never renders). Clicking a
   truncated directory *completes* the open (promotes it to a manual,
   un-truncated open) instead of collapsing it; the next click collapses.
   `measureTreeRowCapacity` now floors (padding excluded) instead of ceiling, so a
   partial last row is no longer counted as fillable space. Verified:
   `[data-tree-scroll]` scrollHeight == clientHeight after fill.

   **Row grid unified 2026-07-28.** The plan was exact in *rows* but not in
   *pixels*: the "N unlisted" and hidden-tally lines rendered at 11.5px/`py-px`
   (21px) against an entry row's 27px, so each one the fill planned left ~6px
   blank, and their `ch`-measured connectors broke the tree's vertical guides.
   All row kinds now share `TREE_ROW_METRICS_CLASS` (interaction styling is a shared
   token — one owned token, composed by every surface); annotations recede by colour, not size. Row
   height is also read fractionally now — `getBoundingClientRect().height`, not
   a rounded `offsetHeight`, whose error multiplies by the row count. Trailing
   space is down to `pb-2.5` plus a sub-row remainder, which is the screen-fit
   floor working as intended, not a gap.

   **Rails drawn rather than written, same day.** Equal row heights still left a
   hole at every row *boundary*: a `│` glyph is ~16px of ink in a 26.9px row, so
   the rails read as dashed lines. Glyphs cannot span a browser's leading, so
   R1's connectors are now a `TreeConnector` descriptor rendered by a shared
   `TreeRails` component as CSS rules over the row's full height. broot's
   geometry is preserved exactly — three cells per level, rail centred in the
   first, arm reaching the text — so this stays faithful to §1.3 while dropping
   the box-drawing characters that §1.3 specifies as *strings*. Measured zero
   seam gaps over 81 rail segments across browse and search.

3. **Interleaved alpha order (broot `Sort::None`, R-sort).** Browse no longer
   groups folders first or orders files by size — one `compareEntryNames`
   (case-insensitive, numeric) drives both browse and search rows, files and
   directories mixed. The dirs-first + size-desc `compareEntries` was dropped.

Render-verified in both themes at `?path=Music`; `lib/tree.test.ts` covers the
sort and the fill planner (170 tests green).

## Related fixes

- ~~Tree names truncated ~104px too early when the size **bars** are off.~~ →
  fixed 2026-07-21. The row grid template was the hardcoded literal
  `grid-cols-[1fr_104px_66px]` on both the root line and every entry row, so the
  104px bar track stayed reserved-and-emptied when `showSizes` was false.
  Factored into `rowGridColumnsClass(showSizes)` in `TreeView.tsx` (one shared
  invariant for both rows) → `grid-cols-[1fr_66px]` when bars are hidden, and the
  empty spacer is dropped from the DOM. Render-verified both states.
- **Single click navigates** (2026-07-27): the Enter action (broot `open_stay`)
  moved from `onDoubleClick` to `onClick`; refined the same day into
  file-previews / directory-enters — see
  [006-preview-panel](006-preview-panel.md). The inline expand/collapse toggle was
  only reachable via that single click and had no keyboard binding, so it and the
  orphaned `toggleDirectory` chain were removed; auto-open still expands
  directories inline.

## Engine note

[**Re-engineer, don't extract**](../decisions/2026-07-17-re-engineer-the-broot-engine.md)
(2026-07-17). broot has no supported library API; the algorithms are small and
MIT, so they are ported in TypeScript with broot's source as the reference spec.
A Rust-sidecar extraction is the fallback, gated on a stress fixture proving Bun
misses the budgets
([`../research/2026-07-17-broot-engine.md`](../research/2026-07-17-broot-engine.md)).
