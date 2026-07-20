import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Elysia } from 'elysia'
import { createFilesystemService } from '../services/filesystem'
import { attachmentDispositionFor, createFilesystemRoutes } from './filesystem'

// A served root holding exactly the file kinds that made `GET /api/fs/raw`
// dangerous: markup the browser would happily execute if it were allowed to
// render it as a document in the explorer's own origin.
let servedRoot: string
let application: ReturnType<typeof createHardenedApplication>

beforeAll(async () => {
  servedRoot = await realpath(await mkdtemp(join(tmpdir(), 'binp-fex-raw-headers-')))
  await mkdir(servedRoot, { recursive: true })
  await writeFile(
    join(servedRoot, 'evil.html'),
    '<script>fetch("/api/fs/list?path=/").then((response) => response.text())</script>',
  )
  await writeFile(
    join(servedRoot, 'evil.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  )
  // A one-pixel GIF: the preview panel's happy path, and the load that must
  // keep working after the hardening.
  await writeFile(
    join(servedRoot, 'pixel.gif'),
    Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
  )
  await writeFile(join(servedRoot, 'quote"and\\slash.txt'), 'awkward name')
  await writeFile(join(servedRoot, 'rapport-café.txt'), 'non-ascii name')

  application = createHardenedApplication(servedRoot)
})

// The routed instance carries its route table in its type, so it is named by
// inference rather than by the bare `Elysia` annotation.
function createHardenedApplication(rootAbsolutePath: string) {
  return new Elysia().use(
    createFilesystemRoutes({
      filesystemService: createFilesystemService({ rootAbsolutePath }),
    }),
  )
}

afterAll(async () => {
  await rm(servedRoot, { recursive: true, force: true })
})

function requestRaw(relativePath: string): Promise<Response> {
  return application.handle(
    new Request(`http://localhost/api/fs/raw?path=${encodeURIComponent(relativePath)}`),
  )
}

describe('GET /api/fs/raw hardening', () => {
  test('serves executable markup as a non-renderable attachment', async () => {
    const response = await requestRaw('evil.html')

    expect(response.status).toBe(200)
    // The three headers that, together, stop the file becoming a same-origin
    // document with script access to the rest of the read API.
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Content-Security-Policy')).toBe("sandbox; default-src 'none'")
    expect(response.headers.get('Content-Disposition')).toStartWith('attachment;')
    // Never `inline` — that is the disposition that renders.
    expect(response.headers.get('Content-Disposition')).not.toContain('inline')
    // Still the real bytes, unmodified: this is a byte-serving endpoint.
    expect(await response.text()).toContain('<script>')
  })

  test('applies the same hardening to SVG', async () => {
    const response = await requestRaw('evil.svg')

    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Content-Security-Policy')).toBe("sandbox; default-src 'none'")
    expect(response.headers.get('Content-Disposition')).toStartWith('attachment;')
  })

  test('keeps the extension-inferred content type and streams the body', async () => {
    const response = await requestRaw('pixel.gif')

    // `<img src>` needs a usable image content type; nosniff makes the inferred
    // type binding, so losing it here would break the preview panel.
    expect(response.headers.get('Content-Type')).toContain('image/gif')
    // A body that is still a stream, not a buffered string.
    expect(response.body).not.toBeNull()
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0)
  })

  test('carries the entry basename in the disposition filename', async () => {
    const response = await requestRaw('evil.html')

    expect(response.headers.get('Content-Disposition')).toContain('filename="evil.html"')
  })
})

describe('attachmentDispositionFor', () => {
  test('escapes quotes and backslashes in the quoted form', () => {
    expect(attachmentDispositionFor('quote"and\\slash.txt')).toContain(
      'filename="quote\\"and\\\\slash.txt"',
    )
  })

  test('carries non-ASCII names in the RFC 5987 form and degrades the fallback', () => {
    const disposition = attachmentDispositionFor('rapport-café.txt')

    expect(disposition).toContain('filename="rapport-caf_.txt"')
    expect(disposition).toContain("filename*=UTF-8''rapport-caf%C3%A9.txt")
  })

  test('drops control characters so a crafted name cannot inject a header', () => {
    const disposition = attachmentDispositionFor('inject\r\nX-Evil: yes.txt')

    expect(disposition).not.toContain('\r')
    expect(disposition).not.toContain('\n')
    expect(disposition).toContain('filename="injectX-Evil: yes.txt"')
  })
})
