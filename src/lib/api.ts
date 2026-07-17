import {
  DirectoryListingSchema,
  FilesystemErrorSchema,
  type DirectoryListing,
} from '../../shared/filesystem.schema'

// The one client-side seam to the server: fetch a listing and parse it through
// the same Zod schema the route validates with (ADR-0013).
export async function fetchDirectoryListing(relativePath: string): Promise<DirectoryListing> {
  const response = await fetch(`/api/fs/list?path=${encodeURIComponent(relativePath)}`)
  const payload: unknown = await response.json()
  if (!response.ok) {
    const parsedError = FilesystemErrorSchema.safeParse(payload)
    throw new Error(
      parsedError.success ? parsedError.data.error : `listing failed with status ${response.status}`,
    )
  }
  return DirectoryListingSchema.parse(payload)
}
