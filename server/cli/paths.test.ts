import { describe, expect, test } from 'bun:test'
import { DaemonStateSchema, baseUrlForState } from './paths'

describe('DaemonStateSchema', () => {
  const validState = {
    pid: 4242,
    host: '127.0.0.1',
    port: 3000,
    root: '/home/user/projects',
    startedAt: '2026-07-27T12:00:00.000Z',
  }

  test('accepts a complete state record', () => {
    expect(DaemonStateSchema.parse(validState)).toEqual(validState)
  })

  test('rejects a partial record — identity fields have no defaults (fail loud)', () => {
    for (const missing of ['pid', 'host', 'port', 'root', 'startedAt']) {
      const partial = { ...validState } as Record<string, unknown>
      delete partial[missing]
      expect(DaemonStateSchema.safeParse(partial).success).toBe(false)
    }
  })

  test('rejects a non-positive port or pid', () => {
    expect(DaemonStateSchema.safeParse({ ...validState, port: 0 }).success).toBe(false)
    expect(DaemonStateSchema.safeParse({ ...validState, pid: -1 }).success).toBe(false)
  })
})

describe('baseUrlForState', () => {
  test('builds the base URL from host and port', () => {
    expect(baseUrlForState({ host: '127.0.0.1', port: 3000 })).toBe('http://127.0.0.1:3000')
    expect(baseUrlForState({ host: '0.0.0.0', port: 8080 })).toBe('http://0.0.0.0:8080')
  })
})
