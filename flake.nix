{
  description = "binp-file-explorer — a high-speed Bun file explorer, as a single on-demand CLI (bfe)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    let
      perSystem = flake-utils.lib.eachDefaultSystem (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};

          pname = "binp-file-explorer";
          version = "0.1.0";

          # A fixed-output derivation is addressed by its `outputHash` alone, so
          # a stale hash makes nix silently reuse the previously-fetched tree
          # even after bun.lock gains a dependency — which surfaces much later
          # as an unresolvable import in the middle of the vite build. Stamping
          # the lockfile digest into the derivation name changes the store path
          # whenever the dependency set changes, forcing a refetch that fails
          # loudly with a hash mismatch instead of building against yesterday's
          # node_modules — the same fail-on-conflict posture the server takes at
          # bind time, applied to the dependency tree.
          lockDigest = builtins.substring 0 12 (builtins.hashFile "sha256" ./bun.lock);

          # Vendored dependencies as a fixed-output derivation: `bun install`
          # needs the network, which only an FOD is allowed, so deps are fetched
          # once here and the build proper runs offline. The hash is content-
          # addressed and platform-specific — bun resolves some optional native
          # deps (rolldown, oniguruma) per system, so this is pinned per the
          # flake-utils system split. Refresh it after any bun.lock change:
          # set `outputHash` to `pkgs.lib.fakeHash`, run `nix build`, and copy
          # the "got:" hash the mismatch prints.
          nodeModules = pkgs.stdenv.mkDerivation {
            pname = "${pname}-node-modules-${lockDigest}";
            inherit version;
            # Only the files that determine the dependency set — so editing app
            # source never invalidates the (slow) dependency fetch.
            src = pkgs.lib.fileset.toSource {
              root = ./.;
              fileset = pkgs.lib.fileset.unions [
                ./package.json
                ./bun.lock
              ];
            };
            nativeBuildInputs = [ pkgs.bun ];
            dontConfigure = true;
            dontFixup = true;
            buildPhase = ''
              runHook preBuild
              export HOME="$TMPDIR"
              bun install --frozen-lockfile --no-progress --ignore-scripts
              runHook postBuild
            '';
            installPhase = ''
              runHook preInstall
              mkdir -p "$out"
              cp -R node_modules/. "$out/"
              runHook postInstall
            '';
            outputHashMode = "recursive";
            outputHashAlgo = "sha256";
            outputHash = "sha256-GL1LrQ5FFEfn9oSfkD42KQI15U6aEerkQCQ4L2ZoM7U=";
          };

          binp-file-explorer = pkgs.stdenv.mkDerivation {
            inherit pname version;
            src = pkgs.lib.fileset.toSource {
              root = ./.;
              # Everything the client + server + CLI bundles read at build time.
              fileset = pkgs.lib.fileset.unions [
                ./package.json
                ./bun.lock
                ./tsconfig.json
                ./vite.config.ts
                ./server
                ./shared
                ./src
                ./public
              ];
            };

            nativeBuildInputs = [
              pkgs.bun
              # Vite/rolldown shell out to `node` during the client build; the
              # sandbox has no node unless we add it. Build-time only — the
              # runtime closure is just bun + the self-contained dist bundles.
              pkgs.nodejs_22
              pkgs.makeWrapper
            ];

            configurePhase = ''
              runHook preConfigure
              # Bring in the vendored deps read-write so bun/vite can touch their
              # caches during the build without reaching for the network.
              cp -R ${nodeModules} node_modules
              chmod -R u+w node_modules
              export HOME="$TMPDIR"
              runHook postConfigure
            '';

            buildPhase = ''
              runHook preBuild
              export NODE_ENV=production
              # Run vite under `node` explicitly, not via `bunx` or its shebang:
              # `bunx` attempts a registry round-trip to resolve the bin even when
              # it is vendored, and the `#!/usr/bin/env node` shebang has no
              # /usr/bin/env in the sandbox — both fail with no useful output.
              # Client → dist/client, server + CLI bundles → dist/server. The
              # bundles are self-contained (bun inlines every dependency), so the
              # runtime closure is just bun + dist — node_modules is build-only.
              node node_modules/vite/bin/vite.js build
              bun build server/index.ts server/cli.ts \
                --outdir dist/server --target bun --sourcemap=linked --production
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall
              mkdir -p "$out/lib/${pname}"
              cp -R dist/. "$out/lib/${pname}/"

              # The single on-demand executable. `bfe` from anywhere in a
              # terminal serves the current directory (broot-style); the wrapper
              # resolves the built CLI bundle beside the server bundle so the
              # `location-agnostic-cli` sibling lookup and the '../client'
              # static-asset path both hold. `binp-file-explorer` is provided as
              # a spelled-out alias, since the published artifact's name matches
              # the repository name exactly (`package-name-matches-repo`).
              makeWrapper ${pkgs.bun}/bin/bun "$out/bin/bfe" \
                --add-flags "$out/lib/${pname}/server/cli.js"
              ln -s bfe "$out/bin/${pname}"
              runHook postInstall
            '';

            meta = {
              description = "High-speed Bun file explorer, browse a filesystem in your browser";
              license = pkgs.lib.licenses.mit;
              mainProgram = "bfe";
              platforms = pkgs.lib.platforms.unix;
            };
          };
        in
        {
          packages.default = binp-file-explorer;
          packages.binp-file-explorer = binp-file-explorer;

          # `nix run` → serve the current directory on a free port and open the
          # browser. `nix run .# -- daemon start` etc. reach the full CLI.
          apps.default = {
            type = "app";
            program = "${binp-file-explorer}/bin/bfe";
            meta = {
              description = "Serve the current directory in the browser (bfe)";
              mainProgram = "bfe";
            };
          };

          devShells.default = pkgs.mkShell {
            buildInputs = with pkgs; [
              bun
              mise
              nodejs_22
            ];
          };
        }
      );
    in
    perSystem
    // {
      # NixOS module: run the explorer as a hardened background daemon on a box
      # (the deployed counterpart of `bfe daemon start`). Loopback-bound and
      # unconfined by default — front it with an authenticating reverse proxy
      # and set `allowedHosts` before exposing it (see AGENTS.md deployment).
      nixosModules.default =
        {
          config,
          pkgs,
          lib,
          ...
        }:
        let
          cfg = config.services.binp-file-explorer;
          package = self.packages.${pkgs.system}.default;
        in
        {
          options.services.binp-file-explorer = {
            enable = lib.mkEnableOption "binp-file-explorer filesystem browser";

            port = lib.mkOption {
              type = lib.types.port;
              default = 3000;
              description = "Port for the explorer server to listen on.";
            };

            host = lib.mkOption {
              type = lib.types.str;
              default = "127.0.0.1";
              description = ''
                Bind address. Default is loopback so only a local reverse proxy
                can reach the service. A non-loopback host is a fatal startup
                error unless `allowedHosts` names the served host(s) — binding
                off loopback publishes an unauthenticated filesystem API.
              '';
            };

            root = lib.mkOption {
              type = lib.types.str;
              example = "/srv/files";
              description = "Absolute path of the directory the explorer serves.";
            };

            confine = lib.mkOption {
              type = lib.types.bool;
              default = true;
              description = ''
                Whether the served root is a real boundary (true, the safe
                default for a hosted surface — paths escaping the root, lexically
                or via a symlink, are refused) or only a starting anchor (false,
                the local-tool default, which exposes the whole filesystem).
              '';
            };

            allowedHosts = lib.mkOption {
              type = lib.types.listOf lib.types.str;
              default = [ ];
              example = [ "files.example.com" ];
              description = ''
                Extra Host header values to answer for, beyond loopback. Required
                (as an explicit acknowledgement) when `host` is non-loopback.
              '';
            };

            user = lib.mkOption {
              type = lib.types.str;
              default = "binp-file-explorer";
              description = "System user the service runs as. Must be able to read `root`.";
            };
          };

          config = lib.mkIf cfg.enable {
            systemd.services.binp-file-explorer = {
              description = "binp-file-explorer — high-speed filesystem browser";
              wantedBy = [ "multi-user.target" ];
              after = [ "network.target" ];

              environment = {
                NODE_ENV = "production";
                HOST = cfg.host;
                PORT = toString cfg.port;
                EXPLORER_ROOT = cfg.root;
                EXPLORER_CONFINE = if cfg.confine then "true" else "false";
                EXPLORER_ALLOWED_HOSTS = lib.concatStringsSep "," cfg.allowedHosts;
              };

              serviceConfig = {
                Type = "simple";
                # The server binary (not the CLI): systemd owns this lifecycle,
                # so it runs in the foreground and is supervised directly.
                ExecStart = "${pkgs.bun}/bin/bun ${package}/lib/binp-file-explorer/server/index.js";
                Restart = "on-failure";
                RestartSec = 5;

                # Identity
                DynamicUser = false;
                User = cfg.user;
                Group = cfg.user;

                # Filesystem — read-only whole system, and the served root is
                # only reachable if it is world/user-readable. This service only
                # ever reads; it never needs to write.
                ProtectSystem = "strict";
                ProtectHome = "read-only";
                PrivateTmp = true;
                PrivateDevices = true;
                ProtectKernelTunables = true;
                ProtectKernelModules = true;
                ProtectKernelLogs = true;
                ProtectControlGroups = true;
                ProtectClock = true;
                ProtectHostname = true;
                ProtectProc = "invisible";
                ProcSubset = "pid";
                UMask = "0077";

                # Process / kernel
                NoNewPrivileges = true;
                LockPersonality = true;
                RestrictRealtime = true;
                RestrictSUIDSGID = true;
                RestrictNamespaces = true;
                RemoveIPC = true;

                # Network — IP + unix sockets only
                RestrictAddressFamilies = [
                  "AF_INET"
                  "AF_INET6"
                  "AF_UNIX"
                ];

                # Capabilities — an unprivileged listener needs none
                CapabilityBoundingSet = "";
                AmbientCapabilities = "";

                # Syscalls — system-service baseline minus the dangerous groups.
                # NOT MemoryDenyWriteExecute (breaks Bun's JIT); re-allow the
                # nice-level scheduler calls Bun makes at startup (RestrictRealtime
                # above still blocks the realtime policies).
                SystemCallFilter = [
                  "@system-service"
                  "~@privileged"
                  "~@resources"
                  "~@mount"
                  "~@obsolete"
                  "sched_setscheduler"
                  "sched_setparam"
                ];
                SystemCallArchitectures = "native";
              };
            };

            users.users.${cfg.user} = lib.mkDefault {
              isSystemUser = true;
              group = cfg.user;
              description = "binp-file-explorer service user";
            };
            users.groups.${cfg.user} = lib.mkDefault { };
          };
        };
    };
}
