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
  escapesRoot: z
    .boolean()
    .default(false)
    .describe(
      'True when the entry is a symlink whose target resolves outside the served root. Such ' +
        'entries are listed rather than hidden, but everything about their target is withheld ' +
        '(kind `other`, null size and child count) and every attempt to list, read, preview, or ' +
        'open them is refused with 403.',
    ),
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
  confined: z
    .boolean()
    .default(true)
    .describe(
      'True when the served root is a security boundary: paths escaping it are refused, so the ' +
        'client must not offer navigation above the root. False when the root is only a display ' +
        'anchor (local-machine unconfined mode) and the parent filesystem is reachable. Defaults ' +
        'to true so a client that cannot read this flag treats the root as a boundary (fail-safe).',
    ),
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

export const OpenFileRequestSchema = z.object({
  path: z
    .string()
    .default('')
    .describe('File to open with the OS default application, relative to the served root.'),
})
export type OpenFileRequest = z.infer<typeof OpenFileRequestSchema>

export const OpenFileResultSchema = z.object({
  opened: z
    .boolean()
    .default(false)
    .describe('True once the OS default-application launcher was spawned for the file.'),
  path: z.string().default('').describe('The opened file, relative to the served root.'),
})
export type OpenFileResult = z.infer<typeof OpenFileResultSchema>

export const FilesystemErrorSchema = z.object({
  error: z.string().describe('Human-readable reason the listing failed.'),
})
export type FilesystemError = z.infer<typeof FilesystemErrorSchema>
