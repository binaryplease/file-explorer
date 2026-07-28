---
id: 011-command-palette-verbs
title: Keyboard-first verb palette
status: proposed
rank: 11
tags: [client, tree]
blocks: []
blocked_by: []
research: [../.nightshift/research/2026-07-18-file-explorer-vs-fex-comparison.md]
adrs: [ADR-0019, ADR-0025, ADR-0026, ADR-0031]
shipped: null
updated: 2026-07-28
---

# Keyboard-first verb palette

broot's `:` verb menu, from CON009 — reintroduce it once there are actions worth
naming. That threshold is now close: **copy path / copy relative path exist**
(shipped 2026-07-28 as a right-click context menu), and open and publish
([008](008-publish-to-zink.md)) are named actions too.

## Shape

- Fuzzy-filtered verbs, with the matched characters highlighted (ADR-0019).
- Mutating verbs are **shown but disabled with a reason**, never hidden
  (ADR-0025/0031) — fex already does this correctly and is the interaction model
  to lift, not the code (2026-07-20 consolidation decision).
- The verbs the palette would surface first: copy path, copy relative path, open,
  reveal ([004](004-host-app-endpoints.md)), publish
  ([008](008-publish-to-zink.md)).
- **One descriptor per verb**, shared between the palette and the existing
  context menu (ADR-0026) — the context menu is the pointer surface, the palette
  the keyboard one, and they must not drift into two verb lists.

## Notes

- Theme is done as a title-bar toggle, so it no longer needs to be a verb.
- A **breadcrumb bar** (clickable ancestors) is a separate small lift from fex.
- The copy verbs currently have **no keyboard shortcut** — the context menu is
  pointer-only. That gap closes here.
