# binp-file-explorer

A **high-speed Bun file explorer** — a web app for browsing a served filesystem
fast.

## Goals

- **Incredibly fast.** Bun-native filesystem serving; directory listings and
  file streaming that feel instant even on large trees.
- **Browse and open in place.** Opening a file navigates in the same tab
  so the browser back button walks the history naturally.

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

## Serving a location

The explorer serves the **home directory** of the user running the server by
default. To open it at a specific location instead, set `EXPLORER_ROOT` (see
`.mise.toml`) or pass a positional argument: `bun server/index.ts ~/projects`.
Listings never escape the served root. This is a **local-only** tool — the
server binds to loopback and is not meant to be hosted.

## Status

Prototype: broot-style navigation (tree with lazy expansion, keyboard-first
navigation with broot's default keys — `↵`/`→` open, `←`/`esc` back through
history, `h`/`⌫` parent, `j`/`k` move, `ctrl-d`/`ctrl-u` page,
`tab`/`shift-tab` walk matches — size bars, hidden and gitignored toggles,
deep-linkable focus via `?path=` with natural back-button history), styled
after concept CON009. Typing fuzzy-searches the whole focused subtree
server-side with broot's scored-match algorithms re-engineered in TypeScript
(bounded best-first walk, gitignore-aware pruning, results ranked by score
with the best match pre-selected). Files open in place via `/api/fs/raw`
(same-tab navigation, back button returns to the tree). Not yet built:
directory sizing, broot's computed screen-fit openness (R8 — manual
expand/collapse kept for now as a deliberate departure).

Deviation from broot's keyboard shortcuts: broot reveals hidden and gitignored
files through two independent toggles (`:toggle_hidden` / `:toggle_git_ignore`,
Alt-h / Alt-i by default). We add `alt+a` on top of those — a one-stroke
"reveal everything" that flips both views together (both on / both off).
