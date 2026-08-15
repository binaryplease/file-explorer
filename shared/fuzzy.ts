// Scored fuzzy matching, re-engineered in TypeScript from broot's
// `src/pattern/fuzzy_pattern.rs` (MIT, https://github.com/Canop/broot) used as
// the reference spec — see `docs/research/2026-07-17-broot-engine.md`.
// Shared seam: the server ranks search results with the exact same code the
// client uses to highlight them, so scores and highlights can never drift.

export type FuzzySegment = { text: string; matched: boolean }
export type FuzzyScore = { score: number; matchedIndexes: number[] }
export type FuzzyResult = { matched: boolean; score: number; segments: FuzzySegment[] }

// Scoring constants, verbatim from broot's fuzzy_pattern.rs.
const BONUS_MATCH = 50_000
const BONUS_EXACT = 1_000
const BONUS_START = 10
const BONUS_START_WORD = 5
const BONUS_CANDIDATE_LENGTH = -1 // per candidate character
const BONUS_MATCH_LENGTH = -10 // per character of the matched span
const BONUS_NB_HOLES = -30 // per gap between matched characters
const BONUS_SINGLED_CHAR = -15 // per isolated matched character (not first/last)

const WORD_SEPARATORS = new Set(['-', '_', ' '])

// Cap on the number of gaps a match may contain, growing sublinearly with the
// pattern length (adapted from broot's per-length table).
function maximumHoleCount(patternLength: number): number {
  if (patternLength <= 1) return 0
  if (patternLength <= 2) return 1
  if (patternLength <= 4) return 2
  if (patternLength <= 6) return 3
  return Math.floor((patternLength * 4) / 7)
}

// Case- and diacritics-insensitive comparison, one character at a time so
// matched indexes stay aligned with the candidate (broot normalizes via the
// `secular` crate; NFD-stripping per character is the same idea).
const foldedCharacterCache = new Map<string, string>()
function foldCharacter(character: string): string {
  const cachedFold = foldedCharacterCache.get(character)
  if (cachedFold !== undefined) return cachedFold
  const lowered = character.toLowerCase()
  const stripped = lowered.normalize('NFD').replace(/\p{M}+/gu, '')
  const folded = stripped.length === 1 ? stripped : lowered
  foldedCharacterCache.set(character, folded)
  return folded
}

// Scores `pattern` against `candidate`, or returns null when it does not
// match. Tries every viable start position with a greedy forward match and
// keeps the best-scoring one (broot's gap-compaction strategy). Indexes in
// `matchedIndexes` are code-point positions within the candidate.
export function fuzzyScore(pattern: string, candidate: string): FuzzyScore | null {
  if (pattern === '') return { score: 0, matchedIndexes: [] }
  const patternCharacters = Array.from(pattern, foldCharacter)
  const candidateCharacters = Array.from(candidate)
  const foldedCandidate = candidateCharacters.map(foldCharacter)
  const patternLength = patternCharacters.length
  const candidateLength = candidateCharacters.length
  if (patternLength > candidateLength) return null
  const holeCap = maximumHoleCount(patternLength)

  function matchFromStart(startIndex: number): FuzzyScore | null {
    const matchedIndexes = [startIndex]
    let holeCount = 0
    let candidateIndex = startIndex + 1
    for (let patternIndex = 1; patternIndex < patternLength; patternIndex++) {
      let isInHole = false
      while (true) {
        if (candidateIndex >= candidateLength) return null
        if (foldedCandidate[candidateIndex] === patternCharacters[patternIndex]) break
        if (!isInHole) {
          isInHole = true
          holeCount++
          if (holeCount > holeCap) return null
        }
        candidateIndex++
      }
      matchedIndexes.push(candidateIndex)
      candidateIndex++
    }

    const lastMatchedIndex = matchedIndexes[matchedIndexes.length - 1]!
    let score = BONUS_MATCH
    score += BONUS_CANDIDATE_LENGTH * candidateLength
    score += BONUS_NB_HOLES * holeCount
    score += BONUS_MATCH_LENGTH * (lastMatchedIndex - startIndex + 1)
    if (startIndex === 0) {
      score += BONUS_START
      if (candidateLength === patternLength) score += BONUS_EXACT
    } else if (WORD_SEPARATORS.has(candidateCharacters[startIndex - 1]!)) {
      score += BONUS_START_WORD
    }
    for (let matchedOrdinal = 1; matchedOrdinal < matchedIndexes.length - 1; matchedOrdinal++) {
      const matchedIndex = matchedIndexes[matchedOrdinal]!
      const isIsolated =
        matchedIndexes[matchedOrdinal - 1]! < matchedIndex - 1 &&
        matchedIndexes[matchedOrdinal + 1]! > matchedIndex + 1
      if (isIsolated) score += BONUS_SINGLED_CHAR
    }
    return { score, matchedIndexes }
  }

  let bestMatch: FuzzyScore | null = null
  for (let startIndex = 0; startIndex <= candidateLength - patternLength; startIndex++) {
    if (foldedCandidate[startIndex] !== patternCharacters[0]) continue
    const attempt = matchFromStart(startIndex)
    if (attempt !== null && (bestMatch === null || attempt.score > bestMatch.score)) {
      bestMatch = attempt
    }
  }
  return bestMatch
}

// Splits the candidate into contiguous matched/unmatched segments so the UI
// can highlight exactly the characters the best-scoring match used (ADR-0019).
export function fuzzyMatch(pattern: string, candidate: string): FuzzyResult {
  const unmatchedSegments: FuzzySegment[] =
    candidate === '' ? [] : [{ text: candidate, matched: false }]
  if (pattern === '') return { matched: true, score: 0, segments: unmatchedSegments }
  const scored = fuzzyScore(pattern, candidate)
  if (scored === null) return { matched: false, score: 0, segments: unmatchedSegments }

  const matchedIndexSet = new Set(scored.matchedIndexes)
  const segments: FuzzySegment[] = []
  Array.from(candidate).forEach((character, characterIndex) => {
    const characterMatches = matchedIndexSet.has(characterIndex)
    const lastSegment = segments[segments.length - 1]
    if (lastSegment !== undefined && lastSegment.matched === characterMatches) {
      lastSegment.text += character
    } else {
      segments.push({ text: character, matched: characterMatches })
    }
  })
  return { matched: true, score: scored.score, segments }
}
