---
id: 102-theme-token-model
title: One `@theme` block; alternate themes override the same vars
status: standing
rank: null
tags: [client, theme]
blocks: []
blocked_by: []
research: []
adrs: [ADR-0028]
shipped: null
updated: 2026-07-17
---

# One `@theme` block; alternate themes override the same vars

- **Tailwind utilities only.** Design tokens are defined in the single `@theme`
  block, with **dark as the base/fallback**.
- **Alternate themes override those same `--color-*` vars** under a
  `[data-theme="…"]` selector — never a second token set, never per-utility
  variants.
- An interaction-state style that appears on two or more surfaces is a single
  shared token owned by one module and composed by every surface (ADR-0028) —
  e.g. `MATCH_HIGHLIGHT_CLASS` for fuzzy matches, and the preview/tree focus
  accent carried by the split divider.

## Proven

**Light theme shipped 2026-07-17** (parent commit `15f83fc`) without relaxing the
constraint: the dark palette stayed in the one `@theme` block, a
`[data-theme="light"]` block overrides the same `--color-*` vars, and every
utility already reads them via `var()`. No second token set, no per-utility
churn, no ADR relaxation. Control: a system/light/dark toggle in the title bar,
system by default.

Shiki's dual themes ride the same mechanism — `--shiki-light` / `--shiki-dark`
custom props (`defaultColor: false`) swapped by `[data-theme]` in `theme.css`.
