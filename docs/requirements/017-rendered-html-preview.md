---
id: 017-rendered-html-preview
title: An HTML page previews as a rendered page, isolated from the explorer's origin
summary: "Selecting an `.html`/`.htm` file shows the page rendered in the preview panel, with its source one toggle away; the page runs no script, loads nothing from the network, and has no access to the explorer's origin, and it never delays the listing or search."
status: planned
rank: 17
tags: [preview, client, security]
blocks: []
blocked_by: []
research: []
decisions: [2026-07-20-the-preview-is-the-viewer, 2026-07-20-the-origin-is-the-security-boundary]
conventions: [never-hide-a-control, affordances-adjacent, share-the-invariant, descriptive-names]
shipped: null
updated: 2026-11-16
---

# An HTML page previews as a rendered page, isolated from the explorer's origin

## Current behaviour

An `.html` or `.htm` file previews as source text. The shared language detector
maps both extensions to `html` (`shared/language.ts:47-48`), so the server
returns a `text` preview and the panel shows it with Shiki highlighting. The
panel has one rendered text view, markdown (`isMarkdownPreview`,
`src/components/PreviewPanel.tsx:455-457`); no other text kind renders.

The raw-byte endpoint serves an `.html` file with `Content-Disposition:
attachment`, `X-Content-Type-Options: nosniff` and `Content-Security-Policy:
sandbox; default-src 'none'` (`server/routes/filesystem.ts:60-63`, `117-128`).
Only a `.pdf` is served `inline`. The comment above those headers states the
threat: an HTML file rendered as a document in the explorer's own origin can
call the unauthenticated read API same-origin and read anything the server can
read, which is the whole filesystem in the default unconfined mode. This record
therefore touches an injection surface and the read API's exposure.

## Desired outcome

Selecting an `.html` or `.htm` file shows the page rendered in the preview
panel, in a context that cannot run script, cannot load anything from the
network, and cannot reach the explorer's DOM, storage or `/api/*`.

## Done when

With an `.html` file selected, the panel shows the rendered page by default and
its highlighted source one toggle away, and a test page carrying an inline
`<script>`, a remote `<img>`/`<link>` and a `fetch('/api/fs/list')` shows its
markup while the browser records no script execution and no network request
initiated by the page, to `/api` or to any other host. The repo's gates (typecheck and tests, see
`AGENTS.md`) stay green.

## Behaviour this record binds

- **The origin is the boundary.** Per
  [the origin decision](../decisions/2026-07-20-the-origin-is-the-security-boundary.md)
  and [100-loopback-only-service](100-loopback-only-service.md), the rendered
  page never runs as a document in the explorer's origin. A click on a link or a
  form submit inside the page never navigates the explorer's own page.
- **Direct navigation stays a download.** Opening an `.html` file's raw URL in
  the address bar still downloads it under the existing attachment hardening.
  Rendering in the panel adds no route by which a browser navigation receives
  the file as a live same-origin document.
- **Source is one toggle away** (`never-hide-a-control`). The render/source
  switch sits in the preview header beside the kind badges
  (`affordances-adjacent`). It is the same switch markdown uses, so one setting
  and one control govern both kinds (`share-the-invariant`).
- **Responsiveness principle** (`AGENTS.md`,
  [101-performance-budgets](101-performance-budgets.md)). The listing and search
  never wait on the page. The page renders after the tree has painted, a page
  still loading when the selection moves is discarded, and a page that fails to
  render falls back to its source with a one-line reason.

## Relation to other records

- [002-preview-parity](002-preview-parity.md) requires the preview to render
  what a file is; this record is the HTML kind of that work. Its markdown path
  escapes inline HTML on purpose. This record leaves that rule alone: HTML
  embedded in a markdown file stays escaped.
- [006-preview-panel](006-preview-panel.md) is the panel this renders in; its
  click and focus behaviour is unchanged.
- [008-publish-to-a-share-service](008-publish-to-a-share-service.md) also acts
  on HTML files, as a verb that uploads them. This record is local viewing only
  and sends nothing off the machine; neither record depends on the other.
- [102-theme-token-model](102-theme-token-model.md) themes the panel chrome
  around the page. The page keeps its own styling and is not re-themed.

## Out of scope

- Running the page's script, and loading its relative resources (sibling CSS,
  images, scripts). The page renders from its own markup alone, so a page that
  depends on either renders unstyled or incomplete.
- Opening a relative link from the rendered page as an entry in the tree, as
  [014](014-relative-links-in-rendered-markdown.md) does for markdown.

## Note

- The preview reads a bounded window (1 MiB / 4 000 lines,
  [002](002-preview-parity.md)). Today a page larger than that window shows as
  truncated source; whether the rendered view takes the window or the whole file
  is a builder's default, and the truncation notice must stay honest either way.
- `.xhtml` and `.svg` are not mapped to `html` today and are not covered here.
  An opt-in for script in an opaque origin, or for sibling resources, would be a
  later record, each with its own threat statement.
