import { Elysia } from 'elysia'
import { FilesystemErrorSchema } from '../../shared/filesystem.schema'
import { PreviewQuerySchema, PreviewSchema } from '../../shared/preview.schema'
import { previewService } from '../services/instances'
import { failureStatusAndMessage } from './failures'

export const previewRoutes = new Elysia().get(
  '/api/fs/preview',
  async ({ query, status }) => {
    const result = await previewService.previewEntry(query.path)
    if (!result.ok) {
      const { statusCode, message } = failureStatusAndMessage(result.reason, query.path)
      return status(statusCode, { error: message })
    }
    return result.preview
  },
  {
    query: PreviewQuerySchema,
    response: {
      200: PreviewSchema,
      400: FilesystemErrorSchema,
      403: FilesystemErrorSchema,
      404: FilesystemErrorSchema,
    },
    detail: {
      tags: ['filesystem'],
      summary: 'Preview an entry',
      description:
        'Returns a bounded preview of one entry of the served filesystem: the head of a text ' +
        'file (at most 128 KiB read, 600 lines returned), a URL for a small enough image, a ' +
        'summary of a directory built from its own listing (never a recursive walk), or a ' +
        'marker explaining why there is nothing to show — `binary`, `too-large`, `empty`, ' +
        '`unsupported`. Reads are bounded regardless of file size, so previewing a 40 GB log ' +
        'costs the same as previewing a 4 KB one. Paths that escape the root — lexically, or ' +
        'through a symlink pointing outside it — are rejected with 400.',
    },
  },
)
