---
id: 016-ignored-directory-lists-its-entries
title: A focused directory that holds only gitignored entries lists them whatever the toggle says
summary: "With the `gitignored` toggle off, a focused directory that is itself gitignored, or whose entries are all gitignored, renders only an `N gitignored` tally; it must list those entries instead."
status: planned
rank: 16
tags: [client, tree]
blocks: []
blocked_by: []
research: []
decisions: []
conventions: [never-hide-a-control, share-the-invariant, descriptive-names]
shipped: null
updated: 2026-11-04
---

# A focused directory that holds only gitignored entries lists them whatever the toggle says

**Kind:** feature request.

## Current behaviour

The `gitignored` chip filters by each entry's `isGitignored` flag alone
(`src/lib/tree.ts:214`, `src/lib/tree.ts:259`). The filter does not consider the
focused directory. The server flags every entry below an ignored directory,
including everything below `.git` (`server/services/filesystem.ts:294`,
`server/services/filesystem.ts:531`).

So a directory with only ignored entries renders no entry rows while the chip is
off. Reproduced at `HEAD` with `buildTreeRows` over real `listDirectory` output
and a root `.gitignore` of `dist/` and `logs/*`: focusing `dist` and focusing
`logs` each yield one row, the tally `unlisted hidden=0 ignored=2`.

A user reaches such a focus with the chip off through a `?path=` URL
(`src/lib/focusNavigation.ts:36`), a relative markdown link, or by turning the
chip off while inside the directory.

## Desired outcome

While the focused directory is gitignored, or every entry the `hidden` toggle
leaves in it is gitignored, the tree lists those entries and the directories
opened below them regardless of the `gitignored` toggle.

## Done when

With `gitignored` off, focusing `dist` and `logs` from the setup above lists
their entries with no `N gitignored` tally, and a focused directory with both
ignored and non-ignored entries still hides the ignored ones behind the tally,
with the gates declared in `AGENTS.md` passing.

## Out of scope

- The `hidden` toggle keeps filtering dotfiles inside such a directory.
- A directory opened below a focus that does not meet the condition keeps the
  toggle's filtering, even when all its own entries are ignored.

## Note

- Search keeps its own filter: `server/services/filesystem.ts:980` prunes ignored
  entries while `showGitignored` is off, so typing in such a directory finds
  none of the rows this record lists. A later record would have to align search.
- The `gitignored` chip has no effect in such a directory; `never-hide-a-control`
  binds how the chip presents that.
- The known edge in `014-relative-links-in-rendered-markdown` says a link to a
  gitignored target lands on the parent; a target inside such a directory
  becomes a visible row, and that sentence needs narrowing when this ships.
