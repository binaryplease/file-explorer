---
id: 012-publication-readiness
title: The repository is publishable by a stranger, and safe to have published
summary: "Publication is blocked on git history and on the remote's object store — not the tip: commits carry a sibling service's name (one in a subject line), a deleted file maps an outside decision corpus, and an unreferenced commit is still served by SHA after a reset. The route is settled: a new repository, never a rewrite. The tip is now clean, licensed, documented for a stranger and carries its third-party notices; only the export itself remains."
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

This requirement is the checklist. It is `in-progress`, not `standing` — B3 and
B5–B8 have landed and the rest is named below; it closes when the repository is
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
- **Dependency licences are permissive throughout, and the notices ship.**
  [`THIRD-PARTY-NOTICES.md`](../../THIRD-PARTY-NOTICES.md) is the single source
  for the inventory and carries the per-licence counts, the reconciliation of
  the two packages an automated scan cannot classify, and the command to
  re-measure. Nothing reciprocal reaches the shipped artifact. See B7.
- **The repo's own gate is green.** `mise run typecheck` passes; `mise run test`
  runs 328 tests across 25 files, all passing (re-measured 2026-09-09).
- **The tracked tree names nothing outside itself.** True as of 2026-09-09, on
  every surface `AGENTS.md` binds *and* on the one it does not. The
  sibling-service requirement is stated as a generic share service; the source
  comments cite convention slugs rather than outside record numbers (B3); the
  last three sites — a commit subject quoted verbatim in a decision file, the
  local notebook named in this file, and the ignore pattern that named the same
  notebook — are gone. `git grep` over the tracked tree for every outside name
  in the inventory returns only this repository's own owner in README install
  commands, which is where the repository actually lives.
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
in `.gitignore` and `AGENTS.md`. Three of those four mentions went then; the
fourth was left open for a sign-off.

**That sign-off is now given, and the pattern is gone** (2026-09-09). The bare
notebook pattern has moved out of the tracked `.gitignore` into this clone's own
`.git/info/exclude`, which is git's home for an ignore rule that belongs to one
developer rather than to the project — untracked by construction, so it never
travels. `.gitignore` keeps a comment saying per-developer scratch is
deliberately not listed and where it goes instead: the instruction survives, the
name does not, and `git check-ignore` confirms the directory is still ignored
here. The reasoning, and the three arguments for keeping it that did not
survive, are in
the ignore-file decision.

**Two more sites were found and fixed on the same day**, both pre-existing and
both on surfaces `AGENTS.md` binds explicitly, which is why the claim above
needed correcting rather than merely extending:

- The publication-route decision
  quoted a commit **subject line** verbatim in order to prove that a
  content-only rewrite would not be enough — and that subject names the sibling
  service. The proof is unchanged and the name is gone: it now reads as a
  clean-up commit whose subject names the service it was removing. The deleted
  requirements file it cites by name in the next sentence is described rather
  than named for the same reason.
- This file named the local notebook directory while arguing about the ignore
  pattern above. Same surface, same rule; the paragraph is rewritten without it.

Unlike `OPEN_SOURCING_PROGRESS.md`, which the extraction drops as a sidecar,
everything under `docs/` **crosses into the new repository's first commit**. A
name that survives there is published irreversibly, which is why these were
precondition work rather than follow-ups.

`AGENTS.md`'s "Known gap, 2026-08-15" block described this pass as pending and
has been removed; the rule it guarded — cite the slug, never a number — is now
stated as a standing rule rather than an interim workaround.

### B4 — The published repository description names the same service

The description carried on the hosting platform is not part of the tree and is
published with the repository. It currently names the sibling service and a
record number from the outside corpus. Same for topics, which are empty.

### B5 — The publication surface did not exist — **resolved 2026-09-09**

Present then: `README.md`, `LICENSE`. Everything else is now written, in the
tree, and addressed to a stranger who has only this repository:

| File | What it carries |
| --- | --- |
| `CONTRIBUTING.md` | Setup without mise or Nix, the three gates, the fixture rule for any listing-path change, the two-file dependency change, and the responsiveness principle stated as the reason most patches come back. |
| `CODE_OF_CONDUCT.md` | Contributor Covenant 2.1, with the enforcement section rewritten around the channels that actually exist. |
| `SECURITY.md` | The private reporting path, response times a one-person project can keep, and an explicit in-scope / out-of-scope list. |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | Version, Bun version, which of the four run modes, the relevant `EXPLORER_*` variables, and the `Server-Timing` header for performance reports. |
| `.github/ISSUE_TEMPLATE/feature_request.yml` | Leads with the responsiveness principle and asks how the proposal stays off the navigation path. |
| `.github/ISSUE_TEMPLATE/config.yml` | Routes security reports away from the issue tracker before one is opened. |
| `.github/PULL_REQUEST_TEMPLATE.md` | The gates, the before/after benchmark, `deps:hash`, and the "leave the index markers alone" checkbox. |

`CONTRIBUTING.md` carries B6's answer in full: index regeneration is a
maintainer step, a contributor writes the file and leaves the marker block
untouched, and the pull-request template has a checkbox that says so.

**Two gaps stay open deliberately, and both belong to the mandate holder.**

- **The security path depends on a setting that does not exist yet.**
  `SECURITY.md` points at GitHub's private vulnerability reporting — the
  repository's Security tab, "Report a vulnerability". That is a per-repository
  setting, it can only be enabled on the *new* repository, and it is only
  available once that repository is public. Until it is switched on, the link in
  `SECURITY.md` is dead. Enabling it is therefore not a follow-up but part of the
  publication step itself, immediately after the visibility flip and before the
  repository is announced anywhere. `SECURITY.md` also gives a fallback that
  works with no settings at all: open an issue saying only that a private channel
  is needed, with no details.
- **No contact address is published anywhere**, because none has been designated
  for this project and inventing one is not the builder's call. `SECURITY.md`,
  `CODE_OF_CONDUCT.md` and the issue templates are all written to work without
  one, and `CODE_OF_CONDUCT.md` names the absence rather than hiding it. If the
  mandate holder wants a real address on any of the three, it is a one-line edit
  before the export.

There are **no workflow files** in `.github/`, only templates. That matters at
the flip: a new repository's Actions history goes public with it, and a workflow
carried across in the exported tree could have run while the repository was
private. Nothing here can have run.

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

### B7 — Attribution obligation for the bundled font — **resolved 2026-09-09**

The variable font is OFL-1.1, and its copyright and licence notice must travel
with any artifact that embeds the font files. The client build does exactly
that: `mise run build` copies **14 `.woff2` files** into `dist/client/assets/`,
and the Nix flake packages the same output into the `bfe` executable. So does
`dist/server/`, by serving it.

[`THIRD-PARTY-NOTICES.md`](../../THIRD-PARTY-NOTICES.md) discharges it. It
reproduces the Inter copyright line and the full OFL-1.1 text — which is what
§2 asks for, a stand-alone text file accompanying the distribution — and names
the two further conditions that bind anyone redistributing a build of this
project: the font may not be sold on its own, and a modified font may not keep
the name.

The same file covers every other dependency, because the licence claim is over
the whole tree and not just the one obligation that is hardest. Measured over
the full resolved dependency set on 2026-09-09: 308 packages, overwhelmingly MIT
and ISC, with five BSD-3-Clause, five Apache-2.0, three MPL-2.0, one 0BSD and
one Unlicense. Four entries needed judgement rather than a table row and each
has its reasoning written down:

- **None of the Apache-2.0 packages ships a `NOTICE` file** — checked on disk,
  not assumed — so nothing further is owed under its §4(d).
- **`dompurify` is dual-licensed `MPL-2.0 OR Apache-2.0`** and does reach the
  client bundle through `mermaid`. This project **elects Apache-2.0**, so no
  copyleft reaches the artifact.
- **The three MPL-2.0 packages** are a CSS transformer and two of its native
  binaries, used during the build and emitted into nothing.
- **`khroma` publishes no `license` field** in its `package.json`, so a scanner
  reports it unknown. Its shipped `license` file and README both say MIT. A
  metadata gap, not an unlicensed dependency.

Nothing in the tree is GPL, LGPL, AGPL, source-available or non-commercial, and
nothing conflicts with this project's own MIT licence.

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
2. ~~B3 and B5–B7 landed **in the tree, before the export.**~~ **Done**
   (2026-09-09). Extraction copies a tree; it does not clean one, so anything
   left here is carried into the new repository's first commit and published
   irreversibly. That made all four preconditions of the export rather than
   follow-ups to it. Two items remain outstanding but are **not** tree work:
   enabling private vulnerability reporting on the new repository (B5, only
   possible once it is public) and writing its description and topics (B4).
3. ~~B8 answered by whoever holds the mandate; the finish line written down.~~
   **Done** (2026-09-09): a public repository only, no registry version.
4. Public, and verified from a fresh clone in a clean environment with no
   credentials: install, build, test, run. **This is the last step** — per B8
   there is no registry publish after it.
