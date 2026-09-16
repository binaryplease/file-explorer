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

- **The monospace face is now Fira Code, self-hosted.** `--font-mono` previously
  named a stack of fonts the *machine* might have (`ui-monospace`, JetBrains
  Mono, SF Mono, …), so the explorer's metrics — and its column alignment —
  differed per viewer. `@fontsource-variable/fira-code` (OFL-1.1, wght axis only,
  7 `.woff2` subsets, +124K in `dist/client/`) now ships with the build and the
  old stack stays behind it as the fallback. The latin subset is preloaded from
  the document head, so the tree paints in Fira Code rather than painting in the
  system fallback and reflowing. The app sets **no ligature rules at all** — Fira
  Code's ligatures, and every other face's, render exactly as their designers
  shipped them. **Embedding hosts:** importing `file-explorer/theme.css` gives
  you the token, not the font files — add
  `@fontsource-variable/fira-code/wght.css` to your own build to get the intended
  face, or the mounted surface falls back to your system's monospace as before.
  The preload is emitted by this repository's own client build, so a host that
  wants it adds its own.
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
- **The third-party notices no longer overstate what the fonts' licence asks of
  you.** `THIRD-PARTY-NOTICES.md` said an OFL-1.1 §3 Reserved Font Name stopped a
  modified font from keeping the name "Inter" — and the Fira Code entry inherited
  the claim. It does not: §3 binds only names "specified as such after the
  copyright statement(s)", and neither font's `LICENSE` specifies any. Anyone who
  read the 0.1.0 notices before redistributing a modified Inter was working from
  a stricter rule than the licence imposes. Corrected in the notices and in the
  same claim repeated in `docs/requirements/012-publication-readiness.md`.

## 0.1.0 — 2026-09-09

- First public release: broot-style navigation, ranked server-side fuzzy search,
  bounded in-place previews, the on-demand `bfe` CLI with its daemon lifecycle,
  and a Nix flake shipping both a package and a hardened NixOS module.
