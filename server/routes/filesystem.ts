import { Elysia } from 'elysia'
import { config } from '../config'
import { createFilesystemService } from '../services/filesystem'
import {
  DirectoryListingSchema,
  FilesystemErrorSchema,
  ListDirectoryQuerySchema,
} from '../../shared/filesystem.schema'

// Created at startup so a bad EXPLORER_ROOT crashes the boot, not a request.
const filesystemService = createFilesystemService({ rootAbsolutePath: config.EXPLORER_ROOT })

export const filesystemRoutes = new Elysia().get(
  '/api/fs/list',
  async ({ query, status }) => {
    const result = await filesystemService.listDirectory(query.path)
    if (!result.ok) {
      switch (result.reason) {
        case 'outside-root':
          return status(400, { error: `path escapes the served root: ${query.path}` })
        case 'not-a-directory':
          return status(400, { error: `not a directory: ${query.path}` })
        case 'not-found':
          return status(404, { error: `no such directory: ${query.path}` })
        case 'not-readable':
          return status(403, { error: `directory is not readable: ${query.path}` })
      }
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
)
