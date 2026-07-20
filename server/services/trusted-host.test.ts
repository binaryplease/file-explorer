import { describe, expect, test } from 'bun:test'
import { hostnameFromHostHeader, isTrustedHostHeader } from './trusted-host'

describe('hostnameFromHostHeader', () => {
  test('strips the port', () => {
    expect(hostnameFromHostHeader('localhost:3000')).toBe('localhost')
    expect(hostnameFromHostHeader('127.0.0.1:3000')).toBe('127.0.0.1')
  })

  test('keeps a bracketed IPv6 literal intact', () => {
    expect(hostnameFromHostHeader('[::1]:3000')).toBe('[::1]')
    expect(hostnameFromHostHeader('[::1]')).toBe('[::1]')
  })

  test('normalises case', () => {
    expect(hostnameFromHostHeader('LocalHost:3000')).toBe('localhost')
  })
})

describe('trusted hosts — loopback only by default', () => {
  test('accepts the names the server is genuinely reachable under', () => {
    for (const hostHeader of [
      'localhost:3000',
      'localhost',
      '127.0.0.1:3000',
      '127.0.0.53',
      '[::1]:3000',
    ]) {
      expect(isTrustedHostHeader(hostHeader, [])).toBe(true)
    }
  })

  // The attack this exists for: the page is served from evil.example, which
  // resolves to 127.0.0.1, so the browser considers it same-origin and lifts
  // the same-origin policy. The Host header is what gives it away.
  test('refuses a rebound attacker origin', () => {
    expect(isTrustedHostHeader('evil.example', [])).toBe(false)
    expect(isTrustedHostHeader('evil.example:3000', [])).toBe(false)
  })

  // A name an attacker can register and point at loopback. Suffix matching on
  // `.localhost` would hand back exactly what the guard just took away.
  test('refuses a lookalike subdomain of a loopback name', () => {
    expect(isTrustedHostHeader('evil.localhost', [])).toBe(false)
    expect(isTrustedHostHeader('localhost.evil.example', [])).toBe(false)
    expect(isTrustedHostHeader('127.0.0.1.evil.example', [])).toBe(false)
  })

  test('refuses a missing or empty Host header', () => {
    expect(isTrustedHostHeader(null, [])).toBe(false)
    expect(isTrustedHostHeader('   ', [])).toBe(false)
  })

  test('refuses a non-loopback IP that merely starts with the loopback digits', () => {
    expect(isTrustedHostHeader('127.0.0.1.2', [])).toBe(false)
    expect(isTrustedHostHeader('1270.0.0.1', [])).toBe(false)
  })
})

describe('EXPLORER_ALLOWED_HOSTS escape hatch', () => {
  test('accepts a deliberately named host, with or without a port', () => {
    expect(isTrustedHostHeader('files.example.com', ['files.example.com'])).toBe(true)
    expect(isTrustedHostHeader('files.example.com:8080', ['files.example.com'])).toBe(true)
    expect(isTrustedHostHeader('files.example.com', ['files.example.com:443'])).toBe(true)
  })

  test('still refuses everything not named', () => {
    expect(isTrustedHostHeader('evil.example', ['files.example.com'])).toBe(false)
    expect(isTrustedHostHeader('sub.files.example.com', ['files.example.com'])).toBe(false)
  })
})
