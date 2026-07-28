---
id: 006-preview-panel
title: Preview panel beside the tree
status: shipped
rank: 6
tags: [preview, client]
blocks: []
blocked_by: []
research: []
adrs: [ADR-0028, ADR-0031]
shipped: 2026-07-20
updated: 2026-07-28
---

# Preview panel beside the tree

**Shipped 2026-07-20** (see the backlog log entry). A column beside the rows it
describes (ADR-0031), never a modal over them, with a draggable divider sizing
the split.

## Follow-ups

- **Promoted out of this requirement.** Syntax highlighting and long-text reads
  were "deliberately not done" here and are now required work under
  [002-preview-parity](002-preview-parity.md) — highlighting shipped 2026-07-21,
  windowed reads are still the one open item there.
- ~~A resizable split~~ → shipped; the divider owns the drag and carries the
  focus accent (ADR-0028's shared interaction token).
- **Still unscheduled:** previewing the *hovered* row rather than the selected
  one.

## Behaviour we must not regress

- **File click previews, directory click enters** (2026-07-27). A directory
  single-click focuses it as the new root; a file single-click reveals it in the
  preview. The OS open command lives on double-click, files only. Blocked entries
  refuse on either gesture.
- **Focus is signalled at the seam, not on the content** (2026-07-28). Which pane
  holds the keyboard shows on the divider (`bg-sel-bar`) and the preview's header
  row. The scroll surface stays untinted — darkening the document works against
  the reason the panel exists.
