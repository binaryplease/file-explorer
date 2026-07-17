import {
  DirectoryListingSchema,
  FilesystemErrorSchema,
  type DirectoryListing,
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

// URL that serves a file's bytes with a browser-renderable content type.
// "Opening" a file is a same-tab navigation to this URL, so the browser back
// button returns to the tree naturally.
export function rawFileUrl(relativePath: string): string {
  return `/api/fs/raw?path=${encodeURIComponent(relativePath)}`
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
