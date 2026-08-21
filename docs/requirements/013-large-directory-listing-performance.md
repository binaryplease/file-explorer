---
id: 013-large-directory-listing-performance
title: A very large directory lists inside the budget
summary: "The stress fixture and per-listing timing that gate every optimization here are built, and the per-entry `lstat`+`stat` pair is gone: 40 000 entries went from ~243ms to ~98ms — a real ~2.4× cut that still misses the budget at ~2×. The few-thousand-entry scale the budget is written for already met it before this change and still does. What is left is `childCount`: one `readdir` per subdirectory, ~61ms of the remainder."
status: in-progress
rank: 13
tags: [perf, server, tree]
blocks: []
blocked_by: []
research: [../research/2026-07-17-broot-engine.md]
decisions: [2026-07-17-re-engineer-the-broot-engine]
conventions: [never-hide-a-control, emit-nullish]
shipped: null
updated: 2026-08-21
---

# A very large directory lists inside the budget

## What landed (2026-08-21)

**The gate first.** [101](101-performance-budgets.md) forbids optimizing
anything here before a fixture reproduces the miss, and that gate did not exist
— the numbers below the fold were an ad-hoc probe of one machine's real `/tmp`,
which differs per machine and per day. Both halves of it are now built, and they
are the thing every future performance claim about this path passes through:

- [`../../scripts/stress-fixture.ts`](../../scripts/stress-fixture.ts)
  (`mise run stress:fixture`) generates the tree, idempotently, outside the
  repo. Four cases, because the listing path costs them differently:
  `wide-mixed` (40 000 entries, 93% of them directories — the shape the miss was
  measured on), `few-thousand` (4 000, same mix — the scale the budget is
  *written* for), `wide-files` (40 000 plain files, isolating per-entry `stat`
  from child-directory cost), and `deep` (256 nested levels, for the
  `.gitignore` chain). Each mixed case carries one contained and one escaping
  symlink, so confinement stays exercised at scale.
- **Per-listing timing** is reported by the listing itself, in phases *and* in
  syscalls: `listDirectory` returns a
  [`ListingTiming`](../../server/services/listing-timing.ts) beside its result,
  and the route renders it into a `Server-Timing` response header on every
  listing — so a miss is legible in a browser's network panel with nothing
  restarted. `EXPLORER_TIMING=true` additionally logs one line per listing.
  [`../../scripts/bench-listing.ts`](../../scripts/bench-listing.ts)
  (`mise run bench:list`) drives the real route and reports against the budget.

The miss reproduced against the fixture at `243ms` — within a few percent of the
`/tmp` probe, which is what a fixture is for.

**Then the fix.** `describeEntry` issued an `lstat` *and* a `stat` per entry.
Both are now unnecessary for most entries: the directory's own
`readdir(…, { withFileTypes: true })` already carries each entry's kind — the
shape the recursive search walk has always used, which this path predated. Past
that one `readdir`, a syscall is issued only where the dirent cannot answer:

| Entry | Before | Now |
|---|---|---|
| directory | `lstat` + `stat` + `readdir` | `readdir` (for `childCount`) |
| file | `lstat` + `stat` | `stat` (size, execute bit) |
| socket / FIFO / device | `lstat` + `stat` | none |
| symlink | `lstat` + `stat` | `stat` — a link is the one kind that must be followed |

A filesystem that does not fill in the kernel's `d_type` reports every entry as
unknown; that case falls back to the `lstat` no other entry pays for, rather
than being folded into `other`, which would blank the listing on those mounts.
Two smaller cuts came with it: the `.gitignore` verdict is applied inside the
per-entry describe instead of being patched onto the finished entry (one fewer
async frame per entry — 40 000 of them), and the entry path is concatenated onto
a prefix built once per listing rather than re-normalized by `join` per entry.

Measured on the fixture, `GET /api/fs/list` end to end, median of 7 runs after
one warm-up, warm cache:

| Case | Entries | Before | After | Budget |
|---|---|---|---|---|
| `few-thousand` | 4 000 (3 720 dirs) | ~29ms | ~21ms | met before *and* after |
| `wide-mixed` | 40 000 (37 200 dirs) | ~243ms | **~98ms** | 2.0× |
| `wide-mixed`, confined | 40 000 | ~249ms | **~100ms** | 2.0× |
| `wide-files` | 40 000 (0 dirs) | ~177ms | **~79ms** | 1.6× |

Read the first row honestly: **the budget as written was already met before this
change** (~29ms against ~50ms), and the improvement there is within run-to-run
variance on some machines — 3 720 child readdirs dominate at that scale, and
this change did not touch them. The result worth quoting is the 40 000-entry
row: a real ~2.4× cut that still misses at ~2× budget.

Syscalls for `wide-mixed` went from **80 000 stat/lstat + 37 200 child readdir**
to **2 802 stat + 37 200 child readdir**. Payload is unchanged at 6.45 MiB: every
entry is still listed, and every property is still emitted
([`emit-nullish`](103-engineering-conventions.md)).

Confinement's *response* behaviour is untouched and measurably so. An escaping
symlink is still a row with every fact about its target withheld, and for an
entry that is a symlink when the directory is read, that target is never
stat-ed — now asserted by counting rather than by inspecting the response: a
listing of nothing but escaping links completes with **zero** stats and zero
child readdirs, and one `realpath` each purely for the containment check
([`../../server/services/filesystem.test.ts`](../../server/services/filesystem.test.ts)).
That is a stronger claim than the previous tests made, which asserted only that
the response withheld the metadata — not that the server never asked for it.

**That is a steady-state property, and the qualifier is load-bearing.** Every
entry's kind is snapshotted once, from the parent's single
`readdir(…, { withFileTypes: true })`, and the confinement guard fires on the
*snapshot*. An entry that was a real directory when the directory was read, and
becomes a symlink out of the root before it is described, is followed without a
containment check — `childCount` for the new target, emitted with
`escapesRoot: false`. The same shape applies to the file branch's size and
execute bit. Metadata only; no file content crosses the boundary; and it needs a
writer inside a confined root, which is not the default posture.

This race is **not new** — the previous code had no containment check on the
non-symlink path either. What is new is its width. The check used to be an
`lstat` microseconds before the `stat` that followed the path; it is now the
parent `readdir`, and because all entries are described through one
`Promise.all`, that is the whole describe phase ahead of the following syscall —
~76ms on the 40 000-entry fixture rather than microseconds. Closing it properly
means resolving each entry through a descriptor rather than a path (the shape
`openReadableFile` already uses for file reads), which costs a syscall per entry
and so has to be designed against this record's budget rather than bolted on.
Not attempted here; recorded so the next reader does not have to rediscover it
from a benchmark.

## What remains

**The budget as written is met — it already was — and the 10× stretch this
record asks for is not.** [101](101-performance-budgets.md) budgets
`< ~50ms for a few-thousand-entry directory`; 4 000 entries served in ~29ms
before this change and ~21ms after. A 40 000-entry directory serves in ~98ms.

Where those ~98ms go — measured, not apportioned:

| | `wide-mixed`, 40 000 entries |
|---|---|
| child `readdir` per subdirectory, for `childCount` | **~61ms** |
| the directory's own `readdir` | ~10ms |
| 2 802 stats + building 40 000 entry objects + `.gitignore` | ~14ms |
| route: `JSON.stringify` | ~6ms |
| route: framework + collecting 40 000 short-lived objects | ~9ms |
| payload the client then receives | 6.45 MiB |

So the residual is **syscalls, not serialization**: ~71ms of the ~98ms is
filesystem work, and ~61ms of that is `childCount` alone. Skipping `childCount`
and changing nothing else takes the per-entry phase from 86.0ms to 24.6ms on the
same directory, which puts the whole request around ~40ms — inside the budget.
So one item stands between this record and its stated outcome, and it is the one
[101](101-performance-budgets.md) already names as "the first thing to drop or
batch".

**It was not dropped here, and the reason is not performance.** `childCount` is
read at *listing* time by the screen-fit auto-open in
[010](010-broot-tree-display-and-navigation.md): `planAutoOpen` uses a child
directory's count to decide whether to descend into it at all, and to pace the
round-robin fill. Deferring the counts to async enrichment — which is what the
responsiveness principle otherwise prescribes for them, and what would meet the
budget — makes every unfetched directory look empty at plan time, so a shipped
feature stops descending until enrichment lands. That is a redesign of
auto-open's pacing, not a mechanical move of a field, and it wants its own
record and its own before/after. **Nothing here was bounded or truncated to
reach a number**: the listing carries every entry.

The other item, unchanged and still unmeasured: the client renders all 40 000
rows. See out of scope.

## Current behaviour, as measured at `HEAD` on 2026-08-19

Kept for the record — this is the state the work above started from, and the
`/tmp` probe the fixture replaced.

`listDirectory` readdirs the directory for names only, then per entry
`describeEntry` issues an `lstat` **and** a `stat`, and for every entry that is a
directory one further full `readdir` to count its children — so the cost of
listing a directory includes reading the contents of all its child directories.
All of it is issued at once through a single `Promise.all` over every entry. The
recursive-search walk ported from broot's builder takes dirent kinds from
`readdir(…, { withFileTypes: true })` and stats nothing during the walk; the
listing path predated it and did not share that shape.

Measured by calling the service directly (unconfined, warm cache, second run),
against that machine's real `/tmp`:

| Directory | Entries | Of which directories | Listing | Payload |
|---|---|---|---|---|
| `/tmp`    | 37 071  | 34 442               | ~202ms  | 6.4 MiB |
| `/`       | 18      | 17                   | ~17ms   | —       |

No security surface: this is latency and payload size only.

## Desired outcome

Entering a directory of tens of thousands of entries serves and paints inside
the budgets in [101-performance-budgets](101-performance-budgets.md).

## Done when

A listing of a ~40 000-entry directory meets the `GET /api/fs/list` budget in
[101-performance-budgets](101-performance-budgets.md), demonstrated by the
stress fixture and per-listing timing that requirement's gate demands, with the
repo's own checks (`mise run typecheck`, `mise run test` — AGENTS.md, Dev
commands) green.

The fixture, the timing and the checks are done. The 40 000-entry budget is not
— see "What remains".

## Out of scope

- Client row virtualization. The tree still renders every row, and 37 000 rows
  is far past the ≳5–10k threshold [101](101-performance-budgets.md) flags —
  but it is unmeasured here, and it is a second outcome with its own record.
- Large *files*: preview reads are already bounded at `HEAD` (1 MiB / 4 000
  lines windowed, 8 MiB / 40 000 lines full —
  [`../../server/services/preview.ts:35`](../../server/services/preview.ts#L35)),
  and the one open suspect there is already recorded in
  [101](101-performance-budgets.md).
- Aggregated directory sizes, which are [007](007-directory-sizes.md).

## Open questions

- Does a directory of tens of thousands of entries stay listed **in full**, or
  may the listing be bounded with a visible count of what is not shown (as
  broot's tree reports unlisted entries)? This changes what the wire carries and
  what the user sees, so it is a product call, not an implementation detail —
  [`never-hide-a-control`](103-engineering-conventions.md) binds either way.
  **Still open, and deliberately untouched by the work above**: the listing
  carries every entry, and the residual was reported rather than bounded away.
- Does `childCount` stay on the listing, or become async enrichment? The
  measurement now says it is the whole remaining gap, and
  [101](101-performance-budgets.md) already sanctions dropping or batching it —
  but the auto-open coupling described above makes it a redesign of a shipped
  behaviour rather than a field move. Needs its own record.
- `rank: 13` was appended, not argued against
  [012-publication-readiness](012-publication-readiness.md).
