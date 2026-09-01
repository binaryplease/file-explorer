---
id: 014-relative-links-in-rendered-markdown
title: A relative link in a rendered markdown preview opens its target in the explorer
summary: "A relative link in a rendered markdown file leaves the app instead of opening the file it names — `[LICENSE](LICENSE)` in README.md must select that entry, not navigate the browser away."
status: planned
rank: 14
tags: [preview, client]
blocks: []
blocked_by: []
research: []
decisions: [2026-07-20-the-preview-is-the-viewer]
conventions: [never-hide-a-control, share-the-invariant, descriptive-names]
shipped: null
updated: 2026-09-01
---

# A relative link in a rendered markdown preview opens its target in the explorer

## Current behaviour

`MarkdownLink` (`src/components/MarkdownPreview.tsx:28-40`) branches only on
`^https?://`: an external href gains `target=_blank rel="noreferrer noopener"`,
and every other href — a bare relative path like `LICENSE` or
`docs/Requirements.md` — is passed to `<a href>` unchanged, with no click
handler and no `preventDefault` anywhere in the rendered path. Clicking one is
therefore an ordinary browser navigation resolved against the app's own URL, so
the explorer is left behind rather than the linked file being opened. The
component's own comment calls these links "inert", which is the intent, not what
a browser does with them.

`MarkdownPreview` is also given only the document text
(`PreviewPanel.tsx:716` passes `source` and nothing else), so as it stands the
rendered document does not know which file it came from.

Reproduced by reading the code path, not in a browser. No security surface: no
new bytes leave the server and the existing url transform still drops
`javascript:` protocols — this is a navigation bug.

## Desired outcome

Clicking a relative link in a rendered markdown preview opens the file or
directory that link names, resolved against the previewed file's own directory,
inside the explorer.

## Done when

Previewing this repository's `README.md` and clicking the `LICENSE` link in
"MIT — see [`LICENSE`](LICENSE)" shows `LICENSE` in the explorer without a page
navigation, with the repo's gates green (`mise run typecheck` and the test suite,
per [`AGENTS.md`](../../AGENTS.md) "Dev commands").

## Out of scope

- Links in the **source** (unrendered) view — the `rendered` toggle already
  distinguishes the two views.
- `http(s)` links and in-document anchors (`#section`), which behave as they do
  today.
- A target that resolves outside the served root is bound by the existing
  confinement rule in
  [`001-unconfined-root-anchor`](001-unconfined-root-anchor.md) and
  [`100-loopback-only-service`](100-loopback-only-service.md); this requirement
  adds no new path policy.
