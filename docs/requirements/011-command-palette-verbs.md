---
id: 011-command-palette-verbs
title: Keyboard-first verb palette
summary: "A keyboard-first verb palette sharing one descriptor per verb with the context menu, now that copy, open and publish are actions worth naming."
status: proposed
rank: 11
tags: [client, tree]
blocks: []
blocked_by: []
research: []
decisions: []
conventions: [highlight-what-matched, never-hide-a-control, one-descriptor-one-wrapper-one-guard, affordances-adjacent]
shipped: null
updated: 2026-07-28
---

# Keyboard-first verb palette

broot's `:` verb menu — reintroduce it once there are actions worth naming. That
threshold is now close: **copy path / copy relative path exist** (shipped
2026-07-28 as a right-click context menu), and open and publish
([008](008-publish-to-a-share-service.md)) are named actions too.

## Shape

- Fuzzy-filtered verbs, with the matched characters highlighted (highlight what
  matched).
- Mutating verbs are **shown but disabled with a reason**, never hidden (never
  hide a control; affordances sit beside what they change). A palette that hides
  what it cannot currently run teaches the reader the verb does not exist.
- The verbs the palette would surface first: copy path, copy relative path, open,
  reveal ([004](004-host-app-endpoints.md)), publish
  ([008](008-publish-to-a-share-service.md)).
- **One descriptor per verb**, shared between the palette and the existing
  context menu (one descriptor, one wrapper, one guard) — the context menu is the
  pointer surface, the palette the keyboard one, and they must not drift into two
  verb lists.

## Notes

- Theme is done as a title-bar toggle, so it no longer needs to be a verb.
- A **breadcrumb bar** (clickable ancestors) is a separate small lift that rides
  along here.
- The copy verbs currently have **no keyboard shortcut** — the context menu is
  pointer-only. That gap closes here.
