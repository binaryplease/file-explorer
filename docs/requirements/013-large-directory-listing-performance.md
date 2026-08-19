---
id: 013-large-directory-listing-performance
title: A very large directory lists inside the budget
summary: "A directory of tens of thousands of entries misses the listing budget by 4–5× today — measured, not suspected: `/tmp` with 37 071 entries takes ~200ms and 6.4 MiB of JSON."
status: planned
rank: 13
tags: [perf, server, tree]
blocks: []
blocked_by: []
research: [../research/2026-07-17-broot-engine.md]
decisions: [2026-07-17-re-engineer-the-broot-engine]
conventions: [never-hide-a-control, emit-nullish]
shipped: null
updated: 2026-08-19
---

# A very large directory lists inside the budget

## Current behaviour

`listDirectory` readdirs the directory for names only, then per entry
`describeEntry` issues an `lstat` **and** a `stat`, and for every entry that is a
directory one further full `readdir` to count its children
([`../../server/services/filesystem.ts:289`](../../server/services/filesystem.ts#L289),
[`:203`](../../server/services/filesystem.ts#L203),
[`:243`](../../server/services/filesystem.ts#L243)) — so the cost of listing a
directory includes reading the contents of all its child directories. All of it
is issued at once through a single `Promise.all` over every entry
([`:306`](../../server/services/filesystem.ts#L306)). The recursive-search walk
ported from broot's builder takes dirent kinds from `readdir(…, {
withFileTypes: true })` and stats nothing during the walk
([`:622`](../../server/services/filesystem.ts#L622),
[`:802`](../../server/services/filesystem.ts#L802)); the listing path predates
it and does not share that shape.

Measured at `HEAD` on 2026-08-19 by calling the service directly (unconfined,
warm cache, second run), against this machine's real `/tmp`:

| Directory | Entries | Of which directories | Listing | Payload |
|---|---|---|---|---|
| `/tmp`    | 37 071  | 34 442               | ~202ms  | 6.4 MiB |
| `/`       | 18      | 17                   | ~17ms   | —       |

The budget in [101-performance-budgets](101-performance-budgets.md) is < ~50ms
for a few-thousand-entry directory, and it names this exact suspect ("first
thing to drop or batch if listing lag ever shows"). That requirement's gate — a
stress fixture and per-listing server timing, reproduced before optimizing —
has not been built; the numbers above are an ad-hoc probe, not that fixture.
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
- `rank: 13` was appended, not argued against
  [012-publication-readiness](012-publication-readiness.md).
