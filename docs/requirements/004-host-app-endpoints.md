---
id: 004-host-app-endpoints
title: Two endpoints host apps need — `exists` and `reveal`
summary: "Two seam endpoints a host app needs: a batch `exists` to check paths before linkifying them, and `reveal` to select an entry in the OS file manager."
status: planned
rank: 4
tags: [server, api]
blocks: []
blocked_by: []
research: []
decisions: [2026-07-20-the-preview-is-the-viewer]
conventions: [zod-single-source, zod-route-schemas, discovery-routes, emit-nullish, zod-defaults]
shipped: null
updated: 2026-07-20
---

# Two endpoints host apps need

Both are seam requirements from
[the host-adoption decision](../decisions/2026-07-20-the-preview-is-the-viewer.md):
designed for the screen that consumes them, not derived from what the filesystem
service happens to expose.

## `POST /api/fs/exists`

Batch `{ paths: string[] }` → per-path boolean. Hosts linkify file paths inside
markdown and must know which ones resolve *before* rendering them as links — one
round trip, not N.

## `POST /api/fs/reveal`

Open the OS file manager with the entry **selected**, as distinct from
`/api/fs/open`, which hands the file to its default application.

- Linux: D-Bus `org.freedesktop.FileManager1.ShowItems`, with an `xdg-open`
  fallback.
- macOS: `open -R`.
- Windows: `explorer /select,`.
