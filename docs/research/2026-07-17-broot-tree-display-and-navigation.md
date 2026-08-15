---
id: 2026-07-17-broot-tree-display-and-navigation
title: broot tree display and navigation — reference spec
summary: "Every connector string, column default and key binding broot actually uses, read from its source, with our divergences marked — the fixed target that turns \"broot-style\" from a vibe into a checklist (R1–R8)."
researched: 2026-07-17
subject: broot 1.58 / master
decisions: []
requirements: [010-broot-tree-display-and-navigation]
---

# broot tree display & navigation (reference spec)

Researched 2026-07-17 against broot **1.58 / master** (MIT). Companion to
`2026-07-17-broot-engine.md` (that one specs the *search/scoring/du engine*;
this one specs the *look on screen* and the *feel while moving around*). Every
fact below is read from broot's docs or source — see Sources. Where our current
prototype already matches, it is marked ✅; where it diverges, ⚠ with the
decision to make.

Purpose: a fixed target to re-engineer against, so "broot-style" stops being a
vibe and becomes a checklist.

---

## 1. The tree, as broot draws it

### 1.1 Screen-fit is the core idea (⚠ we don't do this)

broot never dumps a full recursive listing. On launch it shows the focused
directory and **auto-opens as many sub-directories as fit the terminal height,
truncating the rest** — "the current directory is displayed, with most often
some directories open and some lines truncated, in order to fit the available
height." Openness is *computed*, not chosen by the user.

Consequence: **broot has no manual per-directory expand/collapse.** The only
ways to reveal a directory's contents are (a) type a filter that matches inside
it, or (b) focus it (Enter → make it the new root). The best-fit + best-score
tree is rebuilt on every keystroke.

> ⚠ **Biggest divergence.** Our prototype is a classic lazy tree: `openPaths`
> plus `→`/`←`/click to expand-collapse each directory independently
> (`App.tsx` `toggleDirectory`, `TreeView` chevrons). That is a *conventional*
> file tree, not broot's. Re-engineering broot's feel means deciding: adopt
> broot's computed-openness screen-fit model (no manual toggles; reveal by
> filter or focus), or keep the manual model and call it a deliberate
> departure. This choice drives everything in §3.

### 1.2 Line anatomy & columns

Columns render in `cols_order`; each hides itself when its data is off. Order
and defaults (`TreeOptions`):

| Col | Default | Content |
|---|---|---|
| `Mark` | off (`show_selection_mark=false`) | `▶` triangle left of the selected line |
| `Git` | off | git status glyph for the file |
| `Branch` | on | the tree connector lines (§1.3) |
| `Permission` | off (Unix only) | `rwx` bits, owner/group |
| `Date` | off | last-modified |
| `Size` | off (`show_sizes=false`) | byte count **plus a proportional bar** vs the largest sibling |
| `Count` | off | child count for directories (`>1` only) |
| `Staged` | contextual | `◍` when the entry is staged |
| `Name` | on | icon (if a skin provides one) + filename, matched chars highlighted |

Notes that matter for us:

- **Sizes are OFF by default in broot** and, when on, draw a bar proportional to
  the largest entry. ⚠ Our app shows sizes + bar **on by default**
  (`showSizes=true`) — a deliberate product choice; keep it, but know it differs.
- **`respect_git_ignore=true`, `show_hidden=false`** by default — gitignored and
  dotfiles are pruned until toggled. ✅ Matches ours.
- `sort=None` by default: broot's natural order is dirs-and-files interleaved
  alphabetically (case-insensitive), **not** dirs-first, unless a sort verb is
  active. ⚠ Ours groups dirs first (`lib/tree.ts`). Decide whether to match
  broot's flat alpha or keep dirs-first.

### 1.3 Tree connectors (box-drawing)

From `display/displayable_tree.rs` `write_branch`, the exact strings per depth
cell:

- `"├──"` — this entry has a sibling below it
- `"└──"` — last child at this depth
- `"│  "` — an ancestor level that continues below
- `"   "` — an ancestor level that has ended (blank)
- staged variants swap the middle dash for `◍`: `"├◍─"`, `"└◍─"`

> ⚠ Ours uses `"├─ "` / `"└─ "` (single dash + space) with matching `"│  "` /
> `"   "` leads (`lib/tree.ts` `connectorLead`). To match broot exactly, use
> **two** dashes (`├──` / `└──`).

### 1.4 The "unlisted" / pruning marker (⚠ different meaning in ours)

When broot truncates a directory's children to fit the screen, the surviving
parent line is suffixed with **` …`** (`line.unlisted > 0` → append `" …"` in
`write_line_label`). It means "this directory has N more children I didn't draw,
because of screen height or score" — a *screen-fit* signal, rebuilt per frame.

> ⚠ Ours emits a *different* thing: a standalone summary row
> `… N hidden ( .dotfiles ) · M gitignored` (`TreeView` pruning row) that counts
> **filtered-out** dotfiles/ignored entries, not screen-fit truncation. Both are
> useful; they are not the same feature. A faithful re-engineer needs broot's
> per-directory ` …` truncation marker in addition to (or instead of) our
> hidden/ignored tally.

### 1.5 Selection & root

- The **root line is the first line** and is where focus math starts.
- The selected line is shown by skin highlight (reverse/background); the `▶`
  mark is an *optional* extra (`show_selection_mark`, off by default). ✅ Ours
  highlights the row (`bg-sel`) + a 3px left bar — equivalent affordance.
- Matched characters in the name are highlighted during searches
  (`show_matching_characters_on_path_searches=true`). ✅ Ours highlights match
  segments.

---

## 2. Navigation — exact default keys (from `verb/builtin.rs`)

| Action | broot default keys | Behaviour | Ours |
|---|---|---|---|
| Move down | `↓`, `j` | next line (selection wraps/cycles) | `↓` only ⚠ (no `j`) |
| Move up | `↑`, `k` | previous line | `↑` only ⚠ (no `k`) |
| Page down | `ctrl-d`, `PageDown` | jump a page | ⚠ missing |
| Page up | `ctrl-u`, `PageUp` | jump a page | ⚠ missing |
| Open / enter | `→`, `Enter` (`open_stay`) | **dir → focus it as new root**; **file → xdg-open, stay in broot**; on the **root line → go to parent** | ⚠ ours: `Enter` focuses dir; `→` *expands* dir (manual toggle); file open not wired |
| Focus | `L` (shift-l), `ctrl-f` | make selected dir the new root without leaving | via `Enter`/double-click ✅ (no dedicated key) |
| Back | `←` (`back`) | undo the last state change (un-focus, un-filter) — a **history step**, not just "parent" | ⚠ ours: `←` collapses/moves to parent node |
| Parent | `h`, `p` (`parent`) | focus the parent directory | `Backspace` ⚠ (different key) |
| Next match | `Tab` | jump selection to the next filter match | ⚠ missing |
| Previous match | `BackTab` / `shift-BackTab` | previous match | ⚠ missing |
| Open & leave | `alt-Enter` (`open_leave`) | open the file and quit broot | n/a (web app) |
| Panel left/right | `ctrl-←` / `ctrl-→` | focus/open an adjacent panel | n/a (single panel) |
| Esc | `Esc` | back to previous state; if none, quit | ⚠ ours: clears the filter only |

### 2.1 Behavioural rules worth stating explicitly

- **`←` (back) is a history stack, not "up".** Each focus, filter, or toggle
  pushes a state; `←`/`Esc` pops it. broot's *parent* action is a separate key
  (`h`). ⚠ Ours conflates them: `←` collapses/steps to parent, `Backspace`
  goes to parent, and the browser back button walks focus history. A faithful
  model is: **back = pop the last navigation state** (maps naturally onto the
  browser history we already push via `?path=`), **parent = go up one dir**.
- **Enter on a directory focuses it** (root becomes that dir); there is no
  "expand in place." ✅ Ours does focus on Enter — but also keeps a parallel
  expand model that broot lacks (§1.1).
- **Enter on the root line goes to the parent** — a neat "escape upward" that
  needs no separate key. ⚠ Not in ours.
- **Filtering drives the tree, and selection lands on the best match.** As you
  type, broot rebuilds the tree to the best-scoring pruned view and moves the
  selection onto the top match; `Tab`/`BackTab` walk the other matches; `Esc`
  clears. ✅ Ours already lands selection on the best score and keeps the old
  result on screen until the new one lands — this part is faithful. ⚠ Missing:
  `Tab`/`BackTab` to walk matches.

---

## 3. Requirements to re-engineer the look/behaviour

Grouped so each can be picked up independently. **R1–R3 are the display look;
R4–R7 are the navigation feel; R8 is the one architectural decision the rest
hang on.**

- **R8 (decide first) — openness model.** Choose broot's *computed screen-fit
  openness* (no manual per-node toggle; reveal by filter or focus) **or** keep
  the current manual expand/collapse and record it as a deliberate departure.
  Everything below assumes we lean toward broot; note per-item where the manual
  model changes the answer. This is the one architectural call the rest depend
  on, and it was deferred as one.

- **R1 — connectors.** Match broot's exact branch strings `├──`, `└──`, `│  `,
  `   ` (two dashes). Trivial change in `lib/tree.ts`.

- **R2 — screen-fit truncation marker.** Add broot's per-directory ` …` suffix
  meaning "N children not drawn (screen/score)", distinct from our existing
  hidden/ignored tally row. Requires the tree builder to know how many children
  it dropped for fit — ties to R8 and to the engine research's best-first walk.

- **R3 — column parity & defaults.** Support the broot column set behind toggles
  (size+bar ✅, dates, permissions, counts, git status) with broot's default
  visibility (most **off**), while keeping our product override that sizes are
  **on**. Add a git-status column later
  ([005](../requirements/005-git-status-column.md)). Natural
  order decision: broot's flat alpha vs our dirs-first (⚠ R-sort).

- **R4 — vim keys.** Add `j`/`k` (down/up), `ctrl-d`/`ctrl-u` and
  `PageDown`/`PageUp` (page), `Tab`/`BackTab` (next/prev match). Pure additions
  to the `App.tsx` keydown handler.

- **R5 — back vs parent split.** Make `←`/`Esc` a **history-pop** (we already
  push focus history to the URL — pop maps onto `window.history.back()`), and
  give **parent** its own key (`h`, and/or keep `Backspace`). Stop overloading
  `←` with collapse (which disappears anyway if R8 drops manual expand).

- **R6 — Enter semantics.** `Enter`/`→` on a directory focuses it; on the
  **root line** goes to the parent; on a **file** opens it in place (this is
  the old "open files in place" goal — same-tab navigation so the browser back
  button walks history). Wire file-open into the same key.

  > **Superseded.** There is no open-in-place flow: the preview panel is how file
  > contents are seen. See
  > [the preview is the viewer](../decisions/2026-07-20-the-preview-is-the-viewer.md).

- **R7 — selection-follows-filter + match walking.** Keep the
  land-on-best-score behaviour (✅ already faithful) and add `Tab`/`BackTab` to
  cycle the remaining matches without clearing the filter.

### Non-goals / product departures (state them, don't silently drop)

- Multi-panel (`ctrl-←/→`), `alt-Enter` open-and-quit, and xdg-open are TUI
  concepts; the web equivalent of "open" turned out to be the preview panel, not
  in-tab navigation. No panels for now.
- Sizes-on-by-default and dirs-first ordering are intentional product choices;
  keep them unless R8/R-sort decides otherwise, but tag them as departures so
  "broot-faithful" claims stay honest — don't hide the delta.

---

## Sources

- broot docs: `dystroy.org/broot/` (overview), `/navigation/`, `/input/`,
  `/tricks/`, `/conf_verbs/`
- broot source (`github.com/Canop/broot`, master): `src/display/displayable_tree.rs`
  (connectors, unlisted ` …`, columns, `▶` mark), `src/tree/tree_options.rs`
  (defaults, Sort enum), `src/verb/builtin.rs` (default key bindings)
- Cross-refs into our tree: `src/App.tsx` (keys, focus/back), `src/components/TreeView.tsx`
  (rows, pruning line), `src/lib/tree.ts` (connectors, dirs-first, row model)
