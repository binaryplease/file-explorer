import { fuzzyScore } from '../../shared/fuzzy'
import type { PreviewLine } from '../../shared/preview.schema'

// An identifier-word: the searchable unit of a text document. Letters, numbers
// and underscores group together (so `parseConfig` and `parse_config` each read
// as one word a short pattern can land on), everything else separates.
const WORD_CHARACTER = /[\p{L}\p{N}_]/u

// One line's search result: which code-point indexes within the line the
// pattern matched (the union across every matching word on the line, so the
// renderer can highlight exactly the matched characters — ADR-0019), and how
// many of the line's words matched.
export type DocumentLineMatch = {
  matchedIndexes: ReadonlySet<number>
  wordMatchCount: number
}

export type DocumentSearchResult = {
  // Indexed 1:1 with the input lines; a line with no match holds an empty set.
  lineMatches: DocumentLineMatch[]
  // Indexes into `lines` that hold at least one match, in document order — the
  // jump targets for next/previous navigation.
  matchedLineIndexes: number[]
  // Total matching words across the document.
  totalMatchCount: number
}

// Shared empty result so an inactive search allocates nothing per line.
const EMPTY_LINE_MATCH: DocumentLineMatch = { matchedIndexes: new Set(), wordMatchCount: 0 }

function isWordCharacter(character: string): boolean {
  return WORD_CHARACTER.test(character)
}

// Fuzzy-searches every line's words for `pattern`, broot-style, returning the
// matched character positions so the preview can highlight which words matched
// and why (ADR-0019). Matching is per word — a document's searchable unit — so a
// short pattern lands on whole identifiers rather than scattering matched holes
// across an entire line. The work is bounded only by the preview window the
// panel already holds — 4000 lines / 1 MiB for an ordinary selection, but 40 000
// lines / 8 MiB once the reader takes the full-text opt-in — and this runs on
// every keystroke, so the ceiling is the reader's, not a few hundred lines as it
// was when the window was 600. Unlike `tokenizePreviewLines`, which stops
// colouring above `HIGHLIGHT_MAX_LINES` (10 000) because tokenizing that many
// lines is felt on the main thread, there is deliberately no line guard here
// yet: the pass is far cheaper per line, and this repo optimizes when a real
// interaction misses a budget on a real file, not before (see
// docs/requirements/101-performance-budgets.md, where it is listed as a
// suspect). It stays client-only and off the core loop either way, so the tree's
// list/search/move never waits on it (AGENTS.md responsiveness principle).
export function searchDocument(
  lines: readonly PreviewLine[],
  pattern: string,
): DocumentSearchResult {
  if (pattern === '') {
    return {
      lineMatches: lines.map(() => EMPTY_LINE_MATCH),
      matchedLineIndexes: [],
      totalMatchCount: 0,
    }
  }

  const lineMatches: DocumentLineMatch[] = []
  const matchedLineIndexes: number[] = []
  let totalMatchCount = 0

  lines.forEach((line, lineIndex) => {
    // Work in code points throughout (the fuzzy engine does too), so a word's
    // matched indexes map back onto the line without astral-character drift.
    const characters = Array.from(line.text)
    const matchedIndexes = new Set<number>()
    let wordMatchCount = 0

    let wordStartIndex = -1
    // The sentinel final iteration (characterIndex === length) flushes a word
    // that runs to the end of the line without duplicating the scoring block.
    for (let characterIndex = 0; characterIndex <= characters.length; characterIndex++) {
      const insideWord =
        characterIndex < characters.length && isWordCharacter(characters[characterIndex]!)
      if (insideWord) {
        if (wordStartIndex === -1) wordStartIndex = characterIndex
        continue
      }
      if (wordStartIndex === -1) continue
      const word = characters.slice(wordStartIndex, characterIndex).join('')
      const scored = fuzzyScore(pattern, word)
      if (scored !== null) {
        wordMatchCount++
        for (const wordCharacterIndex of scored.matchedIndexes) {
          matchedIndexes.add(wordStartIndex + wordCharacterIndex)
        }
      }
      wordStartIndex = -1
    }

    if (wordMatchCount > 0) {
      lineMatches.push({ matchedIndexes, wordMatchCount })
      matchedLineIndexes.push(lineIndex)
      totalMatchCount += wordMatchCount
    } else {
      lineMatches.push(EMPTY_LINE_MATCH)
    }
  })

  return { lineMatches, matchedLineIndexes, totalMatchCount }
}

// Splits one run of characters — a plain line or a single syntax token — into
// contiguous matched / unmatched pieces, addressing the shared per-line matched
// set by each character's absolute code-point position. `startIndex` is the
// run's first character's position within the line.
export function splitRunByMatch(
  characters: readonly string[],
  startIndex: number,
  matchedIndexes: ReadonlySet<number>,
): Array<{ text: string; matched: boolean }> {
  const pieces: Array<{ text: string; matched: boolean }> = []
  characters.forEach((character, offset) => {
    const matched = matchedIndexes.has(startIndex + offset)
    const lastPiece = pieces[pieces.length - 1]
    if (lastPiece !== undefined && lastPiece.matched === matched) lastPiece.text += character
    else pieces.push({ text: character, matched })
  })
  return pieces
}
