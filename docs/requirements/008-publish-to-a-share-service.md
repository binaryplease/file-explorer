---
id: 008-publish-to-a-share-service
title: Publish an HTML file or folder to a share service
summary: "A verb that uploads an HTML file or a folder to a share service named entirely by configuration, and persists the returned edit token so a later publish updates in place."
status: planned
rank: 8
tags: [client, server, api]
blocks: []
blocked_by: []
research: []
decisions: []
conventions: [never-hide-a-control, affordances-adjacent, explicit-flags]
shipped: null
updated: 2026-08-15
---

# Publish an HTML file or folder to a share service

A verb on an HTML file or a folder: upload it, show the resulting share link,
and remember how to update it.

## Shape

- **The service is configuration, never a constant.** The base URL arrives as an
  explicit environment variable and the feature is absent — visible, disabled,
  and saying why (never hide a control) — when it is unset. No default endpoint
  is compiled in, and no service name appears in this repository.
- **`POST <base>/upload`**, multipart, with the file or the folder's contents.
- **Persist the returned edit token** against the published path, so a second
  publish of the same entry updates the existing share rather than creating a
  duplicate.
- **Show the share link** on success, copyable, in the surface that ran the
  verb.

## Surfacing

This is one of the verbs that motivates
[011-command-palette-verbs](011-command-palette-verbs.md) — a named action with a
precondition (the entry must be an HTML file or a folder), so it is shown and
disabled with a reason rather than hidden (never hide a control).

## Open

The wire contract above is the *shape* this requirement commits to; the exact
field names and response body are settled against whichever service the
deployment configures, at implementation time. Nothing is implemented yet.
