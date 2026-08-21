import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { mkdtemp, mkdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
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
  servedRoot = await realpath(await mkdtemp(join(tmpdir(), 'bfe-raw-headers-')))
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
  // A PDF: the one raw byte served `inline` for the preview iframe, so it must
  // NOT carry the attachment/sandbox hardening the markup files above do.
  await writeFile(
    join(servedRoot, 'report.pdf'),
    Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1'),
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

  test('serves a PDF inline so the preview iframe renders it', async () => {
    const response = await requestRaw('report.pdf')

    expect(response.status).toBe(200)
    // `nosniff` stays load-bearing: it forbids the bytes being re-interpreted as
    // anything but `application/pdf`, which is what makes inline serving safe.
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Content-Type')).toContain('application/pdf')
    // Inline — the disposition that lets the `<iframe>` render instead of
    // downloading — and never the `sandbox` that would blank the viewer.
    expect(response.headers.get('Content-Disposition')).toStartWith('inline;')
    expect(response.headers.get('Content-Disposition')).toContain('filename="report.pdf"')
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'")
    expect(response.headers.get('Content-Security-Policy')).not.toContain('sandbox')
  })
})

// The confined-mode check/use gap: `resolveFile` verified containment and
// handed back a *path string*, which the raw route then re-opened. An attacker
// with write access to the served tree could swap a path component for a
// symlink pointing out of the root in between, so the bytes served came from
// the escaping target rather than from the entry that passed the check. The
// endpoint now serves the descriptor it validated, so the swap has nothing left
// to poison.
describe('GET /api/fs/raw confined-mode check/use gap', () => {
  let confinedRoot: string
  let outsideRoot: string
  let confinedApplication: ReturnType<typeof createHardenedApplication>

  beforeAll(async () => {
    const temporaryParent = await realpath(await mkdtemp(join(tmpdir(), 'bfe-toctou-')))
    confinedRoot = join(temporaryParent, 'served')
    outsideRoot = join(temporaryParent, 'outside')
    await mkdir(join(confinedRoot, 'swappable'), { recursive: true })
    await mkdir(outsideRoot, { recursive: true })
    await writeFile(join(confinedRoot, 'swappable', 'note.txt'), 'INSIDE CONTENT')
    await writeFile(join(outsideRoot, 'note.txt'), 'OUTSIDE SECRET')
    await writeFile(join(outsideRoot, 'target.txt'), 'OUTSIDE SECRET')
    await symlink(join(outsideRoot, 'target.txt'), join(confinedRoot, 'escaping-link.txt'))
    confinedApplication = createHardenedApplication(confinedRoot)
  })

  afterAll(async () => {
    await rm(join(confinedRoot, '..'), { recursive: true, force: true })
  })

  function requestConfinedRaw(relativePath: string): Promise<Response> {
    return confinedApplication.handle(
      new Request(`http://localhost/api/fs/raw?path=${encodeURIComponent(relativePath)}`),
    )
  }

  test('serves the checked bytes when a path component is swapped after the check', async () => {
    // The response resolves — the descriptor is open and verified — but its body
    // has not been read yet. This is exactly the window the old code lost.
    const response = await requestConfinedRaw('swappable/note.txt')
    expect(response.status).toBe(200)

    // The swap: the directory that was walked is replaced by a symlink out of
    // the served root, so `swappable/note.txt` now names `outside/note.txt`.
    await rename(join(confinedRoot, 'swappable'), join(confinedRoot, 'swappable.real'))
    await symlink(outsideRoot, join(confinedRoot, 'swappable'))
    try {
      // Re-opening by path at this point would serve the out-of-confinement file.
      expect(await realpath(join(confinedRoot, 'swappable', 'note.txt'))).toBe(
        join(outsideRoot, 'note.txt'),
      )
      // The descriptor is what is streamed, so the bytes are still the ones that
      // passed containment.
      expect(await response.text()).toBe('INSIDE CONTENT')
    } finally {
      // Restore even on failure, so one broken assertion cannot cascade into
      // every later test in this block.
      await rm(join(confinedRoot, 'swappable'))
      await rename(join(confinedRoot, 'swappable.real'), join(confinedRoot, 'swappable'))
    }
  })

  test('refuses a symlink whose target leaves the root', async () => {
    const response = await requestConfinedRaw('escaping-link.txt')

    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain('OUTSIDE SECRET')
  })

  test('keeps the streamed body, inferred type and length of a contained file', async () => {
    const response = await requestConfinedRaw('swappable/note.txt')

    expect(response.headers.get('Content-Type')).toContain('text/plain')
    expect(response.headers.get('Content-Length')).toBe(String('INSIDE CONTENT'.length))
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Content-Disposition')).toContain('filename="note.txt"')
    expect(response.body).not.toBeNull()
    expect(await response.text()).toBe('INSIDE CONTENT')
  })

  test('reports a directory as not-a-file rather than opening it for bytes', async () => {
    const response = await requestConfinedRaw('swappable')

    expect(response.status).toBe(400)
  })

  test('reports a missing entry as not-found', async () => {
    const response = await requestConfinedRaw('nope.txt')

    expect(response.status).toBe(404)
  })

  test('does not leak a descriptor per served request', async () => {
    const descriptorsBefore = openDescriptorCount()
    for (let requestIndex = 0; requestIndex < 20; requestIndex++) {
      await (await requestConfinedRaw('swappable/note.txt')).arrayBuffer()
    }
    // Bun never closes a descriptor it did not open, so streaming a raw
    // `Bun.file(fd)` would leak one per request; the read stream closes it.
    expect(openDescriptorCount()).toBeLessThan(descriptorsBefore + 20)
  })
})

// Descriptors this process holds open, used to catch a per-request leak. Linux
// only; elsewhere the check degrades to a no-op rather than a false failure.
function openDescriptorCount(): number {
  try {
    return readdirSync('/proc/self/fd').length
  } catch {
    return 0
  }
}

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

// The reporting half of the optimization gate in
// `docs/requirements/101-performance-budgets.md`: every listing says what it
// cost, on the response itself, so a budget miss is visible in a browser's
// network panel without restarting the server behind a flag.
describe('GET /api/fs/list reports its own timing', () => {
  function requestListing(relativePath: string): Promise<Response> {
    return application.handle(
      new Request(`http://localhost/api/fs/list?path=${encodeURIComponent(relativePath)}`),
    )
  }

  test('carries a Server-Timing header naming the phases and the syscalls', async () => {
    const response = await requestListing('')
    expect(response.status).toBe(200)
    const serverTiming = response.headers.get('Server-Timing') ?? ''
    for (const metricName of ['list', 'readdir', 'ignore', 'describe']) {
      expect(serverTiming).toMatch(new RegExp(`\\b${metricName};dur=\\d`))
    }
    for (const metricName of ['entries', 'dirs', 'stats', 'childreaddirs', 'realpaths']) {
      expect(serverTiming).toMatch(new RegExp(`\\b${metricName};desc="\\d+"`))
    }
  })

  test('reports the entry count the listing actually returned', async () => {
    const response = await requestListing('')
    const listing = await response.json()
    const entriesMetric = /\bentries;desc="(\d+)"/.exec(
      response.headers.get('Server-Timing') ?? '',
    )
    expect(entriesMetric).not.toBeNull()
    expect(Number(entriesMetric![1])).toBe(listing.entries.length)
  })

  test('a refused listing carries no timing, having done no work to report', async () => {
    const response = await requestListing('../escape')
    expect(response.status).toBe(400)
    expect(response.headers.get('Server-Timing')).toBeNull()
  })

  test('the timing log is off unless a writer is supplied', async () => {
    const loggedLines: string[] = []
    const loggingApplication = new Elysia().use(
      createFilesystemRoutes({
        filesystemService: createFilesystemService({ rootAbsolutePath: servedRoot }),
        listingTimingLog: (line) => loggedLines.push(line),
      }),
    )
    await application.handle(new Request('http://localhost/api/fs/list?path='))
    expect(loggedLines).toHaveLength(0)

    await loggingApplication.handle(new Request('http://localhost/api/fs/list?path='))
    expect(loggedLines).toHaveLength(1)
    expect(loggedLines[0]).toContain('list . ')
    expect(loggedLines[0]).toContain('entries')
  })
})
