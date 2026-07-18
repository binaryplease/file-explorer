import {
  DirectoryListingSchema,
  FilesystemErrorSchema,
  OpenFileResultSchema,
  type DirectoryListing,
  type OpenFileResult,
} from '../../shared/filesystem.schema'
import { SearchSubtreeResultSchema, type SearchSubtreeResult } from '../../shared/search.schema'

// The client-side seam to the server: fetch and parse through the same Zod
// schemas the routes validate with (ADR-0013).

async function parseErrorResponse(response: Response, fallbackLabel: string): Promise<never> {
  const payload: unknown = await response.json().catch(() => null)
  const parsedError = FilesystemErrorSchema.safeParse(payload)
  throw new Error(
    parsedError.success
      ? parsedError.data.error
      : `${fallbackLabel} failed with status ${response.status}`,
  )
}

// "Opening" a file asks the server to hand it to the OS default application on
// the host machine (a local-only, loopback tool, so that's the user's own
// machine) — the desktop double-click gesture, not an in-browser navigation.
export async function openFileWithDefaultApplication(
  relativePath: string,
): Promise<OpenFileResult> {
  const response = await fetch('/api/fs/open', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: relativePath }),
  })
  if (!response.ok) return parseErrorResponse(response, 'open')
  return OpenFileResultSchema.parse(await response.json())
}

export async function fetchDirectoryListing(relativePath: string): Promise<DirectoryListing> {
  const response = await fetch(`/api/fs/list?path=${encodeURIComponent(relativePath)}`)
  if (!response.ok) return parseErrorResponse(response, 'listing')
  return DirectoryListingSchema.parse(await response.json())
}

export type SearchRequestOptions = {
  relativePath: string
  pattern: string
  showHidden: boolean
  showGitignored: boolean
  limit: number
  abortSignal: AbortSignal
}

export async function fetchSearchResult(options: SearchRequestOptions): Promise<SearchSubtreeResult> {
  const searchParams = new URLSearchParams({
    path: options.relativePath,
    pattern: options.pattern,
    showHidden: String(options.showHidden),
    showGitignored: String(options.showGitignored),
    limit: String(options.limit),
  })
  const response = await fetch(`/api/fs/search?${searchParams.toString()}`, {
    signal: options.abortSignal,
  })
  if (!response.ok) return parseErrorResponse(response, 'search')
  return SearchSubtreeResultSchema.parse(await response.json())
}
