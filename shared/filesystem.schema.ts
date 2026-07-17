import { z } from 'zod/v4'

// Shared seam schema (ADR-0013): the Elysia route validates responses with
// these, and the client parses fetched payloads through the very same objects.

export const EntryKindSchema = z.enum(['directory', 'file', 'other'])
export type EntryKind = z.infer<typeof EntryKindSchema>

export const DirectoryEntrySchema = z.object({
  name: z.string().describe('Entry basename within its parent directory.'),
  kind: EntryKindSchema.default('file').describe(
    'What the entry is after following symlinks. `other` covers sockets, FIFOs, and broken links.',
  ),
  sizeBytes: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .default(null)
    .describe('File size in bytes. Null for directories and `other` entries.'),
  childCount: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .default(null)
    .describe('Number of entries inside a directory. Null for files and unreadable directories.'),
  isExecutable: z.boolean().default(false).describe('True when any execute bit is set on a file.'),
  isHidden: z.boolean().default(false).describe('True for dot-files.'),
  isSymlink: z.boolean().default(false).describe('True when the entry itself is a symlink.'),
  isGitignored: z
    .boolean()
    .default(false)
    .describe(
      'True when a `.gitignore` rule between the served root and the entry excludes it ' +
        '(the `.git` directory itself counts as ignored).',
    ),
})
export type DirectoryEntry = z.infer<typeof DirectoryEntrySchema>

export const DirectoryListingSchema = z.object({
  rootPath: z.string().describe('Absolute path of the served root on the local machine.'),
  relativePath: z
    .string()
    .describe('Listed directory, relative to the served root. Empty string for the root itself.'),
  entries: z.array(DirectoryEntrySchema).default([]).describe('Directory entries, unsorted.'),
})
export type DirectoryListing = z.infer<typeof DirectoryListingSchema>

export const ListDirectoryQuerySchema = z.object({
  path: z
    .string()
    .default('')
    .describe('Directory to list, relative to the served root. Defaults to the root itself.'),
})
export type ListDirectoryQuery = z.infer<typeof ListDirectoryQuerySchema>

export const ReadFileQuerySchema = z.object({
  path: z
    .string()
    .default('')
    .describe('File to serve, relative to the served root.'),
})
export type ReadFileQuery = z.infer<typeof ReadFileQuerySchema>

export const FilesystemErrorSchema = z.object({
  error: z.string().describe('Human-readable reason the listing failed.'),
})
export type FilesystemError = z.infer<typeof FilesystemErrorSchema>
