---
id: 103-engineering-conventions
title: The engineering conventions binding on this repo
summary: "The full text of every convention this repo is held to, each with a slug other requirements cite — stated here rather than referenced, so the repo is readable without any other repository."
status: standing
rank: null
tags: [server, client, config]
blocks: []
blocked_by: []
research: []
decisions: []
conventions: []
shipped: null
updated: 2026-09-09
---

# The engineering conventions binding on this repo

Every convention below is stated **in full**, because a rule a reader cannot
look up is not a rule they can follow. Each carries a **slug**, and other
requirements cite the slug in their `conventions:` frontmatter and in prose. The
tech-stack choices these sit on top of are in `AGENTS.md`.

## Server and data

**`factory-services`** — A service module is a factory function returning a
typed object, not a class. `createFilesystemService({ … })`, not
`new FilesystemService(…)`.

**`code-lives-with-dependencies`** — A unit of code lives where its dependencies
are, not next to its topical neighbours. One function does one job.

**`composable-design`** — Extend explicitly rather than wrapping implicitly.
Pure logic is separable from the orchestration that calls it.

**`zod-single-source`** — Zod is the single source of truth for schemas *and*
types at every seam. Types are derived from schemas, never declared alongside
them.

**`zod-route-schemas`** — Elysia route schemas use Zod, never TypeBox. The
schemas double as the OpenAPI spec via `z.toJSONSchema`.

**`zod-defaults`** — Every Zod field declares a default, so adding a field is
forward-compatible for existing payloads. Two kinds of field are deliberately
exempt and stay defaultless so a missing value fails loudly instead of resolving
to a plausible lie: **identity** fields (the pid/host/port of a recorded daemon)
and **required inputs** (a search pattern).

**`emit-nullish`** — Output completeness: a nullish property is emitted
explicitly as `null`, never omitted. A reader must be able to tell "absent" from
"not applicable" without consulting the schema.

**`discovery-routes`** — The three `/api` discovery routes stay wired in
`server/index.ts`: discovery at `GET /api`, the Scalar UI at `GET /api/docs`,
and the spec at `GET /api/openapi.json`.

## Startup, ports and configuration

**`fail-loud-ports`** — A port conflict is an immediate, fatal startup error.
`EADDRINUSE` is never swallowed. See
[009](009-cli-daemon-and-status.md) for the `reusePort` hole this caught: the
Bun adapter's default let two processes silently share a port through
`SO_REUSEPORT`, absorbing a genuine conflict.

**`allocate-before-strict-bind`** — When a port must be chosen dynamically, it
is allocated *before* the strict bind, never as a fallback after one fails, and
the chosen port is announced. The bind itself stays strict. Loopback is the
default bind address.

**`explicit-flags`** — Behaviour is gated on an explicit, purpose-named
environment flag, never on an inferred "is this production" boolean. An unset
variable must not silently pick a behaviour.

**`location-agnostic-cli`** — A CLI entry point resolves its own assets
relative to its real path, so it works from any working directory and through
any symlink.

**`daemon-lifecycle`** — A background service exposes
`start|stop|restart|status|logs`: a detached spawn, a process-group
`SIGTERM`→`SIGKILL` teardown, and a PID file plus a companion state file
recording where the server actually bound.

**`package-name-matches-repo`** — When a repository produces one published
artifact, the artifact's name matches the repository name exactly, with no
suffix.

**`mise-task-flags`** — A `.mise.toml` task's `run` calls its command as
directly as it can. Signals, watch mode, teardown and exit codes are solved with
the documented flags of the tools involved (`concurrently -k`, `bun --watch`),
never with `trap`/PID/`wait` ceremony wrapped around them in shell.

## Client and UI

**`never-hide-a-control`** — A control is never hidden because it is currently
unusable. It stays visible, disabled, and carries the reason. Hiding a control
removes the user's ability to discover why it is unavailable.

**`affordances-adjacent`** — An affordance lives adjacent to what it changes:
the toggle for a tree column sits on the tree, not in a settings panel
elsewhere. Scope of placement matches scope of effect, so a control whose effect
really is app-wide — the theme switch — is the one kind that earns global
chrome.

**`share-the-invariant`** — The unit of sharing is the invariant, not the
markup. Two surfaces that must agree share the descriptor that makes them agree,
and each renders it.

**`one-descriptor-one-wrapper-one-guard`** — An affordance that appears on more
than one surface has exactly one descriptor, one shared wrapper, and one guard.
Two verb lists that must not drift are one list.

**`interaction-token`** — An interaction-state style appearing on two or more
surfaces is a single shared token owned by one module and composed by every
surface — the fuzzy match highlight and the focus accent are the worked
examples.

**`icon-components`** — Icons are components from the project's icon set
(`@tabler/icons-react`), never a Unicode character standing in for one.

**`highlight-what-matched`** — Fuzzy search highlights the matched characters in
every visible result. A ranked list that does not show *why* something ranked is
half a feature.

**`bundled-never-cdn`** — Runtime assets are bundled. Production never pulls a
third-party asset from a CDN at load time.

## Naming and knowledge

**`descriptive-names`** — Variable names — including parameters, destructured
bindings, loop variables and type parameters — fully describe what they
represent. No single letters, no acronyms.

**`generated-sibling-index`** — A directory of standalone files carries a
generated index in a **sibling** file named after it (`docs/requirements/` →
`docs/Requirements.md`). Every non-hidden file in the directory gets exactly one
row, there is no exclusion mechanism, and no second listing of that directory
exists anywhere. See [`docs/Requirements.md`](../Requirements.md),
[`docs/Research.md`](../Research.md) and
[`docs/Decisions.md`](../Decisions.md).

## Repo-specific amendments

- **`zod/v4` subpath imports are mandatory** (2026-07-21). A host application
  that source-aliases this package into its own Vite dev server resolves a bare
  `'zod'` specifier against the **host's** dependency tree, which may be pinned
  to Zod v3 — and every route then blanks at import time on a v4-only API
  (`z.stringbool is not a function`). Both v3 and v4 installs ship the `./v4`
  subpath, so `import { z } from 'zod/v4'` resolves to a v4 surface standalone
  and embedded alike. `AGENTS.md`'s tech-stack row mandates it so this cannot
  recur.
- **A feature list is not an implementation.** Where a feature is validated
  elsewhere — in another explorer, in broot — that names *what* to build. The
  implementation is engineered here, against the responsiveness principle
  ([101-performance-budgets](101-performance-budgets.md)): the core navigation
  loop always paints first, and every feature beyond it is async, cancellable,
  and degrades to absent.

## History

This file was `103-binding-adrs`, a table of numbered records held in a separate
repository. The numbers were an external reference a reader of this repo could
not resolve, so the rules were restated here in full and the numbering dropped.
The requirement number `103` is unchanged.

**2026-09-09.** The restatement reached the source. Every citation of one of
those numbers in `src/`, `server/`, `shared/`, `scripts/`, `vite.config.ts` and
`flake.nix` now names the slug above instead — 118 sites across 56 files. Three
rules gained the clause the comments leaned on and this file did not yet state:
the `zod-defaults` exemptions, the `affordances-adjacent` scope-of-effect
clause, and `mise-task-flags`, which had no slug here at all. Two sites cited
rules that are not conventions of this repo — a general fail-loudly posture in
`flake.nix` and a derived-from-a-sibling note in `shared/language.ts` — and
those state their constraint in their own words, with no citation.
