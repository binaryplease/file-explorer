---
id: 012-publication-readiness
title: The repository is publishable by a stranger, and safe to have published
summary: "Publication is blocked on git history and on the remote's object store — not the tip: commits carry a sibling service's name (one in a subject line), a deleted file maps an outside decision corpus, and an unreferenced commit is still served by SHA after a reset. The route is settled: a new repository, never a rewrite. The tip is now clean and the finish line is a public repository only; what remains is the publication surface and the export itself."
status: in-progress
rank: 12
tags: [packaging, config]
blocks: []
blocked_by: []
research: []
decisions: []
conventions:
  - generated-sibling-index
shipped: null
updated: 2026-09-09
---

# Publication readiness

The repository is private. Making it public is **one-way**: a public repo is
cloned, forked and indexed within minutes, and re-privatising it detaches
existing forks into their own network rather than withdrawing them. So every
item below is checked *before* the flip, not after.

This requirement is the checklist. It is `in-progress`, not `standing` — B3, B6
and B8 have landed and the rest is named below; it closes when the repository is
public and a stranger has built it from a fresh clone.

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
  runs 328 tests across 25 files, all passing (re-measured 2026-09-09).
- **The tracked tree names nothing outside itself.** The clean-up landed: the
  sibling-service requirement is now stated as a generic share service, and no
  outside name survives in any tracked file at the tip. The source-comment half
  of it landed on 2026-09-09 — see B3 below.
- **The finish line is written down.** A public repository only, no registry
  version, per
  the finish-line decision.
  See B8.

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

### B3 — source comments citing record numbers from that corpus — **resolved 2026-09-09**

There were 118 of them at `3a4907b`, across 56 tracked files in `src/`,
`server/`, `shared/`, `scripts/`, `vite.config.ts` and `flake.nix`, and a reader
with only this repository could resolve none. Almost all of them now name the
slug [`103-engineering-conventions`](103-engineering-conventions.md) carries
instead, rewritten per site rather than substituted, because most wove the
number into the sentence. `git grep -E "ADR-[0-9]{4}"` over the tracked tree
returns nothing outside `OPEN_SOURCING_PROGRESS.md`, which is the open-sourcing
run's own working file and does not cross into the new repository.

Three rules gained the clause their citing comments leaned on and `103` did not
yet state — the `zod-defaults` exemptions, `affordances-adjacent`'s
scope-of-effect clause, and `mise-task-flags`, which had no slug at all.

**Six sites end without a slug, deliberately.** Two cited rules that are not
conventions of this repo at all, and now state their constraint in their own
words: a general fail-loudly posture in `flake.nix`, and a
derived-from-a-sibling note in `shared/language.ts`. The other four had a better
target than a slug:

- `server/index.ts:95` and `:124` are **OpenAPI `description` strings**, served
  at `/api/openapi.json` and `/api/docs`. A slug in a published spec is no more
  resolvable to an API consumer than a record number, so the citation is dropped
  rather than translated. These are the only two non-comment lines this pass
  changed in shipped output (a `describe()` title in
  `server/services/public-origin.test.ts` is the third changed non-comment line,
  and it is test-local).
- `server/index.ts:197` points at
  [`100-loopback-only-service`](100-loopback-only-service.md) instead — the
  requirement that actually governs the loopback bind, which is more specific
  than any convention slug.
- `server/services/bind-exposure.ts:15` drops the pointer outright: the number
  it carried maps to `fail-loud-ports`, but that line is about the **bind
  address**, not a port conflict, so it was a mis-citation to begin with. The
  sentence states the rule in full and the module header carries the reasoning.

The same sweep took three non-`ADR` outside names the grep would have missed: a
sibling repository named in `shared/language.ts` and its test, an outside
concept number in `src/theme.css` and `README.md`, and the local notebook named
in `.gitignore` and `AGENTS.md`. Three of those four mentions are gone.

**One survives and needs an explicit sign-off before the flip:** the bare
`.nightshift` pattern at `.gitignore:37`. `AGENTS.md` scopes its no-outside-names
rule to `docs/`, source comments and itself, and offers "make it configuration"
as the escape — which an ignore pattern is. But it is the one place a stranger
still meets a name they cannot resolve, in a tree that becomes a public
repository's first commit and cannot be withdrawn. Keeping it is defensible, not
automatic; it is the mandate holder's call, not the builder's, and it is
recorded here unresolved rather than assumed.

`AGENTS.md`'s "Known gap, 2026-08-15" block described this pass as pending and
has been removed; the rule it guarded — cite the slug, never a number — is now
stated as a standing rule rather than an interim workaround.

### B4 — The published repository description names the same service

The description carried on the hosting platform is not part of the tree and is
published with the repository. It currently names the sibling service and a
record number from the outside corpus. Same for topics, which are empty.

### B5 — The publication surface does not exist

Present: `README.md`, `LICENSE`. Absent: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
`SECURITY.md` with a live reporting path, and issue/PR templates. A security
reporting path and private vulnerability reporting are **preconditions**, not
follow-ups: publication creates an inbound obligation on day one.

### B6 — `AGENTS.md` instructed contributors to run a tool they cannot have — **resolved 2026-09-09**

The docs index is generated by a command that exists only in the maintainer's
environment, and `AGENTS.md` told anyone adding a file under `docs/` to run it.

**Taken: index regeneration is a maintainer step.** `AGENTS.md` now says so, and
tells a contributor what to do instead — write the file, leave the marker block
untouched, note in the change description that the index needs rebuilding. The
three index files repeat it above their own tables. Nothing a contributor is
asked to do requires the generator.

**Vendoring it into `scripts/` was rejected.** It is an 862-line general-purpose
tool with an `init`/`info`/`ls` surface this repository does not use, and a copy
would be a fork that drifts from the one the maintainer actually runs. Worse, it
would put *two* generators behind one artifact: the moment they disagreed by a
byte, a contributor's honest rebuild would read as a stale index. A single owner
for a generated file is the same discipline `generated-sibling-index` states for
the listing itself.

A contributor who wants the table rebuilt in their own branch can still do it by
hand — the format is plain markdown between two marker comments, one row per
non-hidden file, documented in the index file itself — but nothing asks them to.

### B7 — Attribution obligation for the bundled font

The variable font is OFL-1.1. Its copyright and licence notice must travel with
any artifact that embeds the font files, which the client build does. A
`THIRD-PARTY-NOTICES` file covering it (and any other notice-bearing dependency)
is part of the licence claim, not an optional extra.

### B8 — Packaging was a fork in the finish line — **answered 2026-09-09**

`package.json` is `"private": true` at version `0.0.0`, yet declares `exports`
subpaths for a host application to mount the render layer. If this were consumed
as a dependency, a public repository alone would **not** be publication — a
registry version would be. It was a mandate question, not an engineering one.

**The mandate holder ruled: a public repository only, no registry version.**
Recorded in
the finish-line decision.

Two consequences land here. The definition of done below is now closed-ended —
its last item is the fresh-clone build, with no step after it. And the artifact
scan a registry publish would have needed (it packs from the *working tree*, so
the git-history scan does not cover it) is not owed. `package.json` is untouched:
it stays `"private": true` at `0.0.0`, which is what the ruling calls for.

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
   **B3 and B6 are done** (2026-09-09); B5 and B7 remain.
3. ~~B8 answered by whoever holds the mandate; the finish line written down.~~
   **Done** (2026-09-09): a public repository only, no registry version.
4. Public, and verified from a fresh clone in a clean environment with no
   credentials: install, build, test, run. **This is the last step** — per B8
   there is no registry publish after it.
