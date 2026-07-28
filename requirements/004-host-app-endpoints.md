---
id: 004-host-app-endpoints
title: Two endpoints host apps need — `exists` and `reveal`
status: planned
rank: 4
tags: [server, api]
blocks: []
blocked_by: []
research: [../.nightshift/research/2026-07-20-nightshift-ui-adoption.md]
adrs: [ADR-0013, ADR-0014, ADR-0020, ADR-0024, ADR-0029]
shipped: null
updated: 2026-07-20
---

# Two endpoints host apps need

Both are seam requirements from the nightshift-ui adoption: designed for the
screen that consumes them, not derived from what the filesystem service happens
to expose.

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
