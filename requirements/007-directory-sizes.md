---
id: 007-directory-sizes
title: Aggregated directory sizes, opt-in and progressive
status: planned
rank: 7
tags: [tree, server, perf]
blocks: []
blocked_by: []
research: [../.nightshift/research/2026-07-17-broot-engine.md, ../.nightshift/research/2026-07-18-file-explorer-vs-fex-comparison.md]
adrs: [ADR-0025, ADR-0031]
shipped: null
updated: 2026-07-20
---

# Aggregated directory sizes

Aggregated bytes for directories — what broot's size mode really shows — as an
**opt-in**, because it costs a walk.

This is the performance rabbit hole of the backlog, and the one remaining item
that is *inherently* performance work: serious optimization starts here, as part
of the feature, not as a separate pass
([101-performance-budgets](101-performance-budgets.md)).

## Design

Engineer our own, per broot's `file_sum` design
(`../.nightshift/research/2026-07-17-broot-engine.md`):

- worker pool,
- path→sum cache,
- cancellation,
- hard-link dedup,
- progressive/async delivery, so navigation never blocks on a size scan.

fex's naive per-listing walk demonstrates the feature, not the design.
