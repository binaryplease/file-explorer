---
id: 012-publication-readiness
title: The repository is publishable by a stranger, and safe to have published
summary: "Publication is blocked on git history and on the remote's object store — not the tip: commits carry a sibling service's name (one in a subject line), a deleted file maps an outside decision corpus, and an unreferenced commit is still served by SHA after a reset. The route is settled: a new repository, never a rewrite. The tip's own gap is 121 source comments citing record numbers from that corpus."
status: planned
rank: 12
tags: [packaging, config]
blocks: []
blocked_by: []
research: []
decisions: []
conventions: []
shipped: null
updated: 2026-08-17
---

# Publication readiness

The repository is private. Making it public is **one-way**: a public repo is
cloned, forked and indexed within minutes, and re-privatising it detaches
existing forks into their own network rather than withdrawing them. So every
item below is checked *before* the flip, not after.

This requirement is the checklist. It is `planned`, not `standing` — it closes
when the repository is public and a stranger has built it from a fresh clone.

## What is already true

- **Licence settled.** MIT, copyright naming the author as a natural person, per
  the licence decision.
  `LICENSE`, `package.json`, `flake.nix` `meta.license` and the README section
  all agree.
- **No credentials, anywhere.** A full-history secret scan across every ref
  (73 commits, ~865 KB) reports no leaks. The one deploy-key variable that ever
  existed in the tree was always an empty placeholder or a schema field, never a
  value.
- **One copyright holder.** All 74 commits are authored and committed by the
  same person under one address, so there is no contractor, prior-employer or
  personal-account provenance question to resolve.
- **Dependency licences are permissive throughout.** 256 MIT, 40 ISC, 8
  BSD-3-Clause, 4 Apache-2.0, 3 MPL-2.0 (a CSS transformer used at build time),
  one OFL-1.1 (the variable font), one Unlicense, one 0BSD. Nothing reciprocal
  reaches the shipped code.
- **The repo's own gate is green.** `mise run typecheck` passes; `mise run test`
  runs 262 tests across 22 files, all passing.
- **The tracked tree names nothing outside itself.** The clean-up landed: the
  sibling-service requirement is now stated as a generic share service, and no
  outside name survives in any tracked file at the tip.

## Blockers

### B1 — History still names a sibling service and its private contract

The tip is clean; the history is not. Twenty-one commits carry an outside
service's name, its upload endpoint and header contract, and its two environment
variables — in `.mise.toml`, `server/config.ts`, `AGENTS.md`, `README.md`, and a
requirement file since renamed. One commit **subject line** names it as well, so
a rewrite of file contents alone would not be enough. Publishing exports all of
it.

### B2 — A deleted file maps an outside decision corpus

A requirements file removed from the tip enumerated eleven record numbers from a
decision corpus that lives outside this repository, each with a one-line summary
of what it binds. It is reachable in history. Related: an early planning file
carries an internal system's record identifier and its queueing conventions.

### B2b — The remote serves an unreferenced commit that no scan can see

Re-verified 2026-08-17. The reflog records two `reset: moving to HEAD~1` moves.
One of the commits they dropped, `73c0c03`, is reachable from **no ref** — not
locally, not on the remote — yet the hosting platform still returns the commit
*and its blobs* when queried by SHA. The full-history secret scan walked 75
commits and never saw it, because a clone only fetches reachable objects. Its
message and diff cite five record numbers from the outside corpus. The second
dropped commit, `be63bb0`, was never pushed and is local-only; its message names
an outside host application, so it must not travel either.

This blocker is why the route in the definition of done is no longer a choice:
a rewrite cannot reach an object the server keeps serving by SHA.

### B3 — 121 source comments cite record numbers from that corpus, at the tip

Live, in `src/`, `server/`, `shared/`, `scripts/`, `vite.config.ts` and
`flake.nix`. A reader with only this repository cannot resolve any of them.
`103-engineering-conventions` already carries the full text of each rule with a
slug; the mapping is complete, so the fix is to cite the slug. Many comments
weave the number into prose, so it is a real edit per site — its own change, as
`AGENTS.md` notes.

### B4 — The published repository description names the same service

The description carried on the hosting platform is not part of the tree and is
published with the repository. It currently names the sibling service and a
record number from the outside corpus. Same for topics, which are empty.

### B5 — The publication surface does not exist

Present: `README.md`, `LICENSE`. Absent: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
`SECURITY.md` with a live reporting path, and issue/PR templates. A security
reporting path and private vulnerability reporting are **preconditions**, not
follow-ups: publication creates an inbound obligation on day one.

### B6 — `AGENTS.md` instructs contributors to run a tool they cannot have

The docs index is generated by a command that exists only in the author's own
environment. A contributor who adds a file under `docs/` is told to regenerate
the index and cannot. Either vendor the generator into `scripts/`, or state that
index regeneration is a maintainer step.

### B7 — Attribution obligation for the bundled font

The variable font is OFL-1.1. Its copyright and licence notice must travel with
any artifact that embeds the font files, which the client build does. A
`THIRD-PARTY-NOTICES` file covering it (and any other notice-bearing dependency)
is part of the licence claim, not an optional extra.

### B8 — Packaging is undecided, and it is a fork in the finish line

`package.json` is `"private": true` at version `0.0.0`, yet declares `exports`
subpaths for a host application to mount the render layer. If this is consumed
as a dependency, a public repository alone is **not** published — a registry
version is. That is a mandate question, not an engineering one; note that a
registry publish packs from the *working tree*, so it needs its own artifact
scan independent of the git-history scan above.

## Definition of done

1. B1–B4 resolved by the route now recorded in
   the publication-route decision:
   a **fresh repository** from the reviewed tree, starting at a single
   "history starts here" commit, with this repository parked private under a
   legacy name. A history rewrite is not an option — B2b puts objects beyond
   the reach of one.
2. B3 and B5–B7 landed **in the tree, before the export.** Extraction copies a
   tree; it does not clean one, so a tip that still cites the outside corpus
   would simply be carried across into the new repository's first commit.
3. B8 answered by whoever holds the mandate; the finish line written down.
4. Public, and verified from a fresh clone in a clean environment with no
   credentials: install, build, test, run.
