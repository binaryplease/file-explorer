import { z } from 'zod/v4'
import { DirectoryEntrySchema } from './filesystem.schema'

// Shared seam schema (ADR-0013) for the preview panel: the Elysia route
// validates its response with these, and the client parses the payload through
// the very same objects.

export const PreviewKindSchema = z.enum([
  'text',
  'image',
  // Time-based media the browser plays inline off `/api/fs/raw` — an `<audio>`
  // or `<video>` element, not bytes dumped into the panel. Like `image`, the
  // whole file is fetched (progressively, via Range) rather than head-read.
  'audio',
  'video',
  // A PDF the browser renders inline in an `<iframe>` off `/api/fs/raw` (served
  // with an `inline` disposition and `application/pdf`, unlike every other raw
  // byte). Like `image`, the whole file is fetched rather than head-read.
  'pdf',
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
    .describe(
      'Line content verbatim, tabs expanded and the carriage return stripped. Never clipped: a ' +
        'line is returned whole or not at all, so what the panel shows is what the file says.',
    ),
})
export type PreviewLine = z.infer<typeof PreviewLineSchema>

// Which budget stopped the read short, so the panel can name it rather than
// saying "there is more" and leaving the reader to guess how much.
export const PreviewTruncationReasonSchema = z.enum(['byte-budget', 'line-budget'])
export type PreviewTruncationReason = z.infer<typeof PreviewTruncationReasonSchema>

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
  language: z
    .string()
    .default('txt')
    .describe(
      'Shiki grammar hint for syntax-highlighting a text preview, derived from the path ' +
        "(shared/language.ts). 'txt' — the default — for every non-text kind and for text " +
        'whose extension has no known grammar; the client renders those as plain text.',
    ),
  isTruncated: z
    .boolean()
    .default(false)
    .describe('True when the file continues past the window that was read.'),
  truncationReason: PreviewTruncationReasonSchema.nullable()
    .default(null)
    .describe(
      'Which budget stopped the read: the byte budget for the window, or the line budget. Null ' +
        'when nothing was cut. The panel names it in its truncation notice.',
    ),
  bytesShown: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe(
      'Bytes of the file the returned lines account for — the exact numerator of "showing X of ' +
        'sizeBytes". 0 for every non-text kind.',
    ),
  totalLineCount: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .default(null)
    .describe('Total lines in the file, known only when the whole file fit in the window read.'),
  mediaUrlPath: z
    .string()
    .nullable()
    .default(null)
    .describe(
      'URL the client should load the raw media bytes from, for the image, audio, video and ' +
        'pdf kinds. Null for every other kind.',
    ),
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
  fullText: z
    .stringbool()
    .default(false)
    .describe(
      'Read the whole text file, up to the far larger full-read ceiling, instead of the cheap ' +
        'first window. The reader opts into this from the truncation notice, so navigating the ' +
        'tree never pays for it — a 40 GB log still costs one window read per selection.',
    ),
})
export type PreviewQuery = z.infer<typeof PreviewQuerySchema>
