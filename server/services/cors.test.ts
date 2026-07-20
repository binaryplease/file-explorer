import { describe, expect, it } from 'bun:test'
import { corsHeadersFor, createCorsPolicy } from './cors'

const HOST_ORIGIN = 'http://localhost:5175'

describe('corsHeadersFor', () => {
  it('reflects an allowed Origin back with the full header set', () => {
    const headers = corsHeadersFor(HOST_ORIGIN, [HOST_ORIGIN])
    expect(headers['access-control-allow-origin']).toBe(HOST_ORIGIN)
    expect(headers.vary).toBe('Origin')
    expect(headers['access-control-allow-methods']).toContain('POST')
    expect(headers['access-control-allow-headers']).toBe('content-type')
  })

  it('returns no headers for an Origin not on the allowlist', () => {
    expect(corsHeadersFor('http://evil.example', [HOST_ORIGIN])).toEqual({})
  })

  it('returns no headers when the request carries no Origin', () => {
    expect(corsHeadersFor(null, [HOST_ORIGIN])).toEqual({})
  })

  it('is closed by default — an empty allowlist grants nothing', () => {
    expect(corsHeadersFor(HOST_ORIGIN, [])).toEqual({})
  })
})

describe('createCorsPolicy', () => {
  it('answers isAllowed from the configured allowlist', () => {
    const policy = createCorsPolicy({ allowedOrigins: [HOST_ORIGIN] })
    expect(policy.isAllowed(HOST_ORIGIN)).toBe(true)
    expect(policy.isAllowed('http://other.example')).toBe(false)
    expect(policy.isAllowed(null)).toBe(false)
  })
})
