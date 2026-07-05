# binp-file-explorer

A **high-speed Bun file explorer** — a web app for browsing a served filesystem
fast, and publishing any HTML file or folder to [zink](https://github.com/binaryplease/binp-zink)
(= ZIP + LINK) for an instant, shareable link.

## Goals

- **Incredibly fast.** Bun-native filesystem serving; directory listings and
  file streaming that feel instant even on large trees.
- **Browse and open in place.** Opening an HTML file navigates in the same tab
  so the browser back button walks the history naturally.
- **Publish to zink.** One action uploads the selected HTML file or folder to a
  zink instance and returns the share link.

## Stack

Bun · Elysia · React 19 · Tailwind CSS v4 · Vite. Per **ADR-0003** (default
application tech stack). See [`AGENTS.md`](AGENTS.md) for the full breakdown and
conventions.

## Develop

```sh
mise install      # Bun toolchain
bun install       # dependencies
mise run dev      # Elysia (:3000) + Vite (:5173) — open http://localhost:5173
```

`mise run typecheck` type-checks; `mise run build` produces `dist/client` +
`dist/server`; `mise run start` runs the production server.

## Status

Scaffolded. The explorer itself is built by the follow-on task —
see [`task/0001-file-explorer-mvp.md`](task/0001-file-explorer-mvp.md).
