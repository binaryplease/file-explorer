# binp-file-explorer — AGENTS.md

A **high-speed Bun file explorer**: browse a served filesystem fast,
broot-style — lazy tree navigation, ranked fuzzy search, in-place previews.

This file is the authoritative "how things are done here" reference — read it
before building.

## Project context — read `docs/`

Before starting any non-trivial task, read it. Look on your own; you should not
need to be told. Every directory under `docs/` is a **knowledge directory** with
a generated sibling index named after it; the index is the entry point, and it
is the only listing of that directory that exists.

| Read | For |
|---|---|
| [`docs/Requirements.md`](docs/Requirements.md) → [`docs/requirements/`](docs/requirements/) | what the product must **do** or **be**. `001`–`0xx` are delivery requirements in rank order; `1xx` are standing constraints that bind every feature. Frontmatter schema and status vocabulary are in the index file. |
| [`docs/Decisions.md`](docs/Decisions.md) → [`docs/decisions/`](docs/decisions/) | why we chose one way over another, and **what we rejected**. |
| [`docs/Research.md`](docs/Research.md) → [`docs/research/`](docs/research/) | dated deep-dives, two of which are reference specs code is ported against. |

[`docs/requirements/103-engineering-conventions.md`](docs/requirements/103-engineering-conventions.md)
carries the **full text** of every convention this repo is held to, each with a
slug that requirements cite in frontmatter and in prose. Read it once; the
"Conventions" section below is the same set in brief.

**Keeping the docs current is part of the change.** A change that ships a
requirement moves its `status`/`updated` frontmatter and says in its body what
landed. A change that settles a genuine either/or adds a file to
`docs/decisions/`. After adding or renaming any file under `docs/`, run
`index build` and commit the regenerated index alongside it — `index check`
exits non-zero when an index is stale.

**This repo names nothing outside itself.** No sibling project, no record number
from another repository, no private hostname, no service name — in `docs/`, in
source comments, or here. Where such a fact is load-bearing, restate the
*constraint* without it, or make it configuration. A reader with only this
repository must be able to build it.

> **Known gap, 2026-08-15.** `docs/`, this file, `README.md`, `.mise.toml` and
> `.gitignore` satisfy that rule. **Source comments do not yet**: roughly 120 of
> them across `src/`, `server/`, `shared/`, `scripts/`, `vite.config.ts` and
> `flake.nix` still cite `ADR-NNNN` numbers from a corpus outside this repo.
> The mapping to the slugs in `103-engineering-conventions` is complete, so the
> pass is mechanical — but many of those comments weave the number into prose
> (`ADR-0015 §5`, `ADR-0026's one-guard rule`), so it is a real edit per site,
> not a search-and-replace. Do it as its own change. Until then: cite the slug,
> never a number, in anything you write.

`.nightshift/` is a gitignored local notebook (chronological log, ideas not yet
promoted). Nothing in it is required to build or understand this repo, and
nothing committed may depend on it.

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Bun | Primary runtime. Speed is a first-class requirement — prefer Bun-native FS APIs and streaming. |
| Server | Elysia | |
| Validation | Zod v4 (import from `zod/v4`) | Boundary + config validation. Depend on `zod@^4` (see package.json). **Import the explicit `import { z } from 'zod/v4'` subpath, never bare `'zod'`** — a host application that source-aliases this app into its own Vite dev server resolves bare `'zod'` against the *host's* dependency tree, which may be pinned to v3, and v4-only APIs (`z.stringbool`, …) then blank every route at import time. Both v3 and v4 installs ship the `./v4` subpath, so `zod/v4` resolves to a v4 surface in standalone and embedded builds alike. Route schemas use Zod, never TypeBox. Schemas double as the OpenAPI spec via `z.toJSONSchema`. |
| API docs | `@elysiajs/openapi` | Discovery at `GET /api`, Scalar UI at `GET /api/docs`, spec at `GET /api/openapi.json`. |
| Frontend | React 19 | |
| Styling | Tailwind CSS v4 | `@tailwindcss/vite` plugin. |
| Icons | `@tabler/icons-react` | Never Unicode characters as icons. |
| Build | Vite (client) + Bun bundler (server) | client → `dist/client/`, server → `dist/server/`. |
| Dev env | mise | `.mise.toml` declares tool versions, env vars, and tasks. |

## A feature list is not an implementation

Features worth building are visible in other explorers — git status, previews,
directory sizes, a verb palette, a CLI daemon. That names *what* to build.
**The implementation is engineered here**, optimized for performance and bound
by the responsiveness principle below, because the obvious version of most of
these features is exactly what that principle forbids: status computed inside
the listing handler, sizes walked per request, previews read unbounded.

## Dev commands

Via mise (`.mise.toml`):

| Command | Description |
|---|---|
| `mise run dev` | Resolve free ports, then start Elysia (:3000) + Vite (:5173) concurrently. Open http://localhost:5173. |
| `mise run dev:ports` | Probe the canonical dev ports and print the assignment (no servers started). |
| `mise run dev:server` | Elysia only. |
| `mise run dev:client` | Vite only. |
| `mise run build` | Build client (Vite → `dist/client/`) + server (Bun → `dist/server/`). |
| `mise run start` | Production server. |
| `mise run typecheck` | `tsc --noEmit`. |
| `mise run deps:hash` | Refresh the vendored-dependency hash in `flake.nix`. Run after **any** dependency change. |

**Changing a dependency is a two-file change.** `flake.nix` vendors
`node_modules` as a fixed-output derivation, which nix identifies by its
`outputHash` and by nothing else — package.json and bun.lock are not inputs to
its store path. So editing dependencies without refreshing that hash leaves nix
reusing the tree it fetched *before* your change, and the failure lands far from
the cause (an unresolvable import in the middle of the vite build, naming a
package that is plainly right there in bun.lock). `mise run deps:hash` — or
`./update-deps-hash.sh` directly — syncs the lockfile, computes the new hash from
the mismatch nix reports, writes it back and verifies the build. Commit
`flake.nix` and `bun.lock` together. As a backstop the derivation name embeds a
digest of `bun.lock`, so forgetting fails loudly with a hash mismatch rather than
silently building against stale dependencies.

Ports are resolved before either process binds (`scripts/dev-ports.ts`): if 3000
or 5173 is taken, the next free port is chosen, announced on stdout, and pinned
into both processes via `PORT` / `VITE_PORT` / `VITE_API_TARGET`. This does not
weaken the fail-loud rule — reassignment happens *before* startup and is never silent;
both binds stay strict (`strictPort: true`, no `reusePort`), so a port stolen
after the probe is still a fatal error.

In dev, Vite proxies `/api/*` to Elysia on :3000. In production Elysia serves
`dist/client/` directly (single binary).

## Conventions

The full text of each, with the slug requirements cite it by, is in
[`docs/requirements/103-engineering-conventions.md`](docs/requirements/103-engineering-conventions.md).
In brief:

- **`factory-services`** — service modules are factory functions returning typed
  objects, not classes.
- **`composable-design` / `code-lives-with-dependencies`** — one function, one
  job; a unit of code lives where its dependencies are.
- **`descriptive-names`** — descriptive variable names; no single letters or
  acronyms.
- **`fail-loud-ports`** — port conflicts fail loudly (fatal startup error). Do
  not swallow `EADDRINUSE`.
- **`discovery-routes`** — the three `/api` discovery routes are already wired in
  `server/index.ts`; keep them.
- **`emit-nullish` / `zod-defaults`** — emit nullish properties explicitly; every
  Zod field declares a default.
- **`never-hide-a-control` / `affordances-adjacent`** — never hide UI controls
  (disable with an explanation); affordances live adjacent to what they change.
- **`generated-sibling-index`** — a knowledge directory is indexed by a generated
  sibling file named after it, and by nothing else.

## Responsiveness principle (binding)

The core navigation mechanism — the broot loop of list / fuzzy-search / move —
always comes first. **Every feature beyond it must be async and non-blocking**:
a listing or search response never waits on enrichment work (git status,
previews, directory sizes, thumbnails, …). Enrichment arrives after the tree
has painted, is cancellable when the user navigates away, and degrades to
absent rather than delaying the core. If a feature cannot be built this way,
it does not ship. Perf budgets live in
[`docs/requirements/101-performance-budgets.md`](docs/requirements/101-performance-budgets.md).

## Structure

```
binp-file-explorer/
  .mise.toml          # tool versions, env, tasks
  vite.config.ts      # React + Tailwind; /api proxy → :3000
  package.json        # deps
  tsconfig.json       # strict TS
  public/             # static assets
  src/                # React client (Vite root): index.html, index.tsx, index.css
  server/
    index.ts          # Elysia entry: discovery routes + health, listen
    config.ts         # env parsing (Zod)
    routes/           # route handlers + *.schema.ts (Zod)
  docs/               # committed knowledge, one generated index per directory
    Requirements.md   #   generated index + frontmatter schema + status vocabulary
    requirements/     #   NNN-<slug>.md — 001-0xx delivery (ranked), 1xx standing
    Decisions.md      #   generated index + frontmatter schema
    decisions/        #   YYYY-MM-DD-<slug>.md — the call, and what was rejected
    Research.md       #   generated index + frontmatter schema
    research/         #   YYYY-MM-DD-<topic>.md — dated deep-dives, reference specs
  .nightshift/        # local dev notebook (gitignored, nothing depends on it)
```

## Deployment

Not yet wired. When the app is real: a Nix flake package plus a NixOS module,
or a container image whose published package name matches this repository's name
exactly, fronted by a reverse proxy. Add `flake.nix`, `.github/workflows/`, and
the proxy config then.

**Binding a non-loopback `HOST` fails closed (binding).** The Host-header guard
is a DNS-rebinding defence against *browsers*; it is not access control, because
any non-browser peer can send `Host: localhost` and pass it. The loopback bind
is what keeps this unauthenticated filesystem API off the network — so
`server/services/bind-exposure.ts` refuses to start (a fatal startup error) when
`HOST` is non-loopback and `EXPLORER_ALLOWED_HOSTS` is empty. The documented
`HOST=0.0.0.0`-behind-a-reverse-proxy deployment therefore requires the operator to
(a) front the port with an **authenticating** reverse proxy and (b) name the
served host(s) in `EXPLORER_ALLOWED_HOSTS` as the acknowledgement. Non-loopback
plus `EXPLORER_CONFINE=false` still starts, but warns loudly: unconfined mode
resolves absolute paths, so the whole filesystem — not just `EXPLORER_ROOT` — is
reachable. `HOST=127.0.0.1` (the default) is unaffected and starts silently.
The decision is made once at startup, never per request.
