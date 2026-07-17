import { z } from 'zod/v4'
import { DirectoryEntrySchema } from './filesystem.schema'

// Shared seam schema (ADR-0013) for the recursive fuzzy search endpoint. The
// Elysia route validates with these and the client parses through them.

export const SearchNodeSchema = z.object({
  path: z
    .string()
    .describe('Node path relative to the searched directory, `/`-separated. Never empty.'),
  entry: DirectoryEntrySchema.describe('Entry metadata. `childCount` is not computed for search results.'),
  score: z
    .number()
    .int()
    .nullable()
    .default(null)
    .describe(
      'Fuzzy score of the name match (higher is better). Null for directories included only ' +
        'because they are ancestors of matches.',
    ),
})
export type SearchNode = z.infer<typeof SearchNodeSchema>

export const SearchStatsSchema = z.object({
  matchCount: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe('Matches found during the walk, before trimming to `limit`. A lower bound when truncated.'),
  returnedMatchCount: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe('Matches kept after trimming to the best-scoring `limit`.'),
  scannedDirectoryCount: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe('Directories read during the walk.'),
  truncated: z
    .boolean()
    .default(false)
    .describe('True when the walk stopped early (time budget, overscan cap, or client abort).'),
  elapsedMilliseconds: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe('Wall-clock duration of the walk.'),
})
export type SearchStats = z.infer<typeof SearchStatsSchema>

export const SearchSubtreeResultSchema = z.object({
  rootPath: z.string().describe('Absolute path of the served root on the local machine.'),
  relativePath: z
    .string()
    .describe('Searched directory, relative to the served root. Empty string for the root itself.'),
  pattern: z.string().describe('The fuzzy pattern this result was scored against.'),
  nodes: z
    .array(SearchNodeSchema)
    .default([])
    .describe(
      'Pruned result tree as a flat node list: the best-scoring matches plus every ancestor ' +
        'directory needed to connect them to the searched directory. Unordered.',
    ),
  stats: SearchStatsSchema,
})
export type SearchSubtreeResult = z.infer<typeof SearchSubtreeResultSchema>

export const SearchSubtreeQuerySchema = z.object({
  path: z
    .string()
    .default('')
    .describe('Directory to search under, relative to the served root. Defaults to the root itself.'),
  // Required input, deliberately defaultless (ADR-0029): an empty pattern is a
  // caller bug, not a searchable value.
  pattern: z.string().min(1).describe('Fuzzy pattern to score entry names against.'),
  showHidden: z
    .stringbool()
    .default(false)
    .describe('Include dot-files and descend into dot-directories.'),
  showGitignored: z
    .stringbool()
    .default(false)
    .describe('Include gitignored entries and descend into gitignored directories.'),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(500)
    .default(100)
    .describe('Maximum number of matches to return (the walk overscans 10× this).'),
})
export type SearchSubtreeQuery = z.infer<typeof SearchSubtreeQuerySchema>
