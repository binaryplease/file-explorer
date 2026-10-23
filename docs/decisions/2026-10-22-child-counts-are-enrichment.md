---
id: 2026-10-22-child-counts-are-enrichment
title: A directory's child count is enrichment, served after the listing
summary: "Counting every subdirectory was ~61ms of a 40 000-entry listing, so `childCount` left `GET /api/fs/list` for its own cancellable request; the screen-fit auto-open now waits for a listing's counts instead of reading null as empty, and descends exactly as before."
decided: 2026-10-22
status: accepted
requirements: [013-large-directory-listing-performance, 010-broot-tree-display-and-navigation, 101-performance-budgets]
research: []
---

# A directory's child count is enrichment, served after the listing

## The question

`GET /api/fs/list` reported a `childCount` for every subdirectory, which costs
one `readdir` of each child: 37 200 of them on the `wide-mixed` stress fixture,
~61ms of a ~98ms listing against a ~50ms budget
([013](../requirements/013-large-directory-listing-performance.md),
[101](../requirements/101-performance-budgets.md)). Nothing else stood between
that listing and its budget. But the count was not decoration: the screen-fit
auto-open ([010](../requirements/010-broot-tree-display-and-navigation.md))
reads a pending child directory's count at plan time to decide whether to open
it at all and how many rows to grant it. The tree also renders the count beside
each closed directory.

Where should the count come from, and when?

## Decided

**The count leaves the listing and becomes enrichment.** It is served by its own
endpoint, `GET /api/fs/child-counts?path=…`, which returns `{ name, childCount }`
for every subdirectory of one directory. The client asks for it after the
listing has painted, merges it into the stored entries by name, and aborts it on
navigate-away. The server stops counting when the request is aborted (it checks
between batches of 2 048). On the wire, every listing's `childCount` is now
`null`. The field stays in the shared schema, so the listing keeps one shape and
the client's merged entries are still a `DirectoryEntry`.

The counts endpoint is confined by construction rather than by care. It reads
the directory through the listing's own `readConfinedDirectory` and resolves
each entry through the listing's own `resolveDirentTarget`. A path the listing
refuses is refused with the same status. An escaping symlink is never stat-ed or
counted: it is absent from the result, just as its count is withheld from the
listing. The unit tests count the syscalls to prove it.

**Auto-open waits rather than guesses.** `planAutoOpen` takes the set of
directories whose counts have arrived (`countedDirectoryPaths`). When it needs
the count of an unloaded directory whose parent is not in that set, it does not
read the null as "empty". It names the parent in `pendingChildCountPaths`, and
the caller applies none of that provisional plan: it fetches the counts and
re-plans. So every plan the user actually sees is computed from the same data
the planner had when counts rode on the listing, and the fill descends and paces
exactly as before. The only change is one extra small request per fill level,
measured in single-digit milliseconds for the small directories a fill descends
into. If the counts request fails, the directory is marked counted with its
nulls kept, so the fill reads it as uncounted-empty rather than waiting forever.
A failure degrades to absent, as the responsiveness principle requires.

## Rejected

- **Keep counting on the listing, batched or with bounded concurrency.**
  Batching changes how 37 200 `readdir`s are scheduled, not how many there are.
  Measured here, the counting costs ~73–110ms on its own whatever the batch size
  (2 048 was the fastest, and one unbounded `Promise.all` the slowest). That
  alone exceeds the budget.
- **Count inline only when a directory has few subdirectories** (and defer above
  a threshold). This would avoid one round trip for small directories, but it
  gives the wire two meanings for `childCount: null` and gives the client two
  code paths to keep in agreement. It would also tie a server constant to the
  client's viewport height, which is what decides how many counts auto-open can
  consult. The extra request it saves costs ~1ms on the directories where it
  would apply.
- **Have auto-open fetch the child's whole listing instead of its count.** A
  count stands in for a listing the fill may never open. Fetching listings to
  learn sizes would pull a 6 MiB listing to learn that one directory is large.
- **Let auto-open treat an unknown count as zero and re-plan when counts land.**
  That is the cheapest change, and it is a regression. Directories read as empty
  are skipped, and their rows go to their siblings. When the counts arrive, the
  fill re-paces and visibly takes those rows back. The provisional-plan gate
  exists to prevent exactly that.
- **Drop `childCount` from the wire schema entirely.** The client would then
  need a parallel entry type for the merged count, which is the
  two-shapes-for-one-thing that `zod-single-source` forbids.

## Consequences

- `GET /api/fs/list` on the 40 000-entry fixture went from ~104–117ms to
  ~33–47ms (medians across runs on one machine). The numbers are in
  [013](../requirements/013-large-directory-listing-performance.md).
- Every listing's `Server-Timing` now reports `childreaddirs` as 0. The counts
  request carries the same header under a `childcounts` total.
- A consumer of `GET /api/fs/list` outside this client that read `childCount`
  must now also call `GET /api/fs/child-counts`.
