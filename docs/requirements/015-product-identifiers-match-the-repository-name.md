---
id: 015-product-identifiers-match-the-repository-name
title: The product identifiers carry the repository's name, not the older prefix
summary: "The repository is `file-explorer`, but the package name, the Nix derivation and module, the discovery document, the daemon's five runtime paths and the window title all still read `binp-file-explorer` — so the tree breaks its own `package-name-matches-repo` convention; moving them is a rename plus two migrations, because the daemon's pid/state/log paths move with the constant that names them and the package name is half of both `exports` specifiers an embedding host imports."
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
| `package.json` `name` | the package — and, through `exports`, the first half of every specifier an embedding host imports |
| `src/theme.css` and `src/mount.tsx` | the documented import path `binp-file-explorer/theme.css`, in the comments a host reads before mounting |
| `flake.nix` — `pname`, `packages.<name>`, `services.<name>`, the systemd unit and its service user | the derivation, the NixOS module and the unit |
| `server/routes/discovery.schema.ts` — the `name` default | the answer `GET /api` gives every client |
| `server/index.ts` — `SERVICE_NAME`, the startup line, the non-loopback Host refusal and the `/api/status` OpenAPI description | what the server calls itself out loud |
| `server/services/bind-exposure.ts` — the non-loopback bind warning | the same, on the one message an operator is meant to act on |
| `server/cli.ts` — the module docstring | what the CLI entry says it is |
| `server/cli/paths.ts` — `DAEMON_NAME` | the PID file, the state file, the log directory, the log file and the per-launch ready file |
| `src/lib/theme.ts`, `src/lib/viewSettings.ts` and the pre-paint script in `src/index.html` | two `localStorage` keys, `…:theme` and `…:view-settings` — the theme key is read from two places |
| `src/components/TitleBar.tsx`, `src/index.html` `<title>`, `public/favicon.svg` `<title>` and `aria-label` | the name on screen and to a screen reader |
| `README.md`, `SECURITY.md`, `THIRD-PARTY-NOTICES.md`, `AGENTS.md` | the name in the prose and in the documented paths |
| `server/services/preview.test.ts`, `scripts/stress-fixture.ts` | temporary-directory prefixes |
| `scripts/stress-fixture.test.ts` | a fixture path named after the product, in the test that a directory with no marker is refused however plausible it looks |

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

Two of the sites above are contracts with something outside this process — a
daemon already on disk, and a host application already importing the package —
so the rename has two real migrations in it, not one.

`DAEMON_NAME` is a single constant that five runtime paths are derived from, so
renaming it moves all five at once. Two consequences of that, and neither may be
silent:

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

**The package name is half of a published import specifier.** `package.json`
`exports` maps `./mount` and `./theme.css`, so an embedding host imports
`binp-file-explorer/mount` and `binp-file-explorer/theme.css` — the two paths
`src/mount.tsx` and `src/theme.css` document, and the interface whose packaging
question [`012-publication-readiness`](012-publication-readiness.md) B8 answered.
Renaming `name` breaks both specifiers at once. The
package is `"private": true` and there is no registry version, so the blast
radius is a host consuming this from a path or a git ref rather than an
unknowable set of installs — but it is still a breaking change to the one API
this repository publishes, and it belongs in the release notes of whatever
version ships the rename, not only in this file.

The two `localStorage` keys owe no data migration: a missing theme key falls back
to the system preference and a missing view-settings key falls back to the
defaults, which is what a first visit already gets. They do owe an ordering,
because the theme key is read twice — once by the pre-paint script in
`src/index.html` and once by `src/lib/theme.ts`, which that script's comment says
it mirrors by hand. Rename both in the same commit, or the first paint reads a
key the module no longer writes, falls back to the system preference, and flashes
the wrong palette on every load for anyone who chose against it.

The paths `009` documents move with `DAEMON_NAME`, so shipping this changes a
`shipped` requirement's text. Update `009` in the same change — including the
clause that claims the package name already matches the repository — rather than
leaving the two files to disagree in the other direction.

## Definition of done

1. `git grep -l binp- | grep -v '^docs/'` returns nothing. The exemption is
   deliberate and narrow: this file, `009` and the generated row in
   `docs/Requirements.md` quote the old name in order to argue about it, so a
   grep with no exemption can never pass while the record of the rename exists.
   `bun.lock` carries the package name too but is regenerated rather than
   edited, so it follows `package.json` on the next install instead of needing
   its own pass.
2. `GET /api` answers `{"name":"file-explorer"}`, and the discovery schema's
   default says the same.
3. `mise run deps:hash` has been re-run and `flake.nix` committed with
   `bun.lock`. The derivation name embeds a digest of the lockfile and the
   lockfile carries the package name, so this rename is a dependency-shaped
   change whether or not a dependency moved.
4. The daemon's adopt-or-report path is covered by a test, and `README.md` and
   [`009-cli-daemon-and-status`](009-cli-daemon-and-status.md) name the new pid,
   state and log locations.
5. The two `exports` specifiers are renamed everywhere they are documented, and
   the release that carries the rename says in one line that
   `binp-file-explorer/mount` and `binp-file-explorer/theme.css` became
   `file-explorer/mount` and `file-explorer/theme.css`.

## Open call

This is `proposed`, not `planned`. The rename is owed by the convention, but it
moves a path a user already has on disk, so committing to it — and to which of
the two upgrade paths in point 1 ships — is the maintainer's call, not a
consequence of writing this file down. Promote it to `planned` or drop it; do
not leave it here as a third state.
