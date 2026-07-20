import {
  DirectoryListingSchema,
  FilesystemErrorSchema,
  OpenFileResultSchema,
  type DirectoryListing,
  type OpenFileResult,
} from '../../shared/filesystem.schema'
import { PreviewSchema, type Preview } from '../../shared/preview.schema'
import { SearchSubtreeResultSchema, type SearchSubtreeResult } from '../../shared/search.schema'
import { withApiBase } from './apiBase'

// The client-side seam to the server: fetch and parse through the same Zod
// schemas the routes validate with (ADR-0013).
//
// Every request is built from a `baseUrl` the caller threads in (from
// `useApiBase()`): '' keeps the request same-origin (the standalone app), an
// absolute origin points it at a separately-running explorer server (the
// embedded surface). The base is a parameter, not a module global, so the
// functions stay pure and testable and two mounts could target two servers.

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
  baseUrl: string,
  relativePath: string,
): Promise<OpenFileResult> {
  const response = await fetch(withApiBase(baseUrl, '/api/fs/open'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: relativePath }),
  })
  if (!response.ok) return parseErrorResponse(response, 'open')
  return OpenFileResultSchema.parse(await response.json())
}

export async function fetchDirectoryListing(
  baseUrl: string,
  relativePath: string,
): Promise<DirectoryListing> {
  const response = await fetch(
    withApiBase(baseUrl, `/api/fs/list?path=${encodeURIComponent(relativePath)}`),
  )
  if (!response.ok) return parseErrorResponse(response, 'listing')
  return DirectoryListingSchema.parse(await response.json())
}

// Preview is enrichment, not navigation: the caller fires it after the tree has
// painted and aborts it the moment the selection moves on.
export async function fetchPreview(
  baseUrl: string,
  relativePath: string,
  abortSignal: AbortSignal,
): Promise<Preview> {
  const response = await fetch(
    withApiBase(baseUrl, `/api/fs/preview?path=${encodeURIComponent(relativePath)}`),
    { signal: abortSignal },
  )
  if (!response.ok) return parseErrorResponse(response, 'preview')
  return PreviewSchema.parse(await response.json())
}

export type SearchRequestOptions = {
  baseUrl: string
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
  const response = await fetch(
    withApiBase(options.baseUrl, `/api/fs/search?${searchParams.toString()}`),
    { signal: options.abortSignal },
  )
  if (!response.ok) return parseErrorResponse(response, 'search')
  return SearchSubtreeResultSchema.parse(await response.json())
}
