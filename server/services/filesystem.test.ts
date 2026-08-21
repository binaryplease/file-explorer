import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFilesystemService } from './filesystem'

// A served root containing symlinks that point outside it. The confinement
// guard is lexical first, then real-path: these links look contained by the
// lexical check and must still be refused.
let servedRoot: string
let outsideDirectory: string
let filesystemService: ReturnType<typeof createFilesystemService>
// The same root and the same links, served with `confine: false` — the
// local-machine default. Every refusal below must become a resolution.
let unconfinedService: ReturnType<typeof createFilesystemService>

beforeAll(async () => {
  // The temp dir itself is often reached through a symlink (/tmp, /var). Its
  // real path is what the service will compare against.
  const scratchDirectory = await realpath(await mkdtemp(join(tmpdir(), 'bfe-confinement-')))
  servedRoot = join(scratchDirectory, 'served')
  outsideDirectory = join(scratchDirectory, 'outside')

  await mkdir(join(servedRoot, 'inside'), { recursive: true })
  await mkdir(outsideDirectory, { recursive: true })
  await writeFile(join(servedRoot, 'inside', 'contained.txt'), 'contained')
  await writeFile(join(outsideDirectory, 'secret.txt'), 'secret')

  await symlink(join(outsideDirectory, 'secret.txt'), join(servedRoot, 'escaping-file'))
  await symlink(outsideDirectory, join(servedRoot, 'escaping-directory'))
  await symlink(join(servedRoot, 'inside'), join(servedRoot, 'contained-link'))

  // Constructed with `rootAbsolutePath` alone: confinement is the factory
  // default, so these assertions also pin that default in place.
  filesystemService = createFilesystemService({ rootAbsolutePath: servedRoot })
  unconfinedService = createFilesystemService({ rootAbsolutePath: servedRoot, confine: false })
})

afterAll(async () => {
  await rm(join(servedRoot, '..'), { recursive: true, force: true })
})

describe('symlink-escape confinement', () => {
  test('refuses to serve a file through a symlink leaving the root', async () => {
    const result = await filesystemService.resolveFile('escaping-file')
    expect(result).toEqual({ ok: false, reason: 'symlink-escapes-root' })
  })

  test('refuses to list a directory through a symlink leaving the root', async () => {
    const result = await filesystemService.listDirectory('escaping-directory')
    expect(result).toEqual({ ok: false, reason: 'symlink-escapes-root' })
  })

  // The failure reason is itself a disclosure channel: answering `not-a-file`
  // here would confirm that the target is a directory, which the listing goes
  // out of its way to withhold. Both kinds of escaping link answer the same.
  test('refuses an escaping symlink to a directory without revealing it is one', async () => {
    const result = await filesystemService.resolveFile('escaping-directory')
    expect(result).toEqual({ ok: false, reason: 'symlink-escapes-root' })
  })

  test('still reports a genuine directory inside the root as not-a-file', async () => {
    const result = await filesystemService.resolveFile('inside')
    expect(result).toEqual({ ok: false, reason: 'not-a-file' })
  })

  test('refuses to search a subtree through a symlink leaving the root', async () => {
    const result = await filesystemService.searchSubtree('escaping-directory', {
      pattern: 'secret',
      limit: 10,
      showHidden: false,
      showGitignored: false,
      abortSignal: new AbortController().signal,
    })
    expect(result).toEqual({ ok: false, reason: 'symlink-escapes-root' })
  })

  test('refuses to open a file through a symlink leaving the root', async () => {
    const result = await filesystemService.openFile('escaping-file')
    expect(result).toEqual({ ok: false, reason: 'symlink-escapes-root' })
  })

  test('still serves a file reached through a symlink that stays inside the root', async () => {
    const result = await filesystemService.resolveFile('contained-link/contained.txt')
    expect(result.ok).toBe(true)
  })

  test('still lists a directory reached through a symlink that stays inside the root', async () => {
    const result = await filesystemService.listDirectory('contained-link')
    expect(result.ok).toBe(true)
  })

  test('reports a non-existent path as not-found, not as an escape', async () => {
    const result = await filesystemService.resolveFile('inside/absent.txt')
    expect(result).toEqual({ ok: false, reason: 'not-found' })
  })

  test('still rejects a lexical escape before touching the filesystem', async () => {
    const result = await filesystemService.resolveFile('../outside/secret.txt')
    expect(result).toEqual({ ok: false, reason: 'outside-root' })
  })

  test('serves the root itself', async () => {
    const result = await filesystemService.listDirectory('')
    expect(result.ok).toBe(true)
  })
})

describe('escaping symlinks are listed loudly, without leaking their target', () => {
  async function rootEntryNamed(entryName: string) {
    const result = await filesystemService.listDirectory('')
    if (!result.ok) throw new Error(`listing the root failed: ${result.reason}`)
    const found = result.listing.entries.find((candidate) => candidate.name === entryName)
    if (found === undefined) throw new Error(`no entry named ${entryName} in the root listing`)
    return found
  }

  test('an escaping symlink stays visible in the listing rather than being hidden', async () => {
    // ADR-0025: the row is shown and refused, not quietly dropped — a missing
    // entry would read as "nothing is there", which is a different lie.
    const result = await filesystemService.listDirectory('')
    if (!result.ok) throw new Error(`listing the root failed: ${result.reason}`)
    const entryNames = result.listing.entries.map((entry) => entry.name)
    expect(entryNames).toContain('escaping-file')
    expect(entryNames).toContain('escaping-directory')
  })

  test('withholds the child count of a directory outside the root', async () => {
    const escapingDirectory = await rootEntryNamed('escaping-directory')
    expect(escapingDirectory.escapesRoot).toBe(true)
    expect(escapingDirectory.childCount).toBeNull()
    // Not even the kind: reporting `directory` would confirm what the target is.
    expect(escapingDirectory.kind).toBe('other')
    expect(escapingDirectory.isSymlink).toBe(true)
  })

  test('withholds the size and executability of a file outside the root', async () => {
    const escapingFile = await rootEntryNamed('escaping-file')
    expect(escapingFile.escapesRoot).toBe(true)
    expect(escapingFile.sizeBytes).toBeNull()
    expect(escapingFile.isExecutable).toBe(false)
    expect(escapingFile.kind).toBe('other')
  })

  test('a symlink that stays inside the root keeps its metadata', async () => {
    const containedLink = await rootEntryNamed('contained-link')
    expect(containedLink.escapesRoot).toBe(false)
    expect(containedLink.kind).toBe('directory')
    expect(containedLink.childCount).toBe(1)
    expect(containedLink.isSymlink).toBe(true)
  })

  test('ordinary entries are marked as not escaping', async () => {
    const inside = await rootEntryNamed('inside')
    expect(inside.escapesRoot).toBe(false)
    expect(inside.isSymlink).toBe(false)
  })

  test('search results withhold an escaping symlink target the same way', async () => {
    const result = await filesystemService.searchSubtree('', {
      pattern: 'escaping',
      limit: 20,
      showHidden: false,
      showGitignored: false,
      abortSignal: new AbortController().signal,
    })
    if (!result.ok) throw new Error(`search failed: ${result.reason}`)
    const escapingNodes = result.result.nodes.filter((node) => node.entry.escapesRoot)
    expect(escapingNodes.length).toBeGreaterThan(0)
    for (const node of escapingNodes) {
      expect(node.entry.kind).toBe('other')
      expect(node.entry.sizeBytes).toBeNull()
      expect(node.entry.childCount).toBeNull()
    }
  })
})

// The mirror of the two blocks above, with confinement off. Same fixture, same
// escaping links; the root is now only the tree's starting anchor, so nothing
// is refused for leaving it and no entry is ever marked `escapesRoot`.
describe('unconfined mode — the root is a display anchor, not a boundary', () => {
  test('serves a file through a symlink leaving the root', async () => {
    const result = await unconfinedService.resolveFile('escaping-file')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.absolutePath).toBe(join(servedRoot, 'escaping-file'))
  })

  test('lists a directory through a symlink leaving the root', async () => {
    const result = await unconfinedService.listDirectory('escaping-directory')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(`listing failed: ${result.reason}`)
    expect(result.listing.entries.map((entry) => entry.name)).toContain('secret.txt')
  })

  test('searches a subtree through a symlink leaving the root', async () => {
    const result = await unconfinedService.searchSubtree('escaping-directory', {
      pattern: 'secret',
      limit: 10,
      showHidden: false,
      showGitignored: false,
      abortSignal: new AbortController().signal,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(`search failed: ${result.reason}`)
    expect(result.result.nodes.map((node) => node.path)).toContain('secret.txt')
  })

  test('resolves a file for opening through a symlink leaving the root', async () => {
    // openFile spawns the OS launcher, which a test must not do. It resolves
    // through resolveFile first, so the escape verdict is observable there —
    // and the escaping *directory* still answers not-a-file, the honest kind
    // verdict that confinement had to withhold.
    const result = await unconfinedService.resolveFile('escaping-directory')
    expect(result).toEqual({ ok: false, reason: 'not-a-file' })
  })

  test('resolves a lexical escape instead of refusing it', async () => {
    const result = await unconfinedService.resolveFile('../outside/secret.txt')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.absolutePath).toBe(join(outsideDirectory, 'secret.txt'))
  })

  test('accepts an absolute path outside the root', async () => {
    const result = await unconfinedService.listDirectory(outsideDirectory)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(`listing failed: ${result.reason}`)
    expect(result.listing.entries.map((entry) => entry.name)).toContain('secret.txt')
  })

  // The wire-format decision the embeddable component depends on: a directory
  // outside the anchor is addressed by its absolute path, not a `../../` chain,
  // so the client's plain string join (`joinTreePath`) keeps producing a path
  // the server can resolve. Inside the anchor the format is unchanged.
  test('addresses out-of-root listings by absolute path, in-root ones relatively', async () => {
    const outside = await unconfinedService.listDirectory(outsideDirectory)
    if (!outside.ok) throw new Error(`listing failed: ${outside.reason}`)
    expect(outside.listing.relativePath).toBe(outsideDirectory)
    expect(outside.listing.rootPath).toBe(servedRoot)

    const roundTripped = await unconfinedService.resolveFile(
      `${outside.listing.relativePath}/secret.txt`,
    )
    expect(roundTripped.ok).toBe(true)

    const inside = await unconfinedService.listDirectory('inside')
    if (!inside.ok) throw new Error(`listing failed: ${inside.reason}`)
    expect(inside.listing.relativePath).toBe('inside')
  })

  test('never marks an entry as escaping the root', async () => {
    const result = await unconfinedService.listDirectory('')
    if (!result.ok) throw new Error(`listing the root failed: ${result.reason}`)
    expect(result.listing.entries.every((entry) => !entry.escapesRoot)).toBe(true)
  })

  // The flag the client keys "up from the anchor" off: unconfined it is false,
  // so the tree offers navigation above the served root; confined it is true.
  test('reports the root as an anchor, not a boundary', async () => {
    const unconfined = await unconfinedService.listDirectory('')
    if (!unconfined.ok) throw new Error(`listing failed: ${unconfined.reason}`)
    expect(unconfined.listing.confined).toBe(false)

    const confined = await filesystemService.listDirectory('')
    if (!confined.ok) throw new Error(`listing failed: ${confined.reason}`)
    expect(confined.listing.confined).toBe(true)
  })

  // The counterpart of the confined block's withholding tests: with nothing to
  // withhold, an escaping link reports its target's real metadata.
  test('reports the real kind and metadata of a link pointing outside the root', async () => {
    const result = await unconfinedService.listDirectory('')
    if (!result.ok) throw new Error(`listing the root failed: ${result.reason}`)
    const escapingDirectory = result.listing.entries.find(
      (entry) => entry.name === 'escaping-directory',
    )!
    expect(escapingDirectory.kind).toBe('directory')
    expect(escapingDirectory.childCount).toBe(1)

    const escapingFile = result.listing.entries.find((entry) => entry.name === 'escaping-file')!
    expect(escapingFile.kind).toBe('file')
    expect(escapingFile.sizeBytes).toBe('secret'.length)
  })
})

// The syscall budget of a listing, asserted directly rather than inferred from
// wall clock. `docs/requirements/013-large-directory-listing-performance.md`
// cut the per-entry cost by taking entry kinds from the parent's `readdir`
// instead of an `lstat` + `stat` pair each; a change that quietly reintroduces
// either shows up here as a count, on a three-entry directory, with no
// benchmark to run and nothing timing-dependent to flake on.
describe('listing syscall budget', () => {
  let countedRoot: string
  let countedService: ReturnType<typeof createFilesystemService>

  beforeAll(async () => {
    countedRoot = await realpath(await mkdtemp(join(tmpdir(), 'bfe-counted-')))
    await mkdir(join(countedRoot, 'a-directory'))
    await writeFile(join(countedRoot, 'a-directory', 'child.txt'), 'child')
    await writeFile(join(countedRoot, 'a-file.txt'), 'file')
    await symlink(join(countedRoot, 'missing'), join(countedRoot, 'broken-link'))
    countedService = createFilesystemService({ rootAbsolutePath: countedRoot, confine: false })
  })

  afterAll(async () => {
    await rm(countedRoot, { recursive: true, force: true })
  })

  test('stats plain files only, and reads only the directories it counts', async () => {
    const result = await countedService.listDirectory('')
    if (!result.ok) throw new Error(`listing failed: ${result.reason}`)
    expect(result.timing.entryCount).toBe(3)
    expect(result.timing.directoryCount).toBe(1)
    // One for the plain file, one for the symlink that has to be followed to
    // learn what it points at. The directory needs none: its dirent said so.
    expect(result.timing.statCount).toBe(2)
    // Exactly one: the `childCount` of `a-directory`.
    expect(result.timing.childReaddirCount).toBe(1)
    // Unconfined, containment is not checked, so no path is ever resolved.
    expect(result.timing.realpathCount).toBe(0)
  })

  test('a broken symlink is reported as `other` without a kind of its own', async () => {
    const result = await countedService.listDirectory('')
    if (!result.ok) throw new Error(`listing failed: ${result.reason}`)
    const brokenLink = result.listing.entries.find((entry) => entry.name === 'broken-link')!
    expect(brokenLink.kind).toBe('other')
    expect(brokenLink.isSymlink).toBe(true)
    expect(brokenLink.sizeBytes).toBeNull()
    expect(brokenLink.childCount).toBeNull()
  })

  test('reports the phases that make up the listing', async () => {
    const result = await countedService.listDirectory('')
    if (!result.ok) throw new Error(`listing failed: ${result.reason}`)
    const { timing } = result
    expect(timing.totalMilliseconds).toBeGreaterThanOrEqual(0)
    for (const phase of [
      timing.readdirMilliseconds,
      timing.ignoreMilliseconds,
      timing.describeMilliseconds,
    ]) {
      expect(phase).toBeGreaterThanOrEqual(0)
      expect(phase).toBeLessThanOrEqual(timing.totalMilliseconds + 1)
    }
  })
})

// The security half of the same counters: confinement's promise is not merely
// that an escaping link's metadata is absent from the response, but that the
// server never asked for it. A root holding nothing but escaping links must
// therefore complete its listing with zero stats and zero child readdirs — if a
// future refactor follows a link first and withholds afterwards, the target has
// already been read, and this fails.
describe('an escaping symlink is never followed', () => {
  let linkOnlyRoot: string
  let linkOnlyService: ReturnType<typeof createFilesystemService>

  beforeAll(async () => {
    const scratchDirectory = await realpath(await mkdtemp(join(tmpdir(), 'bfe-links-')))
    linkOnlyRoot = join(scratchDirectory, 'served')
    const outside = join(scratchDirectory, 'outside')
    await mkdir(linkOnlyRoot, { recursive: true })
    await mkdir(join(outside, 'a-directory'), { recursive: true })
    await writeFile(join(outside, 'an-executable'), 'x')
    await chmod(join(outside, 'an-executable'), 0o755)

    await symlink(join(outside, 'a-directory'), join(linkOnlyRoot, 'to-a-directory'))
    await symlink(join(outside, 'an-executable'), join(linkOnlyRoot, 'to-an-executable'))
    linkOnlyService = createFilesystemService({ rootAbsolutePath: linkOnlyRoot })
  })

  afterAll(async () => {
    await rm(join(linkOnlyRoot, '..'), { recursive: true, force: true })
  })

  test('issues no stat and no child readdir for a listing of nothing but escaping links', async () => {
    const result = await linkOnlyService.listDirectory('')
    if (!result.ok) throw new Error(`listing failed: ${result.reason}`)
    expect(result.timing.entryCount).toBe(2)
    expect(result.timing.statCount).toBe(0)
    expect(result.timing.childReaddirCount).toBe(0)
    // One containment check for the listed root, one per symlink.
    expect(result.timing.realpathCount).toBe(3)
  })

  test('still lists both links, with every fact about their targets withheld', async () => {
    const result = await linkOnlyService.listDirectory('')
    if (!result.ok) throw new Error(`listing failed: ${result.reason}`)
    expect(result.listing.entries.map((entry) => entry.name).sort()).toEqual([
      'to-a-directory',
      'to-an-executable',
    ])
    for (const entry of result.listing.entries) {
      expect(entry.escapesRoot).toBe(true)
      expect(entry.isSymlink).toBe(true)
      expect(entry.kind).toBe('other')
      expect(entry.sizeBytes).toBeNull()
      expect(entry.childCount).toBeNull()
      expect(entry.isExecutable).toBe(false)
    }
  })
})

// An escaping symlink's row participates in `.gitignore` filtering like any
// other entry, so a rule such as `*-link` marks it ignored and the client's
// default view drops it. Pinned here because it looks like something the dirent
// refactor introduced and is not: before that change `describeEntry` returned a
// hardcoded `isGitignored: false` for this branch, and `listDirectory` then
// overwrote it for *every* entry with exactly the verdict below — verified
// identical at the parent commit. The tension with `never-hide-a-control` (the
// row confinement keeps visible precisely to say why a target is unavailable
// can be filtered out of the default view) is therefore pre-existing, and
// changing it is a decision rather than a refactor.
describe('gitignore rules apply to an escaping symlink row', () => {
  let ignoredLinkRoot: string
  let ignoredLinkService: ReturnType<typeof createFilesystemService>

  beforeAll(async () => {
    const scratchDirectory = await realpath(await mkdtemp(join(tmpdir(), 'bfe-ignored-link-')))
    ignoredLinkRoot = join(scratchDirectory, 'served')
    const outside = join(scratchDirectory, 'outside')
    await mkdir(ignoredLinkRoot, { recursive: true })
    await mkdir(outside, { recursive: true })
    await writeFile(join(ignoredLinkRoot, '.gitignore'), '*-link\n')
    await symlink(outside, join(ignoredLinkRoot, 'escaping-link'))
    await symlink(ignoredLinkRoot, join(ignoredLinkRoot, 'contained-link'))
    ignoredLinkService = createFilesystemService({ rootAbsolutePath: ignoredLinkRoot })
  })

  afterAll(async () => {
    await rm(join(ignoredLinkRoot, '..'), { recursive: true, force: true })
  })

  test('an ignored escaping link is still listed, and still withholds its target', async () => {
    const result = await ignoredLinkService.listDirectory('')
    if (!result.ok) throw new Error(`listing failed: ${result.reason}`)
    const escapingLink = result.listing.entries.find((entry) => entry.name === 'escaping-link')!
    // The row is present and blank whatever the gitignore verdict says: the
    // withholding is confinement's job, and it is decided before this one.
    expect(escapingLink.escapesRoot).toBe(true)
    expect(escapingLink.kind).toBe('other')
    expect(escapingLink.childCount).toBeNull()
    expect(escapingLink.sizeBytes).toBeNull()
    // And the verdict itself is emitted rather than assumed, per `emit-nullish`.
    expect(escapingLink.isGitignored).toBe(true)
  })

  test('following the link is still refused whether or not it is ignored', async () => {
    expect(await ignoredLinkService.listDirectory('escaping-link')).toEqual({
      ok: false,
      reason: 'symlink-escapes-root',
    })
  })

  test('a contained link matched by the same rule is marked ignored too', async () => {
    const result = await ignoredLinkService.listDirectory('')
    if (!result.ok) throw new Error(`listing failed: ${result.reason}`)
    const containedLink = result.listing.entries.find((entry) => entry.name === 'contained-link')!
    expect(containedLink.escapesRoot).toBe(false)
    expect(containedLink.isGitignored).toBe(true)
  })

  test('an entry no rule matches is not marked ignored', async () => {
    const result = await ignoredLinkService.listDirectory('')
    if (!result.ok) throw new Error(`listing failed: ${result.reason}`)
    const ignoreFile = result.listing.entries.find((entry) => entry.name === '.gitignore')!
    expect(ignoreFile.isGitignored).toBe(false)
  })
})
