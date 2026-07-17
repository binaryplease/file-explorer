import { describe, expect, test } from 'bun:test'
import { isPathIgnored, parseGitignoreContent, type IgnoreFile } from './ignore'

function ignoreFileAt(directoryAbsolutePath: string, content: string): IgnoreFile {
  return { directoryAbsolutePath, rules: parseGitignoreContent(content) }
}

describe('parseGitignoreContent', () => {
  test('skips blanks and comments', () => {
    expect(parseGitignoreContent('\n# comment\n\n')).toHaveLength(0)
  })
})

describe('isPathIgnored', () => {
  const repoRoot = '/repo'

  test('basename patterns match at any depth', () => {
    const chain = [ignoreFileAt(repoRoot, 'node_modules\n*.log')]
    expect(isPathIgnored(chain, '/repo/node_modules', true)).toBe(true)
    expect(isPathIgnored(chain, '/repo/packages/app/node_modules', true)).toBe(true)
    expect(isPathIgnored(chain, '/repo/deep/debug.log', false)).toBe(true)
    expect(isPathIgnored(chain, '/repo/debug.log.txt', false)).toBe(false)
  })

  test('star does not cross directory boundaries', () => {
    const chain = [ignoreFileAt(repoRoot, 'build/*.js')]
    expect(isPathIgnored(chain, '/repo/build/out.js', false)).toBe(true)
    expect(isPathIgnored(chain, '/repo/build/nested/out.js', false)).toBe(false)
  })

  test('double star crosses directory boundaries', () => {
    const chain = [ignoreFileAt(repoRoot, 'build/**\n**/generated')]
    expect(isPathIgnored(chain, '/repo/build/nested/out.js', false)).toBe(true)
    expect(isPathIgnored(chain, '/repo/build', true)).toBe(false)
    expect(isPathIgnored(chain, '/repo/a/b/generated', true)).toBe(true)
  })

  test('anchored patterns only match relative to their gitignore directory', () => {
    const chain = [ignoreFileAt(repoRoot, '/dist')]
    expect(isPathIgnored(chain, '/repo/dist', true)).toBe(true)
    expect(isPathIgnored(chain, '/repo/packages/dist', true)).toBe(false)
  })

  test('directory-only patterns never match files', () => {
    const chain = [ignoreFileAt(repoRoot, 'cache/')]
    expect(isPathIgnored(chain, '/repo/cache', true)).toBe(true)
    expect(isPathIgnored(chain, '/repo/cache', false)).toBe(false)
  })

  test('negation re-includes, last matching rule wins', () => {
    const chain = [ignoreFileAt(repoRoot, '*.log\n!keep.log')]
    expect(isPathIgnored(chain, '/repo/debug.log', false)).toBe(true)
    expect(isPathIgnored(chain, '/repo/keep.log', false)).toBe(false)
  })

  test('an inner gitignore overrides an outer one', () => {
    const chain = [
      ignoreFileAt(repoRoot, '*.snap'),
      ignoreFileAt('/repo/tests', '!golden.snap'),
    ]
    expect(isPathIgnored(chain, '/repo/tests/other.snap', false)).toBe(true)
    expect(isPathIgnored(chain, '/repo/tests/golden.snap', false)).toBe(false)
  })

  test('an inner gitignore does not leak outside its directory', () => {
    const chain = [ignoreFileAt('/repo/sub', 'secret')]
    expect(isPathIgnored(chain, '/repo/sub/secret', false)).toBe(true)
    expect(isPathIgnored(chain, '/repo/secret', false)).toBe(false)
  })

  test('question mark and character classes stay within a segment', () => {
    const chain = [ignoreFileAt(repoRoot, 'file?.txt\n*.sw[po]')]
    expect(isPathIgnored(chain, '/repo/file1.txt', false)).toBe(true)
    expect(isPathIgnored(chain, '/repo/file12.txt', false)).toBe(false)
    expect(isPathIgnored(chain, '/repo/.index.swp', false)).toBe(true)
    expect(isPathIgnored(chain, '/repo/.index.swx', false)).toBe(false)
  })
})
