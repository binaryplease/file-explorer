---
id: 012-publication-readiness
title: The repository is publishable by a stranger, and safe to have published
summary: "The repository is public under MIT and carries its whole history, built from a fresh credential-less clone by a stranger: licence, third-party notices, community surface and a live private reporting path all landed before the flip, and the route was a new repository because the old host kept serving commits no ref pointed at. The history terms the checklist had treated as confidential were ruled public by the mandate holder and crossed unchanged — the lesson being that a sweep hands over names, not verdicts."
status: shipped
rank: 12
tags: [packaging, config]
blocks: []
blocked_by: []
research: []
decisions: []
conventions:
  - generated-sibling-index
shipped: 2026-09-09
updated: 2026-09-16
---

# Publication readiness

**This shipped on 2026-09-09.** The repository is public under MIT, carries all
of its history, and has been built from a fresh clone with no credentials. The
file is kept rather than deleted, because publication is one-way and a reader
who wants to know what was checked before the flip — or who repeats the exercise
for another repository — needs the checklist *and* the two things it got wrong:
B1 inferred confidentiality from the shape of a string, and this file once
claimed no outside name survived at the tip while two did.

Making a repository public is **one-way**: it is cloned, forked and indexed
within minutes, and re-privatising it detaches existing forks into their own
network rather than withdrawing them. So every item below was checked *before*
the flip, not after. The one item that could not be — the private reporting
path, which is a setting that only exists on a public repository — was made part
of the flip itself rather than a follow-up to it.

## What is already true

- **Licence settled.** MIT, with the copyright notice naming the author as a
  natural person rather than a trade name, because a sole proprietorship has no
  legal personality that could hold the right. `LICENSE`, `package.json`,
  `flake.nix` `meta.license` and the README section all agree.
- **No credentials, anywhere.** A full-history secret scan across every ref
  (73 commits, ~865 KB) reports no leaks. The one deploy-key variable that ever
  existed in the tree was always an empty placeholder or a schema field, never a
  value.
- **One copyright holder.** Every commit is authored and committed by the same
  person under one address — 74 of them when this was first measured, all of
  them since — so there is no contractor, prior-employer or personal-account
  provenance question to resolve.
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
- **The finish line is written down.** Publication is complete when the reviewed
  tree is public and a stranger has built it from a fresh clone: a public
  repository only, no registry version, so the package stays `"private": true`
  and no artifact scan of the working tree is owed. See B8.

## Blockers, and how each one closed

### B1 — The history names things the tip does not — **resolved 2026-09-09, and this blocker was wrong**

The tip was cleaned; the history was not. A full-history sweep produced an
inventory of five term classes that appear in commits but not at the tip: two
names in file content, on eight commits and on fifteen; two commit subjects
carrying one of them; an opaque task-id trailer on eighty-six commits; and the
author line on every commit.

**This was recorded as a blocker on the sweep's own inference, and the inference
was wrong.** Nothing in the inventory was confidential: the mandate holder ruled
every row *may cross*, and the history was published carrying all of it — no
content rewrite, no subject rewrite, no mailmap. The prose edit this blocker
implied was never owed.

The lesson is the only durable part of B1, and it is worth more than the
blocker was: **a sweep's job is to hand the mandate holder names, not verdicts.**
A term that looks internal is not evidence that it is. The mechanical check —
one `git log --all -i -S<term>` per term, which finds file-content hits a
tip-and-messages grep misses — is still worth running; what it produces is
inventory, and inventory is for the mandate holder to rule on.

### B2 — A file deleted from the tip is still in the history — **resolved 2026-09-09**

A requirements file removed from the tip enumerated record numbers from a
decision corpus that lives outside this repository, each with a one-line summary
of what it binds; an early planning file carried a second such identifier and
its queueing conventions. Both are reachable in history, and both were covered
by the same ruling as B1: not confidential, and they crossed. The tip names
neither — [`103-engineering-conventions`](103-engineering-conventions.md) is the
only corpus this repository cites, and it is its own.

### B2b — A host serves unreferenced commits that no clone can see — **the one that settled the route**

Re-verified 2026-08-17. The reflog recorded two `reset: moving to HEAD~1` moves.
Both dropped commits were reachable from **no ref** — not locally, not on the
remote — yet the host still returned one of them *and its blobs* when it was
queried by SHA. The full-history secret scan walked every reachable commit and
never saw it, because a clone fetches reachable objects and nothing else.

This is the blocker that made the route in the definition of done a conclusion
rather than a preference: **a history rewrite cannot reach an object the host
keeps serving by SHA.** A rewrite moves refs; the orphan stays, and stays
fetchable by anyone holding its forty characters — which, on a public
repository, is anyone at all, for the reason the next paragraphs give.

The same mechanism is now visible on this repository, from the other side. It is
recorded here in full, because a reader who finds it should find it described
accurately rather than minimised: the 2026-09-10 pass that removed seven
non-architectural records from `docs/decisions/` rewrote every commit, and the
pre-rewrite objects remain resolvable by SHA on the host, so the removed files
are still readable through them. Three things sharpen that, and none of them is
an obstacle to a reader:

- **The SHAs are published.** No file in the tracked tree names them, which
  bounds nothing: the host's own activity feed does.
  `GET /repos/binaryplease/file-explorer/events` returns the force-push of
  2026-09-10T13:22:33Z with the `before` SHA it replaced, unauthenticated, and
  the public archive of that feed keeps the record after the API window closes.
  Reaching the pre-rewrite tree is one request, not forty guessed characters.
- **The trees did change.** Diffing the tagged commit before the pass against
  the one after it is 9 files and 526 deleted lines: the seven records, plus
  `docs/Decisions.md` and this file. Nothing outside `docs/` moved, and no source
  file did. The `v0.1.0` tag travelled with the rewrite while its release kept
  its 2026-09-09 timestamp, so a source archive taken from that tag on the day
  and one taken from it now are two different trees under one name.
- **They were at the public tip first.** The seven records were published
  normally, in the tip of a public repository, from 2026-09-09T19:01:36Z until
  the pass roughly eighteen hours later. Anyone could clone, fork or index them
  in that window; this is not residue that only a SHA reaches.

The mandate holder accepted all of it, and what makes it acceptable is the
content rather than the obscurity: the seven files were removed for belonging in
another directory, not for anything they said. One consequence is worth naming,
because it is the same lesson twice: one of the seven quotes B2b's unreferenced
commit by its full forty characters, so taking those SHAs out of *this* file's
text left them exactly where they were. The pre-rewrite copy of this file still
carries them too. A rewrite edits what a clone sees; it does not retract a
published string.

### B3 — source comments citing record numbers from that corpus — **resolved 2026-09-09**

There were 118 of them at `3a4907b`, across 56 tracked files in `src/`,
`server/`, `shared/`, `scripts/`, `vite.config.ts` and `flake.nix`, and a reader
with only this repository could resolve none. Almost all of them now name the
slug [`103-engineering-conventions`](103-engineering-conventions.md) carries
instead, rewritten per site rather than substituted, because most wove the
number into the sentence. `git grep -E "ADR-[0-9]{4}"` over the tracked tree
returns nothing — the run's own working file, the one place that still carried
such citations, stayed behind as a sidecar and was never extracted.

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
here. `.git/info/exclude` is where an ignore rule personal to one developer
belongs anyway — untracked by construction, so it never travels — which is what
settled it against the three arguments for keeping the pattern tracked.

**Two more sites were found and fixed on the same day**, both pre-existing and
both on surfaces `AGENTS.md` binds explicitly, which is why the claim above
needed correcting rather than merely extending:

- The record of the publication route quoted a commit **subject line** verbatim
  in order to prove that a content-only rewrite would not be enough — and that
  subject names the sibling service. The proof is unchanged and the name is
  gone: it reads as a clean-up commit whose subject names the service it was
  removing, and the deleted requirements file it cites is described rather than
  named for the same reason.
- This file named the local notebook directory while arguing about the ignore
  pattern above. Same surface, same rule; the paragraph is rewritten without it.

The run's own working file was dropped as a sidecar and never extracted, but
everything under `docs/` **crossed**. A name that survives there is published
irreversibly, which is why these were precondition work rather than follow-ups.

`AGENTS.md`'s "Known gap, 2026-08-15" block described this pass as pending and
has been removed; the rule it guarded — cite the slug, never a number — is now
stated as a standing rule rather than an interim workaround.

### B4 — The repository description and topics are published but not in the tree — **resolved 2026-09-09**

The description and topics a host carries are published with the repository and
are not reviewable in a diff, so nothing in the tree's own gate can catch them.
The description then named what B1 was about and cited a record number from the
outside corpus, and there were no topics at all.

Both were rewritten at the flip: the description now says what the product is,
and eight topics name the stack. Under the B1 ruling the rewrite was not owed —
it is kept because the description is better prose, not because the old one was
unsafe. **The general point survives the specific fix:** a repository's
published metadata is state on the host, it drifts out of step with the tree
without anything failing, and it is re-checked by looking at it.

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

**Two gaps belonged to the mandate holder. One is closed; one is still open by
choice.**

- **The security path depended on a setting that did not exist yet — closed.**
  `SECURITY.md` points at GitHub's private vulnerability reporting, the
  repository's Security tab, "Report a vulnerability". That is a per-repository
  setting and it only becomes available once the repository is public, so until
  it was switched on the link in `SECURITY.md` was dead. It was therefore not a
  follow-up but part of the publication step, and it ran in the same sitting as
  the visibility flip and before the repository was announced anywhere. It is
  enabled. `SECURITY.md` also gives a fallback that needs no settings at all:
  open an issue saying only that a private channel is needed, with no details.
- **No contact address is published anywhere — still true, and still the
  default.** None has been designated for this project, and inventing one is not
  the builder's call. `SECURITY.md`, `CODE_OF_CONDUCT.md` and the issue
  templates are all written to work without one, and `CODE_OF_CONDUCT.md` names
  the absence rather than hiding it. The cost is one genuinely awkward gap: a
  conduct report *about* the maintainer has no channel that does not reach the
  maintainer, and GitHub's own abuse form is the only route around it. Adding an
  address is a one-line edit at any time; an address once published is scraped
  within minutes and cannot be withdrawn, which is the asymmetry that keeps the
  default where it is.

There are **no workflow files** in `.github/`, only templates. That mattered at
the flip: a repository's Actions history goes public with it, and a workflow
carried across in the exported tree could have run while the repository was
private. Nothing here can have run, and nothing has: the repository has no
Actions runs at all.

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

**2026-09-16 — a second font joined, and the obligation scaled with it.** The
monospace face moved off the system font stack onto self-hosted Fira Code
(`@fontsource-variable/fira-code`), which is OFL-1.1 on the same terms as Inter.
The counts above are the 2026-09-09 measurement and stay as the record of that
date; as of 2026-09-16 the build copies **21 `.woff2` files** (14 Inter, 7 Fira
Code, +124K) and the tree resolves to 309 packages with two OFL-1.1 entries.
`THIRD-PARTY-NOTICES.md` now names both fonts over one copy of the licence text,
and both reserved font names under §3. The shape of the discharge did not
change — which is the point: adding a bundled asset is a notice edit, not a new
decision.

### B8 — Packaging was a fork in the finish line — **answered 2026-09-09**

`package.json` was `"private": true` at version `0.0.0`, yet declares `exports`
subpaths for a host application to mount the render layer. If this were consumed
as a dependency, a public repository alone would **not** be publication — a
registry version would be. It was a mandate question, not an engineering one.

**The mandate holder ruled: a public repository only, no registry version.**

Two consequences land here. The definition of done below is closed-ended — its
last item is the fresh-clone build, with no step after it. And the artifact scan
a registry publish would have needed (it packs from the *working tree*, so the
git-history scan does not cover it) is not owed. `package.json` keeps
`"private": true`, which is what the ruling calls for; its `version` moved
`0.0.0` → `0.1.0` for the tag, because a tagged release with no version in the
manifest reads as an oversight to anyone who checks both.

## Definition of done

All four are done, on 2026-09-09.

1. ~~B1–B4 resolved by the settled route: a **fresh repository** from the
   reviewed tree, with the original parked private under a legacy name. A
   history rewrite is not an option — B2b puts objects beyond the reach of
   one.~~ **Done.** The route held: this repository was created fresh from the
   reviewed tree and the original was parked private, then archived read-only.
   The *content* of B1 and B2 turned out not to need the route at all — the
   mandate holder ruled every swept term *may cross* — but B2b did, and one
   surviving blocker is enough to settle a route.
2. ~~B3 and B5–B7 landed **in the tree, before the export.**~~ **Done.**
   Extraction copies a tree; it does not clean one, so anything left here is
   carried into the first commit and published irreversibly. That made all four
   preconditions of the export rather than follow-ups to it. The two items that
   were not tree work are done too: private vulnerability reporting is enabled
   (B5, possible only once public), and the description and topics are written
   (B4).
3. ~~B8 answered by whoever holds the mandate; the finish line written down.~~
   **Done:** a public repository only, no registry version.
4. ~~Public, and verified from a fresh clone in a clean environment with no
   credentials: install, build, test, run.~~ **Done.** Public under MIT, tagged
   `v0.1.0`, and verified from an unauthenticated clone with the global and
   system git config and the SSH identity disabled: install against the
   lockfile, `tsc --noEmit`, the full test suite, both builds, and the server
   booting and answering its discovery route. **This was the last step** — per
   B8 there is no registry publish after it.

## What the history carries, and what it does not

Recorded once, here, so that nobody re-derives it from the log:

- **The whole history is public**, back to the root commit. Every commit is
  authored and committed by one person under one public address.
- **This repository stands alone.** The tracked tree names no sibling project,
  no outside record number and no private host; `git grep` is the check, and it
  is a check anyone can run.
- **Objects that no ref points at are still served by SHA**, both on the host
  this repository was extracted from (B2b, which is why it was extracted) and on
  this one after the 2026-09-10 `docs/decisions/` pass (B2b again, accepted).
  Treat a rewrite as a change of what a *clone* sees, never as a deletion — and
  on a public repository not even as a change of what a *reader* can reach, since
  the host's events feed hands out the SHA the rewrite replaced.
