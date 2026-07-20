import { Elysia } from 'elysia'
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
        const result = await filesystemService.resolveFile(query.path)
        if (!result.ok) {
          const { statusCode, message } = failureStatusAndMessage(result.reason, query.path)
          return status(statusCode, { error: message })
        }
        // Bun.file streams the bytes and infers the content type from the
        // extension — a raw byte-serving endpoint (download/preview). The
        // explorer's own "open" hands the file to the OS default application via
        // POST /api/fs/open instead.
        return Bun.file(result.absolutePath)
      },
      {
        query: ReadFileQuerySchema,
        detail: {
          tags: ['filesystem'],
          summary: 'Serve a file',
          description:
            'Streams one file of the served filesystem, relative to the served root, with a ' +
            'content type inferred from the extension, for download or preview. ' +
            CONFINEMENT_NOTE,
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
