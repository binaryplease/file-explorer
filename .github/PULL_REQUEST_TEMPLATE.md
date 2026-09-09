<!--
  Thanks for the patch. CONTRIBUTING.md has the full detail; this template is
  the short version of it. Delete any section that genuinely does not apply,
  rather than leaving it blank.
-->

## What this changes, and why

<!-- The problem first, then the change. A reviewer who reads only this should
     understand why the diff exists. -->

Closes #

## Gates

Run these and report what you actually saw. **"I could not run this, because …"
is a perfectly good answer** — an honest gap is more useful than a checked box.

- [ ] `mise run typecheck` passes
- [ ] `mise run test` passes — <!-- paste the count: N pass, M files -->
- [ ] `mise run build` passes

## If you touched the listing or search path

The rule is **no fixture, no optimization**. Quote a before *and* an after from
the fixture — not an estimate.

- [ ] `mise run stress:fixture` then `mise run bench:list`
- Before: <!-- ms -->
- After: <!-- ms -->
- [ ] Not applicable — this does not touch the listing path

## If you changed a dependency

- [ ] `mise run deps:hash` run, `flake.nix` and `bun.lock` committed together
- [ ] I could not run it (no Nix) — a maintainer needs to
- [ ] The new dependency is permissively licensed; if it is copyleft or
      source-available I have said so above instead of proceeding
- [ ] Not applicable

## Responsiveness

<!-- AGENTS.md is binding here: a listing or search response never waits on
     enrichment work. If this adds a feature, say where the work happens, what
     the user sees before it finishes, and what cancels it when they navigate
     away. -->

- [ ] Nothing in this change makes a listing or search response wait on
      anything, or this change adds no new work at all

## Documentation

- [ ] A requirement this delivers has had its `status` / `updated` frontmatter
      moved, and its body says what landed
- [ ] A genuine either/or this settles has a new file in `docs/decisions/`
- [ ] I added, renamed or removed a file under `docs/`, or changed a `summary` —
      **the generated index needs regenerating by a maintainer.** I left the
      `<!-- index:start … -->` marker block untouched
- [ ] No documentation change was needed

## Anything a reviewer should know

<!-- Trade-offs you are unsure about, a decision you would happily reverse, a
     test you wanted to write and could not. -->
