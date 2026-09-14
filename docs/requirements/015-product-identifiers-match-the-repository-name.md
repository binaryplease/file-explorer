---
id: 015-product-identifiers-match-the-repository-name
title: The product identifiers carry the repository's name, not the older prefix
summary: "Every product identifier — package name, Nix derivation and module, discovery document, the daemon's five runtime paths, both `exports` specifiers, the window title — now reads `file-explorer`, matching the repository per `package-name-matches-repo`; `bfe` keeps its short name. The two migrations inside the rename shipped with it: a daemon still running under the old paths is adopted rather than orphaned, and the specifier break is recorded as a breaking change."
status: shipped
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
shipped: 2026-09-14
updated: 2026-09-14
---

# The product identifiers carry the repository's name

**Shipped 2026-09-14.** Every site in the table below now reads `file-explorer`.
`bfe` kept its name, as required below. Both migrations shipped with the rename:
the CLI **adopts** a daemon still running under the old paths
(`server/cli/legacy-daemon.ts`, covered by `server/cli/legacy-daemon.test.ts`),
and the `exports` break is recorded as a one-line breaking change in
[`CHANGELOG.md`](../CHANGELOG.md). This file and
[`009-cli-daemon-and-status`](009-cli-daemon-and-status.md) are the only places
in the tree that still spell the old name, and they spell it in order to argue
about it — `git grep -l binp- | grep -v '^docs/'` returns nothing.

## The behaviour this replaced

The repository is `file-explorer`. Every identifier a user could see read
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
suffix. This repository produces one artifact and did not match it — and
[`009-cli-daemon-and-status`](009-cli-daemon-and-status.md) stated in passing
that it did, so a shipped requirement was describing behaviour the tree did not
have. That sentence was the smallest reason this file exists: the next reader
had to believe one of the two, and the wrong one was the `shipped` one. Both
were corrected in the change that shipped this.

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

   **Adoption shipped.** `server/cli/legacy-daemon.ts` runs before any verb that
   touches daemon state (`bfe daemon …`, `bfe status`; foreground `serve` owns
   no daemon files) and prints a line for whatever it did. A live old pid is
   rewritten under the new name with its state file; a dead or unreadable one is
   cleared away; and when a *different* live daemon is already recorded under the
   new name it adopts nothing, reports both pids, and says which one the CLI's
   verbs reach — overwriting a live record there would orphan a second port. The
   module is deliberately separable so it can be deleted whole once no daemon can
   plausibly predate the rename.
2. **The log directory does not follow.** `~/.local/share/binp-file-explorer/`
   keeps the old logs. Rename it when the new path is free; leave both in place
   and say which is which when it is not.

   **Shipped as stated**, with one addition the wording implied but did not say:
   the log *file* inside is renamed too, or `daemon logs` would read a directory
   whose only file still carries the old name. A rename keeps the inode, so an
   adopted daemon's open file descriptor follows it and the tail stays live.

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

## Definition of done — all five met

1. **`git grep -l binp- | grep -v '^docs/'` returns nothing.** The exemption is
   deliberate and narrow: this file, `009` and the generated row in
   `docs/Requirements.md` quote the old name in order to argue about it, so a
   grep with no exemption can never pass while the record of the rename exists.
   Two notes on where the old identifier did *not* end up:
   - `server/cli/legacy-daemon.ts` has to name the old paths in order to adopt
     them, so it spells the name as its prefix plus `DAEMON_NAME` rather than as
     one literal, with a comment saying why. Writing it out whole would satisfy
     this grep permanently and turn a live regression check into a standing
     exemption. `server/cli/legacy-daemon.test.ts` asserts the composed value,
     which is where the old string legitimately appears verbatim.
   - `bun.lock` carries the package name too, and the expectation recorded here
     — that it follows `package.json` on the next install — turned out to be
     wrong: bun preserves the root workspace `name` across `bun install` and
     `bun install --lockfile-only`, and only rewrites it when the lockfile is
     regenerated from scratch, which bumps unrelated dependency versions. The
     one `name` line was therefore updated in place, which is the whole of the
     lockfile's diff.
2. **`GET /api` answers `{"name":"file-explorer"}`**, from `SERVICE_NAME` in
   `server/index.ts`, and `StatusResponseSchema`'s `name` default says the same.
3. **`mise run deps:hash` re-run**, `flake.nix` and `bun.lock` committed
   together. The `outputHash` did not move — no dependency did — but the
   lockfile digest in the derivation *name* did, so nix refetched and
   re-verified rather than reusing the pre-rename store path. That is the
   backstop working, not a no-op.
4. **The adopt-or-report path is covered** by `server/cli/legacy-daemon.test.ts`
   (adopt a live pid, decline and report when the new name holds a different
   live daemon, clear a stale or unreadable pair, move the log directory,
   keep both directories when the new one exists). `README.md` and
   [`009-cli-daemon-and-status`](009-cli-daemon-and-status.md) both name the pid,
   state, log-directory and log-file locations.
5. **Both `exports` specifiers renamed** where they are documented —
   `src/theme.css` and `src/mount.tsx` — and recorded as a one-line breaking
   change in [`CHANGELOG.md`](../CHANGELOG.md), which this change adds as the
   home for release notes the repository did not previously have.

## The call, made

This file sat at `proposed` because the rename moves a path a user already has
on disk, so committing to it — and to which of the two upgrade paths in point 1
of "Why this is not a find-and-replace" ships — was the maintainer's call rather
than a consequence of writing the file down.

**The call was made on 2026-09-14: do the rename, and ship the adopting upgrade
path** rather than an upgrade note telling the user to run `bfe stop` first. The
reasoning is the one already argued above — a port held by a process the CLI
reports as not running is undiagnosable from the outside, and an upgrade note
only helps the user who reads it before the CLI lies to them.
