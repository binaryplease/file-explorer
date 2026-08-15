---
id: 009-cli-daemon-and-status
title: On-demand `bfe` CLI, daemon lifecycle, status endpoint
summary: "`bfe [path]` serves the working directory in the foreground and `bfe daemon …` runs the singleton; port selection lives in the server and is strict by default."
status: shipped
rank: 9
tags: [cli, server, packaging, config]
blocks: []
blocked_by: []
research: []
decisions: []
conventions: [package-name-matches-repo, location-agnostic-cli, daemon-lifecycle, fail-loud-ports, emit-nullish, zod-defaults, code-lives-with-dependencies, allocate-before-strict-bind]
shipped: 2026-07-27
updated: 2026-07-27
---

# On-demand `bfe` CLI, daemon lifecycle, status endpoint

**Shipped 2026-07-27** together with the nix flake. broot-style on-demand use: run it in a directory, get a browser.

## What the requirement now means (do not regress)

- **`bfe [path]`** serves a directory in the foreground — **cwd default** (broot
  parity, *not* the server's homedir default) — waits for health, opens the
  browser, and tears down on Ctrl-C with signals forwarded to the spawned server.
- **`bfe daemon start|stop|restart|status|logs`** follows the daemon-lifecycle
  pattern: detached `process.execPath` spawn, process-group SIGTERM→SIGKILL,
  PID at `$XDG_RUNTIME_DIR/…pid` plus a companion `…state.json` recording
  port/host/root so status/stop reach the right server.
- **`GET /api/status`** returns the snapshot `bfe status` renders — served root,
  uptime, pid, port, confine — every field defaulted and emitted
  (emit nullish properties; every Zod field declares a default), plus discovery
  links.
- **Entry-point resolution** is location-agnostic: the server script
  is found via `realpathSync(argv[1])` sibling, and the root travels by env,
  never argv, so a clean spawn can't be mistaken for a subcommand.
- **Packaging**: `flake.nix` `packages.default` builds client + server + CLI and
  installs a wrapped `bfe` (alias `binp-file-explorer`, package name matches the repo); runtime
  closure is **bun + dist only**. `nixosModules.default`
  (`services.binp-file-explorer`) runs a hardened systemd unit — loopback +
  **confine on** by default, because a hosted surface is the case where the
  boundary matters.

## The port rule this locked in

Port selection lives *in the server* (`server/services/listen.ts`, strategy from
`EXPLORER_PORT_STRATEGY`):

- **`strict`** — the default, every direct launch: bind `PORT` exactly, die loud
  on conflict (fail loudly on a port conflict). Explicit `--port` is always strict — the conflict is
  the user's, and it is loud.
- **`auto`** — the CLI's opt-in: walk upward from `PORT` to the first free port
  **in-process**, announcing each skip, and write the bound port to
  `EXPLORER_READY_FILE`. The CLI spawns once and reads that file — no external
  probe-then-respawn, so a fleet of cold-start instances converges instantly.
  Verified: 6 launched in the same instant → 45800-45805.

**The fail-loud hole this fixed:** Elysia's Bun adapter hardcodes `reusePort:
true`, which let two processes silently share a port via SO_REUSEPORT — a genuine
conflict absorbed instead of surfaced, and two roots answering on one port. The
listen path now passes `reusePort: false`, restoring the exclusive, fail-loud
bind.

## Build-sandbox gotchas worth remembering

`bunx` does a registry round-trip even for a vendored bin (fails silently
offline), and the `#!/usr/bin/env node` shebang has no `/usr/bin/env` in the Nix
sandbox — so the flake runs vite as `node node_modules/vite/bin/vite.js build`,
with nodejs a build input and never a runtime one. The vendored-deps FOD hash is
platform-specific; refresh via `lib.fakeHash` after any `bun.lock` change.
