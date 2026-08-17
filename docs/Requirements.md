# Requirements

One file per requirement in [`requirements/`](requirements/), each opening with
YAML frontmatter. **This folder is committed** — it is what the repo requires of
itself, so it ships with the code and is reviewable in a diff like any other
source.

A requirement is something we require the product to **do** or **be**: a feature
we have committed to, or a standing constraint every feature must respect.
`001`–`0xx` are delivery requirements in rank order; `1xx` are standing
constraints that bind every feature.

**Why it happened and when** is not here. A durable choice — the alternatives
weighed and the reason one won — is a file in [`decisions/`](decisions/); the
digging behind one is a file in [`research/`](research/). A requirement links to
both rather than restating them, and **stands on its own without either**: a
reader who has only this repo can build what it describes.

**This repo names nothing outside itself.** No sibling project, no internal
record number, no private hostname, no service name. Where a fact of that kind
was load-bearing, the *constraint* it implied is restated here without it — see
[`103-engineering-conventions`](requirements/103-engineering-conventions.md),
which carries the full text of every convention this repo is held to.

## Frontmatter schema

Every field is present in every file — a value that does not apply is written
`null` or `[]` explicitly rather than omitted, so the shape of a requirement is
readable from any single file (the `emit-nullish` convention this repo applies
to JSON and Zod, applied to its own notes).

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable identifier; matches the filename without `.md`. The **number** is never reused and never renumbered — a superseded requirement keeps it. |
| `title` | string | One line, the requirement itself. |
| `summary` | string | One line stating the **conclusion**, not the topic. This is the row the generated index below carries, so it is written for someone deciding whether to open the file. |
| `status` | enum | `planned` · `in-progress` · `shipped` · `standing` · `proposed` · `superseded`. |
| `rank` | number \| null | Ordering among delivery requirements; `null` for standing constraints, which are not scheduled. Lower is sooner. |
| `tags` | string[] | Surface areas touched: `client`, `server`, `preview`, `tree`, `security`, `perf`, `cli`, `config`, `theme`, `packaging`, `api`. |
| `blocks` | string[] | Requirement ids that cannot ship until this one does. |
| `blocked_by` | string[] | Requirement ids this one waits on. |
| `research` | string[] | Paths to backing deep-dives in [`research/`](research/). |
| `decisions` | string[] | Ids of the decisions in [`decisions/`](decisions/) this requirement rests on. |
| `conventions` | string[] | Slugs from [`103-engineering-conventions`](requirements/103-engineering-conventions.md) binding this requirement's implementation. |
| `shipped` | date \| null | The day it landed; `null` while open. Partial delivery keeps `null` and names the shipped parts in the body. |
| `updated` | date | Last day this requirement's **substance** changed. Editorial passes do not move it. |

Status vocabulary:

- **planned** — committed, not started.
- **in-progress** — partially delivered; the body names what landed and what is left.
- **shipped** — delivered in full. Kept, not deleted: a shipped requirement is
  the spec of behaviour we must not regress, and its follow-ups live in its body.
- **standing** — an always-on constraint, never "done".
- **proposed** — argued for but not yet committed; promote to `planned` or drop.
- **superseded** — replaced by another requirement, named in the body.

## Index

The table below is **generated** by `index build` and is the only listing of
this directory that exists. Do not edit it by hand, and do not copy it
elsewhere — point at it instead. `ls -p requirements | grep -v /` and the row
count are the same number, by construction.

<!-- index:start fields=status,rank -->
| File | Summary | Status | Rank |
| --- | --- | --- | --- |
| [001-unconfined-root-anchor.md](requirements/001-unconfined-root-anchor.md) | The served root is where the tree starts, not where it ends — confinement is a default flip behind a flag, so out-of-root paths travel the wire as absolute paths. | shipped | 1 |
| [002-preview-parity.md](requirements/002-preview-parity.md) | The preview is the only viewer a consuming app gets, so it must render what the file actually is; windowed reads on scroll are the one item still open. | in-progress | 2 |
| [003-embeddable-file-explorer.md](requirements/003-embeddable-file-explorer.md) | `App` is the shell and owns global browser state, so it cannot be mounted by a host or twice on a page — this is the work that makes it a component. | planned | 3 |
| [004-host-app-endpoints.md](requirements/004-host-app-endpoints.md) | Two seam endpoints a host app needs: a batch `exists` to check paths before linkifying them, and `reveal` to select an entry in the OS file manager. | planned | 4 |
| [005-git-status-column.md](requirements/005-git-status-column.md) | Working-tree git status per entry, aggregated up to directories — async enrichment after the listing paints, cancellable and degradable, or it does not ship. | planned | 5 |
| [006-preview-panel.md](requirements/006-preview-panel.md) | The preview is a resizable column beside the tree, never a modal over it; a file click previews, a directory click enters, and focus shows at the seam. | shipped | 6 |
| [007-directory-sizes.md](requirements/007-directory-sizes.md) | Aggregated directory sizes are opt-in because they cost a walk — worker pool, path-to-sum cache, cancellation and hard-link dedup are the design, not extras. | planned | 7 |
| [008-publish-to-a-share-service.md](requirements/008-publish-to-a-share-service.md) | A verb that uploads an HTML file or a folder to a share service named entirely by configuration, and persists the returned edit token so a later publish updates in place. | planned | 8 |
| [009-cli-daemon-and-status.md](requirements/009-cli-daemon-and-status.md) | `bfe [path]` serves the working directory in the foreground and `bfe daemon …` runs the singleton; port selection lives in the server and is strict by default. | shipped | 9 |
| [010-broot-tree-display-and-navigation.md](requirements/010-broot-tree-display-and-navigation.md) | broot's exact connectors, screen-fit auto-open and interleaved alpha order are delivered; vim keys, the back-vs-parent split and the extra columns are open. | in-progress | 10 |
| [011-command-palette-verbs.md](requirements/011-command-palette-verbs.md) | A keyboard-first verb palette sharing one descriptor per verb with the context menu, now that copy, open and publish are actions worth naming. | proposed | 11 |
| [012-publication-readiness.md](requirements/012-publication-readiness.md) | Publication is blocked on git history — not the tip: the working tree is clean, but 21 commits still carry a sibling service's name and upload contract, and a deleted file maps an outside decision corpus. The tip's own gap is 119 source comments citing record numbers from that corpus. | planned | 12 |
| [100-loopback-only-service.md](requirements/100-loopback-only-service.md) | This is an unauthenticated filesystem API: the loopback bind is the boundary, and a non-loopback `HOST` fails closed unless the operator names the served hosts. | standing | — |
| [101-performance-budgets.md](requirements/101-performance-budgets.md) | Optimize when a real interaction misses a budget on a real tree, not before — no stress fixture, no optimization. | standing | — |
| [102-theme-token-model.md](requirements/102-theme-token-model.md) | Design tokens live in one `@theme` block with dark as the base; an alternate theme overrides those same `--color-*` vars, never a second token set. | standing | — |
| [103-engineering-conventions.md](requirements/103-engineering-conventions.md) | The full text of every convention this repo is held to, each with a slug other requirements cite — stated here rather than referenced, so the repo is readable without any other repository. | standing | — |

_16 entries — one row per file in `requirements/`._
<!-- index:end -->
