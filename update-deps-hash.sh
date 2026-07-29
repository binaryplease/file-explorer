#!/usr/bin/env bash
set -euo pipefail

# Refresh the vendored-dependency hash in flake.nix after a dependency change.
#
# `nodeModules` in flake.nix is a fixed-output derivation, so nix identifies it
# by `outputHash` and by nothing else — not by package.json, not by bun.lock.
# The only way to learn the correct hash is to build with a deliberately wrong
# one and read the `got:` line out of the mismatch. That is what this does.
#
# Run it after any change to package.json or bun.lock. Skipping it is what broke
# the build in 2026-07: the hash still matched, so nix reused a node_modules
# tree fetched before the dependency existed and the client build died on an
# unresolvable import.

cd "$(dirname "${BASH_SOURCE[0]}")"

# Sync bun.lock with package.json. --lockfile-only leaves node_modules alone:
# this script's job is the flake, and a dev who just changed dependencies has
# already run a plain `bun install`.
echo ":: Syncing bun.lock..."
bun install --lockfile-only

# Stage it so nix can see it. Building a dirty flake reads *tracked* files from
# the working tree but ignores untracked ones, so an unstaged new lockfile would
# be invisible and we would compute the hash of the old dependency set.
git add bun.lock

# Restore flake.nix if anything below fails. Deliberately not
# `git checkout flake.nix`, which would also discard unrelated uncommitted edits.
original_flake="$(mktemp)"
cp flake.nix "$original_flake"
succeeded=0
cleanup() {
  if [[ $succeeded -eq 0 ]]; then
    echo ":: Restoring flake.nix"
    cp "$original_flake" flake.nix
  fi
  rm -f "$original_flake"
}
trap cleanup EXIT

# Force the mismatch. The anchored ` = ` keeps this off the neighbouring
# `outputHashMode` / `outputHashAlgo` lines.
sed -i 's|^\( *\)outputHash = .*;$|\1outputHash = pkgs.lib.fakeHash;|' flake.nix

echo ":: Building to compute the new outputHash (this will fail once)..."
new_hash=$(nix build 2>&1 | grep -oP 'got:\s+\K\S+') || true

if [[ -z "$new_hash" ]]; then
  echo "ERROR: could not read a 'got:' hash from the build output." >&2
  echo "       Run 'nix build' by hand to see what actually went wrong." >&2
  exit 1
fi

if [[ ! "$new_hash" =~ ^sha256- ]]; then
  echo "ERROR: '${new_hash}' does not look like a sha256- hash." >&2
  exit 1
fi

sed -i "s|^\( *\)outputHash = pkgs.lib.fakeHash;$|\1outputHash = \"${new_hash}\";|" flake.nix

echo ":: Updated outputHash to ${new_hash}"
echo ":: Verifying the build..."
nix build

succeeded=1
echo ":: Done. Commit flake.nix and bun.lock together — they are one change."
