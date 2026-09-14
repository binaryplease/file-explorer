import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { adoptLegacyDaemonAt, legacyDaemonName } from './legacy-daemon'
import { DAEMON_NAME, daemonPathsFor, type DaemonPaths } from './paths'

const LIVE_STATE = {
  pid: 4242,
  host: '127.0.0.1',
  port: 4600,
  root: '/home/user/projects',
  startedAt: '2026-09-09T12:00:00.000Z',
}

describe('adoptLegacyDaemonAt', () => {
  let scratchDirectory = ''
  let legacy: DaemonPaths
  let current: DaemonPaths

  beforeEach(async () => {
    scratchDirectory = await mkdtemp(join(tmpdir(), 'file-explorer-legacy-daemon-'))
    const roots = {
      runtimeDirectory: join(scratchDirectory, 'run'),
      dataHome: join(scratchDirectory, 'share'),
    }
    await mkdir(roots.runtimeDirectory, { recursive: true })
    await mkdir(roots.dataHome, { recursive: true })
    legacy = daemonPathsFor(legacyDaemonName, roots)
    current = daemonPathsFor(DAEMON_NAME, roots)
  })

  afterEach(async () => {
    await rm(scratchDirectory, { recursive: true, force: true })
  })

  /** A pid/state pair as an older build would have left it. */
  async function writeLegacyDaemonRecord(pid: number): Promise<void> {
    await writeFile(legacy.pidFilePath, `${pid}\n`)
    await writeFile(legacy.stateFilePath, JSON.stringify({ ...LIVE_STATE, pid }, null, 2))
  }

  /** A log directory as an older build would have left it. */
  async function writeLegacyLog(contents: string): Promise<void> {
    await mkdir(legacy.logDirectory, { recursive: true })
    await writeFile(legacy.logFilePath, contents)
  }

  const alwaysAlive = () => true
  const neverAlive = () => false

  test('reports nothing when there is no pre-rename state at all', async () => {
    const report = await adoptLegacyDaemonAt({ legacy, current, processIsAlive: alwaysAlive })
    expect(report).toEqual([])
    expect(existsSync(current.pidFilePath)).toBe(false)
  })

  test('adopts a live daemon: the pid/state pair moves under the current name', async () => {
    await writeLegacyDaemonRecord(4242)

    const report = await adoptLegacyDaemonAt({ legacy, current, processIsAlive: alwaysAlive })

    expect(await readFile(current.pidFilePath, 'utf8')).toBe('4242')
    expect(JSON.parse(await readFile(current.stateFilePath, 'utf8'))).toEqual({
      ...LIVE_STATE,
      pid: 4242,
    })
    // The old pair is gone, so a second run is a no-op rather than a re-adopt.
    expect(existsSync(legacy.pidFilePath)).toBe(false)
    expect(existsSync(legacy.stateFilePath)).toBe(false)
    expect(report).toHaveLength(1)
    expect(report[0]).toContain('adopted')
    expect(report[0]).toContain('4242')

    expect(await adoptLegacyDaemonAt({ legacy, current, processIsAlive: alwaysAlive })).toEqual([])
  })

  test('adopts a live daemon whose state file was lost, leaving the pid reachable', async () => {
    await writeFile(legacy.pidFilePath, '4242\n')

    const report = await adoptLegacyDaemonAt({ legacy, current, processIsAlive: alwaysAlive })

    expect(await readFile(current.pidFilePath, 'utf8')).toBe('4242')
    expect(existsSync(current.stateFilePath)).toBe(false)
    expect(report[0]).toContain('adopted')
  })

  test('clears a stale pair rather than adopting a dead pid', async () => {
    await writeLegacyDaemonRecord(4242)

    const report = await adoptLegacyDaemonAt({ legacy, current, processIsAlive: neverAlive })

    expect(existsSync(legacy.pidFilePath)).toBe(false)
    expect(existsSync(legacy.stateFilePath)).toBe(false)
    expect(existsSync(current.pidFilePath)).toBe(false)
    expect(report).toEqual([
      `cleared stale daemon files left under the previous name (${legacyDaemonName})`,
    ])
  })

  test('clears an unreadable pid file rather than adopting a bogus pid', async () => {
    await writeFile(legacy.pidFilePath, 'not-a-pid\n')

    const report = await adoptLegacyDaemonAt({ legacy, current, processIsAlive: alwaysAlive })

    expect(existsSync(legacy.pidFilePath)).toBe(false)
    expect(existsSync(current.pidFilePath)).toBe(false)
    expect(report[0]).toContain('unreadable')
  })

  test('reports both pids instead of overwriting a live record under the current name', async () => {
    await writeLegacyDaemonRecord(4242)
    await writeFile(current.pidFilePath, '777\n')
    await writeFile(current.stateFilePath, JSON.stringify({ ...LIVE_STATE, pid: 777 }))

    const report = await adoptLegacyDaemonAt({ legacy, current, processIsAlive: alwaysAlive })

    // Neither side is touched: adopting here would drop a running daemon's record.
    expect(await readFile(current.pidFilePath, 'utf8')).toBe('777\n')
    expect(existsSync(legacy.pidFilePath)).toBe(true)
    expect(report).toHaveLength(1)
    expect(report[0]).toContain('4242')
    expect(report[0]).toContain('777')
    expect(report[0]).toContain('by hand')
  })

  test('adopts over a stale record under the current name', async () => {
    await writeLegacyDaemonRecord(4242)
    await writeFile(current.pidFilePath, '777\n')

    // Only 4242 is alive; the 777 record is left over from a crashed daemon.
    const report = await adoptLegacyDaemonAt({
      legacy,
      current,
      processIsAlive: (pid) => pid === 4242,
    })

    expect(await readFile(current.pidFilePath, 'utf8')).toBe('4242')
    expect(report[0]).toContain('adopted')
  })

  test('moves the log directory and renames the log file when the new path is free', async () => {
    await writeLegacyLog('older daemon output\n')

    const report = await adoptLegacyDaemonAt({ legacy, current, processIsAlive: alwaysAlive })

    expect(existsSync(legacy.logDirectory)).toBe(false)
    expect(await readFile(current.logFilePath, 'utf8')).toBe('older daemon output\n')
    expect(report).toEqual([
      `moved the log directory from ${legacy.logDirectory} to ${current.logDirectory}`,
    ])
  })

  test('keeps both log directories and says which is which when the new one exists', async () => {
    await writeLegacyLog('older daemon output\n')
    await mkdir(current.logDirectory, { recursive: true })
    await writeFile(current.logFilePath, 'current daemon output\n')

    const report = await adoptLegacyDaemonAt({ legacy, current, processIsAlive: alwaysAlive })

    expect(await readFile(legacy.logFilePath, 'utf8')).toBe('older daemon output\n')
    expect(await readFile(current.logFilePath, 'utf8')).toBe('current daemon output\n')
    expect(report).toHaveLength(1)
    expect(report[0]).toContain(legacy.logDirectory)
    expect(report[0]).toContain(current.logDirectory)
  })

  test('adopts the process state and the logs together, reporting both', async () => {
    await writeLegacyDaemonRecord(4242)
    await writeLegacyLog('older daemon output\n')

    const report = await adoptLegacyDaemonAt({ legacy, current, processIsAlive: alwaysAlive })

    expect(await readFile(current.pidFilePath, 'utf8')).toBe('4242')
    expect(await readFile(current.logFilePath, 'utf8')).toBe('older daemon output\n')
    expect(report).toHaveLength(2)
  })
})

describe('legacyDaemonName', () => {
  test('names the product as it was before it matched the repository', () => {
    // Spelled out here — a test is the one place the old identifier is allowed
    // to be asserted verbatim, and this is what pins the constant's value.
    expect(legacyDaemonName).toBe(['binp', DAEMON_NAME].join('-'))
    expect(legacyDaemonName).not.toBe(DAEMON_NAME)
  })

  test('derives the five pre-rename runtime paths', () => {
    const roots = { runtimeDirectory: '/run/user/1000', dataHome: '/home/user/.local/share' }
    expect(daemonPathsFor(legacyDaemonName, roots)).toEqual({
      pidFilePath: `/run/user/1000/${legacyDaemonName}.pid`,
      stateFilePath: `/run/user/1000/${legacyDaemonName}.state.json`,
      logDirectory: `/home/user/.local/share/${legacyDaemonName}`,
      logFilePath: `/home/user/.local/share/${legacyDaemonName}/${legacyDaemonName}.log`,
    })
  })
})
