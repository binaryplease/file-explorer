---
title: "File explorer MVP — fast browsing, open-in-place, publish to zink"
status: planned
created: 2026-07-05
updated: 2026-07-05
assignee: nightshift
tags: [file-explorer, bun, zink]
---

# File explorer MVP

## Context

The repo is scaffolded (Bun · Elysia · React 19 · Tailwind · Vite, per ADR-0003).
This task turns the scaffold into a real, incredibly fast file explorer that can
publish to zink. Source plan: nightshift note "Development plan for high-speed Bun
file explorer" (`note_ac0e93b3-a2cd-46a6-a5c0-425975e53110`).

> **Not yet authorized for auto-pickup.** `status: planned` — a human flips this
> to `ready` when the design is signed off, at which point nightshift queues it.

## Scope (from the development plan)

- [ ] **Fast filesystem browsing.** Serve directory listings and stream files
      with Bun-native APIs. Speed is the headline requirement — measure it.
- [ ] **Open HTML in place.** Opening an `.html` navigates in the same tab so the
      browser back button walks history naturally (no new-tab, no modal trap).
- [ ] **Publish to zink.** An action uploads the selected HTML file or folder to
      the configured zink instance (`ZINK_BASE_URL` / `ZINK_DEPLOY_KEY`, see
      `server/config.ts` and AGENTS.md → *Publishing to zink*) and surfaces the
      returned share link. Persist the one-time `editToken` if offering
      update-in-place.

## Design notes / open questions

- **What root does it serve, and how is it chosen?** A configured base directory,
  a user-picked path, or an upload area? Decide before building — it drives the
  security model (path traversal containment) and the "must be fast" target.
- **Auth?** The scaffold ships none. A file explorer over a real filesystem likely
  needs at least a deploy gate; if user accounts are wanted, use Better Auth per
  ADR-0023. Confirm scope with the human.
- Honour the binding ADRs listed in `AGENTS.md` (0007, 0010, 0017, 0018, 0020,
  0022, 0024/0029, 0025/0031).

## Deployment (later)

Wire ADR-0002 packaging (Nix flake + NixOS module or GHCR Docker) and ADR-0008
GHCR naming when the app is real. Lean-copy `flake.nix` / `.github` / `Caddyfile`
from `binp-zink`.
