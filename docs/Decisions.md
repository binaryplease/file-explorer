# Decisions

One file per durable decision in [`decisions/`](decisions/): a question that had
more than one defensible answer, the answer we took, and **what we rejected and
why**. Named `YYYY-MM-DD-<slug>.md` for the day it was decided.

**Architecture only.** A file belongs here when the call it records shapes how
the product is built — an engine, a boundary, a scope, a data seam — and a reader
changing that code needs to know what was already weighed and turned down.
Licensing, repository and publication process, branding and visual identity are
decisions too, but not *architectural* ones, and they do not live here; seven
such files were removed on 2026-09-10 for that reason. The argument for each is
restated in the requirement or the file it actually binds.

A decision is not a requirement and not a log entry:

| Kind | Home |
|---|---|
| something the product must **do** or **be** | [`requirements/`](requirements/) |
| why we chose one architecture over another, and what we turned down | [`decisions/`](decisions/) — here |
| the digging that produced the answer | [`research/`](research/) |
| licence, publication, branding, naming | the file they bind — `LICENSE`, a requirement, the theme tokens |
| what happened on a given day | the git history |

A requirement links to the decision it rests on rather than restating the
argument — but it must still stand on its own for a reader who only reads the
requirement.

## Frontmatter schema

Every field is present in every file; a value that does not apply is written
`null` or `[]` explicitly.

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Matches the filename without `.md`. |
| `title` | string | One line, the decision itself. |
| `summary` | string | One line stating the **conclusion**, not the topic — this is the row in the generated index below. |
| `decided` | date | The day the call was made. Never changed; a reversal is a new file that names this one. |
| `status` | enum | `accepted` · `superseded` — a superseded decision names its replacement in the body and is kept, never deleted. |
| `requirements` | string[] | Requirement ids this decision binds. |
| `research` | string[] | Paths to the deep-dives that produced it. |

## Index

The table below is **generated** from `decisions/` and is the only listing of
this directory that exists. Do not edit it by hand, and do not copy it
elsewhere — point at it instead. Rebuilding it is a maintainer step (see
`AGENTS.md`): add your file and leave the marker block below untouched.

<!-- index:start fields=decided,status -->
| File | Summary | Decided | Status |
| --- | --- | --- | --- |
| [2026-07-17-re-engineer-the-broot-engine.md](decisions/2026-07-17-re-engineer-the-broot-engine.md) | broot has no supported library API, so its search, tree-build and du algorithms are ported to TypeScript against its source as a reference spec; a Rust sidecar stays the measured-performance fallback. | 2026-07-17 | accepted |
| [2026-07-20-no-path-confinement-for-local-use.md](decisions/2026-07-20-no-path-confinement-for-local-use.md) | Confining a local tool to its served root buys nothing and costs a realpath per path, so confinement became a default flip behind a flag rather than a deletion; the loopback bind stays the boundary. | 2026-07-20 | accepted |
| [2026-07-20-the-origin-is-the-security-boundary.md](decisions/2026-07-20-the-origin-is-the-security-boundary.md) | Probing the running server showed path confinement was never the exposure — a confined server still serves ~/.ssh to a DNS-rebound origin; the hole was an unvalidated Host header, fixed with a guard ahead of routing. | 2026-07-20 | accepted |
| [2026-07-20-the-preview-is-the-viewer.md](decisions/2026-07-20-the-preview-is-the-viewer.md) | Once this explorer is consumed as a library rather than reimplemented by each host, a gap in the preview is a gap in every consuming app — so the bounded-head "glance" scope is no longer sufficient. | 2026-07-20 | accepted |

_4 entries — one row per file in `decisions/`._
<!-- index:end -->
