import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Re-engineered gitignore matching (broot ships its own `Ignorer` on git2; we
// port the semantics, not the code). A rule set is parsed per `.gitignore`
// file; files stack into a chain from the served root down to the directory
// being read, outermost first, and the last matching rule wins. A directory
// matched by a non-negated rule ignores its whole subtree — like git, a
// negation deeper down cannot re-include it.

export type IgnoreRule = {
  pathRegex: RegExp
  isNegated: boolean
  isDirectoryOnly: boolean
}

export type IgnoreFile = {
  directoryAbsolutePath: string
  rules: IgnoreRule[]
}

function escapeRegexCharacter(character: string): string {
  return /[.*+?^${}()|[\]\\/]/.test(character) ? `\\${character}` : character
}

// Translates one gitignore glob into a regex source (no anchors). `*` and `?`
// never cross a slash; `**` does, in its three positional forms.
function translateGlobToRegexSource(globPattern: string): string {
  let regexSource = ''
  let index = 0
  while (index < globPattern.length) {
    const character = globPattern[index]!
    if (character === '\\' && index + 1 < globPattern.length) {
      regexSource += escapeRegexCharacter(globPattern[index + 1]!)
      index += 2
    } else if (character === '*' && globPattern[index + 1] === '*') {
      if (globPattern[index + 2] === '/') {
        regexSource += '(?:[^/]+/)*'
        index += 3
      } else {
        regexSource += '.*'
        index += 2
      }
    } else if (character === '*') {
      regexSource += '[^/]*'
      index += 1
    } else if (character === '?') {
      regexSource += '[^/]'
      index += 1
    } else if (character === '[') {
      const classEnd = globPattern.indexOf(']', index + 2)
      if (classEnd === -1) {
        regexSource += '\\['
        index += 1
      } else {
        let classBody = globPattern.slice(index + 1, classEnd)
        if (classBody.startsWith('!')) classBody = `^${classBody.slice(1)}`
        regexSource += `[${classBody}]`
        index = classEnd + 1
      }
    } else {
      regexSource += escapeRegexCharacter(character)
      index += 1
    }
  }
  return regexSource
}

export function parseGitignoreContent(content: string): IgnoreRule[] {
  const rules: IgnoreRule[] = []
  for (const rawLine of content.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line === '' || line.startsWith('#')) continue
    // Trailing whitespace is ignored unless backslash-escaped.
    let pattern = line.replace(/(?<!\\)[ \t]+$/, '')
    let isNegated = false
    if (pattern.startsWith('!')) {
      isNegated = true
      pattern = pattern.slice(1)
    }
    let isDirectoryOnly = false
    if (pattern.endsWith('/')) {
      isDirectoryOnly = true
      pattern = pattern.slice(0, -1)
    }
    if (pattern === '') continue
    // A slash anywhere (before stripping the trailing one) anchors the pattern
    // to the .gitignore's own directory; otherwise it matches any basename in
    // the subtree.
    const isAnchored = pattern.includes('/')
    if (pattern.startsWith('/')) pattern = pattern.slice(1)
    const regexSource = translateGlobToRegexSource(pattern)
    try {
      rules.push({
        pathRegex: isAnchored
          ? new RegExp(`^${regexSource}$`)
          : new RegExp(`(?:^|/)${regexSource}$`),
        isNegated,
        isDirectoryOnly,
      })
    } catch {
      // A malformed pattern (unbalanced class, etc.) is skipped, as git does.
    }
  }
  return rules
}

// Reads and parses `<directory>/.gitignore`; null when absent or empty.
export async function loadIgnoreFile(directoryAbsolutePath: string): Promise<IgnoreFile | null> {
  let content: string
  try {
    content = await readFile(join(directoryAbsolutePath, '.gitignore'), 'utf8')
  } catch {
    return null
  }
  const rules = parseGitignoreContent(content)
  return rules.length === 0 ? null : { directoryAbsolutePath, rules }
}

// Tests one path against a chain of ignore files (outermost first). Each file
// only sees paths below its own directory; within the chain, the last
// matching rule decides.
export function isPathIgnored(
  ignoreChain: readonly IgnoreFile[],
  absolutePath: string,
  isDirectory: boolean,
): boolean {
  let ignored = false
  for (const ignoreFile of ignoreChain) {
    const basePrefix = ignoreFile.directoryAbsolutePath.endsWith('/')
      ? ignoreFile.directoryAbsolutePath
      : `${ignoreFile.directoryAbsolutePath}/`
    if (!absolutePath.startsWith(basePrefix)) continue
    const relativePath = absolutePath.slice(basePrefix.length)
    for (const rule of ignoreFile.rules) {
      if (rule.isDirectoryOnly && !isDirectory) continue
      if (rule.pathRegex.test(relativePath)) ignored = !rule.isNegated
    }
  }
  return ignored
}
