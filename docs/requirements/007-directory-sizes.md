---
id: 007-directory-sizes
title: Aggregated directory sizes, opt-in and progressive
summary: "Aggregated directory sizes are opt-in because they cost a walk — worker pool, path-to-sum cache, cancellation and hard-link dedup are the design, not extras."
status: planned
rank: 7
tags: [tree, server, perf]
blocks: []
blocked_by: []
research: [../research/2026-07-17-broot-engine.md]
decisions: [2026-07-17-re-engineer-the-broot-engine]
conventions: [never-hide-a-control, affordances-adjacent]
shipped: null
updated: 2026-07-20
---

# Aggregated directory sizes

Aggregated bytes for directories — what broot's size mode really shows — as an
**opt-in**, because it costs a walk.

This is the performance rabbit hole, and the one remaining requirement that is
*inherently* performance work: serious optimization starts here, as part of the
feature, not as a separate pass
([101-performance-budgets](101-performance-budgets.md)).

## Design

Engineer our own, per broot's `file_sum` design
([`../research/2026-07-17-broot-engine.md`](../research/2026-07-17-broot-engine.md)):

- worker pool,
- path→sum cache,
- cancellation,
- hard-link dedup,
- progressive/async delivery, so navigation never blocks on a size scan.

A naive per-listing `du` walk demonstrates the feature, not the design: it makes
every listing pay for the whole subtree, which is the responsiveness principle
inverted.
