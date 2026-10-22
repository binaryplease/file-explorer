---
id: 013-large-directory-listing-performance
title: A very large directory lists inside the budget
summary: "A 40 000-entry directory now lists inside the ~50ms budget, every entry still listed: `childCount` became enrichment served after the listing by `GET /api/fs/child-counts`, and auto-open waits for it rather than misreading null as empty — ~104–117ms → ~33–47ms on the fixture, measured. A 40 000-plain-file directory still misses (~83–89ms, one `stat` per file); that is a different cost, recorded in 101."
status: shipped
rank: 13
tags: [perf, server, tree]
blocks: []
blocked_by: []
research: [../research/2026-07-17-broot-engine.md]
decisions: [2026-07-17-re-engineer-the-broot-engine, 2026-10-22-child-counts-are-enrichment]
conventions: [never-hide-a-control, emit-nullish]
shipped: 2026-10-22
updated: 2026-10-22
---

# A very large directory lists inside the budget

## What landed (2026-10-22) — `childCount` is enrichment

The one item "What remains" named below, resolved. The design question it
raised — how auto-open keeps working when the counts no longer arrive with the
listing — is settled in
[2026-10-22-child-counts-are-enrichment](../decisions/2026-10-22-child-counts-are-enrichment.md);
in brief:

- **The listing no longer counts.** `GET /api/fs/list` emits `childCount: null`
  for every entry (`emit-nullish`: the field is still there) and issues **zero**
  child `readdir`s. The counts are served by a new
  `GET /api/fs/child-counts?path=…` — `{ relativePath, childCounts: [{ name,
  childCount }] }`, one per subdirectory — which the client fires after the tree
  has painted, merges into the stored listing by name, and aborts on
  navigate-away. The server checks the abort between batches of 2 048 child
  readdirs, so an abandoned count stops issuing syscalls: a request cut off at
  15ms against the fixture stopped at 24 757 of 37 200.
- **Confinement is the listing's own.** The counts read the directory through
  the same `readConfinedDirectory` and resolve each entry through the same
  `resolveDirentTarget` as the listing, so a refused path is refused with the
  same status and an escaping symlink is never stat-ed or counted — it is absent
  from the counts. Asserted by counting, beside the listing's existing
  assertions: a root of nothing but escaping links costs the counts endpoint
  zero stats and zero child readdirs
  ([`../../server/services/filesystem.test.ts`](../../server/services/filesystem.test.ts)).
- **Auto-open waits instead of guessing.** `planAutoOpen` now distinguishes "not
  counted yet" from "empty": a plan that needs the count of a directory whose
  parent's counts have not arrived is *provisional* — it names that parent in
  `pendingChildCountPaths`, and the caller applies none of it, fetches the
  counts and re-plans. Every plan that reaches the screen is therefore computed
  from the same data as before, and the fill descends and paces exactly as it
  did; rendered side by side against `HEAD` on the same tree, the auto-opened
  rows were identical. The screen-fit tests are unchanged in what they assert;
  each now states that its listings' counts have arrived, and new tests pin the
  waiting.
- **Two cuts the measurement then exposed**, on the listing path itself: a plain
  directory — 93% of the fixture — is now described synchronously, in place,
  rather than through one of 40 000 async frames, and an entry whose dirent
  already answers its kind skips the shared resolver's async frame too. Without
  them the listing met the budget at 48.7ms, with no margin.

Measured on this machine, warm cache, `bun scripts/bench-listing.ts`, median of
7 runs after one warm-up. *Before* is `HEAD` before this change, run from the
same fixture on the same machine the same day; *after* is the code as it stands
here; a range is the spread of the medians of repeated runs:

| Case | Before | After | Budget |
|---|---|---|---|
| `wide-mixed`, 40 000 entries (`mise run bench:list`) | 103.8–117.3ms | **32.5–46.8ms** | met, 0.7–0.9× |
| `wide-mixed`, confined (`--confine`) | 93.5–111.1ms | **35.8ms** | met, 0.7× |
| `few-thousand`, 4 000 entries (`--path few-thousand`) | 30.5–35.9ms | **5.2ms** | met, 0.1× |
| `wide-files`, 40 000 plain files (`--path wide-files`) | 77.1–101.8ms | 83.3–88.6ms | **missed**, unchanged |

Syscalls for `wide-mixed`: **2 802 stats + 37 200 child readdirs → 2 802 stats
+ 0 child readdirs**. The deferred counts request costs 73.8–109.7ms on the
same directory (80.4ms confined, 27.8ms for `few-thousand`) — after paint, off
the budget, and reported by the bench on its own line so the moved work stays
visible. Payload went from 6.45 to 6.56 MiB: `null` is three bytes longer than
a one-digit count. Every entry is still listed; nothing was bounded or
truncated.

**Read the last row honestly.** `wide-files` is a 40 000-entry directory too,
and it still misses at ~1.7×: it holds no directories, so `childCount` was never
its cost — one `stat` per file, for size and execute bit, is. This change neither
helped nor hurt it (within run-to-run noise, after an early regression from an
extra promise per entry was found by exactly this comparison and removed). This
record's "Done when" — the representative mixed directory the miss was measured
on — is met; the all-files shape is named in
[101](101-performance-budgets.md) as the next measured miss and wants its own
record.

`scripts/bench-listing.ts` now exits non-zero when it reports MISSES, so the
gate is decided by exit code.

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

Nothing this record set out to do. Recorded so they are not lost, and each
outside its scope:

- **A directory of plain files** — see the `wide-files` row above and
  [101](101-performance-budgets.md).
- **The client still renders every row.** Opening the 40 000-entry fixture in a
  browser keeps the main thread busy for well over ten seconds before the
  child counts can even be requested (they wait for the paint, by design). The
  server half of "serves and paints" is met; the paint half is client row
  virtualization — see out of scope.
- **The snapshot race** recorded above applies to the counts endpoint as it did
  to the listing: an entry swapped for an escaping link between the parent's
  `readdir` and its count is counted. Same width, same fix (descriptors).

## History: what remained after 2026-08-21

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

So the residual was **syscalls, not serialization**, and ~61ms of it was
`childCount` alone — read at listing time by the screen-fit auto-open in
[010](010-broot-tree-display-and-navigation.md), which is why it was not simply
dropped then. Resolved 2026-10-22, above.

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

Met 2026-10-22: `mise run bench:list` reports MEETS for the 40 000-entry
`wide-mixed` case (and exits 0), with `mise run typecheck`, `mise run test` and
`mise run build` green.

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
- ~~Does `childCount` stay on the listing, or become async enrichment?~~
  Enrichment — settled 2026-10-22 in
  [2026-10-22-child-counts-are-enrichment](../decisions/2026-10-22-child-counts-are-enrichment.md).
- `rank: 13` was appended, not argued against
  [012-publication-readiness](012-publication-readiness.md).
