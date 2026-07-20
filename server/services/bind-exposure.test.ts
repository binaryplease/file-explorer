import { describe, expect, test } from 'bun:test'
import { createBindExposurePolicy, evaluateBindExposure } from './bind-exposure'

const LOOPBACK_BIND_HOSTS = ['127.0.0.1', 'localhost', '::1', '127.0.0.53', 'LocalHost', ' 127.0.0.1 ']

describe('loopback bind — the default, and it stays silent', () => {
  test('every loopback spelling is accepted without conditions', () => {
    for (const bindHost of LOOPBACK_BIND_HOSTS) {
      expect(
        evaluateBindExposure({ bindHost, additionalAllowedHosts: [], isConfined: false }),
      ).toEqual({ kind: 'loopback' })
    }
  })

  // The default posture: HOST unset, nothing named, unconfined. Must not warn
  // and must not exit — that is how the tool has always started locally.
  test('the shipped default starts with no warning and no failure', () => {
    const warnings: string[] = []
    const failureMessages: string[] = []
    const policy = createBindExposurePolicy({
      reportWarning: (message) => warnings.push(message),
      fail: (message) => {
        failureMessages.push(message)
        throw new Error('should not fail')
      },
    })

    const decision = policy.enforce({
      bindHost: '127.0.0.1',
      additionalAllowedHosts: [],
      isConfined: false,
    })

    expect(decision).toEqual({ kind: 'loopback' })
    expect(warnings).toEqual([])
    expect(failureMessages).toEqual([])
  })
})

describe('non-loopback bind with no named hosts — fail closed', () => {
  test('refuses, naming the bind address and the way out', () => {
    const decision = evaluateBindExposure({
      bindHost: '0.0.0.0',
      additionalAllowedHosts: [],
      isConfined: false,
    })

    expect(decision.kind).toBe('refused')
    if (decision.kind !== 'refused') return
    expect(decision.reason).toContain('HOST=0.0.0.0')
    expect(decision.reason).toContain('EXPLORER_ALLOWED_HOSTS')
    expect(decision.reason).toContain('EXPLORER_CONFINE=true')
    expect(decision.reason).toContain('reverse proxy')
  })

  test('confinement alone does not buy the right to bind publicly', () => {
    expect(
      evaluateBindExposure({
        bindHost: '0.0.0.0',
        additionalAllowedHosts: [],
        isConfined: true,
      }).kind,
    ).toBe('refused')
  })

  test('any non-loopback address is covered, not just the wildcard', () => {
    for (const bindHost of ['::', '192.168.1.10', '10.0.0.4', 'files.example.com']) {
      expect(
        evaluateBindExposure({ bindHost, additionalAllowedHosts: [], isConfined: true }).kind,
      ).toBe('refused')
    }
  })

  test('enforce routes the refusal to the fatal sink', () => {
    const failureMessages: string[] = []
    const policy = createBindExposurePolicy({
      reportWarning: () => {},
      fail: (message) => {
        failureMessages.push(message)
        throw new Error('fatal')
      },
    })

    expect(() =>
      policy.enforce({ bindHost: '0.0.0.0', additionalAllowedHosts: [], isConfined: false }),
    ).toThrow('fatal')
    expect(failureMessages[0]).toContain('refusing to start')
  })
})

describe('non-loopback bind with named hosts — starts, but says what is exposed', () => {
  test('unconfined starts and warns that the whole filesystem is reachable', () => {
    const warnings: string[] = []
    const policy = createBindExposurePolicy({
      reportWarning: (message) => warnings.push(message),
      fail: () => {
        throw new Error('should not fail')
      },
    })

    const decision = policy.enforce({
      bindHost: '0.0.0.0',
      additionalAllowedHosts: ['files.example.com'],
      isConfined: false,
    })

    expect(decision.kind).toBe('exposed')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('EXPLORER_CONFINE')
    expect(warnings[0]).toContain('ENTIRE filesystem')
  })

  test('confined starts silently', () => {
    const warnings: string[] = []
    const policy = createBindExposurePolicy({
      reportWarning: (message) => warnings.push(message),
      fail: () => {
        throw new Error('should not fail')
      },
    })

    const decision = policy.enforce({
      bindHost: '0.0.0.0',
      additionalAllowedHosts: ['files.example.com'],
      isConfined: true,
    })

    expect(decision).toEqual({ kind: 'exposed', warnings: [] })
    expect(warnings).toEqual([])
  })
})
