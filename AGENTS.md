# binp-file-explorer — AGENTS.md

A **high-speed Bun file explorer**: browse a served filesystem fast,
broot-style — lazy tree navigation, ranked fuzzy search, in-place previews.

Stack follows **ADR-0003** (default application tech stack). This file is the
authoritative "how things are done here" reference — read it before building.

## Project context — read `.nightshift/` first

Before starting any non-trivial task, consult `.nightshift/` — the local dev
notebook (gitignored) that is the single source of truth for plans, decisions,
and open questions. Look here on your own; you should not need to be told.

- `backlog.md` — current intent: next steps, ideas, open questions.
- `log.md` — reverse-chronological run journal: what works now, what's next.
- `research/` — dated deep-dives backing backlog decisions
  (`YYYY-MM-DD-<topic>.md`).

Record session outcomes back here — append to `log.md`, update `backlog.md` — so
the next agent inherits the context. See `.nightshift/README.md` for the full
layout.

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Bun | Primary runtime. Speed is a first-class requirement — prefer Bun-native FS APIs and streaming. |
| Server | Elysia | Per ADR-0003. |
| Validation | Zod v4 (import from `zod`) | Boundary + config validation (ADR-0013). Depend on `zod@^4` — not `zod@3` plus the `zod/v4` compat entrypoint. Route schemas use Zod, never TypeBox (ADR-0014). Schemas double as the OpenAPI spec via `z.toJSONSchema`. |
| API docs | `@elysiajs/openapi` | ADR-0020: discovery at `GET /api`, Scalar UI at `GET /api/docs`, spec at `GET /api/openapi.json`. |
| Frontend | React 19 | |
| Styling | Tailwind CSS v4 | `@tailwindcss/vite` plugin. |
| Icons | `@tabler/icons-react` | ADR-0022 — never Unicode characters as icons. |
| Build | Vite (client) + Bun bundler (server) | client → `dist/client/`, server → `dist/server/`. |
| Dev env | mise | `.mise.toml` declares tool versions, env vars, and tasks (ADR-0004). |

## Derivation (ADR-0006)

Scaffolded **fresh per ADR-0003**, taking the build/dev-env/deploy conventions
and the ADR-0020 discovery skeleton from the freshest ADR-0003-compliant
sibling. Strategy: **Hybrid** — infra/dev-env conventions adopted; the
sibling's *product* surface (auth, forms, domains, emails, admin) is **not
copied**. If you later need a well-tested piece from it (e.g. static-file
serving, thumbnails), extract-and-transplant it deliberately and note it in the
task file.

**`binp-fex` is an ideas reference only.** The diverged sibling explorer names
features worth building (git status, previews, directory sizes, palette,
CLI daemon) — but its code is never transplanted. We engineer our own
implementations, optimized for performance and bound by the responsiveness
principle below. Rationale and per-operation comparison:
`.nightshift/research/2026-07-18-file-explorer-vs-fex-comparison.md`.

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

Ports are resolved before either process binds (`scripts/dev-ports.ts`): if 3000
or 5173 is taken, the next free port is chosen, announced on stdout, and pinned
into both processes via `PORT` / `VITE_PORT` / `VITE_API_TARGET`. This is not an
ADR-0018 exception — reassignment happens *before* startup and is never silent;
both binds stay strict (`strictPort: true`, no `reusePort`), so a port stolen
after the probe is still a fatal error.

In dev, Vite proxies `/api/*` to Elysia on :3000. In production Elysia serves
`dist/client/` directly (single binary).

## Conventions (binding ADRs)

- **ADR-0007** — service modules are factory functions returning typed objects,
  not classes.
- **ADR-0010 / ADR-0032** — one function, one job; a unit of code lives where its
  dependencies are.
- **ADR-0017** — descriptive variable names; no single letters or acronyms.
- **ADR-0018** — port conflicts fail loudly (fatal startup error). Do not swallow
  `EADDRINUSE`.
- **ADR-0020** — the three `/api` discovery routes are already wired in
  `server/index.ts`; keep them.
- **ADR-0024 / ADR-0029** — emit nullish properties explicitly; every Zod field
  declares a default.
- **ADR-0025 / ADR-0031** — never hide UI controls (disable with an explanation);
  affordances live adjacent to what they change.

## Responsiveness principle (binding)

The core navigation mechanism — the broot loop of list / fuzzy-search / move —
always comes first. **Every feature beyond it must be async and non-blocking**:
a listing or search response never waits on enrichment work (git status,
previews, directory sizes, thumbnails, …). Enrichment arrives after the tree
has painted, is cancellable when the user navigates away, and degrades to
absent rather than delaying the core. If a feature cannot be built this way,
it does not ship. Perf budgets live in `.nightshift/backlog.md` (performance
policy).

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
    index.ts          # Elysia entry: ADR-0020 discovery + health, listen
    config.ts         # env parsing (Zod)
    routes/           # route handlers + *.schema.ts (Zod)
  .nightshift/        # local dev notebook (gitignored): backlog, log, research/
```

## Deployment

Not yet wired. When the app is real, follow **ADR-0002** (Deploy Coordinator:
Nix flake package + NixOS module or GHCR Docker image, Caddy vhost) and
**ADR-0008** (GHCR package name = repo name, no suffix). Add `flake.nix`,
`.github/workflows/`, and a `Caddyfile` then.

**Binding a non-loopback `HOST` fails closed (binding).** The Host-header guard
is a DNS-rebinding defence against *browsers*; it is not access control, because
any non-browser peer can send `Host: localhost` and pass it. The loopback bind
is what keeps this unauthenticated filesystem API off the network — so
`server/services/bind-exposure.ts` refuses to start (fatal, ADR-0018) when
`HOST` is non-loopback and `EXPLORER_ALLOWED_HOSTS` is empty. The documented
`HOST=0.0.0.0`-behind-Caddy deployment therefore requires the operator to
(a) front the port with an **authenticating** reverse proxy and (b) name the
served host(s) in `EXPLORER_ALLOWED_HOSTS` as the acknowledgement. Non-loopback
plus `EXPLORER_CONFINE=false` still starts, but warns loudly: unconfined mode
resolves absolute paths, so the whole filesystem — not just `EXPLORER_ROOT` — is
reachable. `HOST=127.0.0.1` (the default) is unaffected and starts silently.
The decision is made once at startup, never per request.
