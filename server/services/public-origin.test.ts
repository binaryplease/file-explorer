import { describe, expect, test } from 'bun:test'
import { createPublicOriginResolver, resolvePublicOrigin } from './public-origin'

const LOOPBACK_REQUEST_URL = 'http://localhost:3000/api'

function originFor(overrides: {
  requestUrl?: string
  hostHeader?: string | null
  forwardedProtocolHeader?: string | null
  forwardedHostHeader?: string | null
  additionalAllowedHosts?: string[]
}): string {
  return resolvePublicOrigin({
    requestUrl: LOOPBACK_REQUEST_URL,
    hostHeader: 'localhost:3000',
    forwardedProtocolHeader: null,
    forwardedHostHeader: null,
    additionalAllowedHosts: [],
    ...overrides,
  })
}

describe('loopback default — forwarded headers carry no authority at all', () => {
  test('the request\'s own Host is what the discovery document names', () => {
    expect(originFor({})).toBe('http://localhost:3000')
  })

  // The finding: a request passing the Host guard with `Host: localhost` could
  // still choose the origin echoed into docs/openapi/health.
  test('an injected forwarded host is ignored, not reflected', () => {
    expect(
      originFor({
        forwardedHostHeader: 'evil.example',
        forwardedProtocolHeader: 'https',
      }),
    ).toBe('http://localhost:3000')
  })

  test('no allow-list means no forwarded value survives, however shaped', () => {
    for (const forwardedHostHeader of [
      'evil.example',
      'evil.example:8443',
      'evil.example, files.example.com',
      'localhost@evil.example',
      'localhost/../evil.example',
    ]) {
      expect(originFor({ forwardedHostHeader })).toBe('http://localhost:3000')
    }
  })

  test('falls back to the request URL when Host is absent', () => {
    expect(originFor({ hostHeader: null })).toBe('http://localhost:3000')
    expect(originFor({ hostHeader: '   ' })).toBe('http://localhost:3000')
  })
})

describe('proxy acknowledged — forwarded host honoured only if it is a named host', () => {
  const additionalAllowedHosts = ['files.example.com']

  test('a forwarded host the operator named is used', () => {
    expect(
      originFor({
        additionalAllowedHosts,
        hostHeader: 'localhost:3000',
        forwardedHostHeader: 'files.example.com',
        forwardedProtocolHeader: 'https',
      }),
    ).toBe('https://files.example.com')
  })

  test('a forwarded host the operator did NOT name falls back to the request Host', () => {
    expect(
      originFor({
        additionalAllowedHosts,
        hostHeader: 'localhost:3000',
        forwardedHostHeader: 'evil.example',
        forwardedProtocolHeader: 'https',
      }),
    ).toBe('http://localhost:3000')
  })

  test('the left-most forwarded entry is the one judged', () => {
    expect(
      originFor({
        additionalAllowedHosts,
        forwardedHostHeader: 'files.example.com, internal.proxy',
      }),
    ).toBe('http://files.example.com')
    expect(
      originFor({
        additionalAllowedHosts,
        forwardedHostHeader: 'evil.example, files.example.com',
      }),
    ).toBe('http://localhost:3000')
  })

  test('an allowed hostname keeps its forwarded port', () => {
    expect(
      originFor({
        additionalAllowedHosts,
        forwardedHostHeader: 'files.example.com:8443',
        forwardedProtocolHeader: 'https',
      }),
    ).toBe('https://files.example.com:8443')
  })

  test('structure smuggled past the hostname is refused', () => {
    for (const forwardedHostHeader of [
      'files.example.com/evil',
      'files.example.com:8443/evil',
      'files.example.com:notaport',
      'user@files.example.com',
      'files.example.com\r\nX-Injected: 1',
      '',
      ':3000',
    ]) {
      expect(originFor({ additionalAllowedHosts, forwardedHostHeader })).toBe(
        'http://localhost:3000',
      )
    }
  })

  // Proxies pad list entries with spaces; that is the header's own syntax, not
  // smuggling, so it is trimmed and accepted like the Host guard does.
  test('surrounding whitespace is trimmed, not treated as malformed', () => {
    expect(
      originFor({ additionalAllowedHosts, forwardedHostHeader: '  files.example.com  ' }),
    ).toBe('http://files.example.com')
  })

  test('subdomains of a named host are not named hosts', () => {
    expect(
      originFor({ additionalAllowedHosts, forwardedHostHeader: 'evil.files.example.com' }),
    ).toBe('http://localhost:3000')
  })

  test('hostname matching is case-insensitive and port-insensitive, like the Host guard', () => {
    expect(
      originFor({
        additionalAllowedHosts: ['Files.Example.com:8443'],
        forwardedHostHeader: 'files.example.com',
      }),
    ).toBe('http://files.example.com')
  })
})

describe('forwarded protocol', () => {
  const additionalAllowedHosts = ['files.example.com']

  // TLS terminated at the proxy, Host passed through untouched.
  test('is honoured when the origin we advertise is a named host', () => {
    expect(
      originFor({
        additionalAllowedHosts,
        requestUrl: 'http://files.example.com/api',
        hostHeader: 'files.example.com',
        forwardedProtocolHeader: 'https',
      }),
    ).toBe('https://files.example.com')
  })

  test('is ignored when the origin is loopback — nothing proxied us there', () => {
    expect(
      originFor({
        additionalAllowedHosts,
        hostHeader: 'localhost:3000',
        forwardedProtocolHeader: 'https',
      }),
    ).toBe('http://localhost:3000')
  })

  test('only http and https are ever reflected', () => {
    for (const forwardedProtocolHeader of ['javascript', 'file', 'https evil', 'HTTPS://x', '']) {
      expect(
        originFor({
          additionalAllowedHosts,
          forwardedHostHeader: 'files.example.com',
          forwardedProtocolHeader,
        }),
      ).toBe('http://files.example.com')
    }
  })

  test('case and list form are normalised like the host header', () => {
    expect(
      originFor({
        additionalAllowedHosts,
        forwardedHostHeader: 'files.example.com',
        forwardedProtocolHeader: 'HTTPS, http',
      }),
    ).toBe('https://files.example.com')
  })
})

describe('the `factory-services` resolver reads the headers off a real Request', () => {
  test('loopback resolver ignores the forwarded headers', () => {
    const resolver = createPublicOriginResolver({ additionalAllowedHosts: [] })
    const request = new Request('http://localhost:3000/api', {
      headers: {
        host: 'localhost:3000',
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'https',
      },
    })
    expect(resolver.forRequest(request)).toBe('http://localhost:3000')
  })

  test('acknowledged-proxy resolver honours the named host', () => {
    const resolver = createPublicOriginResolver({
      additionalAllowedHosts: ['files.example.com'],
    })
    const request = new Request('http://localhost:3000/api', {
      headers: {
        host: 'localhost:3000',
        'x-forwarded-host': 'files.example.com',
        'x-forwarded-proto': 'https',
      },
    })
    expect(resolver.forRequest(request)).toBe('https://files.example.com')
  })
})
