import type { ListDirectoryFailureReason, ReadFileFailureReason } from '../services/filesystem'
import type { PreviewFailureReason } from '../services/preview'

// One mapping from a service failure reason to its HTTP shape, shared by every
// route that can hit the same reasons — the one-guard half of
// `one-descriptor-one-wrapper-one-guard`, in route form.
export function failureStatusAndMessage(
  reason: ListDirectoryFailureReason | ReadFileFailureReason | PreviewFailureReason,
  requestedPath: string,
): { statusCode: 400 | 403 | 404; message: string } {
  switch (reason) {
    case 'outside-root':
      return { statusCode: 400, message: `path escapes the served root: ${requestedPath}` }
    // 403, not 400: the path is well-formed and the entry is really there — the
    // explorer is refusing it. The message says what was refused, why, and that
    // it is a rule rather than a malfunction, because this is the one failure a
    // user meets by clicking something the tree showed them.
    case 'symlink-escapes-root':
      return {
        statusCode: 403,
        message:
          `not allowed: "${requestedPath}" is a symlink pointing outside the served root. ` +
          'The explorer only opens what lives inside the root it was given, so its target ' +
          'is not listed, previewed, or opened.',
      }
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
