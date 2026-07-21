import { describe, expect, test } from 'bun:test'
import { searchDocument, splitRunByMatch } from './documentSearch'
import type { PreviewLine } from '../../shared/preview.schema'

function lines(...texts: string[]): PreviewLine[] {
  return texts.map((text, index) => ({ number: index + 1, text }))
}

describe('searchDocument', () => {
  test('an empty pattern matches nothing and leaves every line empty', () => {
    const result = searchDocument(lines('const value = 1', 'return value'), '')
    expect(result.totalMatchCount).toBe(0)
    expect(result.matchedLineIndexes).toEqual([])
    expect(result.lineMatches.every((lineMatch) => lineMatch.matchedIndexes.size === 0)).toBe(true)
  })

  test('fuzzy-matches words and reports the matching lines in document order', () => {
    const result = searchDocument(
      lines('function parseConfig() {', '  // nothing here', '  return parse(config)'),
      'parse',
    )
    // Line 0 has `parseConfig`, line 2 has `parse` — line 1 matches nothing.
    expect(result.matchedLineIndexes).toEqual([0, 2])
    expect(result.totalMatchCount).toBe(2)
    expect(result.lineMatches[1]!.matchedIndexes.size).toBe(0)
  })

  test('highlights only the matched characters within a fuzzy-matched word', () => {
    // `pConfig` fuzzy-matches `parseConfig`: the p, then Config (one hole span).
    const [lineMatch] = searchDocument(lines('parseConfig'), 'pConfig').lineMatches
    expect(lineMatch!.matchedIndexes.size).toBeGreaterThan(0)
    const matched = Array.from('parseConfig')
      .map((character, index) => (lineMatch!.matchedIndexes.has(index) ? character : ''))
      .join('')
    // Only the characters the best-scoring fuzzy match used are highlighted, in
    // order — not the whole word (ADR-0019 shows *why* it matched).
    expect(matched.toLowerCase()).toBe('pconfig')
  })

  test('counts every matching word on a line', () => {
    const result = searchDocument(lines('value value other value'), 'value')
    expect(result.totalMatchCount).toBe(3)
    expect(result.matchedLineIndexes).toEqual([0])
  })

  test('treats underscores as part of a word so snake_case matches whole', () => {
    const result = searchDocument(lines('parse_config = 1'), 'parseconfig')
    expect(result.matchedLineIndexes).toEqual([0])
  })

  test('is case-insensitive, matching broot fuzzy semantics', () => {
    expect(searchDocument(lines('README'), 'readme').matchedLineIndexes).toEqual([0])
  })
})

describe('splitRunByMatch', () => {
  test('coalesces adjacent characters into matched / unmatched runs', () => {
    const pieces = splitRunByMatch(Array.from('abcdef'), 0, new Set([2, 3]))
    expect(pieces).toEqual([
      { text: 'ab', matched: false },
      { text: 'cd', matched: true },
      { text: 'ef', matched: false },
    ])
  })

  test('addresses the match set by the run offset within the line', () => {
    // A run that starts at line offset 4 — only its second character is matched.
    const pieces = splitRunByMatch(Array.from('xy'), 4, new Set([5]))
    expect(pieces).toEqual([
      { text: 'x', matched: false },
      { text: 'y', matched: true },
    ])
  })
})
