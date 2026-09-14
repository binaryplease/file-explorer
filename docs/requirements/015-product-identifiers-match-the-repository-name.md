---
id: 015-product-identifiers-match-the-repository-name
title: The product identifiers carry the repository's name, not the older prefix
summary: "The repository is `file-explorer`, but the package name, the Nix derivation and module, the discovery document, the daemon's five runtime paths and the window title all still read `binp-file-explorer` — so the tree breaks its own `package-name-matches-repo` convention; moving them is a rename plus one real migration, because the daemon's pid/state/log paths move with the constant that names them."
status: proposed
rank: 15
tags: [packaging, cli, config]
blocks: []
blocked_by: []
research: []
decisions: []
conventions:
  - package-name-matches-repo
  - daemon-lifecycle
  - location-agnostic-cli
shipped: null
updated: 2026-09-14
---

# The product identifiers carry the repository's name

## Current behaviour

The repository is `file-explorer`. Every identifier a user can see still reads
`binp-file-explorer`, the prefix this project carried before it was published:

| Site | What it names |
|---|---|
| `package.json` `name` | the package |
| `flake.nix` — `pname`, `packages.<name>`, `services.<name>`, the systemd unit and its service user | the derivation, the NixOS module and the unit |
| `server/routes/discovery.schema.ts` — the `name` default | the answer `GET /api` gives every client |
| `server/index.ts` — `SERVICE_NAME`, the startup line, two error messages | what the server calls itself out loud |
| `server/cli/paths.ts` — `DAEMON_NAME` | the PID file, the state file, the log directory, the log file and the per-launch ready file |
| `src/lib/theme.ts` and `src/lib/viewSettings.ts` | two `localStorage` keys, `…:theme` and `…:view-settings` |
| `src/components/TitleBar.tsx`, `src/index.html` `<title>`, `public/favicon.svg` `<title>` and `aria-label` | the name on screen and to a screen reader |
| `README.md`, `SECURITY.md`, `THIRD-PARTY-NOTICES.md`, `AGENTS.md` | the name in the prose and in the documented paths |
| `server/services/preview.test.ts`, `scripts/stress-fixture.ts` | temporary-directory prefixes |

`package-name-matches-repo` says that when a repository produces one published
artifact, the artifact's name matches the repository name exactly, with no
suffix. This repository produces one artifact and does not match it — and
[`009-cli-daemon-and-status`](009-cli-daemon-and-status.md) states in passing
that it does, so a shipped requirement is currently describing behaviour the
tree does not have. That sentence is the smallest reason this file exists: the
next reader has to believe one of the two, and today the wrong one is the
`shipped` one.

## Required behaviour

Every site above reads `file-explorer`. The `bfe` command keeps its name: the
convention binds the artifact, not the executable, and `bin` is free to differ
from `name` — a shorter command is the point of having one.

## Why this is not a find-and-replace

`DAEMON_NAME` is a single constant that five runtime paths are derived from, so
renaming it moves all five at once. Two consequences, and neither may be silent:

1. **A daemon already running under the old name goes unreachable.** The new CLI
   reads `$XDG_RUNTIME_DIR/file-explorer.pid`, finds nothing, and reports
   stopped — while the old process is still alive and still holding its port.
   `stop` becomes a no-op and `logs` reads an empty directory. Either the
   upgrade notes say "run `bfe stop` first", or the CLI adopts: if the old PID
   file names a live process, take it over and rewrite the pair under the new
   name. Adopting is the better answer, because the failure it prevents is one
   the user cannot diagnose — a port held by a process their CLI says is not
   running is exactly the fail-quietly case `fail-loud-ports` exists to reject.
2. **The log directory does not follow.** `~/.local/share/binp-file-explorer/`
   keeps the old logs. Rename it when the new path is free; leave both in place
   and say which is which when it is not.

The two `localStorage` keys are a third rename and owe no migration: a missing
theme key falls back to the system preference and a missing view-settings key
falls back to the defaults, which is what a first visit already gets.

The paths `009` documents move with `DAEMON_NAME`, so shipping this changes a
`shipped` requirement's text. Update `009` in the same change — including the
clause that claims the package name already matches the repository — rather than
leaving the two files to disagree in the other direction.

## Definition of done

1. `git grep binp-` over the tracked tree returns nothing at all. `bun.lock`
   carries the package name too, but it is regenerated rather than edited, so it
   follows `package.json` on the next install instead of needing its own pass.
2. `GET /api` answers `{"name":"file-explorer"}`, and the discovery schema's
   default says the same.
3. `mise run deps:hash` has been re-run and `flake.nix` committed with
   `bun.lock`. The derivation name embeds a digest of the lockfile and the
   lockfile carries the package name, so this rename is a dependency-shaped
   change whether or not a dependency moved.
4. The daemon's adopt-or-report path is covered by a test, and `README.md` and
   [`009-cli-daemon-and-status`](009-cli-daemon-and-status.md) name the new pid,
   state and log locations.

## Open call

This is `proposed`, not `planned`. The rename is owed by the convention, but it
moves a path a user already has on disk, so committing to it — and to which of
the two upgrade paths in point 1 ships — is the maintainer's call, not a
consequence of writing this file down. Promote it to `planned` or drop it; do
not leave it here as a third state.
