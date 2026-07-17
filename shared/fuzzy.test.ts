import { describe, expect, test } from 'bun:test'
import { fuzzyMatch, fuzzyScore } from './fuzzy'

describe('fuzzyScore', () => {
  test('matches a plain subsequence and rejects a non-subsequence', () => {
    expect(fuzzyScore('idx', 'index.ts')).not.toBeNull()
    expect(fuzzyScore('xyz', 'index.ts')).toBeNull()
  })

  test('is case- and diacritics-insensitive', () => {
    expect(fuzzyScore('CAFE', 'café.txt')).not.toBeNull()
    expect(fuzzyScore('readme', 'README.md')).not.toBeNull()
  })

  test('an exact match outscores a prefix match, which outscores an inner match', () => {
    const exact = fuzzyScore('main', 'main')!.score
    const prefix = fuzzyScore('main', 'main.rs')!.score
    const inner = fuzzyScore('main', 'domain.rs')!.score
    expect(exact).toBeGreaterThan(prefix)
    expect(prefix).toBeGreaterThan(inner)
  })

  test('a compact match outscores a gappy match', () => {
    const compact = fuzzyScore('conf', 'config.ts')!.score
    const gappy = fuzzyScore('conf', 'collection-final.ts')!.score
    expect(compact).toBeGreaterThan(gappy)
  })

  test('a word-boundary start outscores a mid-word start', () => {
    const wordStart = fuzzyScore('view', 'tree-view.tsx')!.score
    const midWord = fuzzyScore('view', 'preview.tsx')!.score
    expect(wordStart).toBeGreaterThan(midWord)
  })

  test('shorter candidates outscore longer ones for the same match', () => {
    const short = fuzzyScore('app', 'app.tsx')!.score
    const long = fuzzyScore('app', 'application-window.tsx')!.score
    expect(short).toBeGreaterThan(long)
  })

  test('rejects matches with too many holes', () => {
    // Every pattern character exists in order, but each needs its own gap.
    expect(fuzzyScore('abcdef', 'a1b2c3d4e5f6')).toBeNull()
  })

  test('picks the best start position, not the first', () => {
    // Starting at the second `pat` yields a compact, word-boundary match.
    const result = fuzzyScore('pat', 'p-a-t_pattern')!
    expect(result.matchedIndexes).toEqual([6, 7, 8])
  })
})

describe('fuzzyMatch', () => {
  test('empty pattern matches everything without highlights', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({
      matched: true,
      score: 0,
      segments: [{ text: 'anything', matched: false }],
    })
  })

  test('segments cover the candidate exactly and highlight the matched characters', () => {
    const result = fuzzyMatch('idx', 'index.ts')
    expect(result.matched).toBe(true)
    expect(result.segments.map((segment) => segment.text).join('')).toBe('index.ts')
    expect(
      result.segments
        .filter((segment) => segment.matched)
        .map((segment) => segment.text)
        .join(''),
    ).toBe('idx')
  })
})
