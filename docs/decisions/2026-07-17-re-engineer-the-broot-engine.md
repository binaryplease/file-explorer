---
id: 2026-07-17-re-engineer-the-broot-engine
title: Re-engineer broot's engine in TypeScript, don't extract it
summary: "broot has no supported library API, so its search, tree-build and du algorithms are ported to TypeScript against its source as a reference spec; a Rust sidecar stays the measured-performance fallback."
decided: 2026-07-17
status: accepted
requirements: [007-directory-sizes, 010-broot-tree-display-and-navigation, 101-performance-budgets]
research: [../research/2026-07-17-broot-engine.md]
---

# Re-engineer broot's engine in TypeScript, don't extract it

## The question

broot is the model for this explorer's core loop. It is MIT-licensed Rust and it
publishes a `lib` target. Do we consume it — as a crate behind a sidecar, or by
lifting its modules — or do we reimplement it?

## Decided

**Re-engineer in TypeScript, using broot's source as the reference spec.**

broot's `lib` target is internal code organization, not an API: no doc comments,
no examples, no contract, no semver discipline on internals, and no prior art of
anyone consuming it as a library. The modules worth having are woven into
application machinery — an app-context type, a keypress-interruption primitive,
its own git ignorer — and depending on the crate compiles in the whole TUI and
preview stack.

The algorithms themselves are small and well isolated, and that is what makes
the port cheap: the search-language module is nearly self-contained, the
tree builder is ~450 lines of logic, and the parallel du is ~15 KB. Our
client/server shape differs from broot's single-process TUI anyway, so a
faithful *transplant* would be reshaped on arrival regardless. Bun workers cover
the du threading and `AbortController` replaces the interruption primitive.

## Rejected

- **Depend on the crate from a Rust sidecar.** Works today, breaks on any
  release, drags a huge dependency tree, and still needs IPC from Bun.
- **Extract-and-transplant three modules into a small Rust sidecar** (JSON over
  stdio/HTTP). Permitted by the licence with attribution, and mechanically
  plausible — but it costs a Rust toolchain and an IPC seam in a Bun project,
  plus permanent fork maintenance. **Kept as the fallback**, gated on a stress
  fixture proving Bun misses the performance budgets
  ([101-performance-budgets](../requirements/101-performance-budgets.md)).

## Consequences

- Fuzzy scoring is a port of broot's constants, so results are *ranked* rather
  than merely filtered (`shared/fuzzy.ts`).
- Recursive search is a bounded best-first walk with a time budget and
  leaf-trimming, not a client-side filter over loaded listings.
- Directory sizes ([007](../requirements/007-directory-sizes.md)) must be
  cached, interruptible and hard-link-aware by design, per the same spec.
- **Licence:** re-implementation from an MIT reference carries no obligation.
  Any literally-ported snippet keeps an attribution comment.

Full findings, including the scoring constants and the per-module entanglement
table: [`../research/2026-07-17-broot-engine.md`](../research/2026-07-17-broot-engine.md).
