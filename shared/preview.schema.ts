import { z } from 'zod'
import { DirectoryEntrySchema } from './filesystem.schema'

// Shared seam schema (ADR-0013) for the preview panel: the Elysia route
// validates its response with these, and the client parses the payload through
// the very same objects.

export const PreviewKindSchema = z.enum([
  'text',
  'image',
  'binary',
  'empty',
  'too-large',
  'directory',
  // A symlink leaving the served root. Not an error: the entry exists and the
  // panel can describe it honestly ("out of bounds") without reading anything
  // through it — the same contract as `empty` or `binary`.
  'blocked',
  'unsupported',
])
export type PreviewKind = z.infer<typeof PreviewKindSchema>

export const PreviewLineSchema = z.object({
  number: z.number().int().positive().describe('1-based line number within the file.'),
  text: z
    .string()
    .default('')
    .describe('Line content, tabs expanded, clipped to a bounded display width.'),
})
export type PreviewLine = z.infer<typeof PreviewLineSchema>

export const DirectorySummarySchema = z.object({
  entryCount: z.number().int().nonnegative().default(0).describe('Direct children, all kinds.'),
  directoryCount: z.number().int().nonnegative().default(0).describe('Direct child directories.'),
  fileCount: z.number().int().nonnegative().default(0).describe('Direct child regular files.'),
  otherCount: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe('Direct children that are neither file nor directory (sockets, broken links).'),
  hiddenCount: z.number().int().nonnegative().default(0).describe('Direct children that are dot-files.'),
  gitignoredCount: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe('Direct children excluded by a `.gitignore` rule.'),
  directFileBytes: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe(
      'Summed size of the direct child files only — never a recursive walk, so the summary ' +
        'costs nothing beyond the listing that produced it.',
    ),
  largestEntries: z
    .array(DirectoryEntrySchema)
    .default([])
    .describe('The few largest direct child files, largest first.'),
})
export type DirectorySummary = z.infer<typeof DirectorySummarySchema>

export const PreviewSchema = z.object({
  path: z.string().default('').describe('Previewed entry, relative to the served root.'),
  name: z.string().default('').describe('Basename of the previewed entry.'),
  kind: PreviewKindSchema.default('unsupported').describe(
    'What the panel should render: file head text, an image, or a marker explaining why ' +
      'there is no content to show.',
  ),
  sizeBytes: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .default(null)
    .describe('File size in bytes. Null for directories and unsupported entries.'),
  lines: z
    .array(PreviewLineSchema)
    .default([])
    .describe('Head lines of a text file. Empty for every other kind.'),
  isTruncated: z
    .boolean()
    .default(false)
    .describe('True when the file continues past the bounded head that was read.'),
  totalLineCount: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .default(null)
    .describe('Total lines in the file, known only when the whole file fit in the bounded read.'),
  imageUrlPath: z
    .string()
    .nullable()
    .default(null)
    .describe('URL the client should load the image bytes from. Null for every other kind.'),
  directory: DirectorySummarySchema.nullable()
    .default(null)
    .describe('Directory summary. Null for files.'),
  note: z
    .string()
    .nullable()
    .default(null)
    .describe('Human-readable explanation of a marker kind (binary, too-large, unsupported).'),
})
export type Preview = z.infer<typeof PreviewSchema>

export const PreviewQuerySchema = z.object({
  path: z
    .string()
    .default('')
    .describe('Entry to preview, relative to the served root. Defaults to the root itself.'),
})
export type PreviewQuery = z.infer<typeof PreviewQuerySchema>
