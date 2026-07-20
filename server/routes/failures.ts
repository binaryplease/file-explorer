import type { ListDirectoryFailureReason, ReadFileFailureReason } from '../services/filesystem'
import type { PreviewFailureReason } from '../services/preview'

// One mapping from a service failure reason to its HTTP shape, shared by every
// route that can hit the same reasons (ADR-0026's one-guard rule, in route form).
export function failureStatusAndMessage(
  reason: ListDirectoryFailureReason | ReadFileFailureReason | PreviewFailureReason,
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
