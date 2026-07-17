export type FuzzySegment = { text: string; matched: boolean }
export type FuzzyResult = { matched: boolean; segments: FuzzySegment[] }

// Case-insensitive subsequence match. Returns the candidate split into
// segments so the UI can highlight exactly the matched characters (ADR-0019).
export function fuzzyMatch(pattern: string, candidate: string): FuzzyResult {
  if (pattern === '') {
    return { matched: true, segments: candidate === '' ? [] : [{ text: candidate, matched: false }] }
  }
  const patternLower = pattern.toLowerCase()
  const candidateLower = candidate.toLowerCase()
  const segments: FuzzySegment[] = []
  let patternIndex = 0
  for (let candidateIndex = 0; candidateIndex < candidate.length; candidateIndex++) {
    const characterMatches =
      patternIndex < patternLower.length &&
      candidateLower[candidateIndex] === patternLower[patternIndex]
    if (characterMatches) patternIndex++
    const character = candidate[candidateIndex]!
    const lastSegment = segments[segments.length - 1]
    if (lastSegment !== undefined && lastSegment.matched === characterMatches) {
      lastSegment.text += character
    } else {
      segments.push({ text: character, matched: characterMatches })
    }
  }
  return { matched: patternIndex === patternLower.length, segments }
}
