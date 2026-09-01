---
id: 014-relative-links-in-rendered-markdown
title: A relative link in a rendered markdown preview opens its target in the explorer
summary: "A relative link in a rendered markdown file opens the entry it names, resolved against the previewed file's own directory: the click belongs to the app, so the reader lands on the linked entry instead of the browser navigating away from the explorer."
status: shipped
rank: 14
tags: [preview, client]
blocks: []
blocked_by: []
research: []
decisions: [2026-07-20-the-preview-is-the-viewer]
conventions: [never-hide-a-control, share-the-invariant, descriptive-names]
shipped: 2026-09-01
updated: 2026-09-01
---

# A relative link in a rendered markdown preview opens its target in the explorer

## Current behaviour

**Shipped 2026-09-01.** Clicking a relative link in a rendered markdown preview
opens the entry that link names, resolved against the previewed file's own
directory, inside the explorer — the click is the app's, so the page never
navigates away from the tree.

Three pieces, each doing one job:

- **`src/lib/markdownLinkTarget.ts`** decides, from the href alone, what a link
  points at: `external` (`http(s)`, opened in a new tab as before), `anchor` (a
  `#fragment`, untouched), `inert` (an empty href — which is what react-markdown's
  url transform leaves of a `javascript:`-style protocol — any other scheme, a
  protocol-relative `//host` URL, an undecodable escape, or a link rendered
  before the served root is known), or `entry`, a path in the tree's own address
  vocabulary. Only `entry` is ever handed to the explorer. Percent-escapes are
  decoded *before* `.`/`..` resolution, so a traversal written as `%2e%2e%2f`
  resolves like any other `../` instead of reaching the server as a filename; a
  leading slash reads as the **served root**, not the filesystem root. It is
  pure string work over the tree's existing path helpers, unit-tested in
  `src/lib/markdownLinkTarget.test.ts`.
- **`src/components/MarkdownPreview.tsx`** is told which document it is
  rendering (`documentPath`, `rootPath`) and given the verb that opens a path.
  Its anchor keeps the href the document wrote, gains a title naming the target,
  and intercepts the click for an `entry`. Everything else renders exactly as it
  did.
- **`App.openTreePath`** reveals the target the way the tree reveals anything:
  its directory becomes the focus and the entry itself the selection, which is
  what aims the preview at it — [the preview is the
  viewer](../decisions/2026-07-20-the-preview-is-the-viewer.md). It composes the
  same focus and selection a tree click uses rather than adding a second
  navigation path beside them (`share-the-invariant`).

`PreviewPanel` passes the previewed entry's own server-side address down as the
document path, so a link resolves against the file the text actually came from.

Verified in a browser against this repository: previewing `README.md` and
clicking the `LICENSE` link in "MIT — see [`LICENSE`](LICENSE)" selects `LICENSE`
in the tree and shows it in the panel, with the page URL unchanged; a nested link
(`docs/requirements/103-engineering-conventions.md`) and an upward one
(`../Requirements.md`) focus the target's directory and land on the file.

## Behaviour we must not regress

- **The href is untrusted input.** It comes from file content, so nothing is
  read as a path until its syntax has been classified: a scheme, a
  protocol-relative URL or an empty href never becomes one. The url transform
  that drops `javascript:` protocols is upstream of all of this and stays.
- **No path policy of its own.** A target the `../` chain walks out of the
  served root is expressed as the absolute path it is — the same wire format a
  tree row above the anchor already carries — and left to the existing
  confinement rule ([001-unconfined-root-anchor](001-unconfined-root-anchor.md),
  [100-loopback-only-service](100-loopback-only-service.md)): a confined server
  refuses it with a 403, exactly as it refuses a hand-typed `?path=`.
- **Files and directories are revealed identically**, without asking the server
  which one it is: a directory lands selected with its summary in the panel, one
  Enter from being focused.

## Known edge

A target the current view filters hide — a dotfile, a gitignored build directory
— lands on its parent directory rather than on the entry, because the selection
can only rest on a row the tree is showing. Turning on `hidden` / `gitignored`
shows it. Whether a link should override the filters is not settled here.

## Out of scope

- Links in the **source** (unrendered) view — the `rendered` toggle already
  distinguishes the two views.
- `http(s)` links and in-document anchors (`#section`), which behave as they do
  today.
- Relative **image** sources in a rendered document, which are a separate
  fetch-and-render path, not a navigation.
- A target that resolves outside the served root is bound by the existing
  confinement rule in
  [`001-unconfined-root-anchor`](001-unconfined-root-anchor.md) and
  [`100-loopback-only-service`](100-loopback-only-service.md); this requirement
  adds no new path policy.
