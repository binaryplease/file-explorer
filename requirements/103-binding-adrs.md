---
id: 103-binding-adrs
title: The ADRs binding on this repo
status: standing
rank: null
tags: [server, client, config]
blocks: []
blocked_by: []
research: []
adrs: [ADR-0007, ADR-0013, ADR-0014, ADR-0017, ADR-0018, ADR-0020, ADR-0022, ADR-0024, ADR-0025, ADR-0029, ADR-0031]
shipped: null
updated: 2026-07-28
---

# The ADRs binding on this repo

Read any of them in full with `adr show <number>` — never reconstruct from
memory. AGENTS.md is the authoritative list for the repo; this file exists so a
requirement can point at "the standing ADR set" as one addressable thing.

| ADR | What it binds here |
|---|---|
| 0007 | Service modules are factory functions returning typed objects, not classes. |
| 0013 / 0014 | Zod is the single source of truth at every seam; Elysia route schemas use Zod, never TypeBox. Import from `zod/v4`, never bare `zod`. |
| 0017 | Descriptive variable names — no single letters or acronyms. |
| 0018 | Port conflicts fail loudly; `EADDRINUSE` is never swallowed. See [009](009-cli-daemon-and-status.md) for the `reusePort` hole this caught. |
| 0020 | The three `/api` discovery routes stay wired in `server/index.ts`. |
| 0022 | `@tabler/icons-react` for every icon — never a Unicode character. |
| 0024 / 0029 | Nullish properties are emitted explicitly; every Zod field declares a default. |
| 0025 / 0031 | Never hide a UI control — disable it with an explanation; affordances live adjacent to what they change. |

Also load-bearing, though not in the original standing list: **0026/0027/0028**
(one descriptor + one wrapper + one guard for cross-surface affordances;
component granularity; interaction-state styling as a shared token), **0032** (a
unit of code lives where its dependencies are), **0011/0015** for the CLI, and
**0006** for what may be transplanted from a sibling repo.

## Repo-specific amendments to the defaults

- **`zod/v4` subpath imports are mandatory** (2026-07-21). nightshift-ui
  source-aliases this app into its Vite dev server, where a bare `'zod'`
  specifier resolves to the *host's* zod (pinned v3) and every route blanks with
  `z.stringbool is not a function` at import time. Both installs ship the `./v4`
  subpath, so `zod/v4` resolves to a v4 surface standalone and embedded alike.
  AGENTS.md's tech-stack row mandates it so this can't recur.
- **binp-fex is an ideas reference only** (ADR-0006 hybrid derivation). Its
  feature list names what to build; its code is never ported.
