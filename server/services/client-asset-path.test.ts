import { describe, expect, test } from 'bun:test'
import { resolveClientAssetPath } from './client-asset-path'

const CLIENT_DIRECTORY = '/srv/app/dist/client'

function assetPathFor(requestPath: string): string | null {
  return resolveClientAssetPath({
    requestUrl: `http://localhost:3000${requestPath}`,
    clientDirectory: CLIENT_DIRECTORY,
  })
}

describe('ordinary asset requests resolve inside the client directory', () => {
  test('a plain asset path', () => {
    expect(assetPathFor('/assets/index-abc123.js')).toBe(
      `${CLIENT_DIRECTORY}/assets/index-abc123.js`,
    )
  })

  test('percent-encoded names are decoded', () => {
    expect(assetPathFor('/assets/my%20file.css')).toBe(`${CLIENT_DIRECTORY}/assets/my file.css`)
  })

  test('the root path resolves to the directory itself', () => {
    expect(assetPathFor('/')).toBe(CLIENT_DIRECTORY)
  })

  test('the query string is not part of the path', () => {
    expect(assetPathFor('/favicon.ico?v=2')).toBe(`${CLIENT_DIRECTORY}/favicon.ico`)
  })
})

// The finding: decodeURIComponent threw URIError straight out of the handler.
describe('malformed percent-encoding yields the SPA fallback, never a throw', () => {
  test('a lone percent does not throw', () => {
    expect(() => assetPathFor('/%')).not.toThrow()
    expect(assetPathFor('/%')).toBeNull()
  })

  test('every malformed escape shape returns null', () => {
    for (const requestPath of ['/%', '/%zz', '/%e0%a4', '/a/%/b', '/%c0%80', '/%FF']) {
      expect(assetPathFor(requestPath)).toBeNull()
    }
  })
})

describe('containment survives decoding', () => {
  // The WHATWG URL parser collapses `..` segments (and `%2e%2e`, which it
  // decodes first) while parsing, so these never reach the resolver as
  // traversal — they arrive already flattened to an in-tree path that simply
  // does not exist, and the caller falls back to index.html.
  test('dot segments are flattened by URL parsing, landing inside the tree', () => {
    expect(assetPathFor('/../../etc/passwd')).toBe(`${CLIENT_DIRECTORY}/etc/passwd`)
    expect(assetPathFor('/%2e%2e/%2e%2e/etc/passwd')).toBe(`${CLIENT_DIRECTORY}/etc/passwd`)
    expect(assetPathFor('/../client-secrets/keys.json')).toBe(
      `${CLIENT_DIRECTORY}/client-secrets/keys.json`,
    )
  })

  // `%2f` is NOT a path separator to the URL parser, so the `..` segments only
  // become segments after decodeURIComponent — this is the case the containment
  // check has to catch on its own, and the reason it runs on the decoded path.
  test('traversal smuggled through %2f is refused after decoding', () => {
    expect(assetPathFor('/assets/..%2f..%2f..%2fetc%2fpasswd')).toBeNull()
    expect(assetPathFor('/..%2f..%2f..%2f..%2fetc%2fshadow')).toBeNull()
  })

  // `/srv/app/dist/client-secrets` must not pass a naive prefix check.
  test('a sibling directory sharing the name prefix is refused', () => {
    expect(assetPathFor('/..%2fclient-secrets%2fkeys.json')).toBeNull()
  })

  test('traversal that comes back inside is fine', () => {
    expect(assetPathFor('/assets/..%2findex.html')).toBe(`${CLIENT_DIRECTORY}/index.html`)
  })
})
