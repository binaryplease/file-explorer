# Changelog

Notable changes to `file-explorer`, newest first. **Breaking** marks a change to
something outside this process depends on — the `exports` specifiers a host
imports, or a path a running daemon already holds.

This file lives under `docs/` rather than at the repository root because release
notes for a rename have to quote the name that was renamed away from, and
[`015-product-identifiers-match-the-repository-name`](requirements/015-product-identifiers-match-the-repository-name.md)
makes `git grep -l binp- | grep -v '^docs/'` returning nothing the standing check
that no *live* identifier carries the old prefix. `docs/` is this repository's
committed knowledge, so a changelog is at home here; moving it to the root would
break that check for the sake of a filename convention.

## Unreleased

- **Breaking — the package is now named `file-explorer`, matching the
  repository, so the two published import specifiers moved with it:
  `binp-file-explorer/mount` and `binp-file-explorer/theme.css` became
  `file-explorer/mount` and `file-explorer/theme.css`.** An embedding host must
  update both; there is no compatibility alias. The `bfe` command is unchanged —
  the convention behind the rename binds the artifact, not the executable.
- The daemon's pid, state, log-directory and log-file paths moved with the
  package name (`$XDG_RUNTIME_DIR/file-explorer.pid`,
  `…/file-explorer.state.json`, `~/.local/share/file-explorer/`,
  `~/.local/share/file-explorer/file-explorer.log`). **No action needed:** the
  first `bfe daemon …` or `bfe status` after upgrading adopts a daemon still
  running under the old paths — taking over its pid and state and moving its logs
  across — and says on stdout what it did.
- The two `localStorage` keys moved to `file-explorer:theme` and
  `file-explorer:view-settings`. No data migration: a missing theme key falls
  back to the system preference and a missing view-settings key falls back to the
  defaults, which is what a first visit already gets.
- The Nix derivation, the `nix run` alias, the NixOS module
  (`services.file-explorer`), its systemd unit and its default service user were
  renamed to match. A host running the module through `nixosModules.default`
  needs its `services.binp-file-explorer.*` options renamed to
  `services.file-explorer.*`.

## 0.1.0 — 2026-09-09

- First public release: broot-style navigation, ranked server-side fuzzy search,
  bounded in-place previews, the on-demand `bfe` CLI with its daemon lifecycle,
  and a Nix flake shipping both a package and a hardened NixOS module.
