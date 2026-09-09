# Contributing

Thanks for looking. This is a small project with a strong opinion about how it
is built, and that opinion is written down rather than kept in someone's head —
which means you can follow it without asking anyone.

Two files carry the rules:

- [`AGENTS.md`](AGENTS.md) — the tech stack, the dev commands, the layout, and
  the binding responsiveness principle. **Read it before writing code.** It is
  addressed to coding agents, but it is the same manual for humans.
- [`docs/requirements/103-engineering-conventions.md`](docs/requirements/103-engineering-conventions.md)
  — the full text of every convention the code is held to, each with a short
  slug (`factory-services`, `fail-loud-ports`, `never-hide-a-control`, …). Code
  comments cite conventions by slug, so when you meet one in a comment, that is
  where it is defined.

## Getting it running

You need [Bun](https://bun.sh). The repository pins the version with
[mise](https://mise.jdx.dev), which is the easiest way to get the right one:

```sh
mise install      # installs the pinned Bun toolchain
bun install       # dependencies
mise run dev      # Elysia on :3000 + Vite on :5173
```

Then open <http://localhost:5173>. A dev session serves **this repository**, so
you are browsing the code you are changing. Set `EXPLORER_ROOT` to point it
somewhere else.

If a port is taken, the dev script picks the next free one and prints the
assignment before either server binds — that is deliberate, and it is the only
place a port is reassigned. Everywhere else a taken port is a fatal error
(`fail-loud-ports`).

Without mise, any Bun 1.x works: `bun install` then `bun dev`.

There is also a [Nix](https://nixos.org) flake. `nix develop` gives you the
toolchain, and `nix run .` builds and runs the `bfe` CLI. You do **not** need
Nix to develop — only to touch dependency vendoring (see below).

## Before you open a pull request

Run these. All three must pass, and a reviewer will run them:

```sh
mise run typecheck   # tsc --noEmit
mise run test        # bun test
mise run build       # Vite → dist/client, Bun → dist/server
```

Tests live beside the code they test — `foo.ts` and `foo.test.ts` in the same
directory (`code-lives-with-dependencies`). There is no separate test tree.

### If you touched the listing path, you owe a measurement

The repository's rule is **no fixture, no optimization**. Before claiming any
performance change on directory listing or search, reproduce it against the
stress fixture and quote a before *and* an after:

```sh
mise run stress:fixture   # generates a large-directory fixture outside the repo
mise run bench:list       # measures GET /api/fs/list against its budget
```

The budgets are in
[`docs/requirements/101-performance-budgets.md`](docs/requirements/101-performance-budgets.md).
Every listing already reports its own phase timings and syscall counts on a
`Server-Timing` response header, so there is nothing to instrument first.

### If you changed a dependency, it is a two-file change

`flake.nix` vendors `node_modules` as a fixed-output derivation identified by a
hash. `package.json` and `bun.lock` are not inputs to it, so changing a
dependency without refreshing that hash leaves Nix building against the *old*
tree, and it fails somewhere far from the cause.

```sh
mise run deps:hash   # syncs the lockfile, recomputes the hash, verifies the build
```

Commit `flake.nix` and `bun.lock` together. This step needs Nix; if you cannot
run it, say so in the pull request and a maintainer will.

If the new dependency is copyleft (GPL, LGPL, AGPL) or source-available, stop and
open an issue instead — see [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

## The rule that will surprise you: everything is async but navigation

`AGENTS.md` states it as binding, and it is the constraint most likely to send a
patch back:

> The core navigation mechanism — list / fuzzy-search / move — always comes
> first. Every feature beyond it must be async and non-blocking. A listing or
> search response never waits on enrichment work (git status, previews,
> directory sizes, thumbnails, …).

So the obvious implementation of most good ideas is the one this project
refuses. Git status computed inside the listing handler, directory sizes walked
per request, an unbounded preview read — each of those is a rejected patch, not
a starting point. Enrichment arrives *after* the tree has painted, cancels when
the user navigates away, and degrades to absent rather than delaying the core.

## Documentation is part of the change

The committed knowledge lives in [`docs/`](docs/), in three directories, each
with an index file beside it:

| You are writing | It goes in |
| --- | --- |
| something the product must **do** or **be** | [`docs/requirements/`](docs/requirements/) |
| why one way was chosen over another, and what was rejected | [`docs/decisions/`](docs/decisions/) |
| a dated deep-dive that produced an answer | [`docs/research/`](docs/research/) |

Each index file states the frontmatter schema its directory uses; every field is
present in every file, written `null` or `[]` when it does not apply. A change
that delivers a requirement moves that requirement's `status` and `updated`
fields and says in its body what landed. A change that settles a genuine
either/or gets a file in `docs/decisions/`.

### Do not regenerate the docs indexes

The table inside each index file, between the `<!-- index:start … -->` and
`<!-- index:end -->` markers, is **generated** — and the generator is maintainer
tooling that is not part of this repository. That is a deliberate choice, not an
oversight: two generators behind one artifact would disagree eventually, and an
honest rebuild would then read as a stale index.

So if you add, rename or remove a file under `docs/`, or change a `summary` in
frontmatter:

1. Write the file.
2. **Leave the marker block alone.** Do not hand-edit rows, and do not add one
   for your file.
3. Say in your pull-request description that the index needs regenerating.

A maintainer rebuilds it. Nothing you are asked to do here requires the
generator, and the prose *outside* the markers is ordinary documentation you
should edit freely.

## Style

- **Descriptive names.** No single letters, no acronyms — `selectedEntryPath`,
  not `sep` (`descriptive-names`).
- **Services are factory functions** returning a typed object, not classes
  (`factory-services`).
- **Zod is imported from `zod/v4`**, never from bare `zod`. There is a real
  failure behind that: a host application that source-aliases this project into
  its own build resolves bare `zod` against *its* dependency tree, which may be
  v3, and v4-only APIs then blank every route at import time.
- **Never hide a UI control.** Disable it and say why (`never-hide-a-control`).
- **Icons come from `@tabler/icons-react`**, never Unicode characters.
- **This repository names nothing outside itself** — no other project, no
  private hostname, no service name — in `docs/`, in source comments, or in
  `AGENTS.md`. If a fact like that is load-bearing for you, restate the
  constraint without it or make it configuration.

Match the surrounding code's comment density and idiom. Comments here explain
*why*, not *what*, and they are expected to be full sentences.

## Commits and pull requests

- Write the commit message in the imperative, describing the change and why:
  `fix: refuse a non-loopback bind with no allowed hosts`.
- One logical change per pull request. If you find a second thing worth fixing,
  that is a second pull request.
- Fill in the template. Whichever gates you could not run, say so — an honest
  "I could not run `deps:hash`, no Nix" is far more useful than silence.
- A reviewer will read it. Nothing is merged unreviewed, including work by the
  maintainer.

## Reporting a security problem

Not here. Do not open an issue or a pull request for it —
[`SECURITY.md`](SECURITY.md) has the private reporting path.

## Licensing of your contribution

There is **no contributor licence agreement (CLA)** — a separate document some
projects make you sign before they will accept a patch — and **no
Developer Certificate of Origin (DCO)** sign-off line to add to your commits.

Contributions are accepted under the project's own licence: by opening a pull
request you offer your change under the MIT License in [`LICENSE`](LICENSE), on
the same terms as the rest of the project. That is the ordinary "inbound equals
outbound" arrangement, and it is also GitHub's stated default for public
repositories.

Only submit work you have the right to submit. If any part of your patch is
copied from somewhere else, or was written for an employer who might hold the
copyright, say so in the pull request before it is reviewed.

## Code of conduct

Participating here means following the [Code of Conduct](CODE_OF_CONDUCT.md).
