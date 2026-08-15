---
id: 2026-07-17-broot-engine
title: "broot: extract a core engine, or re-engineer?"
summary: "broot publishes no usable library API and its interesting modules are welded to app machinery, but the algorithms are small enough to port — so the search scorer, tree builder and du spec are transcribed here as a reference spec."
researched: 2026-07-17
subject: broot 1.58.0
decisions: [2026-07-17-re-engineer-the-broot-engine]
requirements: [007-directory-sizes, 010-broot-tree-display-and-navigation, 101-performance-budgets]
---

# broot: extract a core engine, or re-engineer?

Researched 2026-07-17 against broot **1.58.0** (repo pushed 2026-07-11, MIT,
~12.8k stars). **Decision: re-engineer in TypeScript, using broot's source as
the reference spec. Extraction into a Rust sidecar is the measured-performance
fallback only.**

## Findings

### There is no extractable engine

- broot publishes a lib target (`has_lib: true` on crates.io, `src/lib.rs`
  re-exports ~30 modules), but it is internal code organization: **no doc
  comments, no examples, no API contract, no semver discipline on internals**.
- The interesting modules are woven into app machinery: `AppContext`
  (config/special paths), `Dam` (keypress-interruption primitive), broot's own
  git `Ignorer` (custom, built on `git2` — it does NOT use ripgrep's `ignore`
  crate).
- Depending on the crate compiles in the whole TUI/preview stack: `syntect`,
  `image`, `resvg`, `termimad`, `vte`, kitty graphics…
- No prior art found of anyone consuming broot as a library.

### But the engine algorithms are small and well-isolated

| Module | Size | What it is | Entanglement |
|---|---|---|---|
| `src/pattern/` | ~72 KB, 17 files | Search language: fuzzy/exact/regex/tokens/content | nearly self-contained (`secular`, `smallvec`) |
| `src/tree_build/` | ~26 KB | Search-driven tree builder | `AppContext`, `Dam`, git `Ignorer`, `id-arena` |
| `src/file_sum/` | ~15 KB | Parallel, cached, interruptible du | `Dam`, `AppContext`, `rayon` |

## The spec worth porting (verified from source)

### Tree building — `tree_build/builder.rs` (~450 lines of logic)

Breadth-first walk that:
1. gathers up to **10 × targeted_size** lines when a pattern is scoring
   (else stops at screen height);
2. keeps walking up to **900 ms** after the screen is full, looking for
   better matches;
3. trims with a priority queue that removes the **lowest-scoring leaves**
   while always preserving parent→child chains.

This is broot's feel: the visible tree is the best-scoring pruned view of a
much larger walk, rebuilt per keystroke, interruptible the moment you type.
Architecturally different from our prototype (client filters already-loaded
listings); this behaviour is server-side recursive search, shipped 2026-07-17.

### Fuzzy scoring — `pattern/fuzzy_pattern.rs`

> **Correction 2026-07-18** (found porting the builder): broot's **default
> search mode is `PathFuzzy`, not name-fuzzy** — `SearchModeMap::default` in
> `pattern/search_mode.rs` maps the empty prefix (`key: None`) to
> `SearchMode::PathFuzzy`, which scores the fuzzy pattern against the
> **subpath from the search root** (`Candidate.subpath`), not the filename.
> That is why a matching directory's children all display (their subpaths
> match through the parent component) and why matches show as
> `parent/child.ext` labels. Name-fuzzy exists behind the `n/` prefix. The
> scorer below is the same either way; only the scored string differs. Also
> note `make_bline`'s **depth doping**: line score = `10000 − depth`
> (+ pattern score + 10 for direct matches), so shallow matches outrank deep
> ones before trimming.

Greedy forward subsequence match with backtracking to compact gaps. Scoring
constants:

- `BONUS_MATCH` +50 000 (any match)
- `BONUS_EXACT` +1 000 (pattern length == candidate length)
- `BONUS_START` +10 (match at position 0)
- `BONUS_START_WORD` +5 (match after `_`, `-`, space)
- `BONUS_CANDIDATE_LENGTH` −1 per candidate char
- `BONUS_MATCH_LENGTH` −10 per matched-span char
- `BONUS_NB_HOLES` −30 per gap (hole count capped)
- `BONUS_SINGLED_CHAR` −15 per isolated matched char (not first/last)

Unicode-normalized via `secular`. ~100-line port into `shared/fuzzy.ts`
(ours matched unscored at the time of writing).

### Directory sizes — `file_sum/sum_computation.rs`

- configurable thread pool over an unbounded work channel;
- path→sum cache consulted at the first level (navigating up = instant);
- cancellation sentinel when the user types (`Dam`);
- hard-link dedup via an (inode, device) set for files with link count > 1.

Design answer to [007-directory-sizes](../requirements/007-directory-sizes.md).

## Options priced

1. **Depend on broot crate from a Rust sidecar** — works today, breaks on any
   release; huge dep tree; still needs IPC from Bun. Rejected.
2. **Extract-and-transplant** the three modules into a small Rust sidecar
   (JSON over stdio/HTTP). MIT permits with attribution; `pattern/` moves
   almost as-is, `tree_build`/`file_sum` need `AppContext`/`Dam` replaced with
   plain options + a cancellation token. Cost: Rust toolchain + IPC seam in an
   Bun project, permanent fork maintenance. **Fallback only**, gated
   on the stress fixture showing Bun can't hit the perf budgets.
3. **Re-engineer in TypeScript on Bun** — algorithms are small and documented
   above; our client-server shape differs from broot's single-process TUI
   anyway. Bun workers cover du threading; `AbortController` replaces `Dam`.
   **Chosen.**
4. Half-step if native walk speed is ever needed: shell out to `fd` /
   `rg --files` (ripgrep's `ignore` crate) instead of forking broot.

## Consequences

- Port fuzzy scoring constants into `shared/fuzzy.ts` (cheap, immediate ranking
  win — results ordered by score, not just filtered).
- Recursive search = bounded best-first walk with a time budget plus
  leaf-trimming, per the tree-building spec above.
- Directory sizes ([007](../requirements/007-directory-sizes.md)) = cached,
  interruptible, hard-link-aware du, per the `file_sum` spec above.
- License: re-implementation from an MIT reference carries no obligation;
  any literally-ported snippet keeps an attribution comment.

## Sources

- https://github.com/Canop/broot (`src/lib.rs`, `Cargo.toml`,
  `src/tree_build/builder.rs`, `src/pattern/fuzzy_pattern.rs`,
  `src/file_sum/sum_computation.rs`)
- https://crates.io/crates/broot
