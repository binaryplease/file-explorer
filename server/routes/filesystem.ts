import { Elysia } from 'elysia'
import { config } from '../config'
import { createFilesystemService } from '../services/filesystem'
import {
  DirectoryListingSchema,
  FilesystemErrorSchema,
  ListDirectoryQuerySchema,
  ReadFileQuerySchema,
} from '../../shared/filesystem.schema'
import { SearchSubtreeQuerySchema, SearchSubtreeResultSchema } from '../../shared/search.schema'
import type { ListDirectoryFailureReason, ReadFileFailureReason } from '../services/filesystem'

// Created at startup so a bad EXPLORER_ROOT crashes the boot, not a request.
const filesystemService = createFilesystemService({ rootAbsolutePath: config.EXPLORER_ROOT })

function failureStatusAndMessage(
  reason: ListDirectoryFailureReason | ReadFileFailureReason,
  requestedPath: string,
): { statusCode: 400 | 403 | 404; message: string } {
  switch (reason) {
    case 'outside-root':
      return { statusCode: 400, message: `path escapes the served root: ${requestedPath}` }
    case 'not-a-directory':
      return { statusCode: 400, message: `not a directory: ${requestedPath}` }
    case 'not-a-file':
      return { statusCode: 400, message: `not a file: ${requestedPath}` }
    case 'not-found':
      return { statusCode: 404, message: `no such entry: ${requestedPath}` }
    case 'not-readable':
      return { statusCode: 403, message: `entry is not readable: ${requestedPath}` }
  }
}

export const filesystemRoutes = new Elysia().get(
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
        '(`EXPLORER_ROOT`, defaulting to the home directory of the user running the server). ' +
        'Paths that lexically escape the root are rejected with 400.',
    },
  },
).get(
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
        "re-engineered from broot's search-driven tree builder: a breadth-first walk gathers up " +
        'to 10× `limit` scored matches within a ~900ms budget, then trims to the best-scoring ' +
        '`limit` matches plus the ancestor directories connecting them to the searched root. ' +
        'Hidden (dot) and gitignored entries are pruned unless the corresponding toggle is set. ' +
        'Aborting the request cancels the walk.',
    },
  },
).get(
  '/api/fs/raw',
  async ({ query, status }) => {
    const result = await filesystemService.resolveFile(query.path)
    if (!result.ok) {
      const { statusCode, message } = failureStatusAndMessage(result.reason, query.path)
      return status(statusCode, { error: message })
    }
    // Bun.file streams the bytes and infers the content type from the
    // extension. The explorer's "open" is a same-tab navigation to this URL
    // (browser back returns to the tree).
    return Bun.file(result.absolutePath)
  },
  {
    query: ReadFileQuerySchema,
    detail: {
      tags: ['filesystem'],
      summary: 'Serve a file',
      description:
        'Streams one file of the served filesystem, relative to the served root, with a ' +
        'content type inferred from the extension. The client opens files in place by ' +
        'navigating to this URL in the same tab. Paths that lexically escape the root are ' +
        'rejected with 400.',
    },
  },
)
