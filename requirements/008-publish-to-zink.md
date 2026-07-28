---
id: 008-publish-to-zink
title: Publish an HTML file or folder to zink
status: planned
rank: 8
tags: [client, server, api]
blocks: []
blocked_by: []
research: []
adrs: [ADR-0025, ADR-0031]
shipped: null
updated: 2026-07-20
---

# Publish to zink

README goal #3. A verb on an HTML file or a folder: `POST
<ZINK_BASE_URL>/api/upload` multipart, show the share link, and persist the
`editToken` so a later publish updates in place rather than creating a second
share.

The contract is documented in AGENTS.md.

Surfacing: this is one of the verbs that motivates
[011-command-palette-verbs](011-command-palette-verbs.md) — a named action with a
precondition (the entry must be an HTML file or a folder), so it is shown and
disabled with a reason rather than hidden (ADR-0025).
