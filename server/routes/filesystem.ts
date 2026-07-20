import { Elysia } from 'elysia'
import { basename } from 'node:path'
import { Readable } from 'node:stream'
import type { FilesystemService } from '../services/filesystem'
import { failureStatusAndMessage } from './failures'
import {
  DirectoryListingSchema,
  FilesystemErrorSchema,
  ListDirectoryQuerySchema,
  OpenFileRequestSchema,
  OpenFileResultSchema,
  ReadFileQuerySchema,
} from '../../shared/filesystem.schema'
import { SearchSubtreeQuerySchema, SearchSubtreeResultSchema } from '../../shared/search.schema'

// Confinement is configurable (`EXPLORER_CONFINE`, off by default for
// local-machine use), and every endpoint's escape behaviour follows it. Said
// once here rather than four times below.
const CONFINEMENT_NOTE =
  'When confinement is enabled (`EXPLORER_CONFINE`), paths that escape the served root — ' +
  'lexically, or through a symlink pointing outside it — are rejected with 400/403. ' +
  'Unconfined (the default for local-machine use) the root is only the starting anchor: ' +
  'absolute paths outside it resolve, and `path` may itself be absolute.'

// --- Raw-response hardening ---
//
// `GET /api/fs/raw` serves arbitrary bytes from the filesystem with a
// content type inferred from the extension. Left alone, an `.html` or `.svg`
// file inside the served tree becomes a *document in the explorer's own
// origin* when navigated to directly, and its script can then call the rest of
// the read API same-origin (no CORS to stop it) and exfiltrate anything the
// server can read — the whole filesystem in the default unconfined mode.
//
// Three headers close that, and all three are kept because they fail
// independently:
//
//   - `X-Content-Type-Options: nosniff` — the extension-derived type is the
//     final word; a text file whose bytes look like markup cannot be
//     re-classified into something renderable.
//   - `Content-Disposition: attachment` — the decisive one. Disposition is
//     consulted only for *navigation* responses (Fetch's "process response end
//     of body" / the download check), so it turns direct navigation into a
//     download while leaving subresource loads untouched: `<img src>` never
//     looks at this header, which is why the preview panel keeps rendering.
//     That asymmetry is exactly the split we want — the preview path is a
//     subresource, the attack path is a navigation.
//   - `Content-Security-Policy: sandbox; default-src 'none'` — defence in
//     depth for any context that renders the bytes anyway (a browser ignoring
//     disposition, an iframe embed added later). `sandbox` with no
//     `allow-scripts`/`allow-same-origin` drops the document into an opaque
//     origin with scripting off, so even a rendered HTML/SVG file has no
//     origin to attack from. A resource's own CSP does not govern the page
//     embedding it, so this cannot affect `<img>` rendering either.
const RAW_RESPONSE_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "sandbox; default-src 'none'",
} as const

// `filename="..."` carries the basename for the download. Quotes, backslashes
// and control characters (a newline would let a crafted name inject a header)
// are stripped or escaped; the RFC 5987 `filename*` form carries the exact
// name for non-ASCII basenames, which the bare `filename` cannot express.
export function attachmentDispositionFor(entryBasename: string): string {
  const isControlCharacter = (character: string) => {
    const characterCode = character.charCodeAt(0)
    return characterCode < 32 || characterCode === 127
  }
  const withoutControlCharacters = Array.from(entryBasename).filter(
    (character) => !isControlCharacter(character),
  )
  const quotedAsciiFallback = withoutControlCharacters
    .map((character) => {
      if (character.charCodeAt(0) > 126) return '_'
      if (character === '"' || character === '\\') return `\\${character}`
      return character
    })
    .join('')
  const exactName = withoutControlCharacters.join('')
  return `attachment; filename="${quotedAsciiFallback}"; filename*=UTF-8''${encodeURIComponent(exactName)}`
}

// Factory per ADR-0007, and the seam a host app mounts: the routes take their
// filesystem service as an argument instead of importing the process-wide
// singleton, so `app.use(createFilesystemRoutes({ filesystemService }))` can
// anchor a plugin instance at any root without reconstructing the server.
// `server/index.ts` passes the config-wired singleton; standalone behaviour is
// unchanged.
export function createFilesystemRoutes(options: { filesystemService: FilesystemService }) {
  const { filesystemService } = options

  return new Elysia()
    .get(
      '/api/fs/list',
      async ({ query, status }) => {
        const result = await filesystemService.listDirectory(query.path)
        if (!result.ok) {
          const { statusCode, message } = failureStatusAndMessage(result.reason, query.path)
          return status(statusCode, { error: message })
        }
        return result.listing
      },
      {
        query: ListDirectoryQuerySchema,
        response: {
          200: DirectoryListingSchema,
          400: FilesystemErrorSchema,
          403: FilesystemErrorSchema,
          404: FilesystemErrorSchema,
        },
        detail: {
          tags: ['filesystem'],
          summary: 'List a directory',
          description:
            'Lists one directory of the served filesystem, relative to the served root ' +
            '(`EXPLORER_ROOT`, defaulting to the home directory of the user running the ' +
            `server). ${CONFINEMENT_NOTE}`,
        },
      },
    )
    .get(
      '/api/fs/search',
      async ({ query, request, status }) => {
        const result = await filesystemService.searchSubtree(query.path, {
          pattern: query.pattern,
          showHidden: query.showHidden,
          showGitignored: query.showGitignored,
          limit: query.limit,
          // Typing a new character aborts the previous request; the walk stops
          // with it (broot's Dam, in HTTP form).
          abortSignal: request.signal,
        })
        if (!result.ok) {
          const { statusCode, message } = failureStatusAndMessage(result.reason, query.path)
          return status(statusCode, { error: message })
        }
        return result.result
      },
      {
        query: SearchSubtreeQuerySchema,
        response: {
          200: SearchSubtreeResultSchema,
          400: FilesystemErrorSchema,
          403: FilesystemErrorSchema,
          404: FilesystemErrorSchema,
        },
        detail: {
          tags: ['filesystem'],
          summary: 'Fuzzy-search a subtree',
          description:
            'Recursively fuzzy-searches entry names under a directory of the served filesystem, ' +
            "re-engineered from broot's search-driven tree builder: a breadth-first walk gathers " +
            'up to 10× `limit` scored matches within a ~900ms budget, then trims to the ' +
            'best-scoring `limit` matches plus the ancestor directories connecting them to the ' +
            'searched root. Hidden (dot) and gitignored entries are pruned unless the ' +
            'corresponding toggle is set. Aborting the request cancels the walk.',
        },
      },
    )
    .get(
      '/api/fs/raw',
      async ({ query, status }) => {
        const result = await filesystemService.openReadableFile(query.path)
        if (!result.ok) {
          const { statusCode, message } = failureStatusAndMessage(result.reason, query.path)
          return status(statusCode, { error: message })
        }
        const rawResponseHeaders = {
          ...RAW_RESPONSE_SECURITY_HEADERS,
          'Content-Disposition': attachmentDispositionFor(basename(result.absolutePath)),
        }
        // Unconfined: unchanged. Bun.file streams the bytes and infers the
        // content type from the extension — a raw byte-serving endpoint
        // (download/preview). The explorer's own "open" hands the file to the OS
        // default application via POST /api/fs/open instead.
        //
        // Wrapped in a Response only to attach the hardening headers above; the
        // BunFile is still the body, so the bytes stream and are never buffered.
        // The inferred Content-Type rides along with it untouched.
        if (result.handle === null) {
          return new Response(Bun.file(result.absolutePath), { headers: rawResponseHeaders })
        }
        // Confined: the bytes come from the descriptor whose containment was
        // verified, never from a fresh lookup of the path — so a path component
        // swapped for an escaping symlink after the check cannot change what is
        // served. `Bun.file(fd)` would stream from the descriptor too, but Bun
        // never closes a descriptor it did not open, so it leaks one per
        // request; `createReadStream({ autoClose: true })` closes on both normal
        // end and client abort. Still a stream — no full-file buffering.
        //
        // Content-Type and Content-Length are set explicitly because a
        // descriptor carries neither a name nor, to Bun, a length. The type is
        // the same extension inference as above (`Bun.file(path).type` reads no
        // bytes and never touches the disk), and the length is the fstat of the
        // validated handle.
        return new Response(
          // `node:stream/web`'s ReadableStream and the global one are the same
          // object at runtime but distinct nominal types to TypeScript.
          Readable.toWeb(
            result.handle.createReadStream({ autoClose: true }),
          ) as unknown as ReadableStream<Uint8Array>,
          {
            headers: {
              ...rawResponseHeaders,
              'Content-Type': Bun.file(result.absolutePath).type,
              'Content-Length': String(result.sizeBytes),
            },
          },
        )
      },
      {
        query: ReadFileQuerySchema,
        detail: {
          tags: ['filesystem'],
          summary: 'Serve a file',
          description:
            'Streams one file of the served filesystem, relative to the served root, with a ' +
            'content type inferred from the extension, for download or preview. Served with ' +
            '`X-Content-Type-Options: nosniff`, `Content-Disposition: attachment` and a ' +
            "`Content-Security-Policy: sandbox; default-src 'none'` so that browser-executable " +
            'content (HTML, SVG) downloads instead of rendering as a document in the ' +
            'explorer origin. Subresource loads such as `<img src>` ignore the disposition, ' +
            `so inline image preview is unaffected. ${CONFINEMENT_NOTE}`,
        },
      },
    )
    .post(
      '/api/fs/open',
      async ({ body, status }) => {
        const result = await filesystemService.openFile(body.path)
        if (!result.ok) {
          if (result.reason === 'open-failed') {
            return status(500, {
              error: `failed to open with the default application: ${body.path}`,
            })
          }
          const { statusCode, message } = failureStatusAndMessage(result.reason, body.path)
          return status(statusCode, { error: message })
        }
        return { opened: true, path: result.relativePath }
      },
      {
        body: OpenFileRequestSchema,
        response: {
          200: OpenFileResultSchema,
          400: FilesystemErrorSchema,
          403: FilesystemErrorSchema,
          404: FilesystemErrorSchema,
          500: FilesystemErrorSchema,
        },
        detail: {
          tags: ['filesystem'],
          summary: 'Open a file with the OS default application',
          description:
            'Opens one file of the served filesystem with the operating system default ' +
            'application on the machine hosting the explorer (the desktop double-click ' +
            'gesture). The explorer is a local-only, loopback tool, so that machine is the ' +
            `user running it. ${CONFINEMENT_NOTE} A launcher that cannot be spawned yields 500.`,
        },
      },
    )
}
