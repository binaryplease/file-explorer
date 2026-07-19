import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
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

beforeAll(async () => {
  // The temp dir itself is often reached through a symlink (/tmp, /var). Its
  // real path is what the service will compare against.
  const scratchDirectory = await realpath(await mkdtemp(join(tmpdir(), 'binp-fex-confinement-')))
  servedRoot = join(scratchDirectory, 'served')
  outsideDirectory = join(scratchDirectory, 'outside')

  await mkdir(join(servedRoot, 'inside'), { recursive: true })
  await mkdir(outsideDirectory, { recursive: true })
  await writeFile(join(servedRoot, 'inside', 'contained.txt'), 'contained')
  await writeFile(join(outsideDirectory, 'secret.txt'), 'secret')

  await symlink(join(outsideDirectory, 'secret.txt'), join(servedRoot, 'escaping-file'))
  await symlink(outsideDirectory, join(servedRoot, 'escaping-directory'))
  await symlink(join(servedRoot, 'inside'), join(servedRoot, 'contained-link'))

  filesystemService = createFilesystemService({ rootAbsolutePath: servedRoot })
})

afterAll(async () => {
  await rm(join(servedRoot, '..'), { recursive: true, force: true })
})

describe('symlink-escape confinement', () => {
  test('refuses to serve a file through a symlink leaving the root', async () => {
    const result = await filesystemService.resolveFile('escaping-file')
    expect(result).toEqual({ ok: false, reason: 'outside-root' })
  })

  test('refuses to list a directory through a symlink leaving the root', async () => {
    const result = await filesystemService.listDirectory('escaping-directory')
    expect(result).toEqual({ ok: false, reason: 'outside-root' })
  })

  test('refuses to search a subtree through a symlink leaving the root', async () => {
    const result = await filesystemService.searchSubtree('escaping-directory', {
      pattern: 'secret',
      limit: 10,
      showHidden: false,
      showGitignored: false,
      abortSignal: new AbortController().signal,
    })
    expect(result).toEqual({ ok: false, reason: 'outside-root' })
  })

  test('refuses to open a file through a symlink leaving the root', async () => {
    const result = await filesystemService.openFile('escaping-file')
    expect(result).toEqual({ ok: false, reason: 'outside-root' })
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
