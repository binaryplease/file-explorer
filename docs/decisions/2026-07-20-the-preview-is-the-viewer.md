---
id: 2026-07-20-the-preview-is-the-viewer
title: The preview is the viewer, not a glance
summary: "Once this explorer is consumed as a library rather than reimplemented by each host, a gap in the preview is a gap in every consuming app — so the bounded-head \"glance\" scope is no longer sufficient."
decided: 2026-07-20
status: accepted
requirements: [002-preview-parity, 003-embeddable-file-explorer, 004-host-app-endpoints]
research: []
---

# The preview is the viewer, not a glance

## The question

A host application wanted a file tree and a file preview. It already had its own
— roughly 1,265 lines of it. Does it keep them, embed this explorer, or copy the
code?

## Decided

**This explorer is the single source of truth for tree and preview**, consumed
as a library: an Elysia plugin on the server, a React component on the client.

Rejected alternatives, and why:

- **An iframe onto a second local daemon.** Needs CORS we do not ship, cannot
  re-root without a restart, pollutes the host's history, and pays for a second
  React runtime.
- **Copying the code.** Forks a codebase still in motion — the fork is stale the
  week it is taken.

Stack compatibility was verified against both dependency trees rather than
assumed: matching Zod, Elysia, React 19 and Tailwind v4 majors on both sides,
with the `zod/v4` subpath present in each.

## The consequence worth internalising

**Preview stops being "a glance before you open the file" and becomes the
viewer.** The deliberate bounded-head scope was right for a glance and is not
sufficient for being the only way a reader sees a file's contents. A gap in the
preview is now a gap in every consuming app, which is what ranks
[002-preview-parity](../requirements/002-preview-parity.md) and the
embeddability work above everything else.

It also settles a stale goal: there is **no separate "open file in place"
flow**. Same-tab navigation to a served-file URL was a false premise; the
preview panel is how file contents are seen, and the raw-byte endpoint already
covers download. No further open-in-place work is planned.

## Consequences

- The component must be mountable by a host and mountable twice on a page —
  today `App` *is* the shell and owns global browser state
  ([003](../requirements/003-embeddable-file-explorer.md)).
- Seam endpoints are designed for the screen that consumes them, not derived
  from what the filesystem service happens to expose
  ([004](../requirements/004-host-app-endpoints.md)).
- A host that source-aliases this package into its own bundler resolves bare
  specifiers against *its* dependency tree, which is why `zod/v4` subpath
  imports are mandatory here
  ([103-engineering-conventions](../requirements/103-engineering-conventions.md)).
