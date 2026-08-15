# Research

One file per question that needed digging, in [`research/`](research/), named
`YYYY-MM-DD-<topic>.md` for the day the work was done. A research file is a
**dated snapshot**: it records what was true of its subject when it was read,
and it is not revised as the world moves — a later answer is a later file.

Two of these double as **reference specs**. Where a requirement says "broot
does X", the exact strings, constants and key bindings are read from broot's
source and transcribed here, so "broot-style" is a checklist rather than a vibe.
Code that ports one of those specs cites the file it was ported from.

| Kind | Home |
|---|---|
| something the product must **do** or **be** | [`requirements/`](requirements/) |
| why we chose one way over another | [`decisions/`](decisions/) |
| a question that needed digging | [`research/`](research/) — here |

## Frontmatter schema

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Matches the filename without `.md`. |
| `title` | string | One line, the question or the subject. |
| `summary` | string | One line stating what the research **concluded**, not what it looked at. |
| `researched` | date | The day the source material was read. |
| `subject` | string | What was read, at the version it was read at — a research file that does not pin its subject's version cannot be checked later. |
| `decisions` | string[] | Ids of the decisions this backs. |
| `requirements` | string[] | Requirement ids that cite it. |

## Index

The table below is **generated** by `index build` and is the only listing of
this directory that exists. Do not edit it by hand, and do not copy it
elsewhere — point at it instead.

<!-- index:start fields=researched,subject -->
| File | Summary | Researched | Subject |
| --- | --- | --- | --- |
| [2026-07-17-broot-engine.md](research/2026-07-17-broot-engine.md) | broot publishes no usable library API and its interesting modules are welded to app machinery, but the algorithms are small enough to port — so the search scorer, tree builder and du spec are transcribed here as a reference spec. | 2026-07-17 | broot 1.58.0 |
| [2026-07-17-broot-tree-display-and-navigation.md](research/2026-07-17-broot-tree-display-and-navigation.md) | Every connector string, column default and key binding broot actually uses, read from its source, with our divergences marked — the fixed target that turns "broot-style" from a vibe into a checklist (R1–R8). | 2026-07-17 | broot 1.58 / master |

_2 entries — one row per file in `research/`._
<!-- index:end -->
