# Requirements

One file per requirement, each opening with YAML frontmatter. **This folder is
committed** — it is what the repo requires of itself, so it ships with the code
and is reviewable in a diff like any other source.

A requirement here is something we require the product to **do** or **be**: a
feature we have committed to, or a standing constraint every feature must
respect. Chronology and rationale stay in the local dev notebook
(`../.nightshift/backlog.md` → Log and Decisions); a requirement links to them
rather than restating them.

Split out of the backlog on 2026-07-28, and lifted to the repo root on the same
day. The backlog was one 600-line file in which the plan, the history, and the
standing constraints were interleaved, so a requirement could only be addressed
as "Next steps #4".

> **Links into `../.nightshift/` may not resolve on a fresh clone.** The notebook
> (backlog, research) is gitignored — sole-dev, not yet adopted by ADR — while
> these files are not. A requirement therefore states what it requires on its
> own, and cites the notebook for the reasoning behind it. When the notebook
> convention is adopted by ADR and committed, those links resolve everywhere and
> nothing here changes.

## Frontmatter schema

Every field is present in every file — a value that does not apply is written
`null` or `[]` explicitly rather than omitted, so the shape of a requirement is
readable from any single file (the ADR-0024 / ADR-0029 convention this repo
applies to JSON and Zod, applied to its own notes).

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable identifier; matches the filename without `.md`. Never renumbered — a superseded requirement keeps its id. |
| `title` | string | One line, the requirement itself. |
| `status` | enum | `planned` · `in-progress` · `shipped` · `standing` · `proposed` · `superseded`. |
| `rank` | number \| null | Ordering among delivery requirements; `null` for standing constraints, which are not scheduled. Lower is sooner. |
| `tags` | string[] | Surface areas touched: `client`, `server`, `preview`, `tree`, `security`, `perf`, `cli`, `config`, `theme`, `packaging`. |
| `blocks` | string[] | Requirement ids that cannot ship until this one does. |
| `blocked_by` | string[] | Requirement ids this one waits on. |
| `research` | string[] | Paths to backing deep-dives in `../.nightshift/research/`. |
| `adrs` | string[] | ADRs that bind the implementation. |
| `shipped` | date \| null | The day it landed; `null` while open. Partial delivery keeps `null` and names the shipped parts in the body. |
| `updated` | date | Last day this requirement's content changed. |

Status vocabulary:

- **planned** — committed, not started.
- **in-progress** — partially delivered; the body names what landed and what is left.
- **shipped** — delivered in full. Kept, not deleted: a shipped requirement is
  the spec of behaviour we must not regress, and its follow-ups live in its body.
- **standing** — an always-on constraint, never "done".
- **proposed** — argued for but not yet committed; promote to `planned` or drop.
- **superseded** — replaced by another requirement, named in the body.

## Index

| id | status | rank | title |
|---|---|---|---|
| [001-unconfined-root-anchor](001-unconfined-root-anchor.md) | shipped | 1 | The served root is a display anchor, not a security boundary |
| [002-preview-parity](002-preview-parity.md) | in-progress | 2 | Preview parity — the preview is the viewer, not a glance |
| [003-embeddable-file-explorer](003-embeddable-file-explorer.md) | planned | 3 | Embeddable `<FileExplorer>` component |
| [004-host-app-endpoints](004-host-app-endpoints.md) | planned | 4 | Two endpoints host apps need — `exists` and `reveal` |
| [005-git-status-column](005-git-status-column.md) | planned | 5 | Git status column, async and degradable |
| [006-preview-panel](006-preview-panel.md) | shipped | 6 | Preview panel beside the tree |
| [007-directory-sizes](007-directory-sizes.md) | planned | 7 | Aggregated directory sizes, opt-in and progressive |
| [008-publish-to-zink](008-publish-to-zink.md) | planned | 8 | Publish an HTML file or folder to zink |
| [009-cli-daemon-and-status](009-cli-daemon-and-status.md) | shipped | 9 | On-demand `bfe` CLI, daemon lifecycle, status endpoint |
| [010-broot-tree-display-and-navigation](010-broot-tree-display-and-navigation.md) | in-progress | 10 | broot tree display and navigation parity (R1–R8) |
| [011-command-palette-verbs](011-command-palette-verbs.md) | proposed | 11 | Keyboard-first verb palette |
| [100-loopback-only-service](100-loopback-only-service.md) | standing | null | Loopback-only service; exposure is an explicit opt-in |
| [101-performance-budgets](101-performance-budgets.md) | standing | null | Speed budgets, and when optimization starts |
| [102-theme-token-model](102-theme-token-model.md) | standing | null | One `@theme` block; alternate themes override the same vars |
| [103-binding-adrs](103-binding-adrs.md) | standing | null | The ADRs binding on this repo |

Ranks 1–4 outrank the rest: they block the nightshift-ui adoption
(`../.nightshift/research/2026-07-20-nightshift-ui-adoption.md`).
