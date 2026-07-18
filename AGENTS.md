# binp-file-explorer — AGENTS.md

A **high-speed Bun file explorer**: browse a served filesystem fast and open
files in place (same-tab navigation, natural back-button history).

Stack follows **ADR-0003** (default application tech stack). This file is the
authoritative "how things are done here" reference — read it before building.

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Bun | Primary runtime. Speed is a first-class requirement — prefer Bun-native FS APIs and streaming. |
| Server | Elysia | Per ADR-0003. |
| Validation | Zod (v4 API via `zod/v4`) | Boundary + config validation (ADR-0013). Route schemas use Zod, never TypeBox (ADR-0014). Schemas double as the OpenAPI spec via `z.toJSONSchema`. |
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

## Dev commands

Via mise (`.mise.toml`):

| Command | Description |
|---|---|
| `mise run dev` | Start Elysia (:3000) + Vite (:5173) concurrently. Open http://localhost:5173. |
| `mise run dev:server` | Elysia only. |
| `mise run dev:client` | Vite only. |
| `mise run build` | Build client (Vite → `dist/client/`) + server (Bun → `dist/server/`). |
| `mise run start` | Production server. |
| `mise run typecheck` | `tsc --noEmit`. |

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
  task/               # ADR-0005 tracking files
```

## Deployment

Not yet wired. When the app is real, follow **ADR-0002** (Deploy Coordinator:
Nix flake package + NixOS module or GHCR Docker image, Caddy vhost) and
**ADR-0008** (GHCR package name = repo name, no suffix). Add `flake.nix`,
`.github/workflows/`, and a `Caddyfile` then.
